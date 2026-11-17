import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import Scene, { type Frame, type Mode } from "./Scene";
import { COUNTRIES, N, STEP, mod, type Project } from "./data";
import Plate from "./Plate";
import { MagneticButton } from "./amicro/magnetic-button";
import { WordReveal } from "./amicro/word-reveal";
import { TextReveal } from "./amicro/text-reveal";
import { ConcentricPulse } from "./amicro/concentric-pulse";

const EASE_OUT = [0.23, 1, 0.32, 1] as const;

// One small icon set, drawn here so every arrow shares a stroke.
const PATHS = {
  right: "M3 8h10M9 4l4 4-4 4",
  left: "M13 8H3M7 4 3 8l4 4",
  out: "M5 11 11 5M6 5h5v5",
  close: "M4 4l8 8M12 4l-8 8",
} as const;
const Icon = ({ name }: { name: keyof typeof PATHS }) => (
  <svg className="pf-icon" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={PATHS[name]} /></svg>
);
const count = (n: number) => `${n} ${n === 1 ? "project" : "projects"}`;

export default function App() {
  const [pos, setPos] = useState(0);            // which region is selected; unbounded, so the planet can keep turning
  const [mode, setMode] = useState<Mode>("browse");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pulseKey, setPulseKey] = useState(0);
  const [spinKey, setSpinKey] = useState(0);
  const reduced = !!useReducedMotion();

  const index = mod(pos, N), country = COUNTRIES[index];
  const active = country.projects.find((p) => p.id === activeId) ?? null;

  const drag = useRef({ offset: 0 }).current;
  const frame = useRef<Frame | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const label = useRef<HTMLButtonElement>(null);
  const line = useRef<SVGLineElement>(null);
  const pin = useRef<SVGCircleElement>(null);
  const dots = useRef<(HTMLButtonElement | null)[]>([]);

  const land = useCallback(() => { drag.offset = 0; setMode("focus"); }, [drag]);
  const orbit = useCallback(() => { setActiveId(null); setMode("browse"); }, []);
  const open = useCallback((p: Project) => { setActiveId(p.id); setPulseKey((k) => k + 1); }, []);
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
      const lx = narrow ? Math.max(16, Math.min(f.cx - lw / 2 + 24, f.w - lw - 16)) : Math.min(f.cx + f.r * 0.86 + 40, f.w - lw - 24);
      const ly = Math.max(narrow ? 64 : 76, narrow ? f.cy - f.r - lh - 34 : f.cy - f.r * 0.98 - lh * 0.55);
      el.style.transform = `translate3d(${lx.toFixed(1)}px, ${ly.toFixed(1)}px, 0)`;
      line.current.setAttribute("x1", f.ax.toFixed(1)); line.current.setAttribute("y1", f.ay.toFixed(1));
      line.current.setAttribute("x2", lx.toFixed(1)); line.current.setAttribute("y2", (ly + lh - 0.5).toFixed(1));
      pin.current.setAttribute("cx", f.ax.toFixed(1)); pin.current.setAttribute("cy", f.ay.toFixed(1));
    }
    f.dots.forEach((d, k) => {
      const b = dots.current[k];
      if (!b) return;
      b.style.transform = `translate3d(${d.x.toFixed(1)}px, ${d.y.toFixed(1)}px, 0)`;
      b.style.visibility = d.on ? "visible" : "hidden";
    });
  }, []);

  // Scroll: one region per notch (or per trackpad flick), with a short lock so inertia doesn't skip past the next one.
  useEffect(() => {
    let acc = 0, lockedUntil = 0;
    const onWheel = (e: WheelEvent) => {
      if (mode !== "browse") return;
      const now = performance.now();
      if (now < lockedUntil) return;
      acc += e.deltaY + e.deltaX;
      if (Math.abs(acc) < 40) return;
      setPos((p) => p + Math.sign(acc));
      acc = 0; lockedUntil = now + 320;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { if (activeId) setActiveId(null); else if (mode === "focus") orbit(); return; }
      if (mode !== "browse" || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === "ArrowDown" || e.key === "ArrowRight") { e.preventDefault(); setPos((p) => p + 1); }
      if (e.key === "ArrowUp" || e.key === "ArrowLeft") { e.preventDefault(); setPos((p) => p - 1); }
    };
    window.addEventListener("wheel", onWheel, { passive: true });
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("wheel", onWheel); window.removeEventListener("keydown", onKey); };
  }, [mode, activeId, orbit]);

  // Drag (or swipe) turns the planet under the finger, then it settles on the nearest region. A tap on it lands.
  const press = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (mode !== "browse" || press.current) return;
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

  return (
    <div className="pf" ref={root} data-mode={mode} data-open={active ? "" : undefined}>
      <div className="pf-stage" onPointerDown={onPointerDown} onPointerMove={onPointerMove}
        onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
        <Scene pos={pos} mode={mode} drag={drag} activeId={activeId} pulseKey={pulseKey} spinKey={spinKey}
          reduced={reduced} onFrame={onFrame} />
      </div>

      <header className="pf-top">
        <a className="pf-brand" href="/" aria-label="Mason, back to fluxdev.org">Mason</a>
      </header>

      <nav className="pf-rail" aria-label="Regions">
        {COUNTRIES.map((c, k) => (
          <button key={c.id} type="button" className="pf-rail-item" aria-current={k === index ? "true" : undefined}
            tabIndex={mode === "browse" ? 0 : -1} onClick={() => pick(k)}>
            <i aria-hidden="true" /><span>{c.name}</span>
          </button>
        ))}
      </nav>

      <svg className="pf-tether" aria-hidden="true"><line ref={line} /><circle ref={pin} r="4" /></svg>
      <button ref={label} type="button" className="pf-label" onClick={land} tabIndex={mode === "browse" ? 0 : -1}>
        <span className="pf-label-name">{country.name}</span>
        <span className="pf-label-meta">{country.blurb}, {count(country.projects.length)}</span>
        <span className="pf-label-go">Land here <Icon name="right" /></span>
      </button>

      <div className="pf-head" aria-hidden={mode !== "focus"}>
        <MagneticButton className="pf-back" onClick={orbit}><span className="pf-back-in"><Icon name="left" />Orbit</span></MagneticButton>
        <h1 className="pf-title">{mode === "focus" && <TextReveal key={country.id} text={country.name} duration={0.5} />}</h1>
        <p className="pf-sub">{country.blurb}, {count(country.projects.length)}</p>
      </div>

      <div className="pf-dots">
        {country.projects.map((p, k) => (
          <button key={p.id} type="button" className="pf-dot" data-alt={k % 2 ? "" : undefined} ref={(el) => { dots.current[k] = el; }}
            aria-pressed={p.id === activeId} tabIndex={mode === "focus" ? 0 : -1} onClick={() => open(p)}>
            <i className="pf-dot-mark" aria-hidden="true">{p.id === activeId && !reduced && <ConcentricPulse />}</i>
            <span className="pf-dot-name">{p.title}</span>
          </button>
        ))}
      </div>

      <div className="pf-panel-wrap">
        <AnimatePresence mode="wait">
          {active && (
            <motion.aside key={active.id} className="pf-panel" aria-label="Selected work"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0, transition: { duration: 0.24, ease: EASE_OUT } }}
              exit={{ opacity: 0, transition: { duration: 0.12, ease: EASE_OUT } }}>
              <button type="button" className="pf-close" aria-label="Close" onClick={() => setActiveId(null)}><Icon name="close" /></button>
              <div className="pf-art">{active.img ? <img src={active.img} alt="" /> : <Plate seed={active.id} />}</div>
              <div className="pf-body">
                <h2 className="pf-name"><TextReveal text={active.title} duration={0.5} /></h2>
                <p className="pf-when">{active.kicker}<span>{active.year}</span></p>
                <WordReveal className="pf-desc" text={active.desc} duration={0.3} staggerDelay={0.012} />
                <p className="pf-tags">{active.tags.join(" · ")}</p>
                {active.link && (
                  <a className="pf-visit" href={active.link} target="_blank" rel="noopener noreferrer">Open project <Icon name="out" /></a>
                )}
              </div>
            </motion.aside>
          )}
        </AnimatePresence>
      </div>

      <p className="pf-hint" aria-hidden="true">
        {mode === "browse" ? <>Scroll or drag to turn the planet<span>, click it to land</span></> : active ? "Esc closes this" : "Pick a marker"}
      </p>
      <p className="pf-sr" role="status">
        {mode === "browse" ? `${country.name}, region ${index + 1} of ${N}` : active ? `${active.title}. ${active.desc}` : `${country.name}: choose a project`}
      </p>
    </div>
  );
}
