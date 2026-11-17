import { useEffect, useRef } from "react";

/** The picture for a project that has no screenshot yet: a small contour survey, drawn from the project's id so each
 *  one is different and always the same. Give a project an `img` in data.ts to show real artwork instead. */
export default function Plate({ seed }: { seed: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current, g = cv?.getContext("2d");
    if (!cv || !g) return;
    const W = cv.width, H = cv.height;
    let s = 0;
    for (const ch of seed) s = (s * 31 + ch.charCodeAt(0)) >>> 0;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);

    g.fillStyle = "#14181d"; g.fillRect(0, 0, W, H);
    // two hills; each contour is a ring around one of them, wobbling with a few seeded waves
    const hills = [0, 1].map(() => ({
      x: W * (0.2 + rnd() * 0.6), y: H * (0.25 + rnd() * 0.5),
      waves: [0, 1, 2].map((k) => ({ n: 2 + k + Math.floor(rnd() * 2), a: 0.05 + rnd() * 0.09, p: rnd() * 6.283 })),
      squash: 0.55 + rnd() * 0.35, turn: rnd() * 3.14,
    }));
    hills.forEach((hill, hi) => {
      const rings = hi === 0 ? 11 : 6;
      for (let i = 1; i <= rings; i++) {
        const base = i * (hi === 0 ? 34 : 26);
        g.beginPath();
        for (let t = 0; t <= 96; t++) {
          const a = (t / 96) * 6.283;
          const r = base * (1 + hill.waves.reduce((m, w) => m + w.a * Math.sin(a * w.n + w.p + i * 0.18), 0));
          const px = Math.cos(a) * r, py = Math.sin(a) * r * hill.squash;
          const x = hill.x + px * Math.cos(hill.turn) - py * Math.sin(hill.turn);
          const y = hill.y + px * Math.sin(hill.turn) + py * Math.cos(hill.turn);
          if (t) g.lineTo(x, y); else g.moveTo(x, y);
        }
        g.strokeStyle = `rgba(236,231,220,${i % 4 === 0 ? 0.5 : 0.2})`;
        g.lineWidth = i % 4 === 0 ? 1.6 : 1;
        g.stroke();
      }
    });
    // the survey mark on the first summit
    const { x, y } = hills[0];
    g.strokeStyle = "#f2542d"; g.lineWidth = 2;
    g.beginPath(); g.moveTo(x - 12, y); g.lineTo(x + 12, y); g.moveTo(x, y - 12); g.lineTo(x, y + 12); g.stroke();
    g.fillStyle = "#f2542d"; g.beginPath(); g.arc(x, y, 4, 0, 6.283); g.fill();
  }, [seed]);
  return <canvas ref={ref} width={800} height={420} aria-hidden="true" />;
}
