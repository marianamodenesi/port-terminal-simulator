// Discrete-event simulation engine for the port terminal.
//
// No graphics here on purpose: the screen (2D now, maybe 3D later) only READS
// this state. That keeps the maths testable and lets us swap the visuals.
//
// The core idea (same as your Arena model): the clock does not tick hour by
// hour. It JUMPS from one event to the next. There are only two event types:
//   ARRIVAL - a ship reaches the anchorage
//   FINISH  - a ship finishes loading and leaves its berth
// Between events nothing changes, so there is nothing to compute.

export class Simulation {
  constructor(config, ships) {
    this.config = config;
    this.time = 0;
    this.ships = ships.map((s) => ({
      ...s,
      laytime: s.tonnes / config.laytimeRate + config.laytimeTurnTime,
      status: 'expected',   // expected -> waiting -> loading -> done
      assignedTo: null,     // berth id, 'ANY' (first free berth) or null
      berth: null,
      start: null,
      finish: null,
      cost: null,
    }));
    this.berths = config.berths.map((b) => ({ ...b, current: null, queue: [] }));
    this.byId = new Map(this.ships.map((s) => [s.id, s]));

    // Future event list, kept sorted by time. Arrivals are known in advance.
    this.events = this.ships.map((s) => ({ time: s.arrival, type: 'ARRIVAL', shipId: s.id }));
    this.sortEvents();
    this.log = [];
  }

  sortEvents() {
    // Ties: process FINISH before ARRIVAL, so a berth freed at time t can
    // take a ship arriving at the same t.
    this.events.sort((a, b) => a.time - b.time || (a.type === 'FINISH' ? -1 : 1));
  }

  // --- Helpers the player, the screen and the algorithms all use -----------

  berth(id) { return this.berths.find((b) => b.id === id); }

  canUse(ship, berth) { return berth.rates[ship.cls] !== undefined; }

  // Hours a ship occupies a berth: loading at that berth's rate + overhead.
  serviceTime(ship, berth) {
    return ship.tonnes / berth.rates[ship.cls] + this.config.overheadHours;
  }

  // When could a NEW ship start at this berth, given what's already on it
  // and queued behind it? (Used by the ship cards and by FCFS.)
  berthAvailableAt(berth) {
    let t = berth.current ? berth.current.finish : this.time;
    for (const s of berth.queue) t = Math.max(t, s.arrival) + this.serviceTime(s, berth);
    return t;
  }

  // Estimated finish if this ship were sent to this berth now (ship card info).
  estimatedFinish(ship, berth) {
    const start = Math.max(this.berthAvailableAt(berth), ship.arrival, this.time);
    return start + this.serviceTime(ship, berth);
  }

  // Ships the player can see and act on: waiting ones, plus the 72 h line-up.
  visibleShips() {
    return this.ships.filter(
      (s) => s.status === 'waiting' ||
        (s.status === 'expected' && s.arrival <= this.time + this.config.lineupWindow),
    );
  }

  // --- The player's (or an algorithm's) only action -------------------------

  // Send a ship to a berth. If the berth is busy, the ship queues behind it.
  // berthId 'ANY' = "send to first free berth" it can use.
  assign(shipId, berthId) {
    const ship = this.byId.get(shipId);
    if (!ship || ship.assignedTo || !['expected', 'waiting'].includes(ship.status)) {
      throw new Error(`Ship ${shipId} can't be assigned now`);
    }
    if (ship.status === 'expected' && ship.arrival > this.time + this.config.lineupWindow) {
      throw new Error(`Ship ${shipId} isn't in the line-up yet`);
    }
    if (berthId !== 'ANY') {
      const berth = this.berth(berthId);
      if (!this.canUse(ship, berth)) throw new Error(`${ship.cls} can't use ${berthId}`);
      berth.queue.push(ship);
    }
    ship.assignedTo = berthId;
    this.startShips();
  }

  // --- Running the clock ----------------------------------------------------

  // Start every ship that can start now: berth free, ship arrived, first in
  // that berth's queue. Then serve 'ANY' ships in arrival order.
  startShips() {
    for (const berth of this.berths) {
      if (!berth.current && berth.queue.length && berth.queue[0].status === 'waiting') {
        this.begin(berth.queue.shift(), berth);
      }
    }
    for (const ship of this.ships) {
      if (ship.assignedTo !== 'ANY' || ship.status !== 'waiting') continue;
      const free = this.berths.filter((b) => !b.current && !b.queue.length && this.canUse(ship, b));
      if (!free.length) continue;
      // Of the free berths, take the fastest one for this ship.
      free.sort((a, b) => this.serviceTime(ship, a) - this.serviceTime(ship, b));
      this.begin(ship, free[0]);
    }
  }

  begin(ship, berth) {
    ship.status = 'loading';
    ship.berth = berth.id;
    ship.start = this.time;
    ship.finish = this.time + this.serviceTime(ship, berth);
    berth.current = ship;
    this.events.push({ time: ship.finish, type: 'FINISH', shipId: ship.id });
    this.sortEvents();
  }

  // Demurrage if time in port > laytime, despatch (negative cost) if less.
  costOf(ship, endTime) {
    const timeInPort = endTime - ship.arrival;
    const over = timeInPort - ship.laytime;
    return over > 0 ? over * this.config.demurragePerHour : over * this.config.despatchPerHour;
  }

  // Process the next event. Returns it, or null if the level is over.
  step() {
    const ev = this.events[0];
    if (!ev || ev.time > this.config.horizon) return null;
    this.events.shift();
    this.time = ev.time;
    const ship = this.byId.get(ev.shipId);
    if (ev.type === 'ARRIVAL') {
      ship.status = 'waiting';
    } else {
      ship.status = 'done';
      ship.cost = this.costOf(ship, ship.finish);
      this.berth(ship.berth).current = null;
    }
    this.startShips();
    this.log.push(ev);
    return ev;
  }

  // A decision is needed when a berth is idle and a visible ship could use it.
  // This is what triggers auto-pause in the game.
  needsDecision() {
    return this.berths.some((b) => !b.current && !b.queue.length &&
      this.visibleShips().some((s) => !s.assignedTo && this.canUse(s, b)));
  }

  isOver() {
    const next = this.events[0];
    return !next || next.time > this.config.horizon;
  }

  // Final score. Ships still in port at the horizon count the demurrage they
  // have built up so far (no despatch), so stalling at the end never pays.
  results() {
    const end = this.config.horizon;
    let netCost = 0, demurrage = 0, despatch = 0, waitSum = 0, n = 0, tonnes = 0;
    for (const s of this.ships) {
      if (s.arrival > end) continue;
      n++;
      let cost;
      if (s.status === 'done') {
        cost = s.cost;
        tonnes += s.tonnes;
      } else {
        cost = Math.max(0, this.costOf(s, end));
      }
      netCost += cost;
      if (cost > 0) demurrage += cost; else despatch -= cost;
      waitSum += (s.start ?? end) - s.arrival;
    }
    return { netCost, demurrage, despatch, avgWait: n ? waitSum / n : 0, ships: n, tonnesShipped: tonnes };
  }
}

// Run a whole level with a policy (an algorithm). A policy is a function
// called after every event; it may call sim.assign(...). The player is just
// another policy, driven by clicks instead of code.
export function runPolicy(config, ships, policy) {
  const sim = new Simulation(config, ships);
  policy(sim);
  while (sim.step()) policy(sim);
  return sim;
}
