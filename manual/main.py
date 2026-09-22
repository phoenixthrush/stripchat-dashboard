"""Standalone terminal fetcher; shares the dashboard fetch implementation."""

import sys

if sys.version_info < (3, 11):  # noqa: UP036 — explain unsupported Python when run directly
    raise SystemExit("Python 3.11 or newer is required.")
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fetcher import main

if __name__ == "__main__":
    raise SystemExit(main())
