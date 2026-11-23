const assert = require('assert');
const fs = require('fs');
require('../site/live.js');
const L = globalThis.GolfLive;

// A tiny synthetic event: holes are listed in play order with per-hole score to par.
const hole = (period, toPar) => ({period, value: 4 + toPar, scoreType: {displayValue: toPar === 0 ? 'E' : (toPar > 0 ? '+' : '') + toPar}});
const round = (period, holes) => ({period, value: holes.reduce((a, b) => a + 4 + b, 0), linescores: holes.map((h, i) => hole(i + 1, h))});
const even = n => new Array(n).fill(0);
const player = (id, rounds, score) => ({id, athlete: {displayName: 'Player ' + id}, score, linescores: rounds});
const event = {id: '1', name: 'Test Open', status: {type: {state: 'in'}}, competitions: [{status: {period: 3}, competitors: [
  // Leader: -2 through 2 holes of round 3.
  player('a', [round(1, even(18)), round(2, even(18)), {period: 3, linescores: [hole(1, -1), hole(2, -1)]}], '-2'),
  // Not yet teed off in round 3.
  player('b', [round(1, even(18)), round(2, [-1, ...even(17)]), {period: 3}], '-1'),
  // Missed the cut: no round-3 entry.
  player('c', [round(1, [-3, ...even(17)]), round(2, [6, ...even(17)])], '+3'),
]}]};

const parsed = L.parseEvent(event);
assert.equal(parsed.maxRound, 3);
const now = L.stateAt(parsed);
const [a, b, c] = now.states;
assert.deepEqual([a.toPar, a.played, a.remaining, a.alive], [-2, 38, 34, true]);
assert.deepEqual([b.toPar, b.played, b.remaining, b.alive], [-1, 36, 36, true]);
assert.equal(c.alive, false, 'cut player is eliminated');
assert.deepEqual(L.positions(now), ['1', '2', 'CUT']);
assert.deepEqual(parsed.players[0].current, {round: 3, thru: 2, tee: ''});
// Before the cut, the cut player was still alive and the scores are rewound.
const after18 = L.stateAt(parsed, 18);
assert.deepEqual(after18.states.map(s => [s.toPar, s.alive]), [[0, true], [0, true], [-3, true]]);
// This week's completed rounds are centered on each round's field.
assert.equal(after18.states[2].weekRounds, 1);
assert(Math.abs(after18.states[2].weekSum - (-3 - -1)) < 1e-9);

// Simulation: a cut player never wins; probabilities sum to one.
let seed = 7;
const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const sim = L.simulate(now, [0, 0, -5], [2.8, 2.8, 2.8], 4000, random);
assert.equal(sim.wins[2], 0);
assert(Math.abs(sim.win.reduce((x, y) => x + y, 0) - 1) < 1e-9);
assert(sim.win[0] > sim.win[1], 'one-shot leader with fewer holes left is the favorite');
assert(Math.abs(sim.projected[0] - (-2 + 34 * now.fieldHole)) < 1e-9);

// Finished and tied: a sudden-death playoff decides each simulation, favoring the better player.
const done = {states: [{toPar: -10, remaining: 0, alive: true}, {toPar: -10, remaining: 0, alive: true}], fieldHole: 0};
const playoff = L.simulate(done, [-2, 2], [2.8, 2.8], 4000, random, 0);
assert.equal(playoff.playoffs, 4000);
assert(playoff.win[0] > 0.53 && playoff.win[0] < 0.7, playoff.win[0]); // About 0.59 for a 4-stroke-per-round gap over one hole.
// Constant random draws cannot loop forever.
L.simulate(done, [0, 0], [2.8, 2.8], 10, () => 0.5, 0);

// Real ESPN feed after round 3 of the 2026 RSM Classic.
const real = L.parseEvent(JSON.parse(fs.readFileSync(__dirname + '/fixtures/espn-live-rsm-r3.json', 'utf8')).events[0]);
const realNow = L.stateAt(real);
assert.equal(realNow.states.filter(s => s.alive).length, 66);
assert(real.players.every(p => !p.holes.length || Math.abs(p.holes.reduce((x, y) => x + y, 0) - p.official) < 1e-9), 'hole scores add up to official totals');
assert.deepEqual(L.checkpoints(real).map(p => p.holes), [0, 6, 12, 18, 24, 30, 36, 42, 48, 54]);
console.log('Live model parses ESPN scoring, handles cuts and playoffs, and simulates remaining holes.');

// The Vercel proxy's trimmed payload parses to the same tournament state.
const {trim} = require('../api/live.js');
const fixture = JSON.parse(fs.readFileSync(__dirname + '/fixtures/espn-live-rsm-r3.json', 'utf8'));
const trimmed = L.stateAt(L.parseEvent(JSON.parse(JSON.stringify(trim(fixture))).events[0]));
assert.deepEqual(trimmed.states.map(s => [s.id, s.toPar, s.remaining, s.alive]), realNow.states.map(s => [s.id, s.toPar, s.remaining, s.alive]));
console.log('Proxy payload trimming preserves the live state.');
