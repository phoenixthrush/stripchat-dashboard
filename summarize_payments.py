import json
import os
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

INPUT_FILE = Path("payments.json")
ANONYMIZE = False
EXCLUDED_NAMES = {
    "Paymentico",
    "Negative Balance Loss",
}
LARGEST_TRANSACTIONS_TO_SHOW = 20
WEEKDAYS = (
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
)


@dataclass
class SpendingSummary:
    tokens: int = 0
    transactions: int = 0
    vr_tokens: int = 0
    vr_transactions: int = 0
    users: set[str] = field(default_factory=set)
    active_days: set[date] = field(default_factory=set)

    def add(self, record: dict[str, Any]) -> None:
        self.tokens += record["tokens"]
        self.transactions += 1
        self.users.add(record["username"])
        self.active_days.add(record["date"].date())
        if record["is_vr"]:
            self.vr_tokens += record["tokens"]
            self.vr_transactions += 1

    @property
    def non_vr_tokens(self) -> int:
        return self.tokens - self.vr_tokens

    @property
    def average_transaction(self) -> float:
        return self.tokens / self.transactions if self.transactions else 0

    @property
    def average_active_day(self) -> float:
        return self.tokens / len(self.active_days) if self.active_days else 0

    @property
    def vr_percent(self) -> float:
        return self.vr_tokens / self.tokens * 100 if self.tokens else 0


def group_spending(
    records: list[dict[str, Any]], key: str
) -> dict[Any, SpendingSummary]:
    groups = defaultdict(SpendingSummary)
    for record in records:
        groups[record[key]].add(record)
    return groups


def get_transaction_user_id(transaction: dict[str, Any]) -> str | None:
    for key in ("userId", "user_id", "userID", "userid"):
        value = transaction.get(key)
        if value is not None:
            return str(value)
    return None


def parse_transaction_date(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None

    date_string = value.strip()

    if date_string.endswith("Z"):
        date_string = date_string[:-1] + "+00:00"

    try:
        date = datetime.fromisoformat(date_string)
    except ValueError:
        return None

    if date.tzinfo is None:
        date = date.replace(tzinfo=timezone.utc)

    return date.astimezone(timezone.utc)


def is_vr_transaction(transaction: dict[str, Any]) -> bool:
    transaction_type = transaction.get("type")

    if not isinstance(transaction_type, str):
        transaction_type = "unknown"

    extra = transaction.get("extra")

    if not isinstance(extra, dict):
        extra = {}

    return (
        transaction.get("isVrModel") is True
        or transaction_type.lower().startswith("vr")
        or extra.get("isVrModel") is True
    )


def display_username(username: str) -> str:
    return "<name_censored>" if ANONYMIZE else username


def display_id(transaction_id: Any) -> str:
    return "" if ANONYMIZE else str(transaction_id or "")


def print_section(title: str) -> None:
    print()
    print(title)
    print("-" * len(title))


def print_rows(
    rows: list[list[Any]],
    headers: list[str] | None = None,
) -> None:
    output_rows = [headers] + rows if headers else rows

    if not output_rows:
        print("(none)")
        return

    output_rows = [[str(value) for value in row] for row in output_rows]
    widths = [max(map(len, column)) for column in zip(*output_rows)]

    for row_number, row in enumerate(output_rows):
        print("  ".join(value.ljust(width) for value, width in zip(row, widths)))
        if headers and row_number == 0:
            print("  ".join("-" * width for width in widths))


def load_transactions() -> list[dict[str, Any]]:
    try:
        with INPUT_FILE.open("r", encoding="utf-8") as file:
            data = json.load(file)
    except FileNotFoundError as error:
        raise RuntimeError(f"Input file not found: {INPUT_FILE}") from error
    except PermissionError as error:
        raise RuntimeError(f"Permission denied reading: {INPUT_FILE}") from error
    except json.JSONDecodeError as error:
        raise RuntimeError(
            f"Invalid JSON in {INPUT_FILE}: line {error.lineno}, column {error.colno}"
        ) from error
    except OSError as error:
        raise RuntimeError(f"Could not read {INPUT_FILE}: {error}") from error

    transactions = data.get("transactions") if isinstance(data, dict) else data

    if not isinstance(transactions, list):
        raise TypeError(
            "The JSON input must be a list or contain a 'transactions' list."
        )

    return [
        transaction for transaction in transactions if isinstance(transaction, dict)
    ]


def prepare_records(
    transactions: list[dict[str, Any]],
    user_id: str | None,
) -> list[dict[str, Any]]:
    records = []

    for transaction in transactions:
        transaction_user_id = get_transaction_user_id(transaction)

        if user_id is not None and transaction_user_id != user_id:
            continue

        username_value = transaction.get("username")
        username = str(username_value).strip() if username_value is not None else ""
        username = username or "(unknown)"

        if username in EXCLUDED_NAMES:
            continue

        raw_tokens = transaction.get("tokens", 0)

        try:
            raw_tokens = int(raw_tokens)
        except (TypeError, ValueError):
            continue

        if raw_tokens >= 0:
            continue

        date = parse_transaction_date(transaction.get("date"))

        if date is None:
            continue

        records.append(
            {
                "id": transaction.get("id"),
                "username": username,
                "tokens": abs(raw_tokens),
                "type": str(transaction.get("type") or "unknown"),
                "date": date,
                "month": date.strftime("%Y-%m"),
                "weekday": date.strftime("%A"),
                "hour": date.hour,
                "is_vr": is_vr_transaction(transaction),
            }
        )

    records.sort(key=lambda record: record["date"])

    return records


def print_monthly_spending(monthly: dict[str, SpendingSummary]) -> None:
    print_section("Monthly spending")
    rows = []
    previous_tokens = None
    for month_name, month in sorted(monthly.items()):
        change = "-"
        if previous_tokens:
            change = f"{(month.tokens - previous_tokens) / previous_tokens * 100:.1f}%"
        rows.append(
            [
                month_name,
                f"{month.tokens:,}",
                f"{month.vr_tokens:,}",
                f"{month.non_vr_tokens:,}",
                f"{month.transactions:,}",
                f"{len(month.users):,}",
                f"{len(month.active_days):,}",
                f"{month.average_transaction:.1f}",
                f"{month.average_active_day:.1f}",
                f"{month.vr_percent:.1f}%",
                change,
            ]
        )
        previous_tokens = month.tokens

    print_rows(
        rows,
        [
            "Month",
            "Tokens",
            "VR",
            "Non-VR",
            "Txns",
            "Users",
            "Days",
            "Avg/txn",
            "Avg/day",
            "VR %",
            "MoM %",
        ],
    )


def print_report(records: list[dict[str, Any]]) -> None:
    total = SpendingSummary()
    for record in records:
        total.add(record)
    users = group_spending(records, "username")
    types = group_spending(records, "type")
    weekdays = group_spending(records, "weekday")
    hours = group_spending(records, "hour")

    print_section("Overall summary")
    print(f"Total tokens spent:       {total.tokens:,}")
    print(f"Total transactions:       {total.transactions:,}")
    print(f"Unique users:             {len(total.users):,}")
    print(f"Active days:              {len(total.active_days):,}")
    print(f"Average per transaction:  {total.average_transaction:.2f} tokens")
    print(f"Average per active day:   {total.average_active_day:.2f} tokens")
    if records:
        print(f"First transaction:        {records[0]['date'].isoformat()}")
        print(f"Last transaction:         {records[-1]['date'].isoformat()}")

    print_section("VR versus non-VR")
    vr_rows = []
    for category, tokens, count in (
        ("VR", total.vr_tokens, total.vr_transactions),
        ("Non-VR", total.non_vr_tokens, total.transactions - total.vr_transactions),
    ):
        percent = tokens / total.tokens * 100 if total.tokens else 0
        average = tokens / count if count else 0
        vr_rows.append(
            [category, f"{tokens:,}", f"{count:,}", f"{percent:.1f}%", f"{average:.2f}"]
        )
    print_rows(
        vr_rows,
        ["Category", "Tokens", "Transactions", "% of tokens", "Avg/transaction"],
    )

    print_monthly_spending(group_spending(records, "month"))

    print_section("Users by tokens")
    print_rows(
        [
            [
                display_username(username),
                f"{user.tokens:,}",
                f"{user.vr_tokens:,}",
                f"{user.non_vr_tokens:,}",
                f"{user.transactions:,}",
                f"{len(user.active_days):,}",
                f"{user.average_transaction:.1f}",
            ]
            for username, user in sorted(
                users.items(), key=lambda item: item[1].tokens, reverse=True
            )
        ],
        ["User", "Tokens", "VR", "Non-VR", "Txns", "Days", "Avg/txn"],
    )

    print_section("Transaction types")
    print_rows(
        [
            [
                transaction_type,
                f"{summary.tokens:,}",
                f"{summary.transactions:,}",
                f"{summary.vr_tokens:,}",
                f"{summary.non_vr_tokens:,}",
            ]
            for transaction_type, summary in sorted(
                types.items(), key=lambda item: item[1].tokens, reverse=True
            )
        ],
        ["Type", "Tokens", "Transactions", "VR", "Non-VR"],
    )

    print_section("Spending by weekday")
    print_rows(
        [
            [
                weekday,
                f"{weekdays[weekday].tokens:,}",
                f"{weekdays[weekday].transactions:,}",
                f"{weekdays[weekday].average_transaction:.1f}",
            ]
            for weekday in WEEKDAYS
            if weekday in weekdays
        ],
        ["Weekday", "Tokens", "Transactions", "Avg/transaction"],
    )

    print_section("Spending by UTC hour")
    print_rows(
        [
            [
                f"{hour:02d}:00",
                f"{summary.tokens:,}",
                f"{summary.transactions:,}",
                f"{summary.average_transaction:.1f}",
            ]
            for hour, summary in sorted(hours.items())
        ],
        ["UTC hour", "Tokens", "Transactions", "Avg/transaction"],
    )

    print_section("Largest individual transactions")
    largest_transactions = sorted(
        records, key=lambda record: record["tokens"], reverse=True
    )
    print_rows(
        [
            [
                record["date"].strftime("%Y-%m-%d %H:%M"),
                display_username(record["username"]),
                f"{record['tokens']:,}",
                record["type"],
                "VR" if record["is_vr"] else "Non-VR",
                display_id(record["id"]),
            ]
            for record in largest_transactions[:LARGEST_TRANSACTIONS_TO_SHOW]
        ],
        ["Date UTC", "User", "Tokens", "Type", "Mode", "ID"],
    )

    print_section("Users by transaction count")
    print_rows(
        [
            [
                display_username(username),
                f"{user.transactions:,}",
                f"{user.tokens:,}",
                f"{user.average_transaction:.1f}",
            ]
            for username, user in sorted(
                users.items(), key=lambda item: item[1].transactions, reverse=True
            )
        ],
        ["User", "Transactions", "Tokens", "Avg/transaction"],
    )


def main() -> int:
    try:
        user_id = os.getenv("STRIPCHAT_USER_ID")
        transactions = load_transactions()
        records = prepare_records(transactions, user_id)
        print_report(records)
        return 0
    except (RuntimeError, TypeError) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
