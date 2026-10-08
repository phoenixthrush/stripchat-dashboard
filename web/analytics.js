'use strict';

// Calculations use saved transactions only. No account activity is inferred.
(function (root) {
    const tokens = rows => rows.reduce((total, row) => total + Math.abs(row.tokens), 0);
    const elapsedDays = (first, last) => (new Date(last) - new Date(first)) / 86400000;
    const formatters = new Map();
    const dates = new Map();
    function dateParts(value, zone = 'UTC') {
        const cacheKey = `${zone}:${value}`;
        if (dates.has(cacheKey)) return dates.get(cacheKey);
        if (!formatters.has(zone)) formatters.set(zone, new Intl.DateTimeFormat('en-CA', {
            timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
        }));
        const parts = Object.fromEntries(formatters.get(zone).formatToParts(new Date(value)).map(p => [p.type, p.value]));
        dates.set(cacheKey, parts);
        return parts;
    }
    function dateKey(value, zone = 'UTC') {
        if (zone === 'UTC') return value.slice(0, 10);
        const p = dateParts(value, zone);
        return `${p.year}-${p.month}-${p.day}`;
    }
    function timestamp(value, zone = 'UTC') {
        const p = dateParts(value, zone);
        return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
    }
    function quantile(values, fraction) {
        if (!values.length) return null;
        const sorted = [...values].sort((a, b) => a - b), index = (sorted.length - 1) * fraction;
        const lower = Math.floor(index), upper = Math.ceil(index);
        return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
    }
    function dailyTotals(rows, key) {
        const daily = new Map();
        for (const row of rows) daily.set(key(row), (daily.get(key(row)) || 0) + Math.abs(row.tokens));
        return daily;
    }
    function longestRun(days, matches) {
        let best = { length: 0, start: null, end: null }, length = 0, start = null;
        for (const day of days) {
            if (matches(day)) {
                if (!length) start = day;
                length++;
                if (length > best.length) best = { length, start, end: day };
            } else length = 0;
        }
        return best;
    }
    function summarize(rows, days, key) {
        const daily = dailyTotals(rows, key), total = tokens(rows), amounts = rows.map(r => Math.abs(r.tokens));
        const activeAmounts = [...daily.values()], calendarAmounts = days.map(d => daily.get(d) || 0), calendarDays = new Set(days);
        const rankedDays = [...daily].sort((a, b) => b[1] - a[1]);
        const topRows = [...rows].sort((a, b) => Math.abs(b.tokens) - Math.abs(a.tokens)).slice(0, Math.ceil(rows.length / 10));
        const topDays = rankedDays.slice(0, 3);
        return {
            total, count: rows.length, active: daily.size, calendar: days.length, daily, topDays, topRows,
            meanTransaction: rows.length ? total / rows.length : null,
            medianTransaction: quantile(amounts, .5), q1Transaction: quantile(amounts, .25), q3Transaction: quantile(amounts, .75),
            medianActiveDay: quantile(activeAmounts, .5), q1ActiveDay: quantile(activeAmounts, .25), q3ActiveDay: quantile(activeAmounts, .75),
            medianCalendarDay: quantile(calendarAmounts, .5),
            meanCalendarDay: days.length ? tokens(rows.filter(r => calendarDays.has(key(r)))) / days.length : null,
            topDaysShare: total ? topDays.reduce((a, d) => a + d[1], 0) / total * 100 : null,
            topRowsShare: total ? tokens(topRows) / total * 100 : null,
            activeRun: longestRun(days, d => daily.has(d)), quietRun: longestRun(days, d => !daily.has(d))
        };
    }
    function groupChanges(current, previous, key) {
        const before = dailyTotals(previous, key), after = dailyTotals(current, key);
        return [...new Set([...before.keys(), ...after.keys()])].map(label => ({
            label, previous: before.get(label) || 0, current: after.get(label) || 0,
            change: (after.get(label) || 0) - (before.get(label) || 0)
        })).sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
    }
    function compare(current, previous, key) {
        const factors = rows => {
            const active = new Set(rows.map(key)).size;
            return [active, active ? rows.length / active : 0, rows.length ? tokens(rows) / rows.length : 0];
        };
        const before = factors(previous), after = factors(current);
        // Average all six substitution orders so interacting factors share the change fairly.
        const effects = [0, 0, 0], orders = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
        const product = values => values.reduce((a, b) => a * b, 1);
        if (current.length && previous.length) for (const order of orders) {
            const values = [...before];
            for (const i of order) {
                const prior = product(values);
                values[i] = after[i];
                effects[i] += (product(values) - prior) / orders.length;
            }
        }
        return {
            previous: tokens(previous), current: tokens(current), change: tokens(current) - tokens(previous),
            factors: ['Active days', 'Transactions per active day', 'Tokens per transaction'].map((label, i) => ({
                label, previous: before[i], current: after[i], effect: current.length && previous.length ? effects[i] : null
            })),
            recipients: groupChanges(current, previous, r => r.username), types: groupChanges(current, previous, r => r.type)
        };
    }
    function recipientHistory(history, selected, start, key) {
        const first = new Map();
        for (const row of history) if (row.spending) {
            const d = key(row);
            if (!first.has(row.username) || d < first.get(row.username)) first.set(row.username, d);
        }
        const groups = new Map();
        for (const row of selected) {
            if (!groups.has(row.username)) groups.set(row.username, []);
            groups.get(row.username).push(row);
        }
        return [...groups].map(([username, rows]) => {
            const days = [...new Set(rows.map(key))].sort(), months = new Set(days.map(d => d.slice(0, 7)));
            const gaps = days.slice(1).map((d, i) => elapsedDays(days[i], d));
            return {
                username, rows, total: tokens(rows), days: days.length, months: months.size,
                first: first.get(username), latest: days.at(-1), new: first.get(username) >= start,
                medianGap: quantile(gaps, .5)
            };
        }).sort((a, b) => b.total - a.total);
    }
    function bursts(history, selected, gapMinutes = 30) {
        const groups = [], chosen = new Set(selected);
        for (const row of [...history].filter(r => r.spending).sort((a, b) => new Date(a.date) - new Date(b.date))) {
            const last = groups.at(-1);
            if (!last || new Date(row.date) - new Date(last.at(-1).date) > gapMinutes * 60000) groups.push([row]);
            else last.push(row);
        }
        return groups.flatMap(full => {
            const rows = full.filter(r => chosen.has(r));
            return rows.length ? [{
                rows, total: tokens(rows), start: rows[0].date, end: rows.at(-1).date,
                recipients: new Set(rows.map(r => r.username)).size,
                spanMinutes: (new Date(rows.at(-1).date) - new Date(rows[0].date)) / 60000,
                clipped: full.length !== rows.length
            }] : [];
        });
    }
    function purchaseLifecycle(history) {
        const queue = [], batches = [];
        let cursor = 0, uncovered = 0;
        for (const row of [...history].sort((a, b) => new Date(a.date) - new Date(b.date))) {
            if (row.tokens > 0) {
                const batch = { row, remaining: row.tokens, spent: 0, other: 0, half: null, finished: null };
                queue.push(batch);
                if (row.purchase) batches.push(batch);
            } else if (row.tokens < 0) {
                let remaining = -row.tokens;
                while (remaining && cursor < queue.length) {
                    const batch = queue[cursor], used = Math.min(remaining, batch.remaining);
                    batch.remaining -= used;
                    batch[row.spending ? 'spent' : 'other'] += used;
                    if (!batch.half && batch.remaining <= batch.row.tokens / 2) batch.half = row.date;
                    if (!batch.remaining) { batch.finished = row.date; cursor++; }
                    remaining -= used;
                }
                uncovered += remaining;
            }
        }
        return { batches, uncovered };
    }
    function weekdayProfile(rows, days, key) {
        const daily = dailyTotals(rows, key);
        return Array.from({ length: 7 }, (_, weekday) => {
            const occurrences = days.filter(d => (new Date(d + 'T12:00:00Z').getUTCDay() + 6) % 7 === weekday);
            const active = occurrences.filter(d => daily.has(d)), total = occurrences.reduce((a, d) => a + (daily.get(d) || 0), 0);
            return {
                occurrences: occurrences.length, active: active.length, total,
                average: occurrences.length ? total / occurrences.length : null,
                activePercent: occurrences.length ? active.length / occurrences.length * 100 : null,
                medianActive: quantile(active.map(d => daily.get(d)), .5)
            };
        });
    }
    const api = { dateParts, dateKey, timestamp, elapsedDays, quantile, summarize, compare, recipientHistory, bursts, purchaseLifecycle, weekdayProfile };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.historyStats = api;
})(globalThis);
