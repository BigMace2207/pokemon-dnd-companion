// The background ambience for Pokémon D&D campaigns: a slow, spatial soundscape that sits under everything, so the
// site feels like it's out in the same cosmos as the sky. Generated live with Web Audio (no sound files):
//  - a soft chord pad that drifts through four chords, gliding a few seconds between them, each note slowly swept
//    through a low-pass filter and panned left and right on its own slow rhythm, so the sound moves around you;
//  - a breath of filtered noise, like distant solar wind, that swells and wanders;
//  - every few seconds a faint, far-away bell somewhere in the stereo field, drowned in the space reverb.
// It goes through the Ambience bus of js/hubSound.js (Settings -> Appearance -> Audio: the Ambience slider, and the
// Master switch), never starts before the first tap or click, and stops in a hidden tab. Everything moves through
// AudioParams, so it costs almost nothing to run.

import { ambienceOut, hubSoundOn } from "./hubSound.js";

// D major / B minor colours, open voicings in the warm middle (low enough to be soft, high enough not to rumble)
const CHORDS = [
  [146.83, 220.0, 329.63, 369.99],   // D3 A3 E4 F#4
  [123.47, 185.0, 293.66, 329.63],   // B2 F#3 D4 E4
  [98.0, 146.83, 246.94, 369.99],    // G2 D3 B3 F#4
  [110.0, 164.81, 277.18, 329.63],   // A2 E3 C#4 E4
];
const LEVEL = 0.16;   // overall level of the soundscape (tuned with renderSound against the hub's clicks)
const BELLS = [587.33, 659.25, 739.99, 880.0, 987.77, 1174.66];   // D major pentatonic, up high
const CHORD_SECONDS = 22, GLIDE = 3.5;

/**
 * Build the soundscape on context `c`, into the nodes `dry` and `send` (the reverb). Returns { stop(), schedule(from,
 * to) }: schedule plans the chord changes and bells between two times (the live version calls it every second; a
 * test render calls it once for the whole span).
 */
export function buildAmbience(c, dry, send, rng = Math.random) {
  const nodes = [];
  const keep = (n) => (nodes.push(n), n);
  const t0 = c.currentTime;
  const out = keep(c.createGain());
  out.gain.setValueAtTime(0.0001, t0);
  out.gain.exponentialRampToValueAtTime(LEVEL, t0 + 6);   // fades in over a few seconds
  const toDry = keep(c.createGain()); toDry.gain.value = 0.5;
  const toSend = keep(c.createGain()); toSend.gain.value = 0.9;
  out.connect(toDry).connect(dry); out.connect(toSend).connect(send);

  // a slow sine moving an AudioParam by ±depth around its value
  const lfo = (param, rate, depth, phase = 0) => {
    const o = keep(c.createOscillator()); o.frequency.value = rate;
    const g = keep(c.createGain()); g.gain.value = depth;
    o.connect(g).connect(param);
    o.start(t0 + phase);
    return o;
  };

  // ---- the pad: four voices, each two slightly detuned oscillators through its own filter and panner
  const voices = CHORDS[0].map((f, i) => {
    const a = keep(c.createOscillator()); a.type = "sine"; a.frequency.value = f;
    const b = keep(c.createOscillator()); b.type = "triangle"; b.frequency.value = f; b.detune.value = i % 2 ? 7 : -7;
    const filt = keep(c.createBiquadFilter()); filt.type = "lowpass"; filt.frequency.value = 420 + i * 90; filt.Q.value = 0.4;
    lfo(filt.frequency, 0.021 + i * 0.009, 160 + i * 40, i * 1.3);
    const g = keep(c.createGain()); g.gain.value = [0.05, 0.04, 0.026, 0.02][i];
    lfo(g.gain, 0.031 + i * 0.006, g.gain.value * 0.45, i * 2.1);   // each note swells on its own
    const pan = c.createStereoPanner ? keep(c.createStereoPanner()) : null;
    if (pan) lfo(pan.pan, 0.017 + i * 0.011, 0.55 + i * 0.08, i * 3.7);
    a.connect(filt); b.connect(filt); filt.connect(g);
    (pan ? (g.connect(pan), pan) : g).connect(out);
    a.start(t0); b.start(t0);
    return { a, b };
  });

  // ---- solar wind: looped noise through a wandering band-pass
  const len = Math.floor(c.sampleRate * 4);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = rng() * 2 - 1;
  const noise = keep(c.createBufferSource()); noise.buffer = buf; noise.loop = true;
  const bp = keep(c.createBiquadFilter()); bp.type = "bandpass"; bp.frequency.value = 520; bp.Q.value = 0.7;
  lfo(bp.frequency, 0.037, 260);
  const wind = keep(c.createGain()); wind.gain.value = 0.012;
  lfo(wind.gain, 0.045, 0.008, 1.7);
  const wpan = c.createStereoPanner ? keep(c.createStereoPanner()) : null;
  if (wpan) lfo(wpan.pan, 0.013, 0.7, 4.2);
  noise.connect(bp).connect(wind);
  (wpan ? (wind.connect(wpan), wpan) : wind).connect(out);
  noise.start(t0);

  // ---- the chord changes and far-off bells, planned ahead in time
  let nextChord = t0 + CHORD_SECONDS, chord = 0, nextBell = t0 + 3 + rng() * 4;
  function bell(at) {
    const f = BELLS[Math.floor(rng() * BELLS.length)];
    const o = c.createOscillator(); o.type = "sine"; o.frequency.value = f;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.012, at + 0.04); g.gain.exponentialRampToValueAtTime(0.0001, at + 3.2);
    const p = c.createStereoPanner ? c.createStereoPanner() : null;
    if (p) p.pan.value = rng() * 1.6 - 0.8;
    o.connect(g); const o2 = p ? (g.connect(p), p) : g;
    const wetOnly = c.createGain(); wetOnly.gain.value = 1;   // mostly reverb: it sounds far away
    o2.connect(wetOnly).connect(toSend); o2.connect(out);
    o.start(at); o.stop(at + 3.3);
  }
  function schedule(from, to) {
    while (nextChord < to) {
      chord = (chord + 1) % CHORDS.length;
      CHORDS[chord].forEach((f, i) => { voices[i].a.frequency.setTargetAtTime(f, nextChord, GLIDE / 3); voices[i].b.frequency.setTargetAtTime(f, nextChord, GLIDE / 3); });
      nextChord += CHORD_SECONDS;
    }
    while (nextBell < to) { if (nextBell >= from) bell(nextBell); nextBell += 4.5 + rng() * 7; }
  }
  return {
    schedule,
    stop(fade = 1.5) {
      const t = c.currentTime;
      out.gain.cancelScheduledValues(t); out.gain.setValueAtTime(Math.max(0.0001, out.gain.value), t); out.gain.exponentialRampToValueAtTime(0.0001, t + fade);
      setTimeout(() => nodes.forEach((n) => { try { n.stop?.(); } catch { /* not started */ } try { n.disconnect(); } catch { /* gone */ } }), fade * 1000 + 100);
    },
  };
}

// ---------------------------------------------------------------- the live soundscape
let live = null, timer = 0, wanted = false;
function tick() {
  if (!live) return;
  const t = live.c.currentTime;
  live.amb.schedule(t, t + 2);
}
function begin() {
  if (live || !wanted || !hubSoundOn()) return;
  const outNodes = ambienceOut();
  if (!outNodes) return;
  if (outNodes.ctx.state !== "running") {
    // not allowed to play yet (no tap so far) or paused (a hidden tab): start when it is
    if (!outNodes.ctx.__ambWait) { outNodes.ctx.__ambWait = true; outNodes.ctx.addEventListener("statechange", () => begin()); }
    return;
  }
  live = { c: outNodes.ctx, amb: buildAmbience(outNodes.ctx, outNodes.dry, outNodes.send) };
  tick();
  timer = setInterval(tick, 1000);
}
function end() {
  clearInterval(timer); timer = 0;
  live?.amb.stop(); live = null;
}

/** Start the background ambience (it waits for the first tap or click, as browsers require). */
export function startAmbience() {
  wanted = true;
  begin();   // if sound isn't allowed yet, it starts when hubSound.js resumes the context on the first tap
}
export function stopAmbience() { wanted = false; end(); }

if (typeof window !== "undefined") {
  // the sound switch in Settings turns it off and on with everything else
  window.addEventListener("audio-changed", () => { if (!hubSoundOn()) end(); else begin(); });
}
