import { useEffect, useRef } from "react";

/** A generated cover for a project that has no image yet: orbits, a grid and the project's initials, seeded by its id.
 *  Give a project an `img` in data.ts to show real artwork instead. */
export default function SignalArt({ seed, title, color }: { seed: string; title: string; color: [number, number, number] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current, g = cv?.getContext("2d");
    if (!cv || !g) return;
    const W = cv.width, H = cv.height;
    let s = 0;
    for (const ch of seed) s = (s * 31 + ch.charCodeAt(0)) >>> 0;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    const rgb = (a: number) => `rgba(${color.map((c) => Math.round(c * 255)).join(",")},${a})`;

    g.fillStyle = "#050814"; g.fillRect(0, 0, W, H);
    const cx = W * (0.3 + rnd() * 0.4), cy = H * (0.35 + rnd() * 0.3);
    const glow = g.createRadialGradient(cx, cy, 0, cx, cy, W * 0.6);
    glow.addColorStop(0, rgb(0.42)); glow.addColorStop(0.5, rgb(0.08)); glow.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = glow; g.fillRect(0, 0, W, H);

    g.strokeStyle = "rgba(255,255,255,.05)"; g.lineWidth = 1;
    for (let x = 0; x <= W; x += 40) { g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, H); g.stroke(); }
    for (let y = 0; y <= H; y += 40) { g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(W, y + 0.5); g.stroke(); }

    const tilt = rnd() * 0.9 - 0.45;
    for (let i = 0; i < 5; i++) {
      const r = 50 + i * (34 + rnd() * 16), a0 = rnd() * Math.PI * 2, a1 = a0 + Math.PI * (0.5 + rnd() * 1.4);
      g.strokeStyle = rgb(0.75 - i * 0.12); g.lineWidth = i === 0 ? 2 : 1.25;
      g.beginPath(); g.ellipse(cx, cy, r, r * 0.42, tilt, a0, a1); g.stroke();
      const px = cx + Math.cos(a1) * r * Math.cos(tilt) - Math.sin(a1) * r * 0.42 * Math.sin(tilt);
      const py = cy + Math.cos(a1) * r * Math.sin(tilt) + Math.sin(a1) * r * 0.42 * Math.cos(tilt);
      g.fillStyle = "#fff"; g.beginPath(); g.arc(px, py, 3, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = rgb(1); g.beginPath(); g.arc(cx, cy, 15, 0, Math.PI * 2); g.fill();

    const initials = title.split(/[\s&·-]+/).filter(Boolean).slice(0, 3).map((w) => w[0]).join("").toUpperCase();
    g.font = "600 150px 'Space Grotesk', system-ui, sans-serif"; g.textBaseline = "alphabetic";
    g.fillStyle = "rgba(255,255,255,.07)"; g.fillText(initials, W - g.measureText(initials).width - 28, H - 26);
  }, [seed, title, color]);
  return <canvas ref={ref} width={800} height={450} aria-hidden="true" />;
}
