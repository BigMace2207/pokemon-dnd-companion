// The portfolio's sounds, made live with the Web Audio API (no sound files). Browsers keep audio locked until the
// visitor has interacted with the site, so a sound only plays if the audio context is already running; the first
// click, key or scroll unlocks it. A mute switch is remembered between visits.

const KEY = "pf-sound-off";
let ctx: AudioContext | null = null;
let off = false;
try { off = localStorage.getItem(KEY) === "1"; } catch { /* storage blocked */ }

function context(): AudioContext | null {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC(); } catch { return null; }
  }
  if (ctx.state === "suspended") void ctx.resume().catch(() => {});
  return ctx;
}
/** The context, but only if it is allowed to make noise right now and the visitor hasn't muted. */
function live(): AudioContext | null {
  if (off) return null;
  const c = context();
  return c && c.state === "running" ? c : null;
}
const unlock = () => { context(); };
for (const ev of ["pointerdown", "keydown", "wheel", "touchstart"]) window.addEventListener(ev, unlock, { passive: true, once: true });

let noiseBuf: AudioBuffer | null = null;
function noise(c: AudioContext) {
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const s = c.createBufferSource();
  s.buffer = noiseBuf;
  return s;
}
function env(g: GainNode, t: number, peak: number, attack: number, release: number) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + release);
}
function tone(c: AudioContext, t: number, from: number, to: number, peak: number, attack: number, release: number, type: OscillatorType = "sine") {
  const o = c.createOscillator(), g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(from, t);
  o.frequency.exponentialRampToValueAtTime(to, t + attack + release * 0.6);
  env(g, t, peak, attack, release);
  o.connect(g).connect(c.destination);
  o.start(t); o.stop(t + attack + release + 0.05);
}

// a major pentatonic ladder: each region pops on its own note
const LADDER = [392, 440, 523.25, 587.33, 659.25, 783.99, 880];

export const sfx = {
  get muted() { return off; },
  setMuted(value: boolean) {
    off = value;
    try { localStorage.setItem(KEY, value ? "1" : "0"); } catch { /* ignore */ }
    if (!value) context();
  },
  /** a land rising out of the planet: thump, a rising note and a sparkle of noise */
  pop(i: number) {
    const c = live(); if (!c) return;
    const t = c.currentTime + 0.01, f = LADDER[((i % LADDER.length) + LADDER.length) % LADDER.length];
    tone(c, t, 110, 48, 0.32, 0.005, 0.2);
    tone(c, t, f * 0.55, f, 0.2, 0.01, 0.35);
    tone(c, t + 0.05, f * 2, f * 2.01, 0.07, 0.01, 0.45, "triangle");
    const n = noise(c), hp = c.createBiquadFilter(), g = c.createGain();
    hp.type = "highpass"; hp.frequency.value = 5200;
    env(g, t, 0.07, 0.004, 0.16);
    n.connect(hp).connect(g).connect(c.destination);
    n.start(t, Math.random()); n.stop(t + 0.3);
  },
  /** the planet starting to turn */
  whoosh() {
    const c = live(); if (!c) return;
    const t = c.currentTime + 0.01, n = noise(c), bp = c.createBiquadFilter(), g = c.createGain();
    bp.type = "bandpass"; bp.Q.value = 0.9;
    bp.frequency.setValueAtTime(180, t); bp.frequency.exponentialRampToValueAtTime(1800, t + 1.1); bp.frequency.exponentialRampToValueAtTime(260, t + 2.6);
    env(g, t, 0.16, 0.9, 1.7);
    n.connect(bp).connect(g).connect(c.destination);
    n.start(t, Math.random()); n.stop(t + 2.8);
  },
  /** the last land is up: a short rising arpeggio */
  chime() {
    const c = live(); if (!c) return;
    const t = c.currentTime + 0.02;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, k) => tone(c, t + k * 0.075, f, f, 0.12, 0.01, 0.7, k === 3 ? "triangle" : "sine"));
  },
  /** a marker chosen: one soft ping, pitched by its place on the list */
  ping(k: number) {
    const c = live(); if (!c) return;
    const f = LADDER[(k + 2) % LADDER.length];
    tone(c, c.currentTime + 0.01, f, f * 1.003, 0.14, 0.006, 0.5);
    tone(c, c.currentTime + 0.01, f / 2, f / 2, 0.08, 0.006, 0.4, "triangle");
  },
  /** landing on a region */
  land() {
    const c = live(); if (!c) return;
    const t = c.currentTime + 0.01;
    tone(c, t, 90, 40, 0.28, 0.008, 0.45);
    tone(c, t, 300, 620, 0.07, 0.04, 0.5, "triangle");
  },
};
