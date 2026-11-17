import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import Scene, { type Frame, type Mode } from "./Scene";
import { COUNTRIES, N, STEP, css, mod, type Project } from "./data";
import SignalArt from "./SignalArt";
import { MagneticButton } from "./amicro/magnetic-button";
import { WordReveal } from "./amicro/word-reveal";
import { TextReveal } from "./amicro/text-reveal";
import { ConcentricPulse } from "./amicro/concentric-pulse";
import ContactSheet from "./Contact";
import Player from "./Player";
import { sfx } from "./sfx";

const pad = (n: number) => String(n).padStart(2, "0");
/** a hand-drawn-looking arrow, one stroke weight everywhere */
const Arrow = ({ back }: { back?: boolean }) => (
  <svg className="pf-arrow" viewBox="0 0 26 16" width="26" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    style={back ? { transform: "scaleX(-1)" } : undefined}><path d="M2 9.5C8 6.5 15 8.5 23 8M18 3.5l5.5 4.5-5 4.5" /></svg>
);
const EASE_OUT = [0.23, 1, 0.32, 1] as const;

export default function App() {
  const [pos, setPos] = useState(0);            // which region is selected; unbounded, so the planet can keep turning
  const [mode, setMode] = useState<Mode>("browse");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pulseKey, setPulseKey] = useState(0);
  const [spinKey, setSpinKey] = useState(0);
  const reduced = !!useReducedMotion();
  // the opening animation: the planet turns once and each region rises. Not for reduced motion; any click, key or scroll skips it.
  const [introOn, setIntroOn] = useState(() => !matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [introSkip, setIntroSkip] = useState(0);
  const [contactOpen, setContactOpen] = useState(false);
  const [muted, setMuted] = useState(sfx.muted);
  const workBtn = useRef<HTMLButtonElement>(null);

  const index = mod(pos, N), country = COUNTRIES[index];
  const active = country.projects.find((p) => p.id === activeId) ?? null;

  const drag = useRef({ offset: 0 }).current;
  const frame = useRef<Frame | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const label = useRef<HTMLButtonElement>(null);
  const line = useRef<SVGLineElement>(null);
  const pin = useRef<SVGGElement>(null);
  const dots = useRef<(HTMLButtonElement | null)[]>([]);

  const land = useCallback(() => { drag.offset = 0; sfx.land(); setMode("focus"); }, [drag]);
  const orbit = useCallback(() => { setActiveId(null); setMode("browse"); }, []);
  const open = useCallback((p: Project, k: number) => { setActiveId(p.id); setPulseKey((n) => n + 1); sfx.ping(k); }, []);
  const closeContact = useCallback(() => { setContactOpen(false); workBtn.current?.focus({ preventScroll: true }); }, []);
  const endIntro = useCallback(() => setIntroOn(false), []);
  /** A region in the list: go to it by the short way round, or, if it is already the one selected, flick the planet. */
  const pick = useCallback((k: number) => {
    if (k === mod(pos, N)) { setSpinKey((n) => n + 1); return; }
    const half = Math.floor(N / 2);
    setPos((p) => p + (((k - mod(p, N) + N + half) % N) - half));
  }, [pos]);

  // The scene reports where things are on screen each frame; the label, tether and markers follow without a re-render.
  const onFrame = useCallback((f: Frame) => {
    const el = label.current, host = root.current;
    if (!frame.current) host?.setAttribute("data-ready", "");
    if (host && host.hasAttribute("data-away") === f.aOn) host.toggleAttribute("data-away", !f.aOn);
    frame.current = f;
    if (el && line.current && pin.current) {
      const lw = el.offsetWidth, lh = el.offsetHeight, narrow = f.w < 700;
      const lx = narrow ? Math.max(16, Math.min(f.ax + 28, f.w - lw - 16)) : Math.min(f.cx + f.r * 0.86 + 40, f.w - lw - 20);
      const ly = Math.max(narrow ? 64 : 76, narrow ? f.cy - f.r - lh - 34 : f.cy - f.r * 0.98 - lh * 0.55);
      el.style.transform = `translate3d(${lx.toFixed(1)}px, ${ly.toFixed(1)}px, 0)`;
      line.current.setAttribute("x1", f.ax.toFixed(1)); line.current.setAttribute("y1", f.ay.toFixed(1));
      line.current.setAttribute("x2", lx.toFixed(1)); line.current.setAttribute("y2", (ly + lh - 0.5).toFixed(1));
      pin.current.setAttribute("transform", `translate(${f.ax.toFixed(1)} ${f.ay.toFixed(1)})`);
    }
    f.dots.forEach((d, k) => {
      const b = dots.current[k];
      if (!b) return;
      b.style.transform = `translate3d(${d.x.toFixed(1)}px, ${d.y.toFixed(1)}px, 0)`;
      b.style.visibility = d.on ? "visible" : "hidden";
    });
  }, []);

  useEffect(() => {
    if (!introOn) return;
    const skip = () => setIntroSkip((n) => n + 1);
    const evs = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
    evs.forEach((e) => window.addEventListener(e, skip, { once: true, passive: true }));
    return () => evs.forEach((e) => window.removeEventListener(e, skip));
  }, [introOn]);

  // Scroll: one region per notch (or per trackpad flick), with a short lock so inertia doesn't skip past the next one.
  useEffect(() => {
    let acc = 0, lockedUntil = 0;
    const onWheel = (e: WheelEvent) => {
      if (mode !== "browse" || introOn) return;
      const now = performance.now();
      if (now < lockedUntil) return;
      acc += e.deltaY + e.deltaX;
      if (Math.abs(acc) < 40) return;
      setPos((p) => p + Math.sign(acc));
      acc = 0; lockedUntil = now + 320;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { if (contactOpen) closeContact(); else if (activeId) setActiveId(null); else if (mode === "focus") orbit(); return; }
      if (mode !== "browse" || introOn || contactOpen || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === "ArrowDown" || e.key === "ArrowRight") { e.preventDefault(); setPos((p) => p + 1); }
      if (e.key === "ArrowUp" || e.key === "ArrowLeft") { e.preventDefault(); setPos((p) => p - 1); }
    };
    window.addEventListener("wheel", onWheel, { passive: true });
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("wheel", onWheel); window.removeEventListener("keydown", onKey); };
  }, [mode, activeId, orbit, introOn, contactOpen, closeContact]);

  // Drag (or swipe) turns the planet under the finger, then it settles on the nearest region. A tap on it lands.
  const press = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (mode !== "browse" || introOn || press.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    press.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const p = press.current, f = frame.current;
    if (!p || p.id !== e.pointerId || !f) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    if (!p.moved && Math.hypot(dx, dy) < 8) return;
    p.moved = true;
    drag.offset = -(dx + dy * 0.6) / (f.r * STEP) || 1e-6;
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const p = press.current, f = frame.current;
    if (!p || p.id !== e.pointerId) return;
    press.current = null;
    if (p.moved) { const n = Math.round(drag.offset); drag.offset = 0; if (n) setPos((v) => v + n); return; }
    if (f && e.type === "pointerup" && Math.hypot(e.clientX - f.cx, e.clientY - f.cy) < f.r) land();
  };

  const accent = useMemo(() => ({ "--acc": css(country.color), "--acc-soft": css(country.color, 0.16) }) as CSSProperties, [country]);

  return (
    <div className="pf" ref={root} data-mode={mode} data-open={active ? "" : undefined} data-intro={introOn ? "" : undefined} style={accent}>
      <div className="pf-stage" onPointerDown={onPointerDown} onPointerMove={onPointerMove}
        onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
        <Scene pos={pos} mode={mode} drag={drag} activeId={activeId} pulseKey={pulseKey} spinKey={spinKey}
          reduced={reduced} onFrame={onFrame} introSkip={introSkip} onIntroEnd={endIntro} />
      </div>
      <div className="pf-vignette" aria-hidden="true" />

      <header className="pf-top">
        <a className="pf-brand" href="/" aria-label="Back to fluxdev.org"><i className="pf-brand-dot" />Mason<span>Allen</span></a>
        <div className="pf-top-right">
          <p className="pf-count" aria-hidden="true">{pad(index + 1)}<span> / {pad(N)}</span></p>
          <button type="button" className="pf-sound" aria-pressed={!muted} aria-label={muted ? "Turn sound on" : "Turn sound off"}
            onClick={() => { const m = !muted; sfx.setMuted(m); setMuted(m); if (!m) sfx.ping(2); }}>
            <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M2.5 6v4h2.6L8.5 12.75v-9.5L5.1 6H2.5z" />
              {muted ? <path d="m11 6 3 4m0-4-3 4" /> : <path d="M11 5.5a3.5 3.5 0 0 1 0 5M12.8 3.7a6 6 0 0 1 0 8.6" />}
            </svg>
          </button>
          <button ref={workBtn} type="button" className="pf-work" aria-haspopup="dialog" aria-expanded={contactOpen} onClick={() => setContactOpen(true)}>Work with me</button>
        </div>
      </header>

      <nav className="pf-rail" aria-label="Regions">
        {COUNTRIES.map((c, k) => (
          <button key={c.id} type="button" className="pf-rail-item" aria-current={k === index ? "true" : undefined}
            tabIndex={mode === "browse" ? 0 : -1} onClick={() => pick(k)}>
            <i aria-hidden="true" /><span>{c.name}</span>
          </button>
        ))}
      </nav>

      <svg className="pf-tether" aria-hidden="true">
        <line ref={line} />
        <g ref={pin}><circle r="9" className="pf-pin-ring" /><circle r="3.5" className="pf-pin-core" /></g>
      </svg>
      <button ref={label} type="button" className="pf-label" onClick={land} tabIndex={mode === "browse" ? 0 : -1}>
        <span className="pf-label-idx">region {index + 1} of {N}</span>
        <span className="pf-label-name">{country.name}</span>
        <span className="pf-label-meta">{country.blurb}, {country.projects.length} projects</span>
        <span className="pf-label-go">land here <Arrow /></span>
      </button>

      <div className="pf-head" aria-hidden={mode !== "focus"}>
        <MagneticButton className="pf-back" onClick={orbit}><span className="pf-back-in"><Arrow back />back to orbit</span></MagneticButton>
        <h1 className="pf-title">{mode === "focus" && <TextReveal key={country.id} text={country.name} duration={0.5} />}</h1>
        <p className="pf-sub">{country.blurb}, {country.projects.length} projects</p>
      </div>

      <div className="pf-dots">
        {country.projects.map((p, k) => (
          <button key={p.id} type="button" className="pf-dot" data-alt={k % 2 ? "" : undefined} ref={(el) => { dots.current[k] = el; }}
            aria-pressed={p.id === activeId} tabIndex={mode === "focus" ? 0 : -1} onClick={() => open(p, k)}>
            <i className="pf-dot-mark" aria-hidden="true">{p.id === activeId && !reduced && <ConcentricPulse />}</i>
            <span className="pf-dot-name">{p.title}</span>
          </button>
        ))}
      </div>

      <AnimatePresence>
        {contactOpen && (
          <motion.div key="sheet" className="pf-sheet-host" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { duration: 0.2, ease: EASE_OUT } }}
            exit={{ opacity: 0, transition: { duration: 0.12, ease: EASE_OUT } }}>
            <ContactSheet onClose={closeContact} />
          </motion.div>
        )}
      </AnimatePresence>

      <Player accent={css(country.color)} />

      <div className="pf-panel-wrap">
        <AnimatePresence mode="wait">
          {active && (
            <motion.aside key={active.id} className="pf-panel" aria-label="Selected work"
              initial={{ opacity: 0, scale: 0.97, filter: "blur(6px)" }}
              animate={{ opacity: 1, scale: 1, filter: "blur(0px)", transition: { duration: 0.24, ease: EASE_OUT } }}
              exit={{ opacity: 0, scale: 0.985, transition: { duration: 0.12, ease: EASE_OUT } }}>
              <button type="button" className="pf-close" aria-label="Close" onClick={() => setActiveId(null)}>×</button>
              <div className="pf-art">
                {active.img ? <img src={active.img} alt="" /> : <SignalArt seed={active.id} title={active.title} color={country.color} />}
              </div>
              <div className="pf-body">
                <p className="pf-kicker">{active.kicker}<span>{active.year}</span></p>
                <h2 className="pf-name"><TextReveal text={active.title} duration={0.5} /></h2>
                <WordReveal className="pf-desc" text={active.desc} duration={0.3} staggerDelay={0.012} />
                <ul className="pf-chips">{active.tags.map((t) => <li key={t}>{t}</li>)}</ul>
                {active.link && (
                  <a className="pf-visit" href={active.link} target="_blank" rel="noopener noreferrer">Open project <Arrow /></a>
                )}
              </div>
            </motion.aside>
          )}
        </AnimatePresence>
      </div>

      <p className="pf-hint" aria-hidden="true">
        {introOn ? <>click anywhere to skip</> : mode === "browse" ? <>scroll or drag to spin<span>, click the planet to land</span></> : active ? <>esc closes this</> : <>pick a marker</>}
      </p>
      <p className="pf-sr" role="status">
        {mode === "browse" ? `${country.name}, region ${index + 1} of ${N}` : active ? `${active.title}. ${active.desc}` : `${country.name}: choose a project`}
      </p>
    </div>
  );
}
