const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = readFileSync(path.join(__dirname, '../web/app.js'), 'utf8');
const historyStats = require('../web/analytics.js');
function dashboard(rows = [], savedPrivacy = false) {
    const elements = new Map();
    function element(id) {
        if (!elements.has(id)) {
            const node = {
                value: '', textContent: '', clientWidth: 760, hidden: false, disabled: false,
                setAttribute() { }, classList: { toggle() { } }, scrollIntoView() { }, focus() { },
                closest() { return { querySelector() { return { textContent: id }; } }; },
                options: [],
                get selectedOptions() { return [{ textContent: this.options.find(o => o.value === this.value)?.label || this.value }]; },
                get innerHTML() { return this.html || ''; },
                set innerHTML(html) {
                    this.html = html;
                    if (id === 'wrapped-month') {
                        this.options = [...html.matchAll(/<option value="([^"]+)">([^<]+)<\/option>/g)].map(m => ({ value: m[1], label: m[2] }));
                        this.value = this.options[0]?.value || '';
                    }
                }
            };
            elements.set(id, node);
        }
        return elements.get(id);
    }
    const storage = new Map([['stripchat-dashboard-hide-names', String(savedPrivacy)]]);
    const context = vm.createContext({
        document: { getElementById: element, documentElement: { dataset: {} } },
        localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
        matchMedia: () => ({ matches: false }), console, rows, historyStats, window: { levelPlanner: { load() { } } }
    });
    vm.runInContext(source.slice(0, source.indexOf("$('refresh').onclick")), context);
    const run = code => vm.runInContext(code, context);
    element('mode').value = 'all'; element('category').value = 'all'; element('sort').value = 'newest';
    run(`data = { transactions: rows }; defaultDates = { from: rows[0]?.date.slice(0, 10) || '', to: rows.at(-1)?.date.slice(0, 10) || '' }; aliases = new Map([...new Set(rows.map(r => r.username))].map((n, i) => [n, 'Recipient ' + (i + 1)]));`);
    return { run, element, storage };
}
function row(date, tokens, username = 'Alice', vr = false, purchase = false) {
    return { date: date + 'T12:00:00Z', tokens, username, vr, purchase, spending: !purchase, estimated_eur: Math.abs(tokens) / 10, id: date, type: purchase ? 'purchase' : 'tip', eur_per_token: .1, matched_cost_tokens: Math.abs(tokens), fallback_cost_tokens: 0, matched_estimated_eur: Math.abs(tokens) / 10, fallback_estimated_eur: 0, source: 'Unspecified', cost_basis: 'Test reference price' };
}

test('UTC month boundaries include leap years and year rollover', () => {
    const { run } = dashboard();
    assert.equal(run("monthEnd('2024-02')"), '2024-02-29');
    assert.equal(run("monthEnd('2025-02')"), '2025-02-28');
    assert.equal(run("shiftDay('2025-01-01', -1)"), '2024-12-31');
    assert.equal(run('delta(100, 0)'), 'No previous baseline');
    assert.equal(run('delta(0, 100)'), '-100%');
});
test('Wrapped compares complete historical months and respects VR rather than date filters', () => {
    const { run, element } = dashboard([row('2024-02-29', -80), row('2024-03-03', -100), row('2024-03-04', -40, 'Bob', true), row('2024-03-10', 200, 'Topup', false, true)]);
    element('from').value = '2024-03-10'; element('to').value = '2024-03-10';
    run('renderWrapped()');
    assert.match(element('wrapped-card').innerHTML, /\+75%/);
    assert.match(element('wrapped-card').innerHTML, /2024-02-01 – 2024-02-29/);
    assert.match(element('wrapped-card').innerHTML, /Alice/);
    element('mode').value = 'vr'; run('renderWrapped()');
    assert.match(element('wrapped-card').innerHTML, /Bob/);
    assert.doesNotMatch(element('wrapped-card').innerHTML, /Alice/);
    assert.match(element('wrapped-card').innerHTML, /No previous baseline/);
});
test('privacy applies to recap, legends and recipient controls on initial load', () => {
    const { run, element } = dashboard([row('2024-03-02', -100)], true);
    run("renderWrapped(); spending = rows; renderRecipientTimeline(['2024-03'], [{username: 'Alice', value: 100, rows}]);");
    assert.doesNotMatch(element('wrapped-card').innerHTML, /Alice/);
    assert.doesNotMatch(element('recipient-legend').innerHTML, /Alice/);
    assert.match(element('wrapped-card').innerHTML, /Recipient 1/);
    assert.doesNotMatch(run("recipientButton('Alice')"), /Alice/);
});
test('rolling average includes prior six days and inactive days', () => {
    const { run, element } = dashboard([row('2024-03-01', -70), row('2024-03-07', -140)]);
    run("spending = [rows[1]]; renderInsights([], ['2024-03-07'], new Map([['2024-03-07', 140]]), new Map([['2024-03-07', 14]]), []);");
    assert.match(element('rolling-chart').innerHTML, /Seven-day average: 30 tokens/);
});
test('chart drill-down uses exact recipient matches and clears independently', () => {
    const { run, element } = dashboard([row('2024-03-01', -10, 'Ann'), row('2024-03-02', -20, 'Anna')]);
    run("filtered = rows; openTransactions({label: 'Ann', matches: r => r.username === 'Ann'});");
    assert.equal(run('tableRows.length'), 1);
    assert.equal(run('tableRows[0].username'), 'Ann');
    assert.equal(element('drill-scope').hidden, false);
    run('clearDrill(); renderTransactions();');
    assert.equal(run('tableRows.length'), 2);
    assert.equal(element('drill-scope').hidden, true);
});
test('empty exports and months without spending produce a usable recap', () => {
    const empty = dashboard(); empty.run('renderWrapped()');
    assert.equal(empty.element('wrapped-month').disabled, true);
    assert.match(empty.element('wrapped-card').innerHTML, /first monthly Wrapped/);
    const quiet = dashboard([row('2024-01-01', -10), row('2024-03-01', -10)]);
    quiet.run("renderWrapped(); $('wrapped-month').value = '2024-02'; renderWrapped();");
    assert.match(quiet.element('wrapped-card').innerHTML, /No spending yet/);
    assert.doesNotMatch(quiet.element('wrapped-card').innerHTML, /NaN|Infinity/);
});
test('partial selected months are excluded from month-over-month comparisons', () => {
    const { run, element } = dashboard();
    element('from').value = '2024-02-15'; element('to').value = '2024-03-31';
    assert.equal(run("monthIsPartial('2024-02')"), true);
    assert.equal(run("monthIsPartial('2024-03')"), false);
});
test('period comparison uses the preceding equal duration with the same VR filter', () => {
    const { run, element } = dashboard([row('2024-03-01', -50, 'Alice', true), row('2024-03-02', -500), row('2024-03-03', -100, 'Alice', true)]);
    element('from').value = '2024-03-03'; element('to').value = '2024-03-04'; element('mode').value = 'vr';
    run('filtered = historyBetween("2024-03-03", "2024-03-04"); spending = filtered; purchases = []; renderComparison();');
    assert.match(element('period-comparison').innerHTML, /2024-03-01 – 2024-03-02/);
    assert.match(element('period-comparison').innerHTML, /\+100%/);
    assert.match(element('period-comparison').innerHTML, /Previously 50 tokens/);
});
test('concentration keeps the remaining recipients in Other and reaches 100 percent', () => {
    const { run, element } = dashboard(Array.from({ length: 18 }, (_, i) => row('2024-03-01', -10, 'Person' + i)));
    run('spending = rows; renderConcentration(rows.map(r => ({username: r.username, value: 10})));');
    assert.match(element('concentration-chart').innerHTML, /Other: 30 tokens · cumulative 100%/);
    assert.match(element('concentration-note').textContent, /16.7%/);
});

test('complete report handles empty data and a purchase-only selection without invalid numbers', () => {
    for (const rows of [[], [row('2024-03-01', 100, 'Topup', false, true)]]) {
        const { run, element } = dashboard(rows);
        element('from').value = rows.length ? '2024-03-01' : '';
        element('to').value = rows.length ? '2024-03-03' : '';
        run('render()');
        for (const id of ['report-highlights', 'typical-stats', 'typical-table', 'burst-stats', 'topup-rhythm', 'activity-stats']) {
            assert.doesNotMatch(element(id).innerHTML, /NaN|Infinity|undefined/);
        }
        assert.match(element('burst-stats').innerHTML, /Recorded spending bursts/);
        if (rows.length) assert.match(element('lifecycle-table').innerHTML, /Not reached/);
    }
});

test('the expanded report and recipient details preserve privacy across names and tooltips', () => {
    const { run, element } = dashboard([row('2024-01-01', -10, 'Alice'), row('2024-02-01', -30, 'Alice'), row('2024-02-02', -20, 'Bob')], true);
    element('from').value = '2024-02-01'; element('to').value = '2024-02-02';
    run("render(); selectedRecipient = 'Alice'; renderRecipient();");
    for (const id of ['recipient-changes', 'recipient-history-table', 'recipient-timeline', 'recipient-return-chart', 'recipient-actions', 'wrapped-card', 'burst-table']) {
        assert.doesNotMatch(element(id).innerHTML, /Alice|Bob|stripchat\.com/);
    }
    assert.match(element('recipient-history-detail').innerHTML, /2024-01-01/);
    assert.match(element('recipient-history-table').innerHTML, /Returning/);
});

test('new recipient classification uses earlier history outside the date and VR selection', () => {
    const { run, element } = dashboard([row('2024-01-01', -10, 'Alice'), row('2024-02-01', -30, 'Alice', true), row('2024-02-02', -20, 'Bob', true)]);
    element('from').value = '2024-02-01'; element('to').value = '2024-02-02'; element('mode').value = 'vr';
    run('render()');
    assert.match(element('recipient-history-table').innerHTML, /Alice<\/button><\/td><td>2024-01-01/);
    assert.match(element('recipient-history-table').innerHTML, /Returning/);
    assert.match(element('recipient-history-table').innerHTML, /First seen here/);
    assert.match(element('burst-table').innerHTML, /2024-02-01/);
    assert.doesNotMatch(element('burst-table').innerHTML, /2024-01-01/);
});

test('a decreased recipient with no current payments drills into the previous interval', () => {
    const { run, element } = dashboard([row('2024-03-01', -70, 'Alice'), row('2024-03-03', -20, 'Bob')]);
    element('from').value = '2024-03-03'; element('to').value = '2024-03-04';
    run('render();');
    run("activateDrill(drillActions.find(a => a.label === 'Alice' && a.range));");
    assert.equal(element('from').value, '2024-03-01');
    assert.equal(element('to').value, '2024-03-02');
    assert.equal(run('tableRows.length'), 1);
    assert.equal(run('tableRows[0].username'), 'Alice');
});

test('loading replacement JSON clears transaction selections that reference old records', async () => {
    const { run, element } = dashboard([row('2024-03-01', -10), row('2024-03-02', -20)]);
    element('from').value = '2024-03-01'; element('to').value = '2024-03-02';
    run("render(); const selected = new Set([rows[0]]); openTransactions({label: 'First day', matches: r => selected.has(r)});");
    assert.equal(run('tableRows.length'), 1);
    await run("api = async () => ({transactions: rows.map(r => ({...r})), exists: false}); loadData();");
    assert.equal(element('drill-scope').hidden, true);
    assert.equal(run('tableRows.length'), 2);
});
