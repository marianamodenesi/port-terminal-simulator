import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEVEL_1 } from '../src/config.js';
import { generateShips } from '../src/random.js';
import { runPolicy } from '../src/engine.js';
import { fcfs } from '../src/policies.js';

test('same seed gives the same ships (fair, comparable scores)', () => {
  assert.deepEqual(generateShips(LEVEL_1, 42), generateShips(LEVEL_1, 42));
});

test('arrival rate and mix match the paper model on average', () => {
  let n = 0, chinamax = 0, util = 0;
  const seeds = 300;
  for (let seed = 1; seed <= seeds; seed++) {
    const ships = generateShips(LEVEL_1, seed);
    n += ships.length;
    chinamax += ships.filter((s) => s.cls === 'Chinamax').length;
    const sim = runPolicy({ ...LEVEL_1, horizon: 100000 }, ships, fcfs);
    const busy = sim.ships.reduce((h, s) => h + Math.min(s.finish, 720) - Math.min(s.start, 720), 0);
    util += busy / (3 * 720);
  }
  const avgShips = n / seeds;
  assert.ok(avgShips > 46 && avgShips < 54, `avg ships ${avgShips}`);       // 720 / 14.5 ≈ 49.7
  assert.ok(Math.abs(chinamax / n - 0.2) < 0.02, `chinamax share ${chinamax / n}`);
  assert.ok(util / seeds > 0.70 && util / seeds < 0.80, `utilization ${util / seeds}`); // target ~0.75
});
