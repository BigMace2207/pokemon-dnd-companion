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
