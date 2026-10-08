const { test } = require('node:test');
const assert = require('node:assert/strict');
const stats = require('../web/analytics.js');
const day = row => row.date.slice(0, 10);
const row = (date, tokens, username = 'Alice', purchase = false) => ({ date: date.length === 10 ? date + 'T12:00:00Z' : date, tokens, username, purchase, spending: tokens < 0, type: purchase ? 'purchase' : 'tip' });

test('percentiles interpolate, preserve input and distinguish empty from zero', () => {
    const values = [100, 0, 10, 20];
    assert.equal(stats.quantile(values, .5), 15);
    assert.equal(stats.quantile(values, .25), 7.5);
    assert.equal(stats.quantile([], .5), null);
    assert.equal(stats.quantile([0], .5), 0);
    assert.deepEqual(values, [100, 0, 10, 20]);
});

test('typical amounts, concentration and runs include observed days without spending', () => {
    const rows = [row('2024-01-01', -10), row('2024-01-01', -90), row('2024-01-02', -20), row('2024-01-05', -1000)];
    const result = stats.summarize(rows, ['2024-01-01', '2024-01-02', '2024-01-03', '2024-01-04', '2024-01-05'], day);
    assert.equal(result.medianTransaction, 55);
    assert.equal(result.medianActiveDay, 100);
    assert.equal(result.medianCalendarDay, 20);
    assert.equal(result.meanCalendarDay, 224);
    assert.equal(result.topRows.length, 1);
    assert.equal(result.topRowsShare, 1000 / 1120 * 100);
    assert.equal(result.topDaysShare, 100);
    assert.deepEqual(result.activeRun, { length: 2, start: '2024-01-01', end: '2024-01-02' });
    assert.deepEqual(result.quietRun, { length: 2, start: '2024-01-03', end: '2024-01-04' });
});

test('empty spending still gives meaningful calendar zeros and no invented percentiles', () => {
    const result = stats.summarize([], ['2024-01-01', '2024-01-02'], day);
    assert.equal(result.medianTransaction, null);
    assert.equal(result.meanCalendarDay, 0);
    assert.equal(result.medianCalendarDay, 0);
    assert.equal(result.topDaysShare, null);
    assert.equal(result.quietRun.length, 2);
});

test('factor allocations and recipient/type changes reconcile exactly to total change', () => {
    const previous = [row('2024-01-01', -10), row('2024-01-01', -10)];
    const current = [row('2024-02-01', -30, 'Bob'), row('2024-02-02', -30), row('2024-02-02', -60)];
    current[2].type = 'ticketShow';
    const result = stats.compare(current, previous, day);
    assert.equal(result.change, 100);
    assert.ok(Math.abs(result.factors.reduce((a, f) => a + f.effect, 0) - result.change) < 1e-9);
    assert.equal(result.recipients.reduce((a, r) => a + r.change, 0), 100);
    assert.equal(result.types.reduce((a, r) => a + r.change, 0), 100);
    assert.deepEqual(result.factors.map(f => f.current), [2, 1.5, 40]);
});

test('zero baselines and periods without spending do not create artificial factor explanations', () => {
    for (const result of [stats.compare([row('2024-01-01', -10)], [], day), stats.compare([], [row('2024-01-01', -10)], day)]) {
        assert.ok(result.factors.every(f => f.effect === null));
    }
});

test('recipient recurrence uses distinct days and full-history first dates', () => {
    const earlier = row('2024-01-01', -10), a = row('2024-02-01', -20), b = row('2024-02-01', -30), c = row('2024-03-03', -40), d = row('2024-03-03', -5, 'Bob');
    const result = stats.recipientHistory([d, c, b, earlier, a], [a, b, c, d], '2024-02-01', day);
    assert.equal(result[0].new, false);
    assert.equal(result[0].first, '2024-01-01');
    assert.equal(result[0].days, 2);
    assert.equal(result[0].months, 2);
    assert.equal(result[0].medianGap, 31);
    assert.equal(result[1].new, true);
    assert.equal(result[1].medianGap, null);
});

test('bursts preserve full-history boundaries when filters hide intermediate payments', () => {
    const a = row('2024-01-01T12:00:00Z', -10), b = row('2024-01-01T12:30:00Z', -20, 'Bob'), c = row('2024-01-01T13:00:00Z', -30), d = row('2024-01-01T13:31:00Z', -100);
    const result = stats.bursts([d, c, b, a], [a, c, d]);
    assert.equal(result.length, 2);
    assert.equal(result[0].total, 40);
    assert.equal(result[0].spanMinutes, 60);
    assert.equal(result[0].clipped, true);
    assert.equal(result[1].clipped, false);
});

test('bursts cross midnight and identify a date-filtered fragment', () => {
    const a = row('2024-01-01T23:55:00Z', -10), b = row('2024-01-02T00:05:00Z', -20);
    assert.equal(stats.bursts([a, b], [a, b]).length, 1);
    const selected = stats.bursts([a, b], [b])[0];
    assert.equal(selected.total, 20);
    assert.equal(selected.clipped, true);
});

test('FIFO consumes other credits, distinguishes refunds and leaves unfinished top-ups open', () => {
    const missing = row('2024-01-01', -20), credit = { ...row('2024-01-02', 40), spending: false }, first = row('2024-01-03', 100, 'Topup', true), spending = row('2024-01-04', -50), refund = { ...row('2024-01-05', -60), spending: false, type: 'refund' }, second = row('2024-01-06', 200, 'Topup', true), later = row('2024-01-07', -100);
    const rows = [missing, credit, first, spending, refund, second, later], snapshot = JSON.stringify(rows);
    const result = stats.purchaseLifecycle(rows);
    assert.equal(result.uncovered, 20);
    assert.equal(result.batches[0].spent, 40);
    assert.equal(result.batches[0].other, 60);
    assert.equal(result.batches[0].remaining, 0);
    assert.equal(result.batches[0].half, refund.date);
    assert.equal(result.batches[0].finished, later.date);
    assert.equal(result.batches[1].remaining, 130);
    assert.equal(result.batches[1].half, null);
    assert.equal(result.batches[1].finished, null);
    assert.equal(JSON.stringify(rows), snapshot);
});

test('FIFO orders subsecond timestamps chronologically rather than lexically', () => {
    const purchase = row('2024-01-01T12:00:00Z', 100, 'Topup', true), spending = row('2024-01-01T12:00:00.001Z', -100);
    const result = stats.purchaseLifecycle([spending, purchase]);
    assert.equal(result.uncovered, 0);
    assert.equal(result.batches[0].finished, spending.date);
    assert.equal(result.batches[0].remaining, 0);
});

test('weekday averages normalize unequal occurrence counts and missing weekdays remain absent', () => {
    const rows = [row('2024-01-01', -100), row('2024-01-02', -80)], days = Array.from({ length: 8 }, (_, i) => '2024-01-' + String(i + 1).padStart(2, '0'));
    const result = stats.weekdayProfile(rows, days, day);
    assert.equal(result[0].occurrences, 2);
    assert.equal(result[0].average, 50);
    assert.equal(result[0].activePercent, 50);
    assert.equal(result[1].average, 80);
    assert.equal(stats.weekdayProfile(rows, ['2024-01-01'], day)[1].average, null);
});

test('local date keys and hours follow midnight boundaries and daylight saving changes', () => {
    assert.equal(stats.dateKey('2024-03-31T22:30:00Z', 'Europe/Berlin'), '2024-04-01');
    assert.equal(stats.dateKey('2024-03-31T22:30:00Z', 'UTC'), '2024-03-31');
    assert.equal(stats.timestamp('2024-03-31T00:30:00Z', 'Europe/Berlin'), '2024-03-31 01:30:00');
    assert.equal(stats.timestamp('2024-03-31T01:30:00Z', 'Europe/Berlin'), '2024-03-31 03:30:00');
    assert.equal(stats.timestamp('2024-10-27T00:30:00Z', 'Europe/Berlin'), '2024-10-27 02:30:00');
    assert.equal(stats.timestamp('2024-10-27T01:30:00Z', 'Europe/Berlin'), '2024-10-27 02:30:00');
});
