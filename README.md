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

The server automatically opens **http://127.0.0.1:8080** in your default browser. Use `python server.py --port 9000` to choose another port; the browser opens that port instead. The server is intentionally bound to localhost; it is not a public multi-user service.

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
| `web/analytics.js` | Transaction-only statistics, recipient history, bursts and FIFO token lifetimes |
| `web/planner.js` | Account level settings, XP targets, bonuses and future package planning |
| `web/index.html`, `web/style.css` | Page structure, styling and themes |
| `manual/` | Preserved terminal summary and plotting tools |

## Views

- Overview: totals, four readable report highlights, monthly purchases/spending, cumulative curves, VR split, full monthly table.
- What changed: active days, transactions per active day, transaction size, and recipient/type contributions compared with the preceding interval of equal length.
- Purchases: top-up intervals, FIFO half-used/completed lifetimes, remaining recorded tokens per purchase, package frequency and token flow.
- Spending: medians, the middle 50% of amounts, spending concentrated in big days/transactions, monthly transaction-type shares, distributions and daily trends.
- Spending bursts: groups of nearby payments, typical tokens and transactions per burst, largest bursts and their matching transactions.
- Activity: daily calendar, active/quiet runs, normalized weekday averages and activity rates, hours and weekday/hour heatmap.
- Recipients: rankings, new/returning spending, recurrence across days and months, full-history first recorded dates and gaps between active days.
- Transactions: search, category and date filters, sorting, pagination and filtered CSV export.
- Reference lab: the original seven payment-method package tables, tokens-per-euro comparison, cumulative XP, XP increments and a level explorer.
- Responsive light/dark themes, clickable recipient profiles, chart hover values, and a **Hide names** control that also anonymizes CSV exports. Profile links are removed while names are hidden. This is a presentation feature; data is still present in the local browser.

The date inputs default to the first and last transaction dates in the saved history, and Reset restores that range. Refresh extends these defaults when they have not been customized. The date and VR filters affect all transaction-based views. Transaction search/category/sort controls affect only the transaction table and CSV. Reference plots and last-pull API totals are explicitly unfiltered. **Time** switches calendar grouping, date filters, presets, activity hours and displayed transaction timestamps between UTC and your browser's local timezone, including daylight saving changes. This choice is remembered locally. CSV retains the original UTC timestamps; the saved-file timestamp uses your browser's local timezone.

## Reading the expanded report

All new statistics are derived from the saved transaction JSON. They do not require
viewing history, account information or another service.

- **Typical amounts:** medians and 25th/75th percentiles use linear interpolation between sorted amounts. Active-day statistics include only days with spending. Calendar statistics and active/quiet runs use selected days within the first and last saved transaction dates, capped at today; days without recorded spending contribute zero. Dates outside that span are excluded. A saved span does not prove that the export is complete, and quiet days do not establish whether you visited the site.
- **Big moments:** the busiest three spending days and the largest 10% of spending transactions show their shares of selected spending. Transaction counts round upward. Both shares and the busiest-day list open the matching payments.
- **Spending changes:** total spending equals active days × transactions per active day × tokens per transaction. When both intervals contain spending, each factor's contribution is averaged over all six substitution orders, sharing interactions without privileging one order. Contributions sum to the recorded token difference before display rounding. These are arithmetic explanations, not causal claims. Missing coverage is flagged. Recipient/type lists show the eight largest absolute changes; a recipient or type with only previous-period spending opens that earlier interval.
- **Recipient history:** first recorded spending dates use the full history across both VR and non-VR, even when filters hide earlier payments. New/returning status is relative to the selected interval or each displayed month. Active days, active months and median gaps between distinct spending days describe the selection. Recipients are identified by their recorded names, so renames cannot be resolved from this export alone.
- **Spending mix:** monthly bars show each transaction type's share of that month's spending, with the latest twelve months plotted and all selected months in the table. Empty months have no mix; partial/current months are marked. Segments open matching payments.
- **Bursts:** gaps greater than 30 minutes between consecutive spending records start a new group. Groups are built from full saved spending before date/VR filtering, so hidden intermediate payments do not split a burst. Values count only selected payments; filtered fragments are marked. The span between payment timestamps is not viewing duration or watch time.
- **Top-up lifetimes:** every positive credit enters the token FIFO, and every debit consumes it, across full history and both viewing modes. Purchase rows distinguish ordinary spending, other debits and unconsumed tokens. Half-used/full-use milestones include refunds and other debits. Milestone medians include only purchases that reached the milestone; unfinished purchases remain open and are never treated as zero-day lifetimes. Top-up gaps include the preceding purchase even when it is outside the date selection. Missing earlier credits are reported. These allocations are not a live balance or a prediction.
- **Fair weekdays:** token averages divide by the number of calendar occurrences of each weekday, including occurrences without spending. Activity rates divide active occurrences by all occurrences. A weekday absent from the observed range has no average or percentage.

Names remain hidden in new report cards, comparisons, recipient details, chart
tooltips and exports when **Hide names** is enabled. Structured transaction sources
use their recorded name (or type) instead of displaying a raw dictionary.

## Monthly Wrapped and exploration

Monthly Wrapped recaps each month in the saved history: tokens spent, top recipient,
busiest spending day, active days, purchases, VR share, spending change, typical
transaction/day amounts, new/returning recipients, big-day concentration and spending
bursts. Choose a month in the sidebar's **Monthly Wrapped** section. It uses
the whole month independently of the date inputs, while respecting the VR filter and
Hide names. Current months compare the elapsed calendar days in the selected timezone with the same days of the
previous month, capped at that month's end; completed months compare full months.
Comparisons and month boundaries use the selected timezone. Periods outside the saved transaction range are flagged because missing days may be
inactive or unrecorded. No missing activity is inferred.

Date presets select the last 30 calendar days (including today), this month, this
year, or all saved history. Calendar presets use today's date in the selected timezone. The overview
compares the selected interval with the immediately preceding interval of equal
length, using the same VR filter. Monthly chart labels mark partial/current months
with an asterisk, and month-over-month percentages exclude partial months.

Click monthly bars, purchase bars, daily spending points, calendar squares, or
recipient timeline columns to inspect matching transactions. The table shows an
explicit chart selection that can be cleared; search, category, sorting and CSV
export continue to work within that selection. Wrapped drill-downs first switch the
date range to the chosen month. Recipient names in rankings and tables open a detail
panel with a timeline, first/latest transaction in the selection, average amount,
active days and VR share, plus a link to their matching transactions.

Recipient insights include a stacked monthly area chart for the top five recipients
and Other, plus ranked spending bars and a cumulative percentage line. Concentration
shows up to fifteen recipients individually and groups the remainder as Other; all
recipients still contribute to the total. The rolling trend includes inactive days
and uses the preceding six days from saved history for a full trailing seven-day
average at the start of the selected range. Missing history contributes zero.

Hide names is remembered in local browser storage, including for Wrapped, recipient
charts, details and exports. It remains a presentation feature, not data removal.

Run the focused frontend checks with Node.js:

```sh
node --check web/app.js
node --check web/analytics.js
node --test tests/*.test.cjs
```

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
| Average active day | Tokens spent / calendar days in the selected timezone containing at least one spending record; inactive days are excluded from the divisor |
| VR or recipient share | That group's spending tokens / total spending tokens × 100 |
| Monthly change | `(current month tokens − previous month tokens) / previous month tokens × 100`; omitted when there is no nonzero previous baseline |
| Cumulative purchased/spent | Running totals starting at the selected range's beginning |
| Net movement | Running sum of **all signed token movements**, including adjustments; starts at zero for the selected range |
| Euro summary / grouped hover | Sum of the already allocated euro costs of the corresponding records |
| Euro hover on an average | Corresponding euro total / the same divisor used for the token average |

Existing summary averages display zero when their count is zero. New distribution and weekday statistics display a dash when there are no samples, keeping missing samples distinct from measured zero spending. Spending totals show positive magnitudes; the transaction table and CSV preserve debit/credit signs for both tokens and euros. The net-movement hover also uses signed costs. Display rounding happens after aggregation, so adding individually rounded tooltip values may differ by a cent from the rounded total. CSV euro amounts retain up to six decimal places and rates up to eight.

Daily and cumulative charts include inactive dates as zero activity. The calendar only displays the latest 365 days of the selected interval; summary totals still cover the full selected interval. Histogram bars count transactions in token-size ranges, and the top-up-size chart counts purchases rather than summing tokens. Their count values are not token amounts.

Date boundaries are inclusive calendar dates in the selected timezone. Initial inputs use the earliest/latest saved transaction, not today or the configured fetch boundaries. Reset restores the saved-history range. After a pull, each boundary still at its previous default follows the new default; a customized boundary stays as entered. Clearing a date restores its default. VR filtering applies to purchases as well as spending, so a VR-only view may omit top-ups that were not marked VR.

API `inUsd` / `outUsd` fields remain unverified, unfiltered reference values and are not used in euro estimates. Taxes, fees, promotions, historic price changes and payment-method differences can make actual charges differ.

Package prices and XP thresholds are copied from the original plotting scripts. They are static reference data, not current offers, confirmed rules, or your account's actual XP. The calendar shows the last 365 days of the selected interval. Rankings show the top ten; the recipient table includes everyone.

## Account level planner

The final section integrates the supplied standalone XP, Token, and Money Calculator into the dashboard theme. It supports target levels, leagues and feature unlocks, watching plans, email and first-purchase bonuses, and a package breakdown with extra purchased tokens.

The payments export has **no current account level or XP**. Choose your current level once; it and optional total account XP are remembered in this browser’s local storage and selected on subsequent visits. These are user-entered settings, not a live account lookup. Update them when you level up or switch accounts. With no saved setting, the planner asks for your level rather than inferring it from spending. The default target is the next level (capped at 100). Without exact XP, the calculation starts at your selected level’s minimum threshold. Exact XP must fall within that level’s range.

Available tokens default to the nonnegative net movement of the **full** saved history, independently of dashboard filters. This may differ from a live balance if history is incomplete; edit it as needed. The optional balance deduction reduces tokens to buy, not tokens to spend for XP. An edited balance lasts for this page session; level and XP persist across reloads.

The imported planning assumptions are 5 XP per spent token, 1 watching XP per 15 minutes capped at level 9, an optional unclaimed 5 XP email bonus below level 10, and an optional eligible 500 XP first-purchase bonus when crossing into Bronze. Bonuses are capped at the XP still required. The first-purchase bonus defaults off when saved purchases exist. Including it requires buying at least one package, even if bonus XP alone reaches the target. These assumptions and unlocks are static references, not verified current rules or account entitlements.

```text
raw XP = max(0, target threshold − current XP)
paid XP = max(0, raw XP − applicable planned bonuses)
tokens to spend = ceil(paid XP / 5)
tokens to buy = max(0, tokens to spend − available tokens used)
```

Package planning preserves the original policy: buy `floor(tokens to buy / 2250)` full 2,250-token packages, then use dynamic programming to find the cheapest combination of smaller packages covering the remainder. Prices are calculated in integer cents; equal-cost solutions prefer fewer bought tokens. This is the cheapest remainder under that policy, **not** a global optimum across all packages. For an eligible first-purchase bonus with zero tokens otherwise needed, the smallest qualifying purchase is still planned.

The six original planner packages, league ranges and feature unlocks live in `web/reference.json` under `level_planner`. The XP thresholds reuse `xp_by_level` (identical in the supplied calculator). Future package costs are separate from historical FIFO estimates and do not change them. No requests to Stripchat or purchases occur when using the planner. It shares the existing theme and needs no additional dependencies.

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
