// The engine must reproduce Mari's paper hand simulation (Phase 2, seed 2).
// Hand values used times rounded to 0.1 h; the engine uses exact values,
// so totals may differ by a few dollars. Berth choices must match exactly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEVEL_1 } from '../src/config.js';
import { runPolicy } from '../src/engine.js';
import { fcfs, fixedPlan, bestPlanBruteForce } from '../src/policies.js';

const T = { Chinamax: 390000, Capesize: 180000, Panamax: 80000 };
const HAND = [
  ['Panamax', 0], ['Chinamax', 1], ['Capesize', 27], ['Capesize', 43], ['Capesize', 57],
  ['Chinamax', 70], ['Capesize', 78], ['Panamax', 96], ['Capesize', 140], ['Capesize', 148],
].map(([cls, arrival], i) => ({ id: i + 1, cls, tonnes: T[cls], arrival }));

const config = { ...LEVEL_1, horizon: 10000 }; // long enough for all 10 to finish
const near = (actual, expected, tol = 100) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${actual.toFixed(0)} not within ${tol} of ${expected}`);

test('FCFS reproduces the hand simulation', () => {
  const sim = runPolicy(config, HAND, fcfs);
  assert.deepEqual(sim.ships.map((s) => s.berth),
    ['B1', 'B1', 'B2', 'B3', 'B1', 'B1', 'B2', 'B3', 'B1', 'B2']);
  near(sim.ships[1].start - sim.ships[1].arrival, 13.7, 0.1); // the Chinamax trap
  near(sim.results().netCost, 16912);
});

test("Mari's hand plan scores about US$40,575", () => {
  const plan = { 1: 'B2', 2: 'B1', 3: 'B2', 4: 'B3', 5: 'B2', 6: 'B1', 7: 'B3', 8: 'B3', 9: 'B2', 10: 'B1' };
  near(runPolicy(config, HAND, fixedPlan(plan)).results().netCost, 40575);
});

test('brute force finds the US$9,450 plan (backfill ship 4 into B1)', () => {
  const best = bestPlanBruteForce(config, HAND);
  assert.equal(best.plan[1], 'B2');
  assert.equal(best.plan[4], 'B1');
  near(best.netCost, 9450);
});

test('a Chinamax can never be sent to B2 or B3', () => {
  const sim = runPolicy(config, HAND, () => {});
  sim.step(); sim.step(); // ships 1 and 2 have arrived
  assert.throws(() => sim.assign(2, 'B2'));
});

test('ships still waiting at the horizon count accrued demurrage only', () => {
  const short = { ...LEVEL_1, horizon: 100 };
  const sim = runPolicy(short, HAND, () => {}); // nobody ever assigned
  const r = sim.results();
  assert.ok(r.netCost > 0 && r.despatch === 0);
});
