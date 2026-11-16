const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = readFileSync(path.join(__dirname, '../web/planner.js'), 'utf8');
const reference = require('../web/reference.json');
const profileKey = 'stripchat-dashboard-level-profile';

function planner(saved) {
    const elements = new Map();
    const defaults = { 'target-type': 'level', balance: '0', watch: '0' };
    const storage = new Map(saved ? [[profileKey, JSON.stringify(saved)]] : []);
    function element(name) {
        if (!elements.has(name)) {
            elements.set(name, Object.assign(new EventTarget(), {
                value: defaults[name] ?? '', validity: { badInput: false }, insertAdjacentHTML() { }
            }));
        }
        return elements.get(name);
    }
    const window = {};
    vm.runInNewContext(source, {
        window,
        document: { getElementById: id => element(id.replace(/^planner-/, '')) },
        localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) }
    });
    window.levelPlanner.load({ transactions: [] }, reference);
    return {
        element,
        profile: () => JSON.parse(storage.get(profileKey)),
        enter(name, value, type = 'input') {
            element(name).value = value;
            element(name).dispatchEvent(new Event(type));
        }
    };
}

test('the planner uses XP earned within the selected level for its targets', () => {
    const { element, enter, profile } = planner();
    assert.equal(element('xp').disabled, true);
    enter('current', '10', 'change');
    assert.equal(element('xp').disabled, false);
    assert.match(element('stats').innerHTML, /XP to target<\/small><strong>250</);
    enter('xp', '120');
    assert.match(element('progress').innerHTML, /120 \/ 250 XP toward level 11/);
    assert.match(element('stats').innerHTML, /XP to target<\/small><strong>130</);
    assert.match(element('stats').innerHTML, /Tokens to spend<\/small><strong>26</);
    enter('target-level', '12');
    assert.match(element('stats').innerHTML, /XP to target<\/small><strong>380</);
    assert.equal(planner(profile()).element('xp').value, '120');
});

test('the planner accepts whole XP below the next level and clears it when the level changes', () => {
    const { element, enter, profile } = planner({ level: 10, levelXp: '0' });
    assert.equal(element('xp').max, '249');
    enter('xp', '249');
    assert.equal(element('results').hidden, false);
    assert.match(element('stats').innerHTML, /XP to target<\/small><strong>1</);
    for (const value of ['250', '-1', '2.5']) {
        enter('xp', value);
        assert.equal(element('results').hidden, true);
        assert.match(element('message').textContent, /0 to 249 XP/);
        assert.equal(profile().levelXp, '249');
    }
    enter('current', '100', 'change');
    assert.equal(element('xp').disabled, true);
    assert.equal(element('xp').value, '');
    assert.deepEqual(profile(), { level: 100, levelXp: '' });
    assert.match(element('progress').innerHTML, /Target already reached/);
    assert.match(element('stats').innerHTML, /XP to target<\/small><strong>0</);
});

test('valid saved account totals convert to level progress without changing the estimate', () => {
    const { element, profile } = planner({ level: 10, xp: '620' });
    assert.equal(element('xp').value, '120');
    assert.deepEqual(profile(), { level: 10, levelXp: '120' });
    assert.match(element('stats').innerHTML, /XP to target<\/small><strong>130</);
    assert.equal(planner({ level: 10, xp: '750' }).element('xp').value, '');
});
