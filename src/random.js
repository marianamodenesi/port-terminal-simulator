// Seeded random numbers, so every player gets the SAME ships for a level.
// Math.random() can't be seeded, so we use mulberry32, a tiny standard PRNG.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Exponential sample by inverse transform: if U ~ Uniform(0,1),
// then -mean * ln(1 - U) ~ Exponential(mean). Same idea as Arena's EXPO().
export function exponential(rand, mean) {
  return -mean * Math.log(1 - rand());
}

// Generate the arrival sequence for a level: interarrival times are
// exponential, ship class is drawn from the mix (an "N-way by chance").
export function generateShips(config, seed) {
  const rand = mulberry32(seed);
  const ships = [];
  let t = 0;
  for (;;) {
    t += exponential(rand, config.meanInterarrival);
    if (t > config.horizon) break;
    const u = rand();
    let acc = 0;
    let pick = config.shipClasses[config.shipClasses.length - 1];
    for (const c of config.shipClasses) {
      acc += c.share;
      if (u <= acc) { pick = c; break; }
    }
    ships.push({ id: ships.length + 1, cls: pick.cls, tonnes: pick.tonnes, arrival: t });
  }
  return ships;
}
