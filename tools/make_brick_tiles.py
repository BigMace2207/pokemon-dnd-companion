"""Generates css/lava-bricks.css: seamless cel-shaded stone-brick tiles for the Lava Tower theme.

These are used by the flat parts of the theme (the menu slab and the no-WebGL fallback wall); the
rotating WebGL tower paints its own bricks in js/lavaTower.js in the same style. Each brick is made of
flat bands of tone (no gradients): a base colour, a lit top/left bevel, a shaded bottom/right bevel, flat
mottled patches, a few hatch strokes, and a hard ink outline. Tiles are inline SVGs (data: URIs, which
the site's CSP allows), so the theme ships no image files. Re-run to change the look:

    python tools/make_brick_tiles.py
"""
import random
import urllib.parse
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "css" / "lava-bricks.css"
INK = "#0d0807"
TONES = [(140, 122, 104), (126, 108, 92), (150, 130, 108), (134, 112, 90), (144, 131, 114), (121, 104, 90), (136, 117, 96)]


def rgb(c):
    return "rgb(%d,%d,%d)" % tuple(max(0, min(255, int(v))) for v in c)


def tone(c, d):
    return (c[0] + d, c[1] + d, c[2] + d * 0.8)


def widths(rnd, total, avg):
    n = max(2, round(total / avg))
    ws = [avg * rnd.uniform(0.75, 1.25) for _ in range(n)]
    k = total / sum(ws)
    return [w * k for w in ws]


def poly(points, fill, extra=""):
    return '<polygon points="%s" fill="%s"%s/>' % (" ".join("%.1f,%.1f" % p for p in points), fill, extra)


def brick(rnd, x, y, w, h, scale, dim, calm=False):
    base = tuple(v * dim for v in rnd.choice(TONES))
    la, da = (11, -17) if calm else (26, -34)   # calm bricks have gentler bevels, so text over them stays readable
    light, mid_light = tone(base, la), tone(base, la * 0.55)
    dark, deep = tone(base, da), tone(base, da * 1.7)
    out = []
    j = [rnd.uniform(0, 3) * scale for _ in range(8)]
    quad = [(x + j[0], y + j[1]), (x + w - j[2], y + j[3]), (x + w - j[4], y + h - j[5]), (x + j[6], y + h - j[7])]
    cid = "c%d" % rnd.randrange(10 ** 9)
    out.append('<clipPath id="%s">%s</clipPath>' % (cid, poly(quad, "#000")))
    out.append(poly(quad, rgb(base)))
    inner = []
    for _ in range(0 if calm else rnd.randint(2, 4)):  # flat mottled patches, one step lighter or darker
        cx, cy = x + rnd.random() * w, y + rnd.random() * h
        rx, ry = w * rnd.uniform(0.1, 0.28), h * rnd.uniform(0.15, 0.4)
        pts = []
        for i in range(7):
            a = i / 7 * 6.2832
            kk = rnd.uniform(0.65, 1.15)
            pts.append((cx + rx * kk * __import__("math").cos(a), cy + ry * kk * __import__("math").sin(a)))
        inner.append(poly(pts, rgb(tone(base, rnd.choice([12, 18, -14, -20])))))
    t, side = h * 0.17, w * 0.075
    inner.append(poly([(x, y), (x + w, y), (x + w - t, y + t), (x + side, y + t), (x, y + h * 0.3)], rgb(light)))
    inner.append(poly([(x, y + h * 0.3), (x + side, y + t), (x + side, y + h * 0.8), (x, y + h)], rgb(mid_light)))
    inner.append(poly([(x, y + h), (x + h * 0.22, y + h * 0.78), (x + w - side, y + h * 0.78), (x + w, y + h * 0.62), (x + w, y + h)], rgb(dark)))
    inner.append(poly([(x + w, y + t), (x + w, y + h), (x + w - side, y + h * 0.78), (x + w - side, y + t * 1.6)], rgb(dark)))
    inner.append(poly([(x + w, y + h * 0.7), (x + w, y + h), (x + w * 0.82, y + h), (x + w - side, y + h * 0.88)], rgb(deep)))
    for _ in range(0 if calm else rnd.randint(3, 5)):  # hatching in the shadow
        hx, hy, ln = x + w * rnd.uniform(0.5, 0.95), y + h * rnd.uniform(0.55, 0.95), h * rnd.uniform(0.1, 0.22)
        inner.append('<line x1="%.1f" y1="%.1f" x2="%.1f" y2="%.1f" stroke="%s" stroke-opacity=".45" stroke-width="%.1f" stroke-linecap="round"/>' % (hx, hy, hx - ln * 0.8, hy + ln, INK, 1.6 * scale))
    if not calm and rnd.random() < 0.45:  # chipped corner
        cw, ch = w * rnd.uniform(0.05, 0.12), h * rnd.uniform(0.2, 0.5)
        right, bottom = rnd.random() < 0.5, rnd.random() < 0.5
        cx = x + w - cw if right else x
        cy = y + h - ch if bottom else y
        inner.append(poly([(cx, cy), (cx + cw, cy), (cx if right else cx + cw, cy + ch)], "#1b1411"))
    if not calm and rnd.random() < 0.3:  # hairline crack
        hx, hy = x + w * rnd.uniform(0.2, 0.8), y
        pts = [(hx, hy)]
        while hy < y + h * 0.95:
            hy += rnd.uniform(4, 10) * scale
            hx += rnd.uniform(-5, 5) * scale
            pts.append((hx, hy))
        inner.append('<polyline points="%s" fill="none" stroke="%s" stroke-width="%.1f"/>' % (" ".join("%.1f,%.1f" % p for p in pts), INK, 1.8 * scale))
    if not calm:
        inner.append('<rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" fill="#fff4e1" fill-opacity=".4"/>' % (x + w * 0.1, y + h * 0.055, w * 0.2, h * 0.04))
    out.append('<g clip-path="url(#%s)">%s</g>' % (cid, "".join(inner)))
    out.append(poly(quad, "none", ' stroke="%s" stroke-width="%.1f" stroke-linejoin="round"' % (INK, 3.2 * scale)))
    return "".join(out)


def tile(w, h, rows, avg_w, seed, dim=1.0, scale=1.0, calm=False):
    rnd = random.Random(seed)
    bh = h / rows
    gap = max(3, round(bh * 0.07))
    p = ['<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 %d %d">' % (w, h, w, h), '<rect width="%d" height="%d" fill="#1b1411"/>' % (w, h)]
    for r in range(rows):
        ws = widths(rnd, w, avg_w)
        x = -ws[0] * rnd.uniform(0, 0.9)
        ws.append(ws[0])
        y = r * bh
        for bw in ws:
            for dx in (0, w, -w):  # draw wrapped copies so the tile repeats seamlessly
                if x + dx > w or x + dx + bw < 0:
                    continue
                p.append(brick(random.Random(rnd.random() if dx == 0 else seed + int(x * 7) + r), x + dx + gap / 2, y + gap / 2, bw - gap, bh - gap, scale, dim, calm))
            x += bw
    p.append("</svg>")
    return "".join(p)


def uri(svg):
    q = urllib.parse.quote(svg, safe="/:=,;()' %")
    return "url(\"data:image/svg+xml," + q.replace('"', "%22").replace("#", "%23") + "\")"


wall = tile(600, 248, 4, 150, 21, dim=0.78)
slab = tile(480, 192, 3, 120, 77, dim=0.62, scale=1.0, calm=True)   # the menu's wall: dark and quiet
OUT.write_text(
    "/* Generated by tools/make_brick_tiles.py -- do not edit by hand. */\n"
    ":root[data-theme=\"lava\"] {\n"
    f"  --brick-wall: {uri(wall)};\n"
    f"  --brick-slab: {uri(slab)};\n"
    "}\n",
    encoding="utf-8",
)
print("wrote", OUT, OUT.stat().st_size, "bytes")
