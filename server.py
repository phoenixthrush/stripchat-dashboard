"""Local dashboard. GET requests never contact Stripchat."""

import argparse
import json
import math
import secrets
import threading
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

from fetcher import (
    ROOT,
    fetch_all_transactions,
    load_config,
    output_path,
    remove_duplicates,
    sort_by_date,
    write_output,
)
from manual.summarize_payments import (
    is_vr_transaction,
    parse_transaction_date,
    prepare_records,
)

WEB = ROOT / "web"
REFRESH_TOKEN = secrets.token_urlsafe(32)
LOCK = threading.Lock()
STATE = {"running": False, "message": "", "error": None, "completed_at": None}


def normalize_export(data):
    raw = data.get("transactions") if isinstance(data, dict) else data
    if not isinstance(raw, list):
        raise TypeError("The saved export must contain a transactions list.")
    records = remove_duplicates([r for r in raw if isinstance(r, dict)])
    user_id = (
        str(data["user_id"]) if isinstance(data, dict) and data.get("user_id") else None
    )
    spending = prepare_records(records, user_id)
    spending_ids = {str(r["id"]) for r in spending if r["id"] is not None}
    rows, skipped = [], len(raw) - len(records)
    for r in records:
        dt = parse_transaction_date(r.get("date"))
        try:
            tokens = int(r.get("tokens", 0))
        except (ValueError, TypeError, OverflowError):
            skipped += 1
            continue
        if dt is None:
            skipped += 1
            continue
        extra = r.get("extra") if isinstance(r.get("extra"), dict) else {}
        is_spending = (
            str(r["id"]) in spending_ids
            if r.get("id") is not None
            else bool(prepare_records([r], user_id))
        )
        amount = r.get("amount")
        if not isinstance(amount, (int, float)) or not math.isfinite(amount):
            amount = None
        rows.append(
            {
                "id": str(r.get("id") or ""),
                "date": dt.isoformat().replace("+00:00", "Z"),
                "username": str(r.get("username") or "(unknown)"),
                "type": str(r.get("type") or "unknown"),
                "tokens": tokens,
                "amount": amount,
                "vr": is_vr_transaction(r),
                "spending": is_spending,
                "purchase": r.get("type") == "purchase" and tokens > 0,
                "source": str(extra.get("source") or "Unspecified"),
                "anonymous": r.get("isAnonymous") is True,
            }
        )
    rows.sort(key=lambda r: r["date"])
    return {
        "transactions": rows,
        "skipped": skipped,
        "from": data.get("from") if isinstance(data, dict) else None,
        "until": data.get("until") if isinstance(data, dict) else None,
        "api_totals": data.get("api_totals", {}) if isinstance(data, dict) else {},
    }


def cached_data():
    path = output_path()
    if not path.exists():
        return {"transactions": [], "exists": False, "saved_at": None, "skipped": 0}
    with path.open(encoding="utf-8") as stream:
        result = normalize_export(json.load(stream))
    result.update(
        exists=True,
        saved_at=datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat(),
    )
    return result


def progress(message):
    with LOCK:
        STATE["message"] = message


def refresh_worker():
    try:
        config = load_config()
        metadata = {}
        rows = sort_by_date(
            remove_duplicates(
                fetch_all_transactions(config, progress=progress, metadata=metadata)
            )
        )
        data = {
            "user_id": config.user_id,
            "from": config.start_date,
            "until": config.end_date,
            "count": len(rows),
            "transactions": rows,
            "api_totals": metadata,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        }
        # Validate before replacing the last successful export.
        normalized = normalize_export(data)
        if normalized["skipped"]:
            raise RuntimeError("The fetched history contains invalid records.")
        write_output(config.output_file, data)
        with LOCK:
            STATE.update(
                message=f"Saved {len(rows):,} transactions.",
                completed_at=data["fetched_at"],
            )
    except (RuntimeError, OSError, TypeError, ValueError):
        # Never expose request objects, credentials, or filesystem details.
        with LOCK:
            STATE.update(
                error="Refresh failed. Check your .env credentials, connection, and date range. Your previous export was kept.",
                message="Refresh failed; previous data kept.",
            )
    except Exception:  # noqa: BLE001
        with LOCK:
            STATE.update(
                error="Unexpected refresh failure. Your previous export was kept.",
                message="Refresh failed; previous data kept.",
            )
    finally:
        with LOCK:
            STATE["running"] = False


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def allowed_host(self):
        return self.headers.get("Host") in {
            f"127.0.0.1:{self.server.server_port}",
            f"localhost:{self.server.server_port}",
        }

    def respond(self, status, body, content_type="application/json; charset=utf-8"):
        if not isinstance(body, bytes):
            body = json.dumps(body, allow_nan=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
        )
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if not self.allowed_host():
            return self.respond(403, {"error": "Local access only."})
        route = urlsplit(self.path).path
        if route == "/api/status":
            with LOCK:
                state = dict(STATE)
            return self.respond(200, {**state, "refresh_token": REFRESH_TOKEN})
        if route == "/api/data":
            try:
                return self.respond(200, cached_data())
            except (OSError, ValueError, TypeError, OverflowError):
                return self.respond(
                    422,
                    {
                        "error": "Could not read the saved export. Fix payments.json or pull fresh data."
                    },
                )
        files = {
            "/": ("index.html", "text/html; charset=utf-8"),
            "/app.js": ("app.js", "text/javascript; charset=utf-8"),
            "/style.css": ("style.css", "text/css; charset=utf-8"),
            "/reference.json": ("reference.json", "application/json"),
        }
        if route not in files:
            return self.respond(404, {"error": "Not found."})
        filename, mime = files[route]
        return self.respond(200, (WEB / filename).read_bytes(), mime)

    def do_POST(self):
        if not self.allowed_host():
            return self.respond(403, {"error": "Local access only."})
        origin = self.headers.get("Origin")
        if origin and origin != "http://" + self.headers.get("Host", ""):
            return self.respond(403, {"error": "Origin rejected."})
        if self.headers.get(
            "Sec-Fetch-Site"
        ) == "cross-site" or not secrets.compare_digest(
            self.headers.get("X-Refresh-Token", ""), REFRESH_TOKEN
        ):
            return self.respond(403, {"error": "Refresh token required."})
        if self.path != "/api/refresh":
            return self.respond(404, {"error": "Not found."})
        with LOCK:
            if STATE["running"]:
                return self.respond(409, {"error": "A refresh is already running."})
            STATE.update(running=True, error=None, message="Connecting to Stripchat…")
        threading.Thread(target=refresh_worker, daemon=True).start()
        return self.respond(202, {"started": True})


def main():
    parser = argparse.ArgumentParser(description="Local Stripchat dashboard")
    parser.add_argument("--port", type=int, default=8080)
    args = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(
        f"Dashboard: http://127.0.0.1:{server.server_port}\nSaved data only until you click Pull new data."
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
