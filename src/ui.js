// The screen. It only READS the engine's state and draws it, and turns the
// player's drags and taps into the engine's one action: sim.assign().
// Keeping it separate means this file could later be replaced by a 3D view.
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

// --- Player interaction state ------------------------------------------------
let selected = null;      // ship id picked by tap, or being dragged
let drag = null;          // { shipId, ghost, startX, startY, moved }
let dismissedDecision = null; // decision the player chose to skip (berth held on purpose)
let message = null;       // short feedback after an action

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

// --- When does the game stop and ask the player? -------------------------------
// A decision is pending when a berth is idle and an ARRIVED, unassigned ship
// could use it. If the player presses Play anyway, they are holding that berth
// on purpose (e.g. for a Chinamax in the line-up), so we don't ask again until
// the situation changes (a new ship arrives or another berth frees up).
function decisionKey() {
  const idle = sim.berths.filter((b) => !b.current && !b.queue.length);
  const waiting = sim.ships.filter((s) => s.status === 'waiting' && !s.assignedTo);
  const pairs = idle.filter((b) => waiting.some((s) => sim.canUse(s, b)));
  if (!pairs.length) return null;
  return pairs.map((b) => b.id).join(',') + '|' + waiting.map((s) => s.id).join(',');
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
      if (demo()) { fcfs(sim); continue; }
      // Auto-pause: stop the clock when the player has a new decision to make.
      const key = decisionKey();
      if (key && key !== dismissedDecision) { setPlaying(false); break; }
    }
    displayTime = playing ? target : sim.time;
    if (displayTime >= config.horizon) setPlaying(false);
  }
  render(displayTime);
  requestAnimationFrame(frame);
}

function setPlaying(p) {
  if (p) dismissedDecision = decisionKey(); // pressing Play = "keep those berths empty"
  playing = p;
  $('btn-play').textContent = p ? '⏸ Pause' : '▶ Play';
}

// --- Player actions ------------------------------------------------------------
function sendShip(shipId, berthId) {
  const ship = sim.byId.get(shipId);
  try {
    sim.assign(shipId, berthId);
    message = berthId === 'ANY'
      ? `Ship #${shipId} will take the first free berth it fits.`
      : `Ship #${shipId} sent to ${berthId}.`;
  } catch {
    message = `A ${ship.cls} can't use ${berthId}. Look for the berths with a ${ship.cls} badge.`;
  }
  selected = null;
}

// Pointer events cover mouse, finger and pen with one piece of code.
function onPointerDown(e) {
  if (e.target.closest('button')) return;           // let the card's buttons work
  const el = e.target.closest('[data-ship]');
  if (!el || demo()) return;
  const shipId = Number(el.dataset.ship);
  const ship = sim.byId.get(shipId);
  if (ship.assignedTo) return;
  drag = { shipId, ghost: null, startX: e.clientX, startY: e.clientY, moved: false };
}

function onPointerMove(e) {
  if (!drag) return;
  const dist = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY);
  if (!drag.moved && dist < 8) return;               // small wiggle = still a tap
  if (!drag.moved) {
    drag.moved = true;
    selected = drag.shipId;
    const ship = sim.byId.get(drag.shipId);
    drag.ghost = document.createElement('div');
    drag.ghost.className = `ghost ${cls(ship)}`;
    drag.ghost.textContent = `#${ship.id} ${ship.cls}`;
    document.body.appendChild(drag.ghost);
    renderBerths(displayTime);                         // light up berths it fits
    renderHint(displayTime);
  }
  drag.ghost.style.left = `${e.clientX}px`;
  drag.ghost.style.top = `${e.clientY}px`;
  const over = berthAt(e.clientX, e.clientY);
  document.querySelectorAll('.berth').forEach((b) => b.classList.toggle('hover', b === over));
}

function onPointerUp(e) {
  if (!drag) return;
  const { shipId, moved, ghost } = drag;
  ghost?.remove();
  drag = null;
  if (moved) {
    const over = berthAt(e.clientX, e.clientY);
    if (over) sendShip(shipId, over.dataset.berth);
    else selected = null;
  } else {
    selected = selected === shipId ? null : shipId;    // tap = select / unselect
  }
  render(displayTime);
}

function berthAt(x, y) {
  return document.elementFromPoint(x, y)?.closest('.berth') ?? null;
}

// Tap a berth after tapping a ship. Buttons inside cards: "First free berth".
function onClick(e) {
  const any = e.target.closest('[data-any]');
  if (any) { sendShip(Number(any.dataset.any), 'ANY'); render(displayTime); return; }
  const berth = e.target.closest('.berth');
  if (berth && selected !== null) { sendShip(selected, berth.dataset.berth); render(displayTime); }
}

// --- Drawing -------------------------------------------------------------------
// Only touch the page when the HTML actually changed. Rebuilding a button 60
// times a second would swallow the player's clicks.
const lastHTML = new Map();
function setHTML(id, html) {
  if (lastHTML.get(id) === html) return;
  lastHTML.set(id, html);
  $(id).innerHTML = html;
}
let lastPanels = 0;

function render(t) {
  $('clock').textContent = clockText(t);
  $('clock-progress').style.width = `${(t / config.horizon) * 100}%`;

  const arrived = sim.ships.filter((s) => s.arrival <= t);
  const net = arrived.reduce((sum, s) => sum + liveCost(s, t), 0);
  $('score').textContent = money(net);
  $('score').className = 'score-value ' + (net > 0 ? 'bad' : net < 0 ? 'good' : '');

  // While a ship is being dragged, keep the cards and berths still under the finger.
  // While playing, refresh the panels 5 times a second, which is plenty to read.
  const now = performance.now();
  if ((!drag || !drag.moved) && (!playing || now - lastPanels > 200)) {
    lastPanels = now;
    renderLineup(t);
    renderQueue(t);
    renderBerths(t);
  }
  renderStats(t, arrived);
  renderHint(t);
}

// One short sentence that tells the player what to do next, in plain words.
function renderHint(t) {
  let text;
  if (t >= config.horizon) {
    text = `Level over. Your net cost: ${money(sim.results().netCost)}. Results screen coming next.`;
  } else if (demo()) {
    text = 'Watching the simple algorithm (first come, first served). Untick the box to play yourself.';
  } else if (drag?.moved) {
    text = 'Drop the ship on a lit-up berth. Locked berths 🔒 are too small or shallow for it.';
  } else if (selected !== null) {
    const s = sim.byId.get(selected);
    text = `Ship #${s.id} picked. Tap a lit-up berth to send it there, or tap the ship again to cancel.`;
  } else if (message) {
    text = message;
  } else if (!playing && t === 0) {
    text = 'Ships arrive at the anchorage. Drag a ship onto a berth to load it. Every hour a ship waits past its free time costs a late fee (demurrage). Press ▶ Play to start.';
  } else if (!playing && decisionKey()) {
    const ids = decisionKey().split('|')[0].split(',');
    const free = ids.length > 1 ? ids.slice(0, -1).join(', ') + ' and ' + ids.at(-1) : ids[0];
    text = `${free} ${free.includes(' and ') ? 'are' : 'is'} free. Drag a waiting ship onto a berth, or press ▶ Play to keep it empty for a ship that's coming.`;
  } else {
    text = playing ? 'The port is running. The game pauses when you have a decision to make.' : 'Paused. Press ▶ Play to continue.';
  }
  if ($('hint').textContent !== text) $('hint').textContent = text;
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
      // Ships in the line-up can be booked onto a berth before they arrive.
      const booked = s.assignedTo ? ` → ${s.assignedTo === 'ANY' ? 'first free' : s.assignedTo}` : '';
      return `<div class="lineup-ship ${selected === s.id ? 'selected' : ''} ${s.assignedTo ? 'booked' : ''}"
          data-ship="${s.id}" style="left:${x}%;top:${4 + lane * 22}px;background:var(--${cls(s)})">
        #${s.id}<span class="full"> ${s.cls} · ${hours(s.arrival - t)}${booked}</span></div>`;
    }).join('');
  setHTML('lineup', ticks + ships);
}

function shipCard(s, t) {
  const inPort = t - s.arrival;
  const left = s.laytime - inPort;
  const used = Math.min(1, inPort / s.laytime);
  const cost = liveCost(s, t);
  const queuedAt = sim.berths.find((b) => b.queue.includes(s));
  // Estimated time in port if sent to each berth now (decision support).
  let est;
  if (queuedAt) {
    est = `<span class="wide">In line for ${queuedAt.id}</span>`;
  } else if (s.assignedTo === 'ANY') {
    est = '<span class="wide">Waiting for the first free berth</span>';
  } else {
    est = sim.berths.map((b) => {
      if (!sim.canUse(s, b)) return `<span class="no" title="${s.cls} doesn't fit ${b.id}">${b.id} 🔒</span>`;
      const finish = Math.max(sim.berthAvailableAt(b), t) + sim.serviceTime(s, b);
      return `<span title="Hours in port if sent to ${b.id} now">${b.id} ${Math.round(finish - s.arrival)} h</span>`;
    }).join('') + `<button type="button" class="any" data-any="${s.id}">First free berth</button>`;
  }
  return `<div class="card ${cls(s)} ${selected === s.id ? 'selected' : ''} ${s.assignedTo ? 'booked' : ''}" data-ship="${s.id}">
      <div class="card-head"><span>#${s.id} ${s.cls}</span><span>${(s.tonnes / 1000).toFixed(0)} kt</span></div>
      <div class="card-sub" title="Laytime: the time in port the contract allows for free">${left >= 0
        ? `Free time left ${hours(left)}` : `Over free time by ${hours(-left)}`}</div>
      <div class="laytime ${left < 0 ? 'over' : ''}"><div style="width:${used * 100}%"></div></div>
      <div class="card-cost ${cost > 0 ? 'bad' : ''}" title="Demurrage: the late fee per hour over free time">Late fee ${money(cost)}</div>
      <div class="est">${est}</div>
    </div>`;
}

function renderQueue(t) {
  const waiting = sim.ships.filter((s) => s.arrival <= t && s.status === 'waiting');
  $('queue-count').textContent = waiting.length;
  setHTML('queue', waiting.length
    ? waiting.map((s) => shipCard(s, t)).join('')
    : '<p class="queued">No ships waiting.</p>');
}

function renderBerths(t) {
  const sel = selected !== null ? sim.byId.get(selected) : null;
  setHTML('berths', sim.berths.map((b) => {
    const s = b.current;
    const badges = Object.keys(b.rates).map((c) => `<span class="badge ${c.toLowerCase()}" title="${c} fits"></span>`).join('');
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
    // While a ship is picked: light up berths it can use, lock the others,
    // and show what sending it here would mean.
    let state = '', preview = '';
    if (sel) {
      if (sim.canUse(sel, b)) {
        state = 'ok';
        const finish = Math.max(sim.berthAvailableAt(b), t, sel.arrival) + sim.serviceTime(sel, b);
        preview = `<div class="preview">#${sel.id} here: ${Math.round(finish - sel.arrival)} h in port</div>`;
      } else {
        state = 'locked';
        preview = `<div class="preview">🔒 ${sel.cls} doesn't fit here</div>`;
      }
    }
    const queued = b.queue.length ? `Next: ${b.queue.map((q) => '#' + q.id).join(', ')}` : '';
    return `<div class="berth ${state}" data-berth="${b.id}">
        <div class="berth-head"><span class="berth-name">${b.id} · ${b.rates.Chinamax ? 'deep water, fast loader' : 'standard'}</span>
          <span class="badges">${badges}</span></div>
        <div class="quay"></div>
        <div class="water">${ship}${preview}</div>
        <div class="berth-info"><span>${info}</span><span class="queued">${queued}</span></div>
      </div>`;
  }).join(''));
}

function renderStats(t, arrived) {
  const done = arrived.filter((s) => s.status === 'done');
  const started = arrived.filter((s) => s.start !== null && s.start <= t);
  const avgWait = started.length ? started.reduce((a, s) => a + (s.start - s.arrival), 0) / started.length : 0;
  const busy = sim.ships.reduce((h, s) => (s.start !== null && s.start <= t ? h + Math.min(s.finish, t) - s.start : h), 0);
  const util = t > 0 ? busy / (sim.berths.length * t) : 0;
  const tonnes = done.reduce((a, s) => a + s.tonnes, 0);
  setHTML('stats', `
    <dt>Ships arrived</dt><dd>${arrived.length}</dd>
    <dt>Ships departed</dt><dd>${done.length}</dd>
    <dt>Avg wait</dt><dd>${hours(avgWait)}</dd>
    <dt>Berth occupancy</dt><dd>${Math.round(util * 100)}%</dd>
    <dt>Tonnes shipped</dt><dd>${(tonnes / 1e6).toFixed(2)} Mt</dd>`);
}

// --- Controls ------------------------------------------------------------------
$('btn-play').addEventListener('click', () => { message = null; setPlaying(!playing); });
document.querySelectorAll('.speed').forEach((btn) => btn.addEventListener('click', () => {
  speed = Number(btn.dataset.speed);
  document.querySelectorAll('.speed').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
}));
$('demo').addEventListener('change', () => { if (demo()) { selected = null; fcfs(sim); } });
document.addEventListener('pointerdown', onPointerDown);
document.addEventListener('pointermove', onPointerMove);
document.addEventListener('pointerup', onPointerUp);
document.addEventListener('pointercancel', onPointerUp);
document.addEventListener('click', onClick);

if (demo()) fcfs(sim);
requestAnimationFrame(frame);
