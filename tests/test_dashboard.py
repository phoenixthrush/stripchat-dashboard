import json
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import fetcher
import server


def record(id="1", tokens=-10, kind="tip", **kwargs):
    return dict(
        id=id,
        tokens=tokens,
        type=kind,
        userId="42",
        username="Example",
        date="2026-01-01T12:00:00Z",
        **kwargs,
    )


class Response:
    def __init__(self, payload, status=200, headers=None):
        self.payload, self.status_code = payload, status
        self.headers = headers or {}

    def json(self):
        return self.payload

    def raise_for_status(self):
        pass


class Session:
    def __init__(self, responses):
        self.responses = iter(responses)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass

    def get(self, *args, **kwargs):
        return next(self.responses)


class DashboardTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "payments.json"
        self.config = fetcher.Config(
            "42",
            "private-cookie",
            "agent",
            "2000-01-01T00:00:00Z",
            "2026-01-02T00:00:00Z",
            2,
            self.path,
            0,
        )
        self.payload = {"user_id": "42", "transactions": [record()]}
        self.path.write_text(json.dumps(self.payload))
        self.path_patch = patch("server.output_path", return_value=self.path)
        self.path_patch.start()
        with server.LOCK:
            server.STATE.update(
                running=False, error=None, message="", completed_at=None
            )

    def tearDown(self):
        self.path_patch.stop()
        self.temp.cleanup()

    def test_normalization_preserves_classification_and_utc(self):
        purchase = record("2", 100, "purchase")
        loss = record("3", 5, "loss")
        loss["username"] = "Negative Balance Loss"
        data = server.normalize_export(
            {
                "user_id": "42",
                "transactions": [
                    record(extra={"isVrModel": True}),
                    purchase,
                    loss,
                    {"id": "bad", "date": "invalid", "tokens": 2},
                    record(extra={"isVrModel": True}),
                ],
            }
        )
        self.assertEqual(len(data["transactions"]), 3)
        self.assertEqual(data["skipped"], 2)
        self.assertEqual(
            sum(abs(r["tokens"]) for r in data["transactions"] if r["spending"]), 10
        )
        self.assertTrue(data["transactions"][0]["vr"])
        self.assertTrue(data["transactions"][1]["purchase"])
        self.assertFalse(data["transactions"][2]["spending"])
        self.assertFalse(data["transactions"][2]["purchase"])

    def test_cached_read_never_fetches(self):
        original = self.path.read_bytes()
        with patch(
            "server.fetch_all_transactions",
            side_effect=AssertionError("Unexpected fetch"),
        ):
            for _ in range(3):
                self.assertEqual(len(server.cached_data()["transactions"]), 1)
        self.assertEqual(original, self.path.read_bytes())

    def test_failed_refresh_preserves_export(self):
        original = self.path.read_bytes()
        with (
            patch("server.load_config", return_value=self.config),
            patch(
                "server.fetch_all_transactions",
                side_effect=RuntimeError("secret-cookie"),
            ),
        ):
            server.refresh_worker()
        self.assertEqual(original, self.path.read_bytes())
        self.assertFalse(server.STATE["running"])
        self.assertNotIn("secret-cookie", server.STATE["error"])
        self.assertIsNotNone(server.STATE["error"])

    def test_invalid_new_history_keeps_old_export(self):
        original = self.path.read_bytes()
        invalid = record()
        invalid["date"] = "not-a-date"
        with (
            patch("server.load_config", return_value=self.config),
            patch("server.fetch_all_transactions", return_value=[invalid]),
        ):
            server.refresh_worker()
        self.assertEqual(original, self.path.read_bytes())
        self.assertIsNotNone(server.STATE["error"])

    def test_success_refresh_writes_deduplicated_export(self):
        def fetch(config, progress, metadata):
            progress("Test progress")
            metadata["inTokens"] = 100
            return [record(), record(), record("2", 100, "purchase")]

        with (
            patch("server.load_config", return_value=self.config),
            patch("server.fetch_all_transactions", side_effect=fetch),
        ):
            server.refresh_worker()
        data = json.loads(self.path.read_text())
        self.assertEqual(data["count"], 2)
        self.assertEqual(data["api_totals"]["inTokens"], 100)
        self.assertIsNone(server.STATE["error"])
        self.assertEqual(len(server.cached_data()["transactions"]), 2)

    def test_fetch_pagination_and_metadata(self):
        responses = [
            Response(
                {
                    "transactions": [record(), record("2")],
                    "numberOfTransactions": 3,
                    "outTokens": 30,
                }
            ),
            Response({"transactions": [record("3")], "numberOfTransactions": 3}),
        ]
        metadata = {}
        with patch("fetcher.create_session", return_value=Session(responses)):
            rows = fetcher.fetch_all_transactions(
                self.config, progress=lambda _: None, metadata=metadata
            )
        self.assertEqual(len(rows), 3)
        self.assertEqual(metadata["outTokens"], 30)

    def test_incomplete_or_repeated_history_rejected(self):
        for response in [
            Response({"transactions": [], "numberOfTransactions": 3}),
            Response(
                {"transactions": [record(), record("2")], "numberOfTransactions": 3}
            ),
        ]:
            with (
                self.subTest(response=response.payload),
                patch(
                    "fetcher.create_session",
                    return_value=Session(
                        [
                            Response(
                                {
                                    "transactions": [record(), record("2")],
                                    "numberOfTransactions": 3,
                                }
                            ),
                            response,
                        ]
                    ),
                ),
                self.assertRaises(RuntimeError),
            ):
                fetcher.fetch_all_transactions(self.config, progress=lambda _: None)

    def test_auth_and_malformed_payload_rejected(self):
        for r in [
            Response({}, 401),
            Response({}, 403),
            Response({}),
            Response({"transactions": "wrong"}),
        ]:
            with (
                patch("fetcher.create_session", return_value=Session([r])),
                self.assertRaises((RuntimeError, TypeError)),
            ):
                fetcher.fetch_all_transactions(self.config, progress=lambda _: None)

    def test_rate_limit_retries_then_succeeds(self):
        with (
            patch(
                "fetcher.create_session",
                return_value=Session(
                    [
                        Response({}, 429, {"Retry-After": "2"}),
                        Response({"transactions": []}),
                    ]
                ),
            ),
            patch("fetcher.time.sleep") as sleep,
        ):
            self.assertEqual(
                fetcher.fetch_all_transactions(self.config, progress=lambda _: None), []
            )
            sleep.assert_called_once_with(2)

    def test_atomic_write_failure_keeps_original(self):
        original = self.path.read_bytes()
        with (
            patch("pathlib.Path.replace", side_effect=OSError("fail")),
            self.assertRaises(OSError),
        ):
            fetcher.write_output(self.path, {"transactions": []})
        self.assertEqual(self.path.read_bytes(), original)
        self.assertEqual(list(self.path.parent.glob("*.tmp")), [])

    def test_http_cache_security_and_refresh_gate(self):
        http = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        thread = threading.Thread(target=http.serve_forever, daemon=True)
        thread.start()
        root = f"http://127.0.0.1:{http.server_port}"

        def request(path, method="GET", headers=None):
            return urlopen(
                Request(root + path, method=method, headers=headers or {}), timeout=3
            )

        try:
            with patch(
                "server.fetch_all_transactions",
                side_effect=AssertionError("GET fetched data"),
            ):
                self.assertEqual(
                    json.load(request("/api/data"))["transactions"][0]["tokens"], -10
                )
                self.assertEqual(request("/").status, 200)
            for path in ["/.env", "/payments.json", "/../.env", "/fetcher.py"]:
                with self.assertRaises(HTTPError) as error:
                    request(path)
                self.assertEqual(error.exception.code, 404)
                error.exception.close()
            for headers in [
                {},
                {
                    "X-Refresh-Token": server.REFRESH_TOKEN,
                    "Origin": "https://other.example",
                },
                {"Host": "attacker.example"},
            ]:
                with self.assertRaises(HTTPError) as error:
                    request("/api/refresh", "POST", headers)
                self.assertEqual(error.exception.code, 403)
                error.exception.close()
            with patch("server.refresh_worker") as worker:
                self.assertEqual(
                    request(
                        "/api/refresh",
                        "POST",
                        {"X-Refresh-Token": server.REFRESH_TOKEN},
                    ).status,
                    202,
                )
                worker.assert_called_once()
                with self.assertRaises(HTTPError) as error:
                    request(
                        "/api/refresh",
                        "POST",
                        {"X-Refresh-Token": server.REFRESH_TOKEN},
                    )
                self.assertEqual(error.exception.code, 409)
                error.exception.close()
        finally:
            http.shutdown()
            http.server_close()
            thread.join()


if __name__ == "__main__":
    unittest.main()
