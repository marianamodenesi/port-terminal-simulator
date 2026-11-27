// Benchmark algorithms the player is compared against.

// First come, first served: each ship, when it arrives, is sent to the berth
// where it would FINISH earliest, given what's already booked. No looking
// ahead, no holding berths.
export function fcfs(sim) {
  for (const ship of sim.ships) {
    if (ship.status !== 'waiting' || ship.assignedTo) continue;
    let best = null;
    for (const berth of sim.berths) {
      if (!sim.canUse(ship, berth)) continue;
      const f = sim.estimatedFinish(ship, berth);
      if (!best || f < best.f) best = { berth, f };
    }
    sim.assign(ship.id, best.berth.id);
  }
}

// A fixed plan: plan[shipId] = berth id. Each ship is assigned on arrival.
// Used to replay a hand schedule, and by the brute-force search below.
export function fixedPlan(plan) {
  return (sim) => {
    for (const ship of sim.ships) {
      if (ship.status === 'waiting' && !ship.assignedTo) sim.assign(ship.id, plan[ship.id]);
    }
  };
}

// Exhaustive search over berth choices (ships keep arrival order on each
// berth). Fine for the 10-ship hand simulation (3^8 = 6,561 plans), far too
// slow for a 50-ship level (3^40 plans): the real "best possible" benchmark
// will need a smarter method (e.g. branch and bound or a MIP) in a later step.
import { runPolicy } from './engine.js';

export function bestPlanBruteForce(config, ships) {
  const options = ships.map((s) =>
    config.berths.filter((b) => b.rates[s.cls] !== undefined).map((b) => b.id));
  let best = null;
  const plan = {};
  (function search(i) {
    if (i === ships.length) {
      const sim = runPolicy(config, ships, fixedPlan(plan));
      const { netCost } = sim.results();
      if (!best || netCost < best.netCost) best = { netCost, plan: { ...plan } };
      return;
    }
    for (const id of options[i]) { plan[ships[i].id] = id; search(i + 1); }
  })(0);
  return best;
}
