# Stripchat Dashboard

A private, local dashboard for your token history. Plain HTML, CSS, JavaScript and SVG; no frontend dependencies, build step, CDN, tracking, or chart library. The Python server uses only `requests` and `python-dotenv` alongside the standard library.

## Run

Use **Python 3.11 or newer** (on macOS, `python3` may still be the system Python 3.9).

```sh
python3.11 -m venv .venv
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

## How the dashboard works

```text
.env → fetcher.py → saved payments.json          (only on an explicit pull)
                        ↓
              server.py normalizes records
                        ↓
              pricing.py allocates FIFO costs
                        ↓
                  GET /api/data
                        ↓
             web/app.js filters and aggregates
                        ↓
                HTML tables and SVG charts
```

The frontend talks to the local Python server, not directly to Stripchat. Python supplies the cookie and user-agent headers from `.env` when fetching history. The website therefore needs the local server running; it is not a standalone static site.

`GET /api/data` rereads the saved export, removes duplicate/invalid records, converts dates to UTC, classifies transactions, sorts them chronologically and calculates euro estimates. The enriched rows are returned to the browser. These calculated fields are **not written back into `payments.json`**. Reloading recalculates estimates from the same saved transactions and current reference constants without fetching new history.

`POST /api/refresh` starts a background pull. The browser polls `GET /api/status` for progress and loads `/api/data` again when it finishes. Filters, search and chart interactions run in the browser against the loaded data.

| File | Responsibility |
| --- | --- |
| `fetcher.py` | `.env` configuration, authenticated fetching, pagination and saving the export |
| `server.py` | Local HTTP routes, refresh worker and transaction normalization |
| `pricing.py` | Package matching, fallback rates and chronological FIFO allocation |
| `web/reference.json` | Static token-package prices and XP thresholds |
| `web/app.js` | Filters, totals, charts, euro tooltips and CSV export |
| `web/index.html`, `web/style.css` | Page structure, styling and themes |
| `manual/` | Preserved terminal summary and plotting tools |

## Views

- Overview: totals, averages, monthly purchases/spending, cumulative curves, VR split, full monthly table.
- Purchases: individual top-ups, token-package frequency, incoming/outgoing flow, cumulative net movement and API-reported totals.
- Spending: types, transaction-size distribution, daily spending, monthly change, sources and largest transactions.
- Activity: daily calendar, weekdays, UTC hours and weekday/hour heatmap.
- Recipients: rankings by tokens and frequency, complete recipient statistics.
- Transactions: search, category and date filters, sorting, pagination and filtered CSV export.
- Reference lab: the original seven payment-method package tables, tokens-per-euro comparison, cumulative XP, XP increments and a level explorer.
- Responsive light/dark themes, clickable recipient profiles, chart hover values, and a **Hide names** control that also anonymizes CSV exports. Profile links are removed while names are hidden. This is a presentation feature; data is still present in the local browser.

The date inputs default to the first and last transaction dates in the saved history (UTC), and Reset restores that range. Refresh extends these defaults when they have not been customized. The date and VR filters affect all transaction-based views. Transaction search/category/sort controls affect only the transaction table and CSV. Reference plots and last-pull API totals are explicitly unfiltered. All transaction dates, grouping and activity charts use **UTC**; the saved-file timestamp uses your browser's local timezone.

## Interpreting the data

Spending reuses the original summary's rules: negative-token records for the exported account, excluding `Paymentico` and `Negative Balance Loss`. Purchases are positive `purchase` records. Other records remain visible as adjustments/other. The overview’s **Where the tokens went** card reconciles purchased tokens minus spending plus signed adjustments. It shows refunds and other credits/debits separately, with a **View adjustments** button that opens the filtered transaction table. The euro purchase total is gross, before refunds; refund tooltips estimate token value rather than cash returned.

Net movement is the sum of signed transactions in the selected range, **not a live account balance**. Invalid dates/token values and duplicate records in old exports are excluded with a notice.

### Estimated euro costs

Euro estimates use the package constants in `web/reference.json` (copied from the original plots). They are **estimates, not receipts or verified charges**; the token-history API has not provided actual purchase prices. No exchange-rate service or additional dependency is used.

1. Match each positive purchase to packages with exactly the same token count. If all matching payment methods have the same price, use that reference price. Duplicate packages across methods are counted only once. Ambiguous prices use their median and are labeled accordingly.
2. Allocate every outgoing transaction against the oldest available incoming token batches (**FIFO**). Spending that crosses two packages receives a proportional share of each package's cost. This is an accounting assumption; Stripchat does not report which package funded a tip.
3. An unmatched purchase, unknown credit, or missing opening inventory uses the **token-weighted euro rate of price-matched purchases**. If there are none, use the median per-token rate of distinct reference packages. The explanation and coverage chart show where fallback pricing was used. Other credits are valued for allocation purposes; they are not counted as purchases or assumed to be free.
4. Calculate costs across the **full saved history before applying date/VR filters**, so filtering does not reprice a tip or discard the package that funded it. Decimal arithmetic is used in Python; only presentation rounds to cents. Refund-like debits also consume inventory. Positive adjustments with unknown acquisition cost use the explicit fallback rather than guessing a reversed purchase.

Tokens are the primary unit in the overview, charts, recipient tables and transactions. Hover a token value, chart mark, bar or heatmap cell to see its estimated euro counterpart. Table and summary amounts also support keyboard focus and tapping. Euro totals and detailed pricing charts are grouped in the optional **Euro summary** panel. CSV exports retain both tokens and estimated euros. Count charts still show counts. Static XP charts remain XP references, since no actual XP-to-euro rule has been verified.

#### FIFO example

These are illustrative prices, not current Stripchat offers:

| Event, oldest first | Calculation | Result |
| --- | --- | --- |
| Buy 100 tokens for €10 | €10 / 100 | First batch: €0.10 per token |
| Buy 200 tokens for €16 | €16 / 200 | Second batch: €0.08 per token |
| Spend 150 tokens | 100 × €0.10 + 50 × €0.08 | Estimated cost: €14; 150 tokens remain in batch two |
| Spend another 100 tokens | 100 × €0.08 | Estimated cost: €8; 50 tokens remain, valued at €4 |

The first spending transaction has an effective rate of €14 / 150, while the next has a rate of €0.08. This is why multiplying every token total by one fixed rate would give different results. A tooltip for both spending transactions together sums their allocated costs: **250 tokens → €22**. Filtering out the purchases still leaves those same spending estimates.

#### Package matching and fallback details

- Package matching uses token count across **all** reference payment methods. The payment-method selector in Reference lab only changes that comparison chart/table; it does not choose the pricing method for your history.
- For a unique price, a purchase batch's rate is `reference package price / purchased tokens`. Repeated purchases each create their own batch.
- If a token size has several distinct prices, the batch uses the median of those prices (the midpoint of the two central prices for an even count). This is tracked as uncertain pricing rather than a uniquely matched package.
- The normal fallback rate is `sum(reference prices of uniquely matched purchases) / sum(tokens in those purchases)`, including repeated purchases. It is weighted by tokens, not a simple average of package rates. It uses the full saved history, including purchases later than an unmatched row.
- Without any uniquely matched purchases, fallback uses the median of `price / tokens` for the distinct `(token count, price)` reference packages. Duplicate copies of the same package across methods do not add weight.
- Every positive credit adds an inventory batch, and every negative transaction consumes inventory, even if it is excluded from spending statistics. Zero-token records have zero cost.
- If a debit exceeds available inventory, its uncovered tokens are valued at the fallback rate immediately. Later purchases do not retroactively fund that missing inventory. An incomplete export can therefore produce less precise estimates.
- In the coverage chart, “Fallback-priced tokens” includes all costs not backed by a unique package-price match, including ambiguous-price batches that used a median.

Changing `web/reference.json` and reloading recalculates historical estimates. Pulling a different history can also change them by adding earlier batches or changing the fallback rate. Date/VR filters alone do neither. Keep the export and reference constants together if you need to reproduce an estimate later.

#### How totals and chart values are calculated

| Metric | Calculation within the selected date/VR range |
| --- | --- |
| Tokens spent | Sum of the absolute token amounts of spending records |
| Tokens purchased | Sum of positive purchase tokens |
| Average transaction | Tokens spent / number of spending records |
| Average active day | Tokens spent / UTC days containing at least one spending record; inactive days are excluded from the divisor |
| VR or recipient share | That group's spending tokens / total spending tokens × 100 |
| Monthly change | `(current month tokens − previous month tokens) / previous month tokens × 100`; omitted when there is no nonzero previous baseline |
| Cumulative purchased/spent | Running totals starting at the selected range's beginning |
| Net movement | Running sum of **all signed token movements**, including adjustments; starts at zero for the selected range |
| Euro summary / grouped hover | Sum of the already allocated euro costs of the corresponding records |
| Euro hover on an average | Corresponding euro total / the same divisor used for the token average |

Zero-count averages display zero. Spending totals show positive magnitudes; the transaction table and CSV preserve debit/credit signs for both tokens and euros. The net-movement hover also uses signed costs. Display rounding happens after aggregation, so adding individually rounded tooltip values may differ by a cent from the rounded total. CSV euro amounts retain up to six decimal places and rates up to eight.

Daily and cumulative charts include inactive dates as zero activity. The calendar only displays the latest 365 days of the selected interval; summary totals still cover the full selected interval. Histogram bars count transactions in token-size ranges, and the top-up-size chart counts purchases rather than summing tokens. Their count values are not token amounts.

Date boundaries are inclusive UTC calendar dates. Initial inputs use the earliest/latest saved transaction, not today or the configured fetch boundaries. Reset restores the saved-history range. After a pull, each boundary still at its previous default follows the new default; a customized boundary stays as entered. Clearing a date restores its default. VR filtering applies to purchases as well as spending, so a VR-only view may omit top-ups that were not marked VR.

API `inUsd` / `outUsd` fields remain unverified, unfiltered reference values and are not used in euro estimates. Taxes, fees, promotions, historic price changes and payment-method differences can make actual charges differ.

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

Python 3.11 is the minimum supported version (also declared in `pyproject.toml` and checked at startup). Newer Python versions work too. There are no test files or test framework dependencies.
