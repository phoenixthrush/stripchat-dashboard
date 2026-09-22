# Ledger · Stripchat dashboard

A private, local dashboard for your token history. Plain HTML, CSS, JavaScript and SVG; no frontend dependencies, build step, CDN, tracking, or chart library. The Python server uses only `requests` and `python-dotenv` alongside the standard library.

## Run

Use **Python 3.10 or newer** (on macOS, `python3` may still be the system Python 3.9).

```sh
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python server.py
```

Open **http://127.0.0.1:8080**. Use `python server.py --port 9000` to choose another port. The server is intentionally bound to localhost; it is not a public multi-user service.

Keep your existing `.env` in the repository root, or copy `.env.example` and configure:

```dotenv
STRIPCHAT_USER_ID=your_numeric_user_id
STRIPCHAT_COOKIE=your_cookie_header
STRIPCHAT_USER_AGENT=your_browser_user_agent
```

The server reads the project-root `.env` independently of your working directory. Edits are picked up on the next pull. Optional existing settings remain supported: `STRIPCHAT_START_DATE`, `STRIPCHAT_END_DATE`, `STRIPCHAT_PAGE_SIZE` (capped at 200), `STRIPCHAT_REQUEST_DELAY_SECONDS`, and `STRIPCHAT_OUTPUT_FILE` (relative paths are resolved from the project root).

## Saved data and refresh

Opening, reloading, filtering, and switching themes **never contact Stripchat**. The dashboard reads the existing `payments.json` (or configured output file). A missing export produces an empty dashboard.

**Pull new data** is the only browser action that fetches history. It uses the existing Python authentication, pagination, delay, retry, deduplication and atomic-write logic. Progress appears in the page. Only one pull can run at a time. A successful pull replaces the saved export; a failed pull keeps the previous file. Reloading the page during a pull reconnects to its progress. Pulls cover the configured date range; they are not incremental merges. The original terminal fetcher remains available as an explicit alternative.

Cookies never go to the browser. Only explicit public assets and data endpoints are served; `.env`, Python source and private files cannot be retrieved through the web server. Cross-origin refresh requests are rejected. Do not expose this local service through a public reverse proxy without adding proper authentication.

## Views

- Overview: totals, averages, monthly purchases/spending, cumulative curves, VR split, full monthly table.
- Purchases: individual top-ups, token-package frequency, incoming/outgoing flow, cumulative net movement and API-reported totals.
- Spending: types, transaction-size distribution, daily spending, monthly change, sources and largest transactions.
- Activity: daily calendar, weekdays, UTC hours and weekday/hour heatmap.
- Recipients: rankings by tokens and frequency, complete recipient statistics.
- Ledger: search, category and date filters, sorting, pagination and filtered CSV export.
- Reference lab: the original seven payment-method package tables, tokens-per-euro comparison, cumulative XP, XP increments and a level explorer.
- Responsive light/dark themes, chart hover values, and a **Hide names** control that also anonymizes CSV exports. This is a presentation feature; data is still present in the local browser.

The date and VR filters affect all transaction-based views. Ledger search/category/sort controls affect only the ledger and CSV. Reference plots and last-pull API totals are explicitly unfiltered. All transaction dates, grouping and activity charts use **UTC**; the saved-file timestamp uses your browser's local timezone.

## Interpreting the data

Spending reuses the original summary's rules: negative-token records for the exported account, excluding `Paymentico` and `Negative Balance Loss`. Purchases are positive `purchase` records. Other records remain visible as adjustments/other. Net movement is the sum of signed transactions in the selected range, **not a live account balance**. Invalid dates/token values and duplicate records in old exports are excluded with a notice.

The current export's purchase `amount` values are zero. The dashboard does **not** invent euro/dollar spending totals or assume all credits are purchases. The next successful pull also saves the API's `inTokens`, `outTokens`, `inUsd`, `outUsd`, and `numberOfTransactions`; monetary fields are displayed as unverified API reference values, not billing totals.

Package prices and XP thresholds are copied from the original plotting scripts. They are static reference data, not current offers, confirmed rules, or your account's actual XP. The calendar shows the last 365 days of the selected interval. Rankings show the top ten; the recipient table includes everyone.

## Preserved terminal tools

```sh
python manual/main.py                  # Explicitly fetch and save history
python manual/summarize_payments.py    # Original terminal summary
pip install -r manual/requirements.txt # Optional plotting dependencies
python manual/plot/plot_xp_progression.py  # Original package comparison
python manual/plot/xp_by_level.py         # Original XP charts
```

`manual/main.py` delegates to the shared `fetcher.py`, so the CLI and web UI use the same fetch logic. The summary reads the configured export and `.env`. Matplotlib and NumPy are needed only for the manual plotting scripts.

## Checks

```sh
python -m unittest discover -s tests -v
node --check web/app.js  # Optional syntax check; Node is not needed to run the app
```

Tests use synthetic data and mock network requests; they never fetch your account or overwrite your export.
