// Spatial, ethereal sound effects for the hub: soft glassy bells for clicks, a rising shimmer when you pick something
// up, faint sparkles while it moves, a low bell when it lands, and a wide chime for pings. Everything is synthesised
// with Web Audio (no sound files), panned left/right by where it happened on screen, and sent through a long
// generated reverb so it sounds like it's out in space.
//
// The AudioContext is only made after the first tap or click (browsers refuse sound before then). Settings ->
// Appearance -> Audio turns sound off on this device (localStorage pkdnd-hub-sound = "off") and sets four levels
// (pkdnd-audio): Master, Sound effects, Ambience (js/ambience.js, the background) and Pokémon (the cries). Each is a
// bus: its own dry gain and its own send into the shared space reverb, so a slider turns a sound and its echo down
// together.

const PREF_KEY = "pkdnd-hub-sound";
const LEVELS_KEY = "pkdnd-audio";
export const AUDIO_DEFAULTS = { master: 100, sfx: 100, ambience: 60, pokemon: 100 };   // percent
let ctx = null, master = null, wet = null, dry = null, offline = false;
let buses = {};   // sfx, ambience, pokemon: { d, s } gains
let trim = 1;   // a per-sound level, so every sound sits at the same loudness (see LEVEL below)

/**
 * Render a sound into a buffer instead of the speakers (OfflineAudioContext), for measuring how loud and how bright
 * each one is: `await renderSound(() => itemSound("ball"))`.
 */
export async function renderSound(play, seconds = 3) {
  const live = [ctx, master, dry, wet, buses];
  const off = new OfflineAudioContext(2, Math.round(44100 * seconds), 44100);
  offline = true; build(off);
  try { play({ ctx: off, ambience: buses.ambience }); } finally { [ctx, master, dry, wet, buses] = live; offline = false; }
  return off.startRendering();
}

/** The four levels (0-100) for this device. */
export function getAudioLevels() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(LEVELS_KEY) || "{}") || {}; } catch { saved = {}; }
  const out = { ...AUDIO_DEFAULTS };
  for (const k of Object.keys(out)) if (Number.isFinite(Number(saved[k]))) out[k] = Math.max(0, Math.min(100, Number(saved[k])));
  return out;
}
/** Set one level (master, sfx, ambience or pokemon) and apply it straight away. */
export function setAudioLevel(name, value) {
  const lv = getAudioLevels();
  if (!(name in lv)) return;
  lv[name] = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  try { localStorage.setItem(LEVELS_KEY, JSON.stringify(lv)); } catch { /* private mode: just this visit */ }
  applyLevels(0.05);
}
// slider percent -> gain: a gentle curve so the low end of a slider is still usable (50% is about -12 dB)
const curve = (pct) => (pct <= 0 ? 0 : Math.pow(pct / 100, 2));
function applyLevels(glide = 0) {
  if (!ctx || offline) return;
  const lv = getAudioLevels(), t = ctx.currentTime;
  const set = (param, v) => { if (glide) param.setTargetAtTime(v, t, glide); else param.value = v; };
  set(master.gain, 0.32 * curve(lv.master));
  for (const k of ["sfx", "ambience", "pokemon"]) if (buses[k]) { set(buses[k].d.gain, curve(lv[k])); set(buses[k].s.gain, curve(lv[k])); }
}
/** The ambience bus, for js/ambience.js: { ctx, dry, send } once sound is allowed, else null. */
export function ambienceOut() {
  if (!hubSoundOn() || !ensure() || !buses.ambience) return null;
  return { ctx, dry: buses.ambience.d, send: buses.ambience.s };
}

export function hubSoundOn() {
  try { return localStorage.getItem(PREF_KEY) !== "off"; } catch { return true; }
}
export function setHubSoundOn(on) {
  try { localStorage.setItem(PREF_KEY, on ? "on" : "off"); } catch { /* private mode: just this visit */ }
  if (!on && ctx) ctx.suspend();
  else if (on && ctx) ctx.resume();
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("audio-changed"));
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
  return build(new AC());
}
// the shared graph: each bus -> (its dry gain, and its send -> echo -> reverb) -> master -> a gentle compressor
function build(c) {
  ctx = c;
  master = ctx.createGain(); master.gain.value = 0.32;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18; comp.ratio.value = 3;
  master.connect(comp).connect(ctx.destination);
  const verb = ctx.createConvolver(); verb.buffer = impulse(ctx);
  const ret = ctx.createGain(); ret.gain.value = 0.7;
  verb.connect(ret).connect(master);
  // a soft echo before the reverb widens it further
  const echo = ctx.createDelay(1); echo.delayTime.value = 0.23;
  const fb = ctx.createGain(); fb.gain.value = 0.28;
  const verbIn = ctx.createGain(); verbIn.gain.value = 1;
  verbIn.connect(verb); verbIn.connect(echo); echo.connect(fb).connect(echo); echo.connect(verb);
  const bus = () => { const d = ctx.createGain(), sd = ctx.createGain(); d.connect(master); sd.connect(verbIn); return { d, s: sd }; };
  buses = { sfx: bus(), ambience: bus(), pokemon: bus() };
  // the sound effects go in here (dry at 0.55, as they always have) and through wet.send into the reverb
  dry = ctx.createGain(); dry.gain.value = 0.55; dry.connect(buses.sfx.d);
  wet = { send: buses.sfx.s };
  if (!offline) applyLevels();
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
  // nothing plays in a hidden tab (the background ambience would otherwise keep running)
  document.addEventListener("visibilitychange", () => {
    if (!ctx) return;
    if (document.hidden) ctx.suspend?.();
    else if (hubSoundOn()) ctx.resume?.();
  });
}

// one voice: an oscillator with an envelope, panned, going to both the dry mix and the reverb
function voice({ freq, to = null, type = "sine", at = 0, attack = 0.004, decay = 0.5, gain = 0.2, pan = 0, verb = 0.6, detune = 0 }) {
  const t = ctx.currentTime + at;
  const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t); o.detune.value = detune;
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + attack + decay * 0.6);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain * trim), t + attack);
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
  if (!ready()) return;
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
    // ---- placing things (hub encounters, Whiteboard nodes) and the Whiteboard's own actions
    case "place":   // something new lands: a soft bloom, a low note and a rising fifth
      voice({ freq: 293.66, attack: 0.012, decay: 0.6, gain: 0.08, pan, verb: 0.7 });
      voice({ freq: 440, to: 587.33, at: 0.05, attack: 0.02, decay: 0.5, gain: 0.05, pan, verb: 0.8 });
      air({ dur: 0.28, from: 500, to: 1800, gain: 0.025, pan });
      break;
    case "remove":   // taken away: a falling breath
      air({ dur: 0.3, from: 1600, to: 300, gain: 0.04, pan });
      voice({ freq: 523.25, to: 261.63, attack: 0.01, decay: 0.3, gain: 0.04, pan, verb: 0.6 });
      break;
    case "snap":   // clicks into a slot
      voice({ freq: 196, attack: 0.006, decay: 0.12, type: "triangle", gain: 0.1, pan, verb: 0.3 });
      [0, 2, 4].forEach((s, i) => voice({ freq: note(659.25, s), at: 0.06 + i * 0.05, attack: 0.01, decay: 0.45, gain: 0.045, pan, verb: 0.8 }));
      break;
    case "link":   // two notes joining
      voice({ freq: 523.25, attack: 0.01, decay: 0.5, gain: 0.06, pan: pan - 0.2, verb: 0.75 });
      voice({ freq: 783.99, at: 0.09, attack: 0.01, decay: 0.7, gain: 0.06, pan: pan + 0.2, verb: 0.8 });
      break;
    case "roll":   // a re-roll: a quick patter of soft ticks settling on a note
      for (let i = 0; i < 5; i++) voice({ freq: note(784, (i * 3) % 7), at: i * 0.045, attack: 0.006, decay: 0.08, type: "triangle", gain: 0.035, pan: pan + (i % 2 ? 0.1 : -0.1), verb: 0.5 });
      voice({ freq: 587.33, at: 0.26, attack: 0.01, decay: 0.5, gain: 0.06, pan, verb: 0.7 });
      break;
    case "levelUp": case "levelDown": {
      const up = kind === "levelUp";
      voice({ freq: up ? 523.25 : 659.25, to: up ? 659.25 : 523.25, attack: 0.01, decay: 0.3, gain: 0.05, pan, verb: 0.6 });
      break;
    }
    case "page":   // changing page: a soft breath out and a two-note glide in
      air({ dur: 0.32, from: 1800, to: 500, gain: 0.03, pan });
      voice({ freq: 587.33, at: 0.14, attack: 0.03, decay: 0.45, gain: 0.035, pan: pan - 0.15, verb: 0.85 });
      voice({ freq: 880, at: 0.22, attack: 0.03, decay: 0.55, gain: 0.03, pan: pan + 0.15, verb: 0.9 });
      break;
    case "ballShake":   // the ball wobbling on the ground: a soft knock, once per shake
      voice({ freq: 330, attack: 0.006, decay: 0.12, type: "triangle", gain: 0.08, pan, verb: 0.35 });
      voice({ freq: 1318.5, attack: 0.004, decay: 0.05, gain: 0.025, pan, verb: 0.4 });
      break;
    case "caught":   // click! and a rising little fanfare
      voice({ freq: 1568, attack: 0.003, decay: 0.08, type: "triangle", gain: 0.06, pan, verb: 0.4 });
      [0, 2, 4, 7].forEach((s, i) => voice({ freq: note(523.25, s), at: 0.12 + i * 0.09, attack: 0.012, decay: 0.7, gain: 0.06, pan, verb: 0.8 }));
      break;
    case "breakFree":   // the ball pops open and it's out
      air({ dur: 0.25, from: 700, to: 2600, gain: 0.05, pan });
      voice({ freq: 659.25, to: 329.63, attack: 0.008, decay: 0.35, gain: 0.06, pan, verb: 0.6 });
      break;
    case "hatch":
      [0, 2, 4, 5, 7].forEach((s, i) => voice({ freq: note(523.25, s), at: i * 0.09, decay: 1.2, gain: 0.08, pan: (i - 2) * 0.25, verb: 0.85 }));
      break;
    default:
      break;
  }
}

// ------------------------------------------------------------------ the item, cry and move sounds
// These follow the hub's own palette so nothing jumps out: sine and triangle tones only (no buzzy square or saw
// waves), notes from the pentatonic scale, soft attacks of 10ms or more, and noise that is always low-passed or
// band-passed below ~3kHz (no hiss). Each sound has a LEVEL so they all land at about the loudness of the hub's
// clicks and drops, measured with renderSound (the loudest 300ms of each, in dB).

// a soft breath of filtered noise: type is a BiquadFilter type, the filter sweeps from `from` to `to` Hz
function burst({ at = 0, dur = 0.3, from = 800, to = 800, type = "lowpass", q = 0.7, gain = 0.08, pan = 0, verb = 0.6, attack = 0.015 }) {
  const t = ctx.currentTime + Math.max(0, at);
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource(); src.buffer = buf;
  const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(Math.min(from, 3200), t); f.frequency.exponentialRampToValueAtTime(Math.max(40, Math.min(to, 3200)), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain * trim), t + Math.min(attack, dur * 0.5)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
  if (p) p.pan.value = Math.max(-1, Math.min(1, pan));
  src.connect(f).connect(g);
  const out = p ? (g.connect(p), p) : g;
  const dg = ctx.createGain(); dg.gain.value = 1 - verb * 0.5; out.connect(dg).connect(dry);
  const wg = ctx.createGain(); wg.gain.value = verb; out.connect(wg).connect(wet.send);
  src.start(t); src.stop(t + dur + 0.05);
}

function ready() {
  if (offline) return true;
  if (!hubSoundOn() || (typeof document !== "undefined" && document.hidden)) return false;
  if (!ensure() || ctx.state === "closed") return false;
  if (ctx.state === "suspended") ctx.resume();
  return true;
}
const panOf = (x) => (x == null || typeof window === "undefined" ? 0 : ((x / (window.innerWidth || 1)) * 2 - 1) * 0.8);
// play one sound at its level
function leveled(key, fn) { trim = LEVEL[key] ?? 1; try { fn(); } finally { trim = 1; } }

// how much each sound is turned up or down so they all sit together (from renderSound measurements)
const LEVEL = {
  "item:ball": 0.95, "item:medicine": 0.75, "item:tm": 1.05, "item:held": 1.12, "item:key": 1.4, "item:berry": 2.04, "item:money": 0.95, "item:egg": 1.23,
  "move:Status": 0.81, "move:Normal": 1.05, "move:Fire": 3.55, "move:Water": 1.78, "move:Electric": 1.38, "move:Grass": 1.88, "move:Ice": 0.87,
  "move:Fighting": 1.12, "move:Poison": 1.8, "move:Ground": 0.45, "move:Rock": 1.15, "move:Flying": 3.16, "move:Psychic": 1.08, "move:Ghost": 0.92,
  "move:Dark": 1.27, "move:Bug": 1.58, "move:Dragon": 0.88, "move:Steel": 0.84, "move:Fairy": 1.08, "move:miss": 1.78,
};

// ------------------------------------------------------------------ items picked up out of the bag
/**
 * The sound of lifting an item out of the bag, by what kind of item it is (js/bagItems.js's sections, plus berries,
 * money and eggs): a Poké Ball pops open, medicine is a soft spray and a sparkle, a TM spins up, a held item rings,
 * a key item jingles, a berry plops, money is a two-note coin chime and an egg wobbles.
 */
export function itemSound(kind, x = null) {
  if (!ready()) return;
  const pan = panOf(x);
  const k = ["ball", "medicine", "tm", "held", "key", "berry", "money", "egg"].includes(kind) ? kind : null;
  if (!k) { hubSound("pick", x); return; }
  leveled(`item:${k}`, () => {
    switch (k) {
      case "ball":   // two soft clicks of the button, then the ball popping open
        voice({ freq: 1046.5, type: "triangle", attack: 0.004, decay: 0.07, gain: 0.05, pan, verb: 0.4 });
        voice({ freq: 784, type: "triangle", at: 0.07, attack: 0.004, decay: 0.08, gain: 0.05, pan, verb: 0.4 });
        voice({ freq: 392, to: 784, at: 0.12, attack: 0.015, decay: 0.35, gain: 0.08, pan, verb: 0.65 });
        burst({ at: 0.12, dur: 0.3, from: 500, to: 1800, type: "bandpass", gain: 0.03, pan });
        break;
      case "medicine":   // a soft spray, then a little healing sparkle
        burst({ dur: 0.4, from: 2200, to: 2800, type: "bandpass", q: 0.9, gain: 0.035, pan, attack: 0.05 });
        [0, 2, 4].forEach((s, i) => voice({ freq: note(784, s), at: 0.16 + i * 0.07, attack: 0.012, decay: 0.55, gain: 0.05, pan, verb: 0.8 }));
        break;
      case "tm":   // the disc spinning up
        voice({ freq: 196, to: 392, attack: 0.04, decay: 0.4, type: "triangle", gain: 0.06, pan, verb: 0.5 });
        [0, 2, 4, 5].forEach((s, i) => voice({ freq: note(523.25, s), at: 0.08 + i * 0.055, attack: 0.01, decay: 0.25, type: "triangle", gain: 0.04, pan, verb: 0.6 }));
        break;
      case "held":   // a small metal ring
        [1, 2.76].forEach((r, i) => voice({ freq: 587.33 * r, attack: 0.008, decay: 0.8 - i * 0.3, gain: 0.07 / (i * 2 + 1), pan, verb: 0.7 }));
        break;
      case "key":   // keys on a ring
        [0, 2, 4, 3].forEach((s, i) => voice({ freq: note(1568, s), at: i * 0.06, attack: 0.01, decay: 0.22, gain: 0.04, pan: pan + (i - 1.5) * 0.08, verb: 0.65 }));
        break;
      case "berry":   // a soft plop
        voice({ freq: 440, to: 196, attack: 0.01, decay: 0.2, gain: 0.1, pan, verb: 0.45 });
        burst({ dur: 0.12, from: 700, to: 250, gain: 0.04, pan, verb: 0.3 });
        break;
      case "money":   // a coin: two quick bell notes, the second held
        voice({ freq: 987.77, attack: 0.008, decay: 0.12, gain: 0.06, pan, verb: 0.5 });
        voice({ freq: 1318.5, at: 0.09, attack: 0.008, decay: 0.6, gain: 0.06, pan, verb: 0.65 });
        break;
      case "egg":   // a wobble: two soft knocks
        [0, 0.14].forEach((at, i) => voice({ freq: 220 - i * 26, at, attack: 0.012, decay: 0.18, type: "triangle", gain: 0.09, pan: pan + (i ? 0.1 : -0.1), verb: 0.45 }));
        break;
    }
  });
}

// ------------------------------------------------------------------ Pokémon cries
// The real cries from the games: the PokeAPI cries collection (Ogg, by the same id numbers as the sprites, forms
// included), or Pokémon Showdown's MP3 of the base species where Ogg won't play (older Safari). They're streamed from
// there, never stored here (sound files aren't committed: see CLAUDE.md), and the CSP allows exactly these two hosts
// for media. The game files are mastered at full volume (they measured ~40 dB louder than the hub's sounds), so the
// Ogg goes through the hub's own mix, turned well down, softened a touch and with a little of the space reverb; the
// MP3 fallback can't (that server doesn't allow it), so it just plays very quietly.
const CRY_OGG = (dex) => `https://raw.githubusercontent.com/PokeAPI/cries/main/cries/pokemon/latest/${dex}.ogg`;
const CRY_MP3 = (name) => `https://play.pokemonshowdown.com/audio/cries/${name}.mp3`;
const CRY_GAIN = 0.1, CRY_FALLBACK_VOLUME = 0.02;   // both put a cry ~44 dB down: just above a hub ping
// "Mr. Mime" -> "mrmime", "Farfetch'd" -> "farfetchd", "Nidoran♀" -> "nidoranf", "Deoxys (Attack)" -> "deoxys"
export const showdownCryName = (name) => String(name || "").replace(/\s*\(.*\)\s*/g, "").replace(/♀/g, "f").replace(/♂/g, "m")
  .normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
let canOgg = null, lastCry = null;
export function playCry(dex, name = "") {
  if (!hubSoundOn() || typeof Audio === "undefined" || (!dex && !name)) return;
  if (canOgg === null) { try { canOgg = !!new Audio().canPlayType('audio/ogg; codecs="vorbis"'); } catch { canOgg = false; } }
  const lv = getAudioLevels();
  const mp3 = () => { const b = new Audio(CRY_MP3(showdownCryName(name))); b.volume = Math.min(1, CRY_FALLBACK_VOLUME * curve(lv.master) * curve(lv.pokemon)); b.play().catch(() => {}); lastCry = b; };
  try {
    lastCry?.pause?.();
    if (!(canOgg && dex) || !ready()) { if (name) mp3(); return; }
    const a = new Audio();
    a.crossOrigin = "anonymous";   // so it can go through the mix (that server allows it)
    a.src = CRY_OGG(dex);
    if (name) a.addEventListener("error", mp3, { once: true });
    const src = ctx.createMediaElementSource(a);
    const soft = ctx.createBiquadFilter(); soft.type = "lowpass"; soft.frequency.value = 5500; soft.Q.value = 0.5;
    const g = ctx.createGain(); g.gain.value = CRY_GAIN;
    src.connect(soft).connect(g);
    const d = ctx.createGain(); d.gain.value = 0.9 * 0.55; g.connect(d).connect(buses.pokemon.d);
    const w = ctx.createGain(); w.gain.value = 0.22; g.connect(w).connect(buses.pokemon.s);
    a.addEventListener("ended", () => { try { src.disconnect(); } catch { /* already gone */ } }, { once: true });
    a.play().catch(() => {});
    lastCry = a;
  } catch { /* no audio: stay quiet */ }
}

// ------------------------------------------------------------------ battle moves
/**
 * The sound of a move, in two parts: the launch when it's used, then the hit `hitAt` seconds later when it lands
 * (js/moveFx.js times both to its animation). By the move's type, after the games but kept soft: fire roars and
 * flickers, water splashes and bubbles, electricity crackles, ice chimes, a punch thumps, steel rings, and so on.
 * x / tx: where the user and the target are on screen (clientX), for panning.
 */
export function moveSound(type, { category = "Physical", hitAt = 0.45, missed = false, x = null, tx = null } = {}) {
  if (!ready()) return;
  const p0 = panOf(x), p1 = panOf(tx ?? x), h = hitAt;
  const key = missed ? "move:miss" : category === "Status" ? "move:Status" : `move:${LEVEL[`move:${type}`] ? type : "Normal"}`;
  leveled(key, () => {
    // the launch
    if (category === "Status") {
      const low = type === "Dark" || type === "Ghost" || type === "Poison" ? -5 : 0;
      [0, 2, 4, 7].forEach((s, i) => voice({ freq: note(392, s + low), at: i * 0.08, attack: 0.03, decay: 0.6, gain: 0.05, pan: p0, verb: 0.85 }));
    } else if (category === "Physical") {
      burst({ dur: 0.24, from: 400, to: 1500, type: "bandpass", q: 0.9, gain: 0.05, pan: p0, attack: 0.05 });
    } else {
      voice({ freq: 262, to: 523, attack: 0.06, decay: h * 0.9, type: "triangle", gain: 0.04, pan: p0, verb: 0.65 });
    }
    if (missed) { burst({ at: h * 0.8, dur: 0.4, from: 1600, to: 400, type: "bandpass", q: 0.9, gain: 0.05, pan: p1, attack: 0.08 }); return; }
    if (category === "Status") return;
    // the hit
    const H = (o) => ({ ...o, at: h + (o.at || 0), pan: o.pan ?? p1 });
    const thump = (gain) => { voice(H({ freq: 150, to: 60, attack: 0.008, decay: 0.26, gain, verb: 0.35 })); burst(H({ dur: 0.16, from: 1400, to: 300, gain: gain * 0.5, verb: 0.35, attack: 0.008 })); };
    switch (type) {
      case "Fire":   // a whoomph of flame, with a few soft flickers
        burst(H({ dur: 0.75, from: 250, to: 1000, gain: 0.12, attack: 0.06 }));
        for (let i = 0; i < 4; i++) burst(H({ at: 0.1 + i * 0.12, dur: 0.06, from: 1600, to: 1600, type: "bandpass", q: 1.5, gain: 0.025 }));
        break;
      case "Water":   // a splash, then bubbles
        burst(H({ dur: 0.5, from: 1500, to: 350, gain: 0.1, attack: 0.012 }));
        [0, 2, 4, 1, 3].forEach((s, i) => voice(H({ freq: note(392, s), to: note(784, s), at: 0.08 + i * 0.07, attack: 0.01, decay: 0.1, gain: 0.04, verb: 0.55 })));
        break;
      case "Electric":   // a crackle and a falling zap
        for (let i = 0; i < 5; i++) burst(H({ at: i * 0.045, dur: 0.05, from: 2200, to: 1800, type: "bandpass", q: 2, gain: 0.04, attack: 0.008 }));
        voice(H({ freq: 1046.5, to: 262, attack: 0.01, decay: 0.32, type: "triangle", gain: 0.05, verb: 0.5 }));
        voice(H({ freq: 110, attack: 0.01, decay: 0.3, gain: 0.05, verb: 0.3 }));
        break;
      case "Grass":   // leaves rustling past, a light rising note
        for (let i = 0; i < 4; i++) burst(H({ at: i * 0.07, dur: 0.14, from: 1400, to: 2400, type: "bandpass", q: 1.6, gain: 0.035, attack: 0.03 }));
        voice(H({ freq: 523.25, to: 784, attack: 0.03, decay: 0.45, gain: 0.04, verb: 0.7 }));
        break;
      case "Ice":   // glassy chimes and a soft crack
        [0, 2, 4, 7].forEach((s, i) => voice(H({ freq: note(1046.5, s), at: i * 0.05, attack: 0.01, decay: 0.7, gain: 0.04, verb: 0.85 })));
        burst(H({ dur: 0.12, from: 2600, to: 1400, type: "bandpass", q: 1.2, gain: 0.04, attack: 0.008 }));
        break;
      case "Poison":   // bubbling
        [0, 2, 1, 4, 3, 0].forEach((s, i) => voice(H({ freq: note(220, s), to: note(440, s), at: i * 0.08, attack: 0.015, decay: 0.13, type: "triangle", gain: 0.05, verb: 0.6 })));
        break;
      case "Ground":   // a low rumble
        voice(H({ freq: 55, to: 40, attack: 0.05, decay: 0.8, gain: 0.12, verb: 0.4 }));
        burst(H({ dur: 0.8, from: 300, to: 120, gain: 0.08, attack: 0.06, verb: 0.4 }));
        break;
      case "Rock":   // stones landing
        for (let i = 0; i < 4; i++) { burst(H({ at: i * 0.1, dur: 0.12, from: 1200, to: 300, gain: 0.06, attack: 0.008 })); voice(H({ freq: 120 - i * 8, to: 70, at: i * 0.1, attack: 0.008, decay: 0.15, gain: 0.06, verb: 0.3 })); }
        break;
      case "Flying":   // a gust
        burst({ at: Math.max(0, h - 0.2), dur: 0.5, from: 400, to: 1800, type: "bandpass", q: 0.7, gain: 0.07, attack: 0.2, pan: p0 });
        burst(H({ dur: 0.45, from: 1800, to: 500, type: "bandpass", q: 0.7, gain: 0.06, attack: 0.03 }));
        break;
      case "Psychic":   // a warbling shimmer
        voice(H({ freq: 440, to: 660, attack: 0.08, decay: 0.8, gain: 0.05, verb: 0.9 }));
        voice(H({ freq: 445, to: 667, attack: 0.08, decay: 0.8, gain: 0.05, verb: 0.9 }));
        voice(H({ freq: 880, to: 660, at: 0.2, attack: 0.06, decay: 0.6, gain: 0.025, verb: 0.9 }));
        break;
      case "Ghost":   // a hollow, sliding moan
        voice(H({ freq: 294, to: 196, attack: 0.18, decay: 0.9, type: "triangle", gain: 0.05, verb: 0.95 }));
        voice(H({ freq: 300, to: 192, attack: 0.18, decay: 0.9, gain: 0.045, verb: 0.95 }));
        break;
      case "Dark":   // two dull swipes and a low note
        [0, 0.13].forEach((a) => burst(H({ at: a, dur: 0.16, from: 2000, to: 500, type: "bandpass", q: 1, gain: 0.06, attack: 0.012 })));
        voice(H({ freq: 98, to: 73, attack: 0.02, decay: 0.45, type: "triangle", gain: 0.08, verb: 0.45 }));
        break;
      case "Bug":   // a soft flutter, then a light hit
        for (let i = 0; i < 8; i++) burst(H({ at: -0.15 + i * 0.03, dur: 0.035, from: 1300, to: 1300, type: "bandpass", q: 2, gain: 0.025, attack: 0.008 }));
        thump(0.06);
        break;
      case "Dragon":   // a deep surge with a fifth on top
        voice(H({ freq: 98, to: 73, attack: 0.06, decay: 0.85, type: "triangle", gain: 0.08, verb: 0.6 }));
        burst(H({ dur: 0.6, from: 400, to: 1400, type: "bandpass", q: 0.8, gain: 0.05, attack: 0.1 }));
        [0, 3, 5].forEach((s, i) => voice(H({ freq: note(196, s), at: 0.1 + i * 0.06, attack: 0.02, decay: 0.7, gain: 0.03, verb: 0.7 })));
        break;
      case "Steel":   // a metal ring
        [1, 2.76, 5.4].forEach((r, i) => voice(H({ freq: 392 * r, attack: 0.008, decay: 1 - i * 0.25, gain: 0.07 / (i * 2 + 1), verb: 0.6 })));
        break;
      case "Fairy":   // a twinkling run
        [0, 2, 4, 5, 7].forEach((s, i) => voice(H({ freq: note(784, s), at: i * 0.06, attack: 0.012, decay: 0.7, gain: 0.04, pan: p1 + (i - 2) * 0.08, verb: 0.9 })));
        break;
      default:   // Normal, Fighting and anything else: a solid thump
        thump(category === "Physical" ? 0.12 : 0.09);
    }
  });
}

// ------------------------------------------------------------------ Whiteboard nodes, each kind with its own voice
// Placing, picking up and dropping a node sound different for each kind, so the board is easy to "hear": a note is a
// soft wooden knock, a sticky a light paper flick, a checklist a quick double tick, a trainer a warm chord, a gym leader
// a deep bell, a wild Pokémon a little chirp, a dungeon a low stone thud, a generated card a glassy bell.
const NODE_VOICES = {
  note: { base: 392, type: "triangle", decay: 0.35 },
  text: { base: 659.25, type: "sine", decay: 0.2, paper: true },
  list: { base: 783.99, type: "triangle", decay: 0.12, tick: true },
  trainer: { base: 293.66, type: "sine", decay: 0.6, chord: [0, 4, 7] },
  libtrainer: { base: 293.66, type: "sine", decay: 0.6, chord: [0, 4, 7] },
  gym: { base: 196, type: "sine", decay: 0.9, chord: [0, 7, 12], bell: true },
  wildmon: { base: 587.33, type: "sine", decay: 0.25, chirp: true },
  libmon: { base: 587.33, type: "sine", decay: 0.25, chirp: true },
  dungeon: { base: 110, type: "triangle", decay: 0.5, stone: true },
  route: { base: 440, type: "sine", decay: 0.45, chord: [0, 7] },
  npc: { base: 349.23, type: "triangle", decay: 0.4, chord: [0, 4] },
  default: { base: 523.25, type: "sine", decay: 0.45 },
};
/** action: "place" (a new node lands), "pick" (picked up) or "drop" (put down); kind: the node's kind (kinds.js). */
export function nodeSound(action, kind, x = null) {
  if (!ready()) return;
  const v = NODE_VOICES[kind] || NODE_VOICES.default, pan = panOf(x);
  const up = action === "pick", f = v.base * (up ? 1.5 : action === "drop" ? 1 : 1.25);
  const g = action === "place" ? 1 : 0.65;
  if (v.paper) burst({ dur: 0.12, from: up ? 1800 : 2600, to: up ? 2600 : 1400, type: "bandpass", q: 1, gain: 0.04 * g, pan, attack: 0.01 });
  if (v.stone) burst({ dur: 0.25, from: 600, to: 150, gain: 0.07 * g, pan, verb: 0.4, attack: 0.008 });
  if (v.tick) [0, 0.06].forEach((at, i) => voice({ freq: f * (i ? 1.25 : 1), at, attack: 0.004, decay: v.decay, type: v.type, gain: 0.05 * g, pan, verb: 0.4 }));
  else if (v.chirp) voice({ freq: f, to: f * (up ? 1.6 : 1.35), attack: 0.01, decay: v.decay, gain: 0.05 * g, pan, verb: 0.55 });
  else (v.chord || [0]).forEach((s, i) => voice({ freq: f * Math.pow(2, s / 12), at: i * (action === "place" ? 0.05 : 0.025), attack: 0.012, decay: v.decay, type: v.type, gain: (0.06 / (i + 1)) * g, pan, verb: v.bell ? 0.85 : 0.6 }));
  if (v.bell && action !== "pick") voice({ freq: f * 2.76, attack: 0.008, decay: v.decay * 0.6, gain: 0.02 * g, pan, verb: 0.85 });
  if (action === "place") air({ dur: 0.24, from: 500, to: 1600, gain: 0.02, pan });
}
