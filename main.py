import json
import math
import os
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from tempfile import mkstemp
from typing import Any

import requests
from dotenv import load_dotenv

DEFAULT_START_DATE = "2000-01-01T00:00:00Z"
DEFAULT_PAGE_SIZE = 200  # API maximum page size
DEFAULT_OUTPUT_FILE = "payments.json"
DEFAULT_REQUEST_DELAY_SECONDS = 0.5
REQUEST_TIMEOUT_SECONDS = 30
MAX_RATE_LIMIT_RETRIES = 5
DEFAULT_RETRY_DELAY_SECONDS = 10
MAX_RETRY_DELAY_SECONDS = 120


@dataclass(frozen=True)
class Config:
    user_id: str
    cookie: str = field(repr=False)
    user_agent: str
    start_date: str
    end_date: str
    page_size: int
    output_file: Path
    request_delay_seconds: float


def required_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is not set. Add it to your .env file.")
    return value


def load_config() -> Config:
    load_dotenv()
    user_id = required_env("STRIPCHAT_USER_ID")
    if not user_id.isdigit():
        raise RuntimeError("STRIPCHAT_USER_ID must contain only digits.")

    cookie = required_env("STRIPCHAT_COOKIE")
    user_agent = required_env("STRIPCHAT_USER_AGENT")

    try:
        page_size = int(os.getenv("STRIPCHAT_PAGE_SIZE", str(DEFAULT_PAGE_SIZE)))
        if page_size <= 0:
            raise ValueError
    except ValueError as error:
        raise RuntimeError("STRIPCHAT_PAGE_SIZE must be a positive integer.") from error

    try:
        request_delay = float(
            os.getenv(
                "STRIPCHAT_REQUEST_DELAY_SECONDS", str(DEFAULT_REQUEST_DELAY_SECONDS)
            )
        )
        if not math.isfinite(request_delay) or request_delay < 0:
            raise ValueError
    except ValueError as error:
        raise RuntimeError(
            "STRIPCHAT_REQUEST_DELAY_SECONDS must be a finite number, zero or greater."
        ) from error

    return Config(
        user_id=user_id,
        cookie=cookie,
        user_agent=user_agent,
        start_date=os.getenv("STRIPCHAT_START_DATE", DEFAULT_START_DATE).strip(),
        end_date=os.getenv(
            "STRIPCHAT_END_DATE",
            datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        ).strip(),
        page_size=page_size,
        output_file=Path(
            os.getenv("STRIPCHAT_OUTPUT_FILE", DEFAULT_OUTPUT_FILE)
        ).expanduser(),
        request_delay_seconds=request_delay,
    )


def create_session(cookie: str, user_agent: str) -> requests.Session:
    session = requests.Session()

    session.headers.update(
        {
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "en-US,en;q=0.9",
            "User-Agent": user_agent,
            "Cookie": cookie,
        }
    )

    return session


def get_reported_total(payload: dict[str, Any]) -> int | None:
    try:
        total = int(payload.get("numberOfTransactions"))
    except (TypeError, ValueError, OverflowError):
        return None
    return total if total >= 0 else None


def fetch_all_transactions(config: Config) -> list[dict[str, Any]]:
    base_url = f"https://stripchat.com/api/front/users/{config.user_id}/transactions"

    all_transactions: list[dict[str, Any]] = []
    offset = 0
    rate_limit_retries = 0

    with create_session(
        cookie=config.cookie,
        user_agent=config.user_agent,
    ) as session:
        while True:
            params = {
                "from": config.start_date,
                "until": config.end_date,
                "limit": config.page_size,
                "offset": offset,
            }

            print(f"Fetching offset {offset}...")

            try:
                response = session.get(
                    base_url,
                    params=params,
                    timeout=REQUEST_TIMEOUT_SECONDS,
                )
            except requests.RequestException as error:
                raise RuntimeError("Request failed.") from error

            if response.status_code in (401, 403):
                raise RuntimeError(
                    "Authentication failed. The configured cookie may be "
                    "expired, incomplete, or invalid."
                )

            if response.status_code == 429:
                rate_limit_retries += 1

                if rate_limit_retries > MAX_RATE_LIMIT_RETRIES:
                    raise RuntimeError(
                        "The server repeatedly rate-limited the requests."
                    )

                retry_after_header = response.headers.get("Retry-After")

                try:
                    retry_after = float(retry_after_header)
                except (TypeError, ValueError):
                    retry_after = DEFAULT_RETRY_DELAY_SECONDS

                retry_after = max(1.0, min(retry_after, MAX_RETRY_DELAY_SECONDS))

                print(
                    f"Rate limited. Waiting {retry_after:g} seconds "
                    f"before retry {rate_limit_retries}/{MAX_RATE_LIMIT_RETRIES}..."
                )

                time.sleep(retry_after)
                continue

            rate_limit_retries = 0

            try:
                response.raise_for_status()
            except requests.HTTPError as error:
                raise RuntimeError(
                    f"HTTP request failed with status {response.status_code}."
                ) from error

            try:
                payload = response.json()
            except ValueError as error:
                raise RuntimeError("The server did not return valid JSON.") from error

            if not isinstance(payload, dict):
                raise TypeError(
                    "Unexpected response format: the top-level JSON value "
                    "is not an object."
                )

            transactions = payload.get("transactions", [])

            if not isinstance(transactions, list):
                raise TypeError(
                    "Unexpected response format: 'transactions' is not a list."
                )

            reported_total = get_reported_total(payload)

            if not transactions:
                print("No more transactions returned.")
                break

            valid_transactions = [
                transaction
                for transaction in transactions
                if isinstance(transaction, dict)
            ]

            all_transactions.extend(valid_transactions)

            total_text = f"/{reported_total}" if reported_total is not None else ""

            print(
                f"Received {len(valid_transactions)} transactions "
                f"({len(all_transactions)}{total_text} collected)"
            )

            if reported_total is not None and len(all_transactions) >= reported_total:
                break

            if len(transactions) < config.page_size:
                break

            offset += len(transactions)
            time.sleep(config.request_delay_seconds)

    return all_transactions


def remove_duplicates(
    transactions: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    unique_transactions: dict[str, dict[str, Any]] = {}
    records_without_ids: list[dict[str, Any]] = []

    for transaction in transactions:
        transaction_id = transaction.get("id")

        if transaction_id is None:
            records_without_ids.append(transaction)
            continue

        unique_transactions[str(transaction_id)] = transaction

    return list(unique_transactions.values()) + records_without_ids


def sort_by_date(
    transactions: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    return sorted(
        transactions,
        key=lambda transaction: str(transaction.get("date", "")),
        reverse=True,
    )


def write_output(output_file: Path, data: dict[str, Any]) -> None:
    output_file.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = mkstemp(
        dir=output_file.parent,
        prefix=f"{output_file.name}.",
        suffix=".tmp",
    )
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as temporary_file:
            json.dump(data, temporary_file, indent=2, ensure_ascii=False)
        temporary_path.replace(output_file)
    finally:
        temporary_path.unlink(missing_ok=True)


def main() -> int:
    try:
        config = load_config()

        transactions = fetch_all_transactions(config)
        transactions = remove_duplicates(transactions)
        transactions = sort_by_date(transactions)

        output = {
            "user_id": config.user_id,
            "from": config.start_date,
            "until": config.end_date,
            "count": len(transactions),
            "transactions": transactions,
        }

        write_output(config.output_file, output)

        print()
        print(f"Finished. Saved {len(transactions)} transactions.")
        print(f"Output file: {config.output_file}")

        return 0

    except KeyboardInterrupt:
        print("\nStopped by user.")
        return 1

    except (RuntimeError, OSError, TypeError, ValueError) as error:
        print(f"\nError: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
