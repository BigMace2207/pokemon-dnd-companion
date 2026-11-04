// Spatial, ethereal sound effects for the hub: soft glassy bells for clicks, a rising shimmer when you pick something
// up, faint sparkles while it moves, a low bell when it lands, and a wide chime for pings. Everything is synthesised
// with Web Audio (no sound files), panned left/right by where it happened on screen, and sent through a long
// generated reverb so it sounds like it's out in space.
//
// The AudioContext is only made after the first tap or click (browsers refuse sound before then). Settings ->
// Appearance -> "Hub sounds" turns it off on this device (localStorage pkdnd-hub-sound = "off").

const PREF_KEY = "pkdnd-hub-sound";
let ctx = null, master = null, wet = null, dry = null;

export function hubSoundOn() {
  try { return localStorage.getItem(PREF_KEY) !== "off"; } catch { return true; }
}
export function setHubSoundOn(on) {
  try { localStorage.setItem(PREF_KEY, on ? "on" : "off"); } catch { /* private mode: just this visit */ }
  if (!on && ctx) ctx.suspend();
  else if (on && ctx) ctx.resume();
}

// a reverb tail made from decaying stereo noise: ~2.8s, darker as it fades
function impulse(c, seconds = 2.8) {
  const len = Math.floor(c.sampleRate * seconds);
  const buf = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      lp += (Math.random() * 2 - 1 - lp) * (0.9 - t * 0.75);   // low-pass that closes over time
      d[i] = lp * Math.pow(1 - t, 3.2);
    }
  }
  return buf;
}

function ensure() {
  if (ctx || typeof window === "undefined") return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain(); master.gain.value = 0.32;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18; comp.ratio.value = 3;
  master.connect(comp).connect(ctx.destination);
  dry = ctx.createGain(); dry.gain.value = 0.55; dry.connect(master);
  const verb = ctx.createConvolver(); verb.buffer = impulse(ctx);
  wet = ctx.createGain(); wet.gain.value = 0.7;
  verb.connect(wet).connect(master);
  // a soft echo before the reverb widens it further
  const echo = ctx.createDelay(1); echo.delayTime.value = 0.23;
  const fb = ctx.createGain(); fb.gain.value = 0.28;
  const send = ctx.createGain(); send.gain.value = 1;
  send.connect(verb); send.connect(echo); echo.connect(fb).connect(echo); echo.connect(verb);
  wet.send = send;
  return ctx;
}

// browsers only allow sound after a gesture: make the context on the first one, then stop listening
if (typeof window !== "undefined") {
  const unlock = () => {
    if (!hubSoundOn()) return;
    ensure(); ctx?.resume?.();
    window.removeEventListener("pointerdown", unlock, true);
    window.removeEventListener("keydown", unlock, true);
  };
  window.addEventListener("pointerdown", unlock, true);
  window.addEventListener("keydown", unlock, true);
}

// one voice: an oscillator with an envelope, panned, going to both the dry mix and the reverb
function voice({ freq, to = null, type = "sine", at = 0, attack = 0.004, decay = 0.5, gain = 0.2, pan = 0, verb = 0.6, detune = 0 }) {
  const t = ctx.currentTime + at;
  const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t); o.detune.value = detune;
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + attack + decay * 0.6);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
  if (p) p.pan.value = Math.max(-1, Math.min(1, pan));
  o.connect(g);
  const out = p ? (g.connect(p), p) : g;
  const d = ctx.createGain(); d.gain.value = 1 - verb * 0.5; out.connect(d).connect(dry);
  const w = ctx.createGain(); w.gain.value = verb; out.connect(w).connect(wet.send);
  o.start(t); o.stop(t + attack + decay + 0.05);
}

// a breath of filtered noise, for whooshes
function air({ at = 0, dur = 0.35, from = 400, to = 2400, gain = 0.08, pan = 0 }) {
  const t = ctx.currentTime + at;
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource(); src.buffer = buf;
  const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.Q.value = 2.2;
  f.frequency.setValueAtTime(from, t); f.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + dur * 0.4); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
  if (p) p.pan.value = pan;
  src.connect(f).connect(g);
  const out = p ? (g.connect(p), p) : g;
  out.connect(wet.send); out.connect(dry);
  src.start(t); src.stop(t + dur + 0.05);
}

// notes of a pentatonic scale, so sparkles that overlap never clash
const PENTA = [0, 2, 4, 7, 9];
const note = (base, step) => base * Math.pow(2, (PENTA[((step % 5) + 5) % 5] + 12 * Math.floor(step / 5)) / 12);

let lastMove = 0, moveStep = 0;

/**
 * Play a hub sound. `x` is where it happened on screen (clientX), so it can be panned; leave it out for the centre.
 * kinds: tick (small control), click (an item), pick (drag starts), move (while dragging; throttled), drop (it lands),
 * ping, pingOther (someone else's ping), open / close (the wheel or a panel), hatch.
 */
export function hubSound(kind, x = null) {
  if (!hubSoundOn() || (typeof document !== "undefined" && document.hidden)) return;
  if (!ensure() || ctx.state === "closed") return;
  if (ctx.state === "suspended") ctx.resume();
  const w = typeof window !== "undefined" ? window.innerWidth || 1 : 1;
  const pan = x == null ? 0 : ((x / w) * 2 - 1) * 0.8;
  switch (kind) {
    case "tick":
      voice({ freq: 1760, decay: 0.16, gain: 0.07, pan, verb: 0.5 });
      voice({ freq: 2637, decay: 0.1, gain: 0.03, pan, verb: 0.6 });
      break;
    case "click":
      voice({ freq: 1046.5, decay: 0.5, gain: 0.12, pan, verb: 0.65 });
      voice({ freq: 1568, decay: 0.35, gain: 0.05, pan: pan * 1.1, verb: 0.75, detune: 6 });
      break;
    case "pick":
      voice({ freq: 523.25, to: 784, attack: 0.02, decay: 0.3, gain: 0.08, pan, verb: 0.7 });
      air({ dur: 0.22, from: 900, to: 3200, gain: 0.03, pan });
      break;
    case "move": {
      const now = performance.now();
      if (now - lastMove < 85) return;
      lastMove = now;
      moveStep = (moveStep + 1 + Math.floor(Math.random() * 2)) % 10;
      voice({ freq: note(1046.5, moveStep), decay: 0.28, gain: 0.022, pan, verb: 0.9 });
      break;
    }
    case "drop":
      voice({ freq: 392, decay: 0.9, gain: 0.12, pan, verb: 0.7 });
      voice({ freq: 587.33, decay: 0.7, gain: 0.06, pan, verb: 0.8, detune: -5 });
      voice({ freq: 196, decay: 0.5, gain: 0.06, pan, verb: 0.4 });
      break;
    case "ping":
    case "pingOther": {
      const g = kind === "ping" ? 1 : 0.7;
      [880, 1318.5, 1760].forEach((f, i) => voice({ freq: f, at: i * 0.07, decay: 1.6, gain: 0.07 * g, pan: pan + (i - 1) * 0.15, verb: 0.85, detune: i * 4 }));
      air({ dur: 0.5, from: 600, to: 2600, gain: 0.025 * g, pan });
      break;
    }
    case "open":
      air({ dur: 0.32, from: 350, to: 2200, gain: 0.05, pan });
      voice({ freq: 659.25, to: 987.77, attack: 0.03, decay: 0.4, gain: 0.04, pan, verb: 0.8 });
      break;
    case "close":
      air({ dur: 0.26, from: 2000, to: 380, gain: 0.04, pan });
      break;
    case "hatch":
      [0, 2, 4, 5, 7].forEach((s, i) => voice({ freq: note(523.25, s), at: i * 0.09, decay: 1.2, gain: 0.08, pan: (i - 2) * 0.25, verb: 0.85 }));
      break;
    default:
      break;
  }
}

// ------------------------------------------------------------------ noise, for the rougher sounds below
// a burst of filtered noise: type is a BiquadFilter type, the filter sweeps from `from` to `to` Hz
function burst({ at = 0, dur = 0.3, from = 1200, to = 1200, type = "bandpass", q = 1, gain = 0.08, pan = 0, verb = 0.5, attack = 0.01 }) {
  const t = ctx.currentTime + Math.max(0, at);
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource(); src.buffer = buf;
  const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(from, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + Math.min(attack, dur * 0.5)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
  if (p) p.pan.value = Math.max(-1, Math.min(1, pan));
  src.connect(f).connect(g);
  const out = p ? (g.connect(p), p) : g;
  const dg = ctx.createGain(); dg.gain.value = 1 - verb * 0.5; out.connect(dg).connect(dry);
  const wg = ctx.createGain(); wg.gain.value = verb; out.connect(wg).connect(wet.send);
  src.start(t); src.stop(t + dur + 0.05);
}

function ready() {
  if (!hubSoundOn() || (typeof document !== "undefined" && document.hidden)) return false;
  if (!ensure() || ctx.state === "closed") return false;
  if (ctx.state === "suspended") ctx.resume();
  return true;
}
const panOf = (x) => (x == null || typeof window === "undefined" ? 0 : ((x / (window.innerWidth || 1)) * 2 - 1) * 0.8);

// ------------------------------------------------------------------ items picked up out of the bag
/**
 * The sound of lifting an item out of the bag, by what kind of item it is (js/bagItems.js's sections, plus berries,
 * money and eggs): a Poké Ball clicks open, medicine sprays, a TM chirps like a disc, a held item rings like metal,
 * a key item jingles, a berry squishes, money is a coin and an egg wobbles.
 */
export function itemSound(kind, x = null) {
  if (!ready()) return;
  const pan = panOf(x);
  switch (kind) {
    case "ball":
      voice({ freq: 1400, type: "square", decay: 0.04, gain: 0.03, pan, verb: 0.3 });
      voice({ freq: 900, type: "square", at: 0.07, decay: 0.05, gain: 0.03, pan, verb: 0.3 });
      voice({ freq: 330, to: 660, at: 0.09, attack: 0.02, decay: 0.3, gain: 0.07, pan, verb: 0.6 });
      burst({ at: 0.08, dur: 0.25, from: 600, to: 3000, gain: 0.03, pan, q: 1.5 });
      break;
    case "medicine":
      burst({ dur: 0.38, from: 5000, to: 7000, type: "highpass", gain: 0.05, pan, verb: 0.4, attack: 0.02 });
      [0, 4, 7].forEach((s, i) => voice({ freq: note(1046.5, s), at: 0.12 + i * 0.06, decay: 0.4, gain: 0.04, pan, verb: 0.8 }));
      break;
    case "tm":
      [0, 7, 12, 19].forEach((semi, i) => voice({ freq: 880 * Math.pow(2, semi / 12), type: "square", at: i * 0.05, decay: 0.07, gain: 0.025, pan, verb: 0.5 }));
      voice({ freq: 220, to: 440, attack: 0.05, decay: 0.3, type: "triangle", gain: 0.05, pan, verb: 0.5 });
      break;
    case "held":
      [1, 2.76, 5.4].forEach((r, i) => voice({ freq: 760 * r, decay: 0.9 - i * 0.25, gain: 0.07 / (i + 1), pan, verb: 0.7 }));
      break;
    case "key":
      for (let i = 0; i < 5; i++) voice({ freq: 2600 + Math.random() * 2400, at: i * 0.045 + Math.random() * 0.02, decay: 0.14, gain: 0.03, pan: pan + (Math.random() - 0.5) * 0.3, verb: 0.6 });
      break;
    case "berry":
      voice({ freq: 520, to: 180, attack: 0.005, decay: 0.16, gain: 0.1, pan, verb: 0.4 });
      burst({ dur: 0.1, from: 900, to: 300, type: "lowpass", gain: 0.05, pan, verb: 0.3 });
      break;
    case "money":
      voice({ freq: 987.77, type: "square", decay: 0.08, gain: 0.03, pan, verb: 0.5 });
      voice({ freq: 1318.5, type: "square", at: 0.08, decay: 0.45, gain: 0.03, pan, verb: 0.6 });
      break;
    case "egg":
      [0, 0.12].forEach((at, i) => voice({ freq: 180 - i * 30, at, attack: 0.01, decay: 0.15, type: "triangle", gain: 0.09, pan: pan + (i ? 0.1 : -0.1), verb: 0.4 }));
      break;
    default:
      hubSound("pick", x);
  }
}

// ------------------------------------------------------------------ Pokémon cries
// The cries come from the PokeAPI cries collection (by the same id numbers as the sprites, forms included) as Ogg;
// a browser that can't play Ogg (older Safari) gets Pokémon Showdown's MP3 of the base species instead. They're
// streamed from there, never stored here (sound files aren't committed: see CLAUDE.md), and the site's CSP allows
// exactly these two hosts for media.
const CRY_OGG = (dex) => `https://raw.githubusercontent.com/PokeAPI/cries/main/cries/pokemon/latest/${dex}.ogg`;
const CRY_MP3 = (name) => `https://play.pokemonshowdown.com/audio/cries/${name}.mp3`;
// "Mr. Mime" -> "mrmime", "Farfetch'd" -> "farfetchd", "Nidoran♀" -> "nidoranf", "Deoxys (Attack)" -> "deoxys"
export const showdownCryName = (name) => String(name || "").replace(/\s*\(.*\)\s*/g, "").replace(/♀/g, "f").replace(/♂/g, "m")
  .normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
let canOgg = null, lastCry = null;
export function playCry(dex, name = "") {
  if (!hubSoundOn() || typeof Audio === "undefined" || (!dex && !name)) return;
  if (canOgg === null) { try { canOgg = !!new Audio().canPlayType('audio/ogg; codecs="vorbis"'); } catch { canOgg = false; } }
  const mp3 = () => { const b = new Audio(CRY_MP3(showdownCryName(name))); b.volume = 0.4; b.play().catch(() => {}); lastCry = b; };
  try {
    lastCry?.pause?.();
    if (!(canOgg && dex)) { if (name) mp3(); return; }
    const a = new Audio(CRY_OGG(dex));
    a.volume = 0.4;
    if (name) a.addEventListener("error", mp3, { once: true });
    a.play().catch(() => {});
    lastCry = a;
  } catch { /* no audio: stay quiet */ }
}

// ------------------------------------------------------------------ battle moves
/**
 * The sound of a move, in two parts: the launch when it's used, then the hit `hitAt` seconds later when it lands
 * (js/moveFx.js times both to its animation). By the move's type, after the games: fire roars and crackles,
 * water splashes, electricity buzzes and zaps, ice chimes, a punch thuds, a steel move rings, and so on.
 * x / tx: where the user and the target are on screen (clientX), for panning.
 */
export function moveSound(type, { category = "Physical", hitAt = 0.45, missed = false, x = null, tx = null } = {}) {
  if (!ready()) return;
  const p0 = panOf(x), p1 = panOf(tx ?? x), h = hitAt;
  // the launch
  if (category === "Status") {
    const low = type === "Dark" || type === "Ghost" || type === "Poison" ? -5 : 0;
    [0, 4, 7, 12].forEach((s, i) => voice({ freq: note(392, s + low), at: i * 0.07, attack: 0.02, decay: 0.5, gain: 0.05, pan: p0, verb: 0.85 }));
  } else if (category === "Physical") {
    burst({ dur: 0.22, from: 500, to: 2600, gain: 0.05, pan: p0, q: 1.2 });
  } else {
    voice({ freq: 300, to: 900, attack: 0.05, decay: h * 0.9, type: "triangle", gain: 0.035, pan: p0, verb: 0.6 });
  }
  if (missed) { burst({ at: h * 0.8, dur: 0.35, from: 2400, to: 400, gain: 0.05, pan: p1, q: 1.4 }); return; }
  // the hit (or, for a status move, the effect settling)
  const H = (o) => ({ ...o, at: h + (o.at || 0), pan: o.pan ?? p1 });
  const thud = (gain) => { voice(H({ freq: 140, to: 50, attack: 0.003, decay: 0.22, gain, verb: 0.3 })); burst(H({ dur: 0.12, from: 2500, to: 400, type: "lowpass", gain: gain * 0.6, verb: 0.3 })); };
  switch (type) {
    case "Fire":
      burst(H({ dur: 0.7, from: 300, to: 1200, type: "lowpass", gain: 0.12, attack: 0.04 }));
      for (let i = 0; i < 7; i++) burst(H({ at: Math.random() * 0.5, dur: 0.03, from: 3000, to: 3000, type: "highpass", gain: 0.05 }));
      break;
    case "Water":
      burst(H({ dur: 0.5, from: 1800, to: 400, type: "lowpass", gain: 0.1 }));
      for (let i = 0; i < 6; i++) voice(H({ freq: 400 + Math.random() * 500, to: 1200 + Math.random() * 800, at: 0.05 + i * 0.06, attack: 0.005, decay: 0.07, gain: 0.04, verb: 0.5 }));
      break;
    case "Electric":
      for (let i = 0; i < 6; i++) voice(H({ freq: 80 + Math.random() * 60, type: "sawtooth", at: i * 0.05, attack: 0.002, decay: 0.06, gain: 0.05, verb: 0.3 }));
      burst(H({ dur: 0.18, from: 6000, to: 2000, type: "highpass", gain: 0.08, attack: 0.002 }));
      voice(H({ freq: 2200, to: 600, attack: 0.002, decay: 0.25, type: "square", gain: 0.025 }));
      break;
    case "Grass":
      for (let i = 0; i < 5; i++) burst(H({ at: i * 0.06, dur: 0.12, from: 2500, to: 5000, gain: 0.04, q: 3 }));
      voice(H({ freq: 660, to: 990, attack: 0.02, decay: 0.4, gain: 0.04, verb: 0.7 }));
      break;
    case "Ice":
      [0, 3, 7, 10].forEach((s, i) => voice(H({ freq: note(1760, s), at: i * 0.05, decay: 0.6, gain: 0.04, verb: 0.85 })));
      burst(H({ dur: 0.15, from: 7000, to: 3000, type: "highpass", gain: 0.06, attack: 0.002 }));
      break;
    case "Poison":
      for (let i = 0; i < 6; i++) voice(H({ freq: 200 + Math.random() * 150, to: 500 + Math.random() * 300, at: i * 0.07, attack: 0.01, decay: 0.12, type: "triangle", gain: 0.05, verb: 0.6 }));
      break;
    case "Ground":
      voice(H({ freq: 60, to: 35, attack: 0.02, decay: 0.8, gain: 0.2, verb: 0.4 }));
      burst(H({ dur: 0.8, from: 400, to: 120, type: "lowpass", gain: 0.12, attack: 0.03, verb: 0.4 }));
      break;
    case "Rock":
      for (let i = 0; i < 4; i++) { burst(H({ at: i * 0.09, dur: 0.1, from: 1800, to: 300, type: "lowpass", gain: 0.1 })); voice(H({ freq: 110 - i * 8, to: 60, at: i * 0.09, attack: 0.002, decay: 0.14, gain: 0.1, verb: 0.3 })); }
      break;
    case "Flying":
      burst({ at: Math.max(0, h - 0.2), dur: 0.5, from: 400, to: 2500, gain: 0.08, q: 0.8, attack: 0.2, pan: p0 });
      burst(H({ dur: 0.4, from: 2500, to: 600, gain: 0.06, q: 0.8 }));
      break;
    case "Psychic":
      voice(H({ freq: 440, to: 880, attack: 0.05, decay: 0.8, gain: 0.05, verb: 0.9 }));
      voice(H({ freq: 446, to: 892, attack: 0.05, decay: 0.8, gain: 0.05, verb: 0.9 }));
      voice(H({ freq: 660, to: 330, at: 0.2, attack: 0.05, decay: 0.6, type: "triangle", gain: 0.03, verb: 0.9 }));
      break;
    case "Ghost":
      voice(H({ freq: 300, to: 180, attack: 0.15, decay: 0.9, type: "triangle", gain: 0.05, verb: 0.95 }));
      voice(H({ freq: 307, to: 175, attack: 0.15, decay: 0.9, gain: 0.05, verb: 0.95 }));
      burst(H({ dur: 0.7, from: 300, to: 900, gain: 0.03, q: 4, attack: 0.2 }));
      break;
    case "Dark":
      [0, 0.12].forEach((a) => burst(H({ at: a, dur: 0.14, from: 5000, to: 900, gain: 0.08, q: 1.5, attack: 0.003 })));
      voice(H({ freq: 90, to: 55, attack: 0.01, decay: 0.4, gain: 0.1, type: "sawtooth", verb: 0.4 }));
      break;
    case "Bug":
      for (let i = 0; i < 10; i++) voice(H({ freq: 3000 + Math.random() * 1500, type: "square", at: i * 0.035, attack: 0.002, decay: 0.03, gain: 0.015, verb: 0.4 }));
      thud(0.06);
      break;
    case "Dragon":
      voice(H({ freq: 110, to: 70, attack: 0.05, decay: 0.8, type: "sawtooth", gain: 0.07, verb: 0.6 }));
      burst(H({ dur: 0.6, from: 500, to: 2000, gain: 0.07, q: 1, attack: 0.08 }));
      [0, 5, 7].forEach((s, i) => voice(H({ freq: note(220, s), at: 0.1 + i * 0.05, decay: 0.7, type: "triangle", gain: 0.03, verb: 0.7 })));
      break;
    case "Steel":
      [1, 2.76, 5.4, 8.9].forEach((r, i) => voice(H({ freq: 520 * r, decay: 1.1 - i * 0.2, gain: 0.08 / (i + 1), verb: 0.6 })));
      burst(H({ dur: 0.06, from: 6000, to: 6000, type: "highpass", gain: 0.06, attack: 0.002 }));
      break;
    case "Fairy":
      [0, 2, 4, 7, 9, 12].forEach((s, i) => voice(H({ freq: note(1318.5, s), at: i * 0.05, decay: 0.7, gain: 0.04, pan: p1 + (i - 3) * 0.08, verb: 0.9 })));
      break;
    default:   // Normal, Fighting and anything unknown: a solid hit
      thud(category === "Physical" ? 0.16 : 0.11);
  }
}
