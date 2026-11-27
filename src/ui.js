// The screen. It only READS the engine's state and draws it, so the engine
// stays testable and this file could later be replaced by a 3D view.
import { LEVEL_1 } from './config.js';
import { generateShips } from './random.js';
import { Simulation } from './engine.js';
import { fcfs } from './policies.js';

const config = LEVEL_1;
const seed = Number(new URLSearchParams(location.search).get('seed')) || 1;
const sim = new Simulation(config, generateShips(config, seed));

// Real ship lengths (m), so ships are drawn to scale against the berth.
const LENGTH = { Chinamax: 360, Capesize: 290, Panamax: 229 };
const BERTH_LENGTH = 380;

// --- Two clocks --------------------------------------------------------------
// Simulation time is in hours. Real time is what the player feels.
// Time scale: at 1x, 1 simulated hour = 0.5 real seconds (30 days ≈ 6 min).
const SIM_HOURS_PER_SECOND = 2;
let speed = 1;
let playing = false;
let displayTime = 0;     // where the on-screen clock is (between events)
let lastFrame = null;

const $ = (id) => document.getElementById(id);
const demo = () => $('demo').checked;
const money = (v) => (v < 0 ? '−' : '') + 'US$' + Math.round(Math.abs(v)).toLocaleString('en-US');
const hours = (h) => `${h.toFixed(1)} h`;
const cls = (s) => s.cls.toLowerCase();

function clockText(t) {
  const day = Math.floor(t / 24) + 1;
  const h = Math.floor(t % 24);
  const m = Math.floor((t % 1) * 60);
  return `Day ${Math.min(day, 30)} · ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// Cost so far for a ship at time t: final cost if it has left, otherwise the
// demurrage it has built up (despatch is only earned when it actually leaves).
function liveCost(ship, t) {
  if (ship.status === 'done') return ship.cost;
  const over = t - ship.arrival - ship.laytime;
  return over > 0 ? over * config.demurragePerHour : 0;
}

// --- Main loop -----------------------------------------------------------------
function frame(now) {
  if (lastFrame === null) lastFrame = now;
  const dt = (now - lastFrame) / 1000;
  lastFrame = now;

  if (playing) {
    const target = Math.min(displayTime + dt * SIM_HOURS_PER_SECOND * speed, config.horizon);
    // Process every event that happens before the new clock time.
    while (sim.events.length && sim.events[0].time <= target) {
      sim.step();
      if (demo()) fcfs(sim);
      // Auto-pause: stop the clock when the player has a decision to make.
      if (!demo() && sim.needsDecision()) { setPlaying(false); break; }
    }
    displayTime = playing ? target : sim.time;
    if (displayTime >= config.horizon) setPlaying(false);
  }
  render(displayTime);
  requestAnimationFrame(frame);
}

function setPlaying(p) {
  playing = p;
  $('btn-play').textContent = p ? '⏸ Pause' : '▶ Play';
}

// --- Drawing -------------------------------------------------------------------
function render(t) {
  $('clock').textContent = clockText(t);
  $('clock-progress').style.width = `${(t / config.horizon) * 100}%`;

  const arrived = sim.ships.filter((s) => s.arrival <= t);
  const net = arrived.reduce((sum, s) => sum + liveCost(s, t), 0);
  $('score').textContent = money(net);
  $('score').className = 'score-value ' + (net > 0 ? 'bad' : net < 0 ? 'good' : '');

  renderLineup(t);
  renderQueue(t);
  renderBerths(t);
  renderStats(t, arrived);
}

function renderLineup(t) {
  const win = config.lineupWindow;
  const ticks = [0, 24, 48, 72].map((h) =>
    `<div class="lineup-tick" style="left:${2 + (h / win) * 84}%">${h === 0 ? 'now' : '+' + h + ' h'}</div>`).join('');
  // Ships close in time are stacked in lanes so their labels don't overlap.
  const laneEnd = [-Infinity, -Infinity, -Infinity];
  const ships = sim.ships
    .filter((s) => s.arrival > t && s.arrival <= t + win)
    .map((s) => {
      const x = 2 + ((s.arrival - t) / win) * 84;
      let lane = laneEnd.findIndex((end) => x > end);
      if (lane < 0) lane = laneEnd.indexOf(Math.min(...laneEnd));
      laneEnd[lane] = x + 15;
      return `<div class="lineup-ship" style="left:${x}%;top:${4 + lane * 22}px;background:var(--${cls(s)})">
        #${s.id}<span class="full"> ${s.cls} · ${hours(s.arrival - t)}</span></div>`;
    }).join('');
  $('lineup').innerHTML = ticks + ships;
}

function shipCard(s, t) {
  const inPort = t - s.arrival;
  const left = s.laytime - inPort;
  const used = Math.min(1, inPort / s.laytime);
  const cost = liveCost(s, t);
  // Already queued at a berth: say where, instead of offering choices.
  const queuedAt = sim.berths.find((b) => b.queue.includes(s));
  // Estimated time in port if sent to each berth now (decision support).
  const est = queuedAt ? `<span style="grid-column:1/-1">Queued at ${queuedAt.id}</span>` : sim.berths.map((b) => {
    if (!sim.canUse(s, b)) return `<span class="no">${b.id} ✕</span>`;
    const finish = Math.max(sim.berthAvailableAt(b), t) + sim.serviceTime(s, b);
    return `<span title="Time in port if sent to ${b.id} now">${b.id} ${Math.round(finish - s.arrival)} h</span>`;
  }).join('');
  return `<div class="card ${cls(s)}">
      <div class="card-head"><span>#${s.id} ${s.cls}</span><span>${(s.tonnes / 1000).toFixed(0)} kt</span></div>
      <div class="card-sub">${left >= 0 ? `Laytime left ${hours(left)}` : `Over laytime by ${hours(-left)}`}</div>
      <div class="laytime ${left < 0 ? 'over' : ''}"><div style="width:${used * 100}%"></div></div>
      <div class="card-cost ${cost > 0 ? 'bad' : ''}">Demurrage ${money(cost)}</div>
      <div class="est">${est}</div>
    </div>`;
}

function renderQueue(t) {
  const waiting = sim.ships.filter((s) => s.arrival <= t && s.status === 'waiting');
  $('queue-count').textContent = waiting.length;
  $('queue').innerHTML = waiting.length
    ? waiting.map((s) => shipCard(s, t)).join('')
    : '<p class="queued">No ships waiting.</p>';
}

function renderBerths(t) {
  $('berths').innerHTML = sim.berths.map((b) => {
    const s = b.current;
    const badges = Object.keys(b.rates).map((c) => `<span class="badge ${c.toLowerCase()}" title="${c}"></span>`).join('');
    let ship = '', info = 'Free';
    if (s && s.start <= t) {
      const progress = Math.min(1, (t - s.start) / (s.finish - s.start));
      const width = (LENGTH[s.cls] / BERTH_LENGTH) * 100;
      // Hull sits lower as it fills: under-water band 25% (empty) to 70% (full).
      ship = `<div class="ship ${cls(s)}" style="width:calc(${width}% - 16px)">
          <div class="draft" style="height:${25 + progress * 45}%"></div>
          <span class="label">#${s.id} ${s.cls}</span></div>`;
      info = `Loading ${Math.round(progress * 100)}% · done in ${hours(s.finish - t)}`;
    }
    const queued = b.queue.length ? `Next: ${b.queue.map((q) => '#' + q.id).join(', ')}` : '';
    return `<div class="berth">
        <div class="berth-head"><span class="berth-name">${b.id} · ${b.rates.Chinamax ? 'deep water' : 'standard'}</span>
          <span class="badges">${badges}</span></div>
        <div class="quay"></div>
        <div class="water">${ship}</div>
        <div class="berth-info"><span>${info}</span><span class="queued">${queued}</span></div>
      </div>`;
  }).join('');
}

function renderStats(t, arrived) {
  const done = arrived.filter((s) => s.status === 'done');
  const started = arrived.filter((s) => s.start !== null && s.start <= t);
  const avgWait = started.length ? started.reduce((a, s) => a + (s.start - s.arrival), 0) / started.length : 0;
  const busy = sim.ships.reduce((h, s) => (s.start !== null && s.start <= t ? h + Math.min(s.finish, t) - s.start : h), 0);
  const util = t > 0 ? busy / (sim.berths.length * t) : 0;
  const tonnes = done.reduce((a, s) => a + s.tonnes, 0);
  $('stats').innerHTML = `
    <dt>Ships arrived</dt><dd>${arrived.length}</dd>
    <dt>Ships departed</dt><dd>${done.length}</dd>
    <dt>Avg wait</dt><dd>${hours(avgWait)}</dd>
    <dt>Berth occupancy</dt><dd>${Math.round(util * 100)}%</dd>
    <dt>Tonnes shipped</dt><dd>${(tonnes / 1e6).toFixed(2)} Mt</dd>`;
}

// --- Controls ------------------------------------------------------------------
$('btn-play').addEventListener('click', () => setPlaying(!playing));
document.querySelectorAll('.speed').forEach((btn) => btn.addEventListener('click', () => {
  speed = Number(btn.dataset.speed);
  document.querySelectorAll('.speed').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
}));

if (demo()) fcfs(sim);
requestAnimationFrame(frame);
