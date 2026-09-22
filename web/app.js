'use strict';
const $ = id => document.getElementById(id);
const fmt = (n, digits = 0) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: digits });
const compact = n => Math.abs(n) < 1 && n !== 0 ? `${+n.toFixed(3)}` : Math.abs(n) >= 1e6 ? `${+(n / 1e6).toFixed(1)}m` : Math.abs(n) >= 1000 ? `${+(n / 1000).toFixed(1)}k` : `${+n.toFixed(1)}`;
const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sum = (rows, fn = r => Math.abs(r.tokens)) => rows.reduce((a, r) => a + fn(r), 0);
const colors = ['var(--mint)', 'var(--violet)', '#d5a777', '#8baec7', '#cd91ab', '#a4b77b', '#c5bca3'];
const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const day = r => r.date.slice(0, 10), month = r => r.date.slice(0, 7);
const dateLabel = d => new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const friendly = s => String(s).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase());
let data = { transactions: [] }, reference = {}, filtered = [], spending = [], purchases = [], tableRows = [], page = 0, hiddenNames = false, aliases = new Map(), refreshToken = '', polling = false;
let theme = 'dark'; try { theme = localStorage.getItem('stripchat-dashboard-theme') || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'); } catch { }
function setTheme(value) { theme = value === 'light' ? 'light' : 'dark'; document.documentElement.dataset.theme = theme; $('theme').innerHTML = theme === 'dark' ? '☼ <span>Light theme</span>' : '☾ <span>Dark theme</span>'; $('theme').setAttribute('aria-label', `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`); try { localStorage.setItem('stripchat-dashboard-theme', theme); } catch { } }
setTheme(theme);
const euro = n => new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR' }).format(n || 0);
let defaultDates = { from: '', to: '' };
const amount = r => Math.abs(r.tokens);
const cost = rows => sum(rows, r => r.estimated_eur);
const chartUnit = () => 'tokens';
const valueText = v => `${fmt(v, 1)} tokens`;
const costTip = value => `Estimated equivalent: ${euro(value)} · FIFO package prices`;
function tokenValue(tokens, euros, digits = 0, suffix = '', basis = '', valuation = 'FIFO package prices') {
    const tip = `Estimated equivalent: ${euro(euros)} · ${valuation}` + (basis ? ` · ${basis}` : '');
    return `<span class="token-value" tabindex="0" data-tip="${esc(tip)}" aria-label="${esc(fmt(tokens, digits) + suffix + '; ' + tip)}">${fmt(tokens, digits)}${esc(suffix)}</span>`;
}
const valueWithCost = rows => tokenValue(sum(rows), cost(rows));
const averageTokens = (rows, divisor) => tokenValue(divisor ? sum(rows) / divisor : 0, divisor ? cost(rows) / divisor : 0, 1);
const euroMap = (rows, key) => new Map(grouped(rows, key, r => r.estimated_eur));
const name = s => hiddenNames ? aliases.get(s) || 'Recipient' : s;
function grouped(rows, key, val = amount) {
    const map = new Map();
    for (const r of rows) { const k = key(r), entry = map.get(k) || [0, 0]; entry[0] += val(r); entry[1] += r.estimated_eur; map.set(k, entry); }
    return [...map].map(([k, [value, euros]]) => [k, value, undefined, undefined, euros]).sort((a, b) => b[1] - a[1]);
}
function profileLink(username, suffix = '') {
    const label = esc(name(username)) + esc(suffix);
    if (hiddenNames || !/^[A-Za-z0-9_-]+$/.test(username) || ['Paymentico', 'Negative Balance Loss'].includes(username)) return label;
    return `<a class="profile-link" href="https://stripchat.com/${encodeURIComponent(username)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
}
function costStat(label, value, note, symbol) {
    return `<div class="stat"><div class="stat-label">${esc(label)}<span class="stat-symbol">${symbol}</span></div><div class="stat-number">${euro(value)}</div><div class="stat-note">${esc(note)}</div></div>`;
}
function empty(id, text = 'No matching activity in this period.') { $(id).innerHTML = `<div class="empty">${esc(text)}</div>`; }
function table(id, headers, rows) { $(id).innerHTML = `<table><thead><tr>${headers.map(h => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${headers.length}">No matching records.</td></tr>`}</tbody></table>`; }
function stat(label, value, note, symbol, euros, noteEuros) { return `<div class="stat"><div class="stat-label">${esc(label)}<span class="stat-symbol">${symbol}</span></div><div class="stat-number">${euros === undefined ? fmt(value) : tokenValue(value, euros, label === 'Average transaction' ? 1 : 0)}</div><div class="stat-note">${noteEuros === undefined ? esc(note) : `<span class="token-value" tabindex="0" data-tip="${esc(costTip(noteEuros))}">${esc(note)}</span>`}</div></div>`; }
function mini(label, value, euros) { return `<div class="mini"><small>${esc(label)}</small><strong>${euros === undefined ? esc(value) : tokenValue(value, euros, 1)}</strong></div>`; }
function bars(id, rows, { unit = chartUnit(), color = colors[0], limit = 10 } = {}) {
    rows = rows.slice(0, limit); if (!rows.length) return empty(id);
    const max = Math.max(...rows.map(r => Math.abs(r[1])), 0.00001);
    const display = value => unit === 'estimated EUR' ? `≈ ${euro(value)}` : `${fmt(value, 2)} ${unit}`;
    $(id).innerHTML = `<div class="bars">${rows.map(([label, value, username, suffix = '', euros], i) => `<div data-tip="${esc(label)}: ${esc(display(value))}${euros === undefined ? '' : esc(' · ' + costTip(euros))}"><div class="bar-label"><span>${username ? profileLink(username, suffix) : esc(label)}</span><span>${unit === 'tokens' && euros !== undefined ? tokenValue(value, euros, 1, ' tokens') : esc(display(value))}</span></div><div class="track"><div class="bar-fill" style="width:${Math.abs(value) / max * 100}%;background:${Array.isArray(color) ? color[i % color.length] : color}"></div></div></div>`).join('')}</div>`;
}
function chart(id, labels, series, { kind = 'line', unit = chartUnit(), height = 245, showPoints = false } = {}) {
    if (!labels.length || !series.some(s => s.values.some(v => v !== null))) return empty(id);
    const w = Math.max(320, $(id).clientWidth || 760), h = height, left = 52, right = 15, top = 20, bottom = 40, pw = w - left - right, ph = h - top - bottom;
    const values = series.flatMap(s => s.values).filter(v => v !== null && Number.isFinite(v));
    const min = Math.min(0, ...values), max = Math.max(0.00001, ...values), span = max - min;
    const y = v => top + ph - (v - min) / span * ph;
    const x = i => left + (kind === 'bar' ? (i + .5) / labels.length : labels.length === 1 ? .5 : i / (labels.length - 1)) * pw;
    let svg = `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc($(id).closest('article')?.querySelector('h3')?.textContent || id)}"><title>${esc(unit)} by ${esc(labels.length)} categories. Hover marks for exact values.</title>`;
    for (let i = 0; i <= 4; i++) { const v = min + span * i / 4; svg += `<line class="gridline" x1="${left}" y1="${y(v)}" x2="${w - right}" y2="${y(v)}"/><text x="${left - 9}" y="${y(v) + 3}" text-anchor="end">${unit === 'estimated EUR' ? '€' : ''}${compact(v)}</text>`; }
    const step = Math.max(1, Math.ceil(labels.length / Math.max(2, Math.floor(pw / 85))));
    labels.forEach((label, i) => { if (i % step === 0 || i === labels.length - 1 && labels.length > 1 && i % step > step / 2) svg += `<text x="${x(i)}" y="${h - 12}" text-anchor="middle">${esc(label)}</text>`; });
    series.forEach((s, si) => {
        const color = s.color || colors[si % colors.length];
        const hover = i => `${labels[i]} · ${s.name}: ${fmt(s.values[i], unit === 'EUR / token' ? 5 : 2)} ${unit}${s.euros?.[i] === undefined ? '' : ' · ' + costTip(s.euros[i])}`;
        if (kind === 'bar') {
            const bw = Math.min(45, pw / labels.length * .7 / series.length);
            s.values.forEach((v, i) => { if (v === null) return; svg += `<rect x="${x(i) + (si - series.length / 2) * bw}" y="${Math.min(y(v), y(0))}" width="${Math.max(.4, bw - 2)}" height="${Math.max(1, Math.abs(y(v) - y(0)))}" rx="2" fill="${color}" data-tip="${esc(hover(i))}"><title>${esc(hover(i))}</title></rect>`; });
        } else {
            let d = '', active = false; s.values.forEach((v, i) => { if (v === null) { active = false; return; } d += `${active ? 'L' : 'M'}${x(i)},${y(v)} `; active = true; });
            svg += `<path d="${d}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>`;
            s.values.forEach((v, i) => { if (v === null) return; svg += `<circle cx="${x(i)}" cy="${y(v)}" r="${showPoints || labels.length < 16 ? 3 : 2}" fill="${color}" data-tip="${esc(hover(i))}"><title>${esc(hover(i))}</title></circle>`; });
        }
    });
    svg += '</svg>'; $(id).innerHTML = `<div class="chart-unit">${esc(unit === 'estimated EUR' ? '≈ EUR · estimated' : unit)}</div>` + svg;
}
function rangeDays(start, end) { const a = []; if (!start || !end) return a; let d = new Date(start + 'T00:00:00Z'); const last = new Date(end + 'T00:00:00Z'); for (let i = 0; d <= last && i < 40000; i++, d.setUTCDate(d.getUTCDate() + 1))a.push(d.toISOString().slice(0, 10)); return a; }
function monthRange(start, end) { const a = []; if (!start || !end) return a; let d = new Date(start.slice(0, 7) + '-01T00:00:00Z'), last = end.slice(0, 7); for (let i = 0; i < 1200 && d.toISOString().slice(0, 7) <= last; i++, d.setUTCMonth(d.getUTCMonth() + 1))a.push(d.toISOString().slice(0, 7)); return a; }
function shortMonth(s) { return new Date(s + '-01T00:00:00Z').toLocaleDateString('en', { month: 'short', year: '2-digit', timeZone: 'UTC' }); }
function selectedBounds() { return [$('from').value || (filtered[0]?.date.slice(0, 10)), $('to').value || filtered.at(-1)?.date.slice(0, 10)]; }
function renderReconciliation() {
    const adjustments = filtered.filter(r => !r.spending && !r.purchase);
    const adjustmentTokens = sum(adjustments, r => r.tokens);
    const signedCost = rows => sum(rows, r => Math.sign(r.tokens) * r.estimated_eur);
    const term = (label, tokens, euros) => `<div><small>${esc(label)}</small><strong>${tokenValue(tokens, euros)}</strong></div>`;
    $('token-reconciliation').innerHTML = term('Purchased', sum(purchases), cost(purchases)) +
        '<span aria-hidden="true">−</span>' + term('Spent', sum(spending), cost(spending)) +
        `<span aria-hidden="true">${adjustmentTokens < 0 ? '−' : '+'}</span>` + term('Adjustments', Math.abs(adjustmentTokens), adjustmentTokens < 0 ? -signedCost(adjustments) : signedCost(adjustments)) +
        '<span aria-hidden="true">=</span>' + term('Net change · tokens', sum(filtered, r => r.tokens), signedCost(filtered));
    $('adjustment-explanation').textContent = adjustments.length
        ? 'Refunds and other adjustments are separate from ordinary spending and purchases. They still change your token total.'
        : 'No refunds or other adjustments in this selection.';
    $('adjustment-breakdown').innerHTML = grouped(adjustments, r => `${friendly(r.type)} · ${r.tokens < 0 ? 'tokens removed' : 'tokens added'}`, r => r.tokens)
        .map(([label, tokens, , , euros]) => `<div><span>${esc(label)}</span><strong>${tokens > 0 ? '+' : ''}${tokenValue(tokens, Math.sign(tokens) * euros, 0, ' tokens')}</strong></div>`).join('');
    $('show-adjustments').disabled = !adjustments.length;
}
function render() {
    const from = $('from').value, to = $('to').value, mode = $('mode').value;
    if (from && to && from > to) { message('The start date must be on or before the end date.', true); return; }
    filtered = data.transactions.filter(r => (!from || day(r) >= from) && (!to || day(r) <= to) && (mode === 'all' || r.vr === (mode === 'vr')));
    spending = filtered.filter(r => r.spending); purchases = filtered.filter(r => r.purchase); page = 0;
    $('scope').textContent = `${fmt(filtered.length)} records`;
    const spent = sum(spending), bought = sum(purchases), active = new Set(spending.map(day)).size, users = new Set(spending.map(r => r.username)).size;
    const spentEuro = cost(spending), boughtEuro = cost(purchases), totalValue = sum(spending, amount), vrRows = spending.filter(r => r.vr), vrValue = sum(vrRows, amount);
    $('cost-stats').innerHTML = costStat('Estimated spending', spentEuro, 'Value of tokens spent · package-based', '↗') + costStat('Estimated purchases', boughtEuro, `${purchases.length} top-ups · gross, before refunds`, '↓') + costStat('Average spending day', active ? spentEuro / active : 0, `${active} active days · estimated EUR`, '◷') + costStat('Average transaction', spending.length ? spentEuro / spending.length : 0, 'Per spending transaction · estimated EUR', '⌁');
    $('stats').innerHTML = stat('Tokens spent', spent, `${fmt(spending.length)} spending transactions`, '↗', spentEuro) + stat('Tokens purchased', bought, `${fmt(purchases.length)} top-ups in this period`, '↓', boughtEuro) + stat('Recipients', users, `${fmt(active)} active spending days`, '♧') + stat('Average transaction', spending.length ? spent / spending.length : 0, `${fmt(active ? spent / active : 0, 1)} tokens per active day`, '⌁', spending.length ? spentEuro / spending.length : 0, active ? spentEuro / active : 0);
    renderReconciliation();
    const pricing = data.pricing;
    $('pricing-note').textContent = pricing ? `${pricing.matched_purchases} of ${pricing.purchase_count} purchases in the full saved history match a single reference price. Spending consumes the oldest available packages first (FIFO). Fallback: €${fmt(pricing.fallback_eur_per_token, 5)} per token — ${pricing.fallback_basis.toLowerCase()}. Selected spending uses ${fmt(sum(spending, r => r.matched_cost_tokens))} package-matched tokens and ${fmt(sum(spending, r => r.fallback_cost_tokens))} fallback-priced tokens.` : 'No saved transactions yet. Pull data to estimate euro costs.';
    const [start, end] = selectedBounds(), months = monthRange(start, end), days = rangeDays(start, end);
    const spe = euroMap(spending, month), pue = euroMap(purchases, month), de = euroMap(spending, day), pde = euroMap(purchases, day);
    const sp = new Map(grouped(spending, month)), pu = new Map(grouped(purchases, month)), daily = new Map(grouped(spending, day)), puday = new Map(grouped(purchases, day));
    chart('monthly-chart', months.map(shortMonth), [{ name: 'Purchased', values: months.map(m => pu.get(m) || 0), euros: months.map(m => pue.get(m) || 0) }, { name: 'Spent', values: months.map(m => sp.get(m) || 0), euros: months.map(m => spe.get(m) || 0) }], { kind: 'bar' });
    let cs = 0, cp = 0, cse = 0, cpe = 0; chart('cumulative-chart', days, [{ name: 'Purchased', values: days.map(d => cp += puday.get(d) || 0), euros: days.map(d => cpe += pde.get(d) || 0) }, { name: 'Spent', values: days.map(d => cs += daily.get(d) || 0), euros: days.map(d => cse += de.get(d) || 0) }]);
    if (totalValue) { const pct = vrValue / totalValue * 100, circ = 2 * Math.PI * 70; $('vr-chart').innerHTML = `<div class="donut-wrap"><svg viewBox="0 0 200 200" role="img" aria-label="VR ${pct.toFixed(1)} percent of ${esc(chartUnit())} spending"><circle cx="100" cy="100" r="70" fill="none" stroke="var(--violet)" stroke-width="19"/><circle cx="100" cy="100" r="70" fill="none" stroke="var(--mint)" stroke-width="19" stroke-dasharray="${circ * pct / 100} ${circ}"/></svg><div class="donut-center">${fmt(pct, 1)}%<span>OF TOKENS SPENT IN VR</span></div></div><div class="donut-legend"><div><span class="local-dot"></span>VR<strong>${tokenValue(vrValue, cost(vrRows), 0, ' tokens')}</strong></div><div>◦ Non-VR<strong>${tokenValue(totalValue - vrValue, spentEuro - cost(vrRows), 0, ' tokens')}</strong></div></div>`; } else empty('vr-chart');
    table('vr-table', ['Mode', 'Tokens', 'Transactions', 'Share of tokens', 'Avg / transaction'], [true, false].map(mode => { const rows = spending.filter(r => r.vr === mode); return [mode ? 'VR' : 'Non-VR', valueWithCost(rows), fmt(rows.length), `${fmt(totalValue ? sum(rows, amount) / totalValue * 100 : 0, 1)}%`, averageTokens(rows, rows.length)]; }));
    $('history-range').textContent = filtered.length ? `Selected history: ${filtered[0].date.replace('T', ' ').replace('Z', ' UTC')} to ${filtered.at(-1).date.replace('T', ' ').replace('Z', ' UTC')}.` : 'No transactions in the selected period.';
    table('monthly-table', ['Month', 'Purchased', 'Spent', 'VR', 'Non-VR', 'Transactions', 'Recipients', 'Days', 'Avg / txn', 'Avg / day', 'VR share', 'MoM'], months.map((m, i) => { const rows = spending.filter(r => month(r) === m), topups = purchases.filter(r => month(r) === m), vrs = rows.filter(r => r.vr), total = sum(rows, amount), active = new Set(rows.map(day)).size, prev = sp.get(months[i - 1]) || 0; return [esc(m), valueWithCost(topups), valueWithCost(rows), valueWithCost(vrs), valueWithCost(rows.filter(r => !r.vr)), fmt(rows.length), fmt(new Set(rows.map(r => r.username)).size), fmt(active), averageTokens(rows, rows.length), averageTokens(rows, active), `${fmt(total ? sum(vrs, amount) / total * 100 : 0, 1)}%`, prev ? `${fmt((total - prev) / prev * 100, 1)}%` : '—']; }));
    const largestPurchase = [...purchases].sort((a, b) => b.tokens - a.tokens)[0];
    const adjustments = filtered.filter(r => !r.spending && !r.purchase);
    $('purchase-stats').innerHTML = mini('Tokens purchased', bought, boughtEuro) + mini('Average top-up', purchases.length ? bought / purchases.length : 0, purchases.length ? boughtEuro / purchases.length : 0) + mini('Largest top-up', largestPurchase?.tokens || 0, largestPurchase?.estimated_eur || 0) + mini('Refunds / other adjustments', sum(adjustments, r => r.tokens), sum(adjustments, r => Math.sign(r.tokens) * r.estimated_eur));
    chart('purchase-chart', purchases.map(day), [{ name: 'Purchase', values: purchases.map(amount), euros: purchases.map(r => r.estimated_eur) }], { kind: 'bar' });
    bars('flow-chart', grouped(filtered, r => `${r.tokens >= 0 ? 'In' : 'Out'} · ${friendly(r.type)}`), { color: colors, limit: 30 });
    const net = new Map(grouped(filtered, day, r => r.tokens)), netEuros = new Map(grouped(filtered, day, r => Math.sign(r.tokens) * r.estimated_eur)); let balance = 0, netCost = 0; chart('net-chart', days, [{ name: 'Net movement', values: days.map(d => balance += net.get(d) || 0), euros: days.map(d => netCost += netEuros.get(d) || 0) }]);
    bars('package-chart', grouped(purchases, r => `${fmt(r.tokens)} tokens`, () => 1), { unit: 'purchases' });
    chart('purchase-rate-chart', purchases.map(day), [{ name: 'Estimated cost per token', values: purchases.map(r => r.eur_per_token) }], { unit: 'EUR / token', showPoints: true });
    bars('cost-basis-chart', [['Package-matched tokens', sum(spending, r => r.matched_estimated_eur)], ['Fallback-priced tokens', sum(spending, r => r.fallback_estimated_eur)]], { unit: 'estimated EUR', color: colors });
    table('purchase-cost-table', ['Date UTC', 'Tokens', 'Estimated price', 'EUR / token', 'Pricing basis'], purchases.map(r => [esc(day(r)), tokenValue(r.tokens, r.estimated_eur), euro(r.estimated_eur), `€${fmt(r.eur_per_token, 5)}`, esc(r.cost_basis)]));
    const totals = data.api_totals || {}; $('api-totals').innerHTML = Object.keys(totals).length ? Object.entries(totals).map(([k, v]) => `<div>${esc(k)} <strong>${esc(typeof v === 'number' ? fmt(v, 2) : String(v))}</strong></div>`).join('') + '<p>API-reported values for the full fetched date range. USD fields are not verified billing amounts and are not used for euro estimates.</p>' : 'Not present in the existing export. The next successful pull will preserve these API fields.';
    bars('type-chart', grouped(spending, r => friendly(r.type)), { color: colors, limit: 30 });
    table('type-table', ['Type', 'Tokens', 'Transactions', 'VR', 'Non-VR'], grouped(spending, r => r.type).map(([type]) => { const rows = spending.filter(r => r.type === type); return [esc(friendly(type)), valueWithCost(rows), fmt(rows.length), valueWithCost(rows.filter(r => r.vr)), valueWithCost(rows.filter(r => !r.vr))]; }));
    const bins = [[0, 10], [10, 50], [50, 100], [100, 500], [500, 1000], [1000, Infinity]];
    chart('distribution-chart', bins.map(([a, b]) => `${a}${b === Infinity ? '+' : `–<${b}`}`), [{ name: 'Transactions', values: bins.map(([a, b]) => spending.filter(r => amount(r) >= a && amount(r) < b).length) }], { kind: 'bar', unit: 'transactions' });
    chart('daily-chart', days, [{ name: 'Spent', values: days.map(d => daily.get(d) || 0), euros: days.map(d => de.get(d) || 0) }]);
    chart('change-chart', months.map(shortMonth), [{ name: 'Change', color: colors[1], values: months.map((m, i) => { const prev = sp.get(months[i - 1]); return prev ? ((sp.get(m) || 0) - prev) / prev * 100 : null; }) }], { kind: 'bar', unit: '%' });
    bars('source-chart', grouped(spending, r => r.source), { color: colors });
    bars('largest-chart', [...spending].sort((a, b) => amount(b) - amount(a)).slice(0, 10).map(r => [`${name(r.username)} · ${day(r)}`, amount(r), r.username, ` · ${day(r)}`, r.estimated_eur]), { color: colors[1] });
    const weekEuros = new Array(7).fill(0), hourEuros = new Array(24).fill(0), heatEuros = Array.from({ length: 7 }, () => new Array(24).fill(0));
    const weekday = new Array(7).fill(0), hour = new Array(24).fill(0), heat = Array.from({ length: 7 }, () => new Array(24).fill(0));
    spending.forEach(r => { const d = new Date(r.date), w = (d.getUTCDay() + 6) % 7, h = d.getUTCHours(); weekday[w] += amount(r); hour[h] += amount(r); heat[w][h] += amount(r); weekEuros[w] += r.estimated_eur; hourEuros[h] += r.estimated_eur; heatEuros[w][h] += r.estimated_eur; });
    chart('weekday-chart', weekdays.map(s => s.slice(0, 3)), [{ name: 'Spent', values: weekday, euros: weekEuros }], { kind: 'bar' });
    chart('hour-chart', hour.map((_, i) => `${String(i).padStart(2, '0')}:00`), [{ name: 'Spent', values: hour, euros: hourEuros }], { kind: 'bar' });
    renderHeatmap(heat, heatEuros); renderCalendar(daily, days, de);
    const activityRows = (keys, fn) => keys.map((label, i) => { const rows = spending.filter(r => fn(r) === i); return [esc(label), valueWithCost(rows), fmt(rows.length), averageTokens(rows, rows.length)]; });
    table('weekday-table', ['Weekday', 'Tokens', 'Transactions', 'Avg / txn'], activityRows(weekdays, r => (new Date(r.date).getUTCDay() + 6) % 7));
    table('hour-table', ['UTC hour', 'Tokens', 'Transactions', 'Avg / txn'], activityRows(hour.map((_, i) => `${String(i).padStart(2, '0')}:00`), r => new Date(r.date).getUTCHours()));
    const people = [...new Set(spending.map(r => r.username))].map(username => { const rows = spending.filter(r => r.username === username); return { username, rows, value: sum(rows, amount), count: rows.length, days: new Set(rows.map(day)).size }; }).sort((a, b) => b.value - a.value);
    bars('people-chart', people.map(p => [name(p.username), p.value, p.username, '', cost(p.rows)])); bars('frequency-chart', [...people].sort((a, b) => b.count - a.count).map(p => [name(p.username), p.count, p.username, '', cost(p.rows)]), { unit: 'transactions', color: colors[1] });
    table('people-table', ['Recipient', 'Tokens', 'Share', 'VR', 'Non-VR', 'Transactions', 'Active days', 'Avg / txn', 'VR share'], people.map(p => [profileLink(p.username), valueWithCost(p.rows), `${fmt(totalValue ? p.value / totalValue * 100 : 0, 1)}%`, valueWithCost(p.rows.filter(r => r.vr)), valueWithCost(p.rows.filter(r => !r.vr)), fmt(p.count), fmt(p.days), averageTokens(p.rows, p.count), `${fmt(p.value ? sum(p.rows.filter(r => r.vr), amount) / p.value * 100 : 0, 1)}%`]));
    updateChartDescriptions(); renderTransactions();
}
function updateChartDescriptions() {
    const unit = 'tokens';
    const descriptions = {
        'monthly-chart': `Monthly purchases and spending · ${unit}`,
        'cumulative-chart': `Cumulative purchases and spending · ${unit}`,
        'vr-chart': `VR and non-VR share of spending · ${unit}`,
        'purchase-chart': `Each top-up over time · ${unit}`,
        'flow-chart': `Incoming and outgoing value by transaction type · ${unit}`,
        'net-chart': `Running net movement · ${unit} · not your account balance`,
        'type-chart': `Spending by transaction type · ${unit}`,
        'distribution-chart': `Transaction counts by token amount`,
        'daily-chart': `Daily spending, including inactive days · ${unit}`,
        'change-chart': `Monthly change in ${unit} · zero baselines excluded`,
        'source-chart': `Spending by recorded source · ${unit}`,
        'largest-chart': `Ten largest spending transactions · ${unit}`,
        'calendar-chart': `Daily spending · ${unit} · latest 365 days in the selected interval`,
        'weekday-chart': `Total spending by weekday · ${unit}`,
        'hour-chart': `Total spending by UTC hour · ${unit}`,
        'heatmap-chart': `Weekday × UTC hour · ${unit} · stronger color means more spending`,
        'people-chart': `Top ten by spending · ${unit}`
    };
    Object.entries(descriptions).forEach(([id, text]) => { $(id).closest('article').querySelector('p').textContent = text; });
}
function renderHeatmap(rows, euros) { const max = Math.max(1, ...rows.flat()), cell = 27; let svg = '<svg viewBox="0 0 730 240" role="img" aria-label="Spending heatmap by weekday and UTC hour">'; for (let h = 0; h < 24; h += 2)svg += `<text x="${65 + h * cell}" y="14">${String(h).padStart(2, '0')}</text>`; rows.forEach((row, w) => { svg += `<text x="0" y="${43 + w * cell}">${weekdays[w].slice(0, 3)}</text>`; row.forEach((v, h) => { svg += `<rect x="${62 + h * cell}" y="${27 + w * cell}" width="22" height="22" rx="4" fill="var(--mint)" opacity="${v ? .22 + .78 * Math.sqrt(v / max) : .07}" data-tip="${weekdays[w]} ${String(h).padStart(2, '0')}:00 UTC: ${valueText(v)} · ${esc(costTip(euros[w][h]))}"><title>${valueText(v)} · ${esc(costTip(euros[w][h]))}</title></rect>`; }); }); svg += '</svg>'; $('heatmap-chart').innerHTML = svg; }
function renderCalendar(daily, allDays, euros) {
    const days = allDays.slice(-365);
    if (!days.length) return empty('calendar-chart');
    const offset = (new Date(days[0] + 'T00:00:00Z').getUTCDay() + 6) % 7;
    const cols = Math.ceil((days.length + offset) / 7), left = 48, top = 36, cell = 15;
    const max = Math.max(1, ...days.map(d => daily.get(d) || 0));
    const candidates = days.flatMap((d, i) => d.endsWith('-01') || i === 0 ? [{ date: d, x: left + Math.floor((i + offset) / 7) * cell }] : []);
    // A short first partial month must not collide with the next month's label.
    if (candidates.length > 1 && candidates[1].x - candidates[0].x < 38) candidates.shift();
    let svg = `<svg viewBox="0 0 ${Math.max(220, left + cols * cell + 35)} 153" role="img" aria-label="Daily token spending calendar">`;
    let lastLabelX = -Infinity;
    for (const label of candidates) {
        if (label.x - lastLabelX < 38) continue;
        svg += `<text x="${label.x}" y="17">${new Date(label.date + 'T00:00:00Z').toLocaleDateString('en', { month: 'short', timeZone: 'UTC' })}</text>`;
        lastLabelX = label.x;
    }
    ['Mon', 'Wed', 'Fri'].forEach((label, i) => svg += `<text x="0" y="${top + 9 + i * 30}">${label}</text>`);
    days.forEach((d, i) => {
        const index = i + offset, x = left + Math.floor(index / 7) * cell, y = top + index % 7 * cell, v = daily.get(d) || 0;
        const tip = `${d}: ${fmt(v)} tokens · ${costTip(euros.get(d) || 0)}`;
        svg += `<rect x="${x}" y="${y}" width="11" height="11" rx="2" fill="var(--mint)" opacity="${v ? .23 + .77 * Math.sqrt(v / max) : .08}" data-tip="${esc(tip)}"><title>${esc(tip)}</title></rect>`;
    });
    $('calendar-chart').innerHTML = svg + `</svg><p class="calendar-caption">${days[0]} — ${days.at(-1)} · Hover a day for tokens and estimated euros.</p>`;
}
function renderTransactions() {
    const query = $('search').value.trim().toLowerCase(), category = $('category').value, sort = $('sort').value;
    tableRows = filtered.filter(r => (category === 'all' || category === 'purchase' && r.purchase || category === 'spending' && r.spending || category === 'adjustment' && !r.purchase && !r.spending) && `${name(r.username)} ${r.type} ${hiddenNames ? '' : r.id}`.toLowerCase().includes(query));
    tableRows.sort((a, b) => sort === 'largest' ? Math.abs(b.tokens) - Math.abs(a.tokens) : sort === 'oldest' ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date));
    const pages = Math.max(1, Math.ceil(tableRows.length / 25)); page = Math.min(page, pages - 1);
    table('transaction-table', ['Date / UTC', 'Recipient', 'Type', 'Mode', 'Tokens', 'Category', 'Transaction ID'], tableRows.slice(page * 25, page * 25 + 25).map(r => [
        esc(r.date.replace('T', ' ').replace('Z', '')), profileLink(r.username), esc(friendly(r.type)), `<span class="badge">${r.vr ? 'VR' : 'NON-VR'}</span>`,
        `<span class="${r.tokens >= 0 ? 'positive' : 'negative'}">${r.tokens > 0 ? '+' : ''}${tokenValue(r.tokens, Math.sign(r.tokens) * r.estimated_eur, 0, '', r.cost_basis)}</span>`, r.purchase ? 'Purchase' : r.spending ? 'Spending' : 'Adjustment / other', hiddenNames ? 'Hidden' : esc(r.id)
    ]));
    $('page-info').textContent = `${fmt(tableRows.length)} transactions · Page ${page + 1} of ${pages}`; $('prev').disabled = page === 0; $('next').disabled = page >= pages - 1;
}
function renderReferences() {
    const methods = Object.keys(reference).filter(k => k.endsWith('_packages')), selected = $('payment-method').value, shown = selected === 'all' ? methods : methods.filter(m => m === selected);
    const prices = [...new Set(methods.flatMap(m => reference[m].map(p => p.price)))].sort((a, b) => a - b);
    chart('value-chart', prices.map(p => `€${fmt(p, 2)}`), shown.map(m => ({ name: friendly(m.replace('_packages', '')), color: colors[methods.indexOf(m)], values: prices.map(price => { const p = reference[m].find(p => p.price === price); return p ? p.tokens / p.price : null; }) })), { unit: 'tokens / €', height: 285, showPoints: true });
    $('value-legend').innerHTML = shown.map(m => `<span style="--c:${colors[methods.indexOf(m)]}">${esc(friendly(m.replace('_packages', '')))}</span>`).join('');
    table('value-table', ['Package price', ...shown.map(m => friendly(m.replace('_packages', '')))], prices.map(price => [`€${fmt(price, 2)}`, ...shown.map(m => { const p = reference[m].find(p => p.price === price); return p ? `${tokenValue(p.tokens, p.price, 0, ' tokens', '', 'Reference package price')} · ${fmt(p.tokens / price, 2)} / €` : '—'; })]));
    const xp = Object.entries(reference.xp_by_level || {}); chart('xp-chart', xp.map(([level]) => level), [{ name: 'Total XP', values: xp.map(([, v]) => v) }], { unit: 'XP' }); chart('xp-step-chart', xp.slice(1).map(([level]) => level), [{ name: 'Additional XP', color: colors[1], values: xp.slice(1).map(([, v], i) => v - xp[i][1]) }], { unit: 'XP' }); renderLevel();
}
function renderLevel() { const level = Number($('level').value), xp = reference.xp_by_level || {}; $('level-value').textContent = level; $('level-stats').innerHTML = `<strong>${fmt(xp[level])} XP</strong> to reach level ${level}<br>${level < 100 ? `<strong>${fmt(xp[level + 1] - xp[level])} XP</strong> to the next level` : 'Highest reference level'}`; }
function message(text, error = false) { $('status').textContent = text; $('status').classList.toggle('error', error); }
async function api(url, options) { const response = await fetch(url, options); const result = await response.json(); if (!response.ok) throw new Error(result.error || `Request failed (${response.status}).`); return result; }
function resetDates() { $('from').value = defaultDates.from; $('to').value = defaultDates.to; }
async function loadData() {
    const previousDefaults = defaultDates;
    data = await api('/api/data');
    defaultDates = { from: data.transactions[0]?.date.slice(0, 10) || '', to: data.transactions.at(-1)?.date.slice(0, 10) || '' };
    for (const key of ['from', 'to']) if (!$(key).value || $(key).value === previousDefaults[key]) $(key).value = defaultDates[key]; aliases = new Map([...new Set(data.transactions.map(r => r.username))].sort().map((n, i) => [n, `Recipient ${String(i + 1).padStart(2, '0')}`])); $('saved').textContent = data.exists ? `Saved ${new Date(data.saved_at).toLocaleString()} · ${fmt(data.transactions.length)} transactions` : 'No saved history yet. Pull new data to get started.'; render(); window.levelPlanner.load(data, reference); if (data.skipped) message(`${data.skipped} invalid or duplicate records were excluded from the charts.`);
}
async function checkStatus() { const s = await api('/api/status'); refreshToken = s.refresh_token; $('refresh').disabled = s.running; $('refresh').textContent = s.running ? '↻ Pulling history…' : '↻ Pull new data'; return s; }
async function poll() { if (polling) return; polling = true; try { let s = await checkStatus(); while (s.running) { message(s.message); await new Promise(r => setTimeout(r, 900)); s = await checkStatus(); } if (s.error) message(s.error, true); else { await loadData(); message(s.message || 'Saved history loaded.'); } } catch (e) { message(`${e.message} Reload this page to reconnect to the refresh status.`, true); $('refresh').disabled = false; } finally { polling = false; } }
$('refresh').onclick = async () => { try { $('refresh').disabled = true; const s = await checkStatus(); if (!s.running) { $('refresh').disabled = true; await api('/api/refresh', { method: 'POST', headers: { 'X-Refresh-Token': refreshToken } }); } await poll(); } catch (e) { message(e.message, true); $('refresh').disabled = false; } };
$('theme').onclick = () => setTheme(theme === 'dark' ? 'light' : 'dark');
$('privacy').onclick = () => { hiddenNames = !hiddenNames; $('privacy').setAttribute('aria-pressed', String(hiddenNames)); $('privacy').textContent = hiddenNames ? '◎ Show names' : '◎ Hide names'; $('search').value = ''; $('tooltip').hidden = true; render(); };
$('filters').onsubmit = e => e.preventDefault();['from', 'to', 'mode'].forEach(id => $(id).onchange = () => { if (id !== 'mode' && !$(id).value) $(id).value = defaultDates[id]; message(''); render(); });
$('show-adjustments').onclick = () => { $('category').value = 'adjustment'; $('search').value = ''; page = 0; renderTransactions(); $('transactions').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' }); $('category').focus({ preventScroll: true }); };
$('reset').onclick = () => { resetDates(); $('mode').value = 'all'; message(''); render(); };
['search', 'category', 'sort'].forEach(id => $(id).addEventListener(id === 'search' ? 'input' : 'change', () => { page = 0; renderTransactions(); }));
$('prev').onclick = () => { page--; renderTransactions(); }; $('next').onclick = () => { page++; renderTransactions(); };
$('payment-method').onchange = renderReferences; $('level').oninput = () => { renderLevel(); const plannerLevel = $('planner-current'); if (plannerLevel) { plannerLevel.value = $('level').value; plannerLevel.dispatchEvent(new Event('change')); } };
$('export').onclick = () => { const cell = v => { let s = String(v ?? ''); if (/^[=+@\-\t\r]/.test(s) && typeof v !== 'number') s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; }; const rows = [['Date UTC', 'Recipient', 'Type', 'VR', 'Tokens', 'Estimated EUR', 'EUR per token', 'Cost basis', 'Category', 'Transaction ID'], ...tableRows.map(r => [r.date, name(r.username), r.type, r.vr, r.tokens, Number((Math.sign(r.tokens) * r.estimated_eur).toFixed(6)), Number(r.eur_per_token.toFixed(8)), r.cost_basis, r.purchase ? 'purchase' : r.spending ? 'spending' : 'other', hiddenNames ? '' : r.id])]; const url = URL.createObjectURL(new Blob(['\ufeff' + rows.map(r => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' })); const a = document.createElement('a'); a.href = url; a.download = 'stripchat-transactions.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
function showTooltip(target, x, y) {
    const tip = $('tooltip');
    if (!target) { tip.hidden = true; return; }
    tip.textContent = target.dataset.tip; tip.hidden = false;
    tip.style.left = `${Math.max(8, Math.min(x + 14, innerWidth - tip.offsetWidth - 10))}px`;
    tip.style.top = `${Math.max(8, Math.min(y + 14, innerHeight - tip.offsetHeight - 10))}px`;
}
document.addEventListener('pointermove', e => showTooltip(e.target.closest('[data-tip]'), e.clientX, e.clientY));
document.addEventListener('focusin', e => { const target = e.target.closest('[data-tip]'); if (target) { const rect = target.getBoundingClientRect(); showTooltip(target, rect.left, rect.bottom); } });
document.addEventListener('click', e => { const target = e.target.closest('.token-value'); if (target) { const rect = target.getBoundingClientRect(); showTooltip(target, rect.left, rect.bottom); } });
for (const event of ['pointerleave', 'focusout', 'scroll']) document.addEventListener(event, () => { $('tooltip').hidden = true; }, true);
document.addEventListener('keydown', e => { if (e.key === 'Escape') $('tooltip').hidden = true; });
document.querySelectorAll('a[href^="#"]').forEach(link => link.addEventListener('click', event => { const section = document.querySelector(link.getAttribute('href')); if (section) { event.preventDefault(); section.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' }); history.replaceState(null, '', link.getAttribute('href')); } }));
let resizeTimer; window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { const oldPage = page; render(); page = oldPage; renderTransactions(); renderReferences(); }, 180); });
const observer = new IntersectionObserver(entries => { const visible = entries.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top); if (visible.length) document.querySelectorAll('nav a').forEach(a => a.classList.toggle('active', a.hash === '#' + visible[0].target.id)); }, { rootMargin: '-5% 0px -65% 0px' }); document.querySelectorAll('main section').forEach(s => observer.observe(s));
(async () => { try { reference = await api('/reference.json'); $('payment-method').insertAdjacentHTML('beforeend', Object.keys(reference).filter(k => k.endsWith('_packages')).map(k => `<option value="${esc(k)}">${esc(friendly(k.replace('_packages', '')))}</option>`).join('')); renderReferences(); await loadData(); const s = await checkStatus(); if (s.running) poll(); else if (s.error) message(s.error, true); } catch (e) { message(e.message, true); } })();

document.querySelector('.pricing-more').addEventListener('toggle', e => { if (e.target.open) { const oldPage = page; render(); page = oldPage; renderTransactions(); } });
