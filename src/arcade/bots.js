// NATURAL AI PLAYERS. Bots are always labelled (name tag "AI", p.bot = true) and never presented as real people.
// Personality: aggressive (chases, grudges hard), cautious (groups up, turns away early), show-off (feints, risky
// near-misses). Each bot has a skill 0..1 → reaction delay (ticks between "seeing" and turning, plus jitter) and a mistake
// rate (misjudged turns / steering into a wall/own trail). Grudge: a bot remembers who killed it and hunts them for a while.
// Trash talk: short canned PG lines only (safe for minors), shown as TEXT speech bubbles in proximity chat — never voice.
// Rate-limited per bot and per map; viewers who mute bots (ProximityVoice.muteBots) don't get them.
export const PERSONAS = ['aggressive', 'cautious', 'showoff'];
export const LINES = { kill: ['ez', 'gg', 'too slow', 'got you'], died: ['nooo', 'lag!!', 'whyyy', 'rematch'], chase: ['come here', 'running?', 'where u going'], idle: ['hi', 'lol', 'nice map', 'brb snack'] };
export const SAY_BOT_TICKS = 40, SAY_MAP_TICKS = 8, BUBBLE_TICKS = 20, GRUDGE_TICKS = 150;
export function makePersona(r) { const kind = PERSONAS[Math.floor(r() * 3)], skill = 0.25 + r() * 0.7;
  return { kind, skill, react: Math.round((1 - skill) * 4) + 1, mistake: +(0.02 + (1 - skill) * 0.08 + (kind === 'showoff' ? 0.03 : 0)).toFixed(3), q: [], grudge: null, grudgeUntil: 0, lastSay: -1e9 }; }
export const botLabel = p => p.bot ? `${p.name} · AI` : p.name;
const DIR4 = ['up', 'down', 'left', 'right'];
const toward = (p, q, w) => { let dx = q.x - p.x, dy = q.y - p.y; const n = w.size; if (Math.abs(dx) > n / 2) dx -= Math.sign(dx) * n; if (Math.abs(dy) > n / 2) dy -= Math.sign(dy) * n; return [dx, dy, Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up')]; };
export function say(w, p, kind, r) { const b = p.persona; if (!b || w.tick - b.lastSay < SAY_BOT_TICKS || w.tick - (w.lastSay ?? -1e9) < SAY_MAP_TICKS) return null;
  const L = LINES[kind]; const text = L[Math.floor(r() * L.length)]; b.lastSay = w.lastSay = w.tick; (w.bubbles ||= []).push({ who: p.code, text, until: w.tick + BUBBLE_TICKS, x: p.x, y: p.y }); w.events.push({ t: 'say', who: p.code, text, tick: w.tick }); return text; }
// Analog games: the game proposes a sensible heading (food / home / away from walls & trails); persona adds hunting,
// grouping or feints; mistakes are a misjudged heading; the chosen heading is applied after the reaction delay (ticks are
// 40 ms here, so delays scale x3 vs the 120 ms grid tick). The game's own safety probe can override (bots still crash).
function thinkAnalog(w, p, r) { const b = p.persona ||= makePersona(r); const G = w.game;
  let want = G.botAim ? G.botAim(w, p, r) : p.h; const others = [...w.players.values()].filter(q => q !== p && q.alive);
  const rel = q => { let dx = q.x - p.x, dy = q.y - p.y; if (G.wraps !== false) { const n = w.size; if (Math.abs(dx) > n / 2) dx -= Math.sign(dx) * n; if (Math.abs(dy) > n / 2) dy -= Math.sign(dy) * n; } return [dx, dy, Math.atan2(dy, dx), Math.hypot(dx, dy)]; };
  const near = (pred, R) => { let best = null; for (const q of others) if (pred(q)) { const t = rel(q); if (t[3] < R && (!best || t[3] < best[1][3])) best = [q, t]; } return best; };
  const g = b.grudge && w.tick < b.grudgeUntil && w.players.get(b.grudge);
  if (G.safe?.(w, p) !== false) {
    if (g?.alive && r() < 0.12) { want = rel(g)[2]; if (r() < 0.02) say(w, p, 'chase', r); }
    else if (b.kind === 'aggressive') { const t = near(q => !q.bot || r() < 0.5, 12); if (t && r() < 0.1) want = t[1][2] + (G.cutAhead ? 0.5 : 0); }
    else if (b.kind === 'cautious') { const buddy = near(q => q.bot && q.persona?.kind === 'cautious', 18); if (buddy && r() < 0.15) want = buddy[1][2]; }
    else if (b.kind === 'showoff' && r() < 0.04) want += (r() < 0.5 ? -1 : 1) * 1.2; }
  if (r() < b.mistake / 3) { want += (r() - 0.5) * 3; b.mistakes = (b.mistakes || 0) + 1; }
  b.decisions = (b.decisions || 0) + 1; const delay = b.react * 3 + (r() < 0.3 ? 2 : 0);
  b.q.push({ at: w.tick + delay, a: want }); if (b.q.length > 1 && b.q[b.q.length - 2].at > w.tick + delay) b.q.sort((x, y) => x.at - y.at); while (b.q.length && b.q[0].at <= w.tick) { const it = b.q.shift(); p.aim = it.a; p.turnIn = 0; }
  const esc = G.escape?.(w, p); if (esc != null && r() < 0.6 + b.skill * 0.4) { p.aim = esc; p.turnIn = 0; b.q.length = 0; } // reflex: imminent wall/trail ahead
  if (r() < 0.0008) say(w, p, 'idle', r); }
export function think(w, p, r) { if (w.game?.analog) return thinkAnalog(w, p, r); const b = p.persona ||= makePersona(r); const base = p.dir;
  w.game?.botThink?.(w, p, r); let want = p.dir; p.dir = base; // the game's "sensible" intent, applied after a reaction delay
  const others = [...w.players.values()].filter(q => q !== p && q.alive);
  const near = (pred, R) => others.filter(pred).map(q => [q, toward(p, q, w)]).filter(([, t]) => Math.abs(t[0]) + Math.abs(t[1]) < R).sort((a, c) => Math.abs(a[1][0]) + Math.abs(a[1][1]) - Math.abs(c[1][0]) - Math.abs(c[1][1]))[0];
  const g = b.grudge && w.tick < b.grudgeUntil && w.players.get(b.grudge);
  if (g?.alive && r() < 0.6) { want = toward(p, g, w)[2]; if (r() < 0.05) say(w, p, 'chase', r); }
  else if (b.kind === 'aggressive') { const t = near(q => !q.bot || r() < 0.5, 14); if (t && r() < 0.5) want = t[1][2]; }
  else if (b.kind === 'cautious') { const buddy = near(q => q.bot && q.persona?.kind === 'cautious', 20); if (buddy && r() < 0.3) want = buddy[1][2]; }
  else if (b.kind === 'showoff' && r() < 0.08) want = DIR4[Math.floor(r() * 4)]; // feint: jink, then the queued real intent follows
  if (r() < b.mistake) { want = DIR4[Math.floor(r() * 4)]; b.mistakes = (b.mistakes || 0) + 1; } // misjudged turn (can crash)
  b.decisions = (b.decisions || 0) + 1;
  const delay = b.react + (r() < 0.3 ? 1 : 0); b.q.push({ at: w.tick + delay, dir: want });
  while (b.q.length && b.q[0].at <= w.tick) w.turn(p, b.q.shift().dir);
  if (r() < 0.002) say(w, p, 'idle', r); }
export function onKill(w, victim, killer, r) { if (victim.bot) { const b = victim.persona; if (b && killer && killer !== victim) { b.grudge = killer.code; b.grudgeUntil = w.tick + GRUDGE_TICKS * (b.kind === 'aggressive' ? 2 : 1); } say(w, victim, 'died', r); }
  if (killer?.bot && killer !== victim) say(w, killer, 'kill', r); }
export function tickBubbles(w) { if (w.bubbles) w.bubbles = w.bubbles.filter(b => b.until > w.tick); }
