'use strict';
// Adapted from the supplied standalone level calculator. Prices are integer cents.
window.levelPlanner = (() => {
    const el = name => document.getElementById(`planner-${name}`);
    const number = n => Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 });
    const money = n => new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR' }).format(n / 100);
    const escape = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const key = 'stripchat-dashboard-level-profile';
    let xp, config, initialized = false, balanceEdited = false;
    const league = level => config.leagues.find(l => level >= l.min && level <= l.max)?.name || '';
    function optimize(needed, requirePurchase = false) {
        needed = Math.max(0, Math.ceil(needed));
        if (!needed && !requirePurchase) return { cents: 0, tokens: 0, counts: new Map() };
        needed = Math.max(1, needed);
        const full = config.packages.find(p => p.tokens === 2250), small = config.packages.filter(p => p.tokens !== 2250);
        const fullCount = Math.floor(needed / full.tokens), remainder = needed % full.tokens;
        const limit = remainder + Math.max(...small.map(p => p.tokens));
        const dp = new Array(limit + 1).fill(Infinity), choice = new Array(limit + 1).fill(-1); dp[0] = 0;
        if (remainder) for (let t = 1; t <= limit; t++)small.forEach((p, i) => { if (t >= p.tokens) { const candidate = dp[t - p.tokens] + Math.round(p.price * 100); if (candidate < dp[t]) { dp[t] = candidate; choice[t] = i; } } });
        let best = remainder ? -1 : 0;
        if (remainder) for (let t = remainder; t <= limit; t++)if (best < 0 || dp[t] < dp[best]) best = t;
        const counts = new Map(); let cursor = best;
        while (cursor > 0) { const p = small[choice[cursor]]; counts.set(p.tokens, (counts.get(p.tokens) || 0) + 1); cursor -= p.tokens; }
        if (fullCount) counts.set(full.tokens, fullCount);
        return { cents: fullCount * Math.round(full.price * 100) + dp[best], tokens: fullCount * full.tokens + best, counts };
    }
    function save() {
        try { localStorage.setItem(key, JSON.stringify({ level: Number(el('current').value) || null, xp: el('xp').value })); } catch { /* Storage may be disabled. */ }
    }
    function compute() {
        const type = el('target-type').value;
        for (const name of ['level', 'league', 'feature']) el(`${name}-wrap`).hidden = type !== name;
        const current = Number(el('current').value);
        el('results').hidden = !current;
        if (!current) { el('account-note').textContent = 'Enter your current level once to save it as your default. The payments export does not contain account XP.'; el('message').textContent = 'Choose your current account level to calculate a plan.'; return; }
        const grey = current < 10;
        for (const name of ['watch-enabled', 'email', 'bronze']) el(name).disabled = !grey;
        el('watch').disabled = !grey || !el('watch-enabled').checked;
        let currentXp = xp[current];
        if (el('xp').value !== '') {
            currentXp = Number(el('xp').value);
            if (!Number.isSafeInteger(currentXp) || currentXp < xp[current] || (current < 100 && currentXp >= xp[current + 1])) {
                el('message').textContent = 'Total XP must fall within your selected level’s thresholds. Clear it to use the level minimum.'; el('results').hidden = true; return;
            }
        }
        const balance = Number(el('balance').value), minutes = Number(el('watch').value);
        if (!Number.isSafeInteger(balance) || balance < 0 || !Number.isSafeInteger(minutes) || minutes < 0) { el('message').textContent = 'Use nonnegative whole numbers for available tokens and watch minutes.'; el('results').hidden = true; return; }
        const target = type === 'level' ? Number(el('target-level').value) : type === 'league' ? config.leagues.find(l => l.name === el('target-league').value).min : config.features.find(f => f.key === el('target-feature').value).level;
        const raw = Math.max(0, xp[target] - currentXp);
        const watch = grey && el('watch-enabled').checked ? Math.min(Math.floor(minutes / 15), Math.max(0, xp[Math.min(target, 9)] - currentXp)) : 0;
        const bronze = grey && target >= 10 && el('bronze').checked ? 500 : 0;
        const email = grey && el('email').checked ? 5 : 0;
        const bonus = Math.min(raw, watch + bronze + email), paid = Math.max(0, raw - bonus), needed = Math.ceil(paid / 5);
        const used = el('use-balance').checked ? Math.min(balance, needed) : 0, buy = Math.max(0, needed - used);
        const plan = optimize(buy, bronze > 0);
        el('results').hidden = false; el('message').textContent = '';
        el('account-note').textContent = `Your saved starting point: level ${current} · ${league(current)} · ${number(currentXp)} XP${el('xp').value === '' ? ' (level minimum assumed)' : ''}. Update it when your account progresses.`;
        el('path').textContent = `Level ${current} (${league(current)}) → level ${target} (${league(target)})${type === 'feature' ? ' · ' + config.features.find(f => f.key === el('target-feature').value).label : ''}`;
        const pct = xp[target] ? Math.min(100, currentXp / xp[target] * 100) : 100;
        el('progress').innerHTML = `<progress max="100" value="${pct}" aria-label="Current XP as a share of target threshold"></progress><p>${number(currentXp)} / ${number(xp[target])} XP · ${pct.toFixed(1)}% of target threshold</p>`;
        const stat = (label, value) => `<div class="mini"><small>${escape(label)}</small><strong>${escape(value)}</strong></div>`;
        el('stats').innerHTML = stat('XP to target', number(raw)) + stat('Planned bonus XP', number(bonus)) + stat('Paid XP remaining', number(paid)) + stat('Tokens to spend', number(needed)) + stat('Existing tokens used', number(used)) + stat('Tokens to buy', number(buy)) + stat('Estimated package cost', money(plan.cents)) + stat('Extra purchased tokens', number(plan.tokens - buy));
        const parts = [...plan.counts].sort((a, b) => b[0] - a[0]).map(([tokens, count]) => `${number(count)} × ${number(tokens)} tokens`);
        el('plan').textContent = parts.length ? `Package plan: ${parts.join(' + ')}. Buy ${number(plan.tokens)} tokens for ${money(plan.cents)}.` : 'No additional token packages needed for this plan.';
        el('notes').textContent = [raw === 0 ? 'You are already at or above this target.' : '', bronze ? 'First-purchase bonus included: at least one package is required, even if the bonus covers all XP.' : '', grey && el('watch-enabled').checked ? `Watching contributes ${number(watch)} XP, capped at the target or level 9.` : '', 'Future package estimates use the imported prices, not historical FIFO costs. Bonuses and unlocks are planning assumptions, not verified account entitlements.'].filter(Boolean).join(' ');
    }
    function load(data, reference) {
        xp = reference.xp_by_level; config = reference.level_planner;
        if (!initialized) {
            const options = Object.keys(xp).map(level => `<option value="${level}">L${level} · ${escape(league(Number(level)))} · ${number(xp[level])} XP</option>`).join('');
            el('current').insertAdjacentHTML('beforeend', options); el('target-level').innerHTML = options;
            el('target-league').innerHTML = config.leagues.map(l => `<option value="${escape(l.name)}">${escape(l.name)} · L${l.min}</option>`).join('');
            el('target-feature').innerHTML = config.features.map(f => `<option value="${escape(f.key)}">${escape(f.label)} · L${f.level}</option>`).join('');
            let saved = {}; try { saved = JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch { }
            if (Number.isInteger(saved.level) && saved.level >= 1 && saved.level <= 100) { el('current').value = String(saved.level); el('xp').value = typeof saved.xp === 'string' ? saved.xp : ''; }
            el('target-level').value = String(Math.min(100, (Number(el('current').value) || 9) + 1)); el('target-league').value = 'Bronze'; el('target-feature').value = 'maskMode';
            el('bronze').checked = !data.transactions.some(r => r.purchase);
            el('leagues').innerHTML = '<table><thead><tr><th>League</th><th>Levels</th><th>Reference unlocks</th></tr></thead><tbody>' + config.leagues.map(l => `<tr><td>${escape(l.name)}</td><td>${l.min}–${l.max}</td><td>${escape(config.features.filter(f => f.level >= l.min && f.level <= l.max).map(f => f.label).join(', ') || 'Badge / league progression')}</td></tr>`).join('') + '</tbody></table>';
            el('packages').innerHTML = '<table><thead><tr><th>Package tokens</th><th>Reference EUR</th></tr></thead><tbody>' + config.packages.map(p => `<tr><td>${number(p.tokens)}</td><td>${money(Math.round(p.price * 100))}</td></tr>`).join('') + '</tbody></table>';
            for (const name of ['target-type', 'target-level', 'target-league', 'target-feature', 'watch', 'watch-enabled', 'email', 'bronze', 'use-balance']) el(name).addEventListener('input', compute);
            el('current').addEventListener('change', () => { el('xp').value = ''; el('target-level').value = String(Math.min(100, (Number(el('current').value) || 1) + 1)); save(); compute(); });
            el('xp').addEventListener('input', () => { save(); compute(); });
            el('balance').addEventListener('input', () => { balanceEdited = true; compute(); });
            initialized = true;
        }
        if (!balanceEdited) el('balance').value = String(Math.max(0, data.transactions.reduce((sum, r) => sum + r.tokens, 0)));
        compute();
    }
    return { load };
})();
