"""
Turn a Pokémon picture (a PNG with a transparent background) into constellation line art like
sprites/sky/rayquaza-lines.png: thin pale-blue/white strokes on transparency, the silhouette's outline plus the main
inner lines, traced at 3x so it stays crisp drawn large (the art is placed at 2x units in js/constellation.js).

    python tools/make_constellation_lines.py <picture.png> sprites/sky/<name>-lines.png [inner-line threshold, default 60]

The art is traced from the picture you give it; it's drawn in the sky at low opacity, with gold stars on top
(js/constellation.js).
"""
import sys
from PIL import Image, ImageChops, ImageFilter


def trace(src, dst, scale=2, inner=60):
    im = Image.open(src).convert("RGBA")
    im = im.resize((im.width * scale, im.height * scale), Image.LANCZOS)
    alpha = im.getchannel("A").point(lambda a: 255 if a > 100 else 0)
    # the silhouette's edge: the shape minus itself shrunk by a pixel or two
    outline = ImageChops.subtract(alpha, alpha.filter(ImageFilter.MinFilter(2 * scale + 1)))
    # the inner lines: where the colours change sharply inside the shape (the picture's own ink lines and folds)
    grey = im.convert("L").filter(ImageFilter.GaussianBlur(1.2))
    edges = grey.filter(ImageFilter.FIND_EDGES).point(lambda v: 255 if v > inner else 0)
    edges = ImageChops.multiply(edges, alpha.filter(ImageFilter.MinFilter(7)))
    lines = ImageChops.lighter(outline, edges).filter(ImageFilter.GaussianBlur(0.6))
    lines = lines.point(lambda v: min(255, int(v * 1.6)))
    out = Image.new("RGBA", im.size, (0, 0, 0, 0))
    ink = Image.new("RGBA", im.size, (214, 226, 255, 255))
    out.paste(ink, (0, 0), lines)
    # pad, so the glow and stars have room round the figure
    pad = 12 * scale   # the same margin at every scale, so star positions in js/constellation.js stay put
    framed = Image.new("RGBA", (out.width + pad * 2, out.height + pad * 2), (0, 0, 0, 0))
    framed.paste(out, (pad, pad))
    framed.save(dst, optimize=True)
    print(f"{dst}: {framed.width}x{framed.height}")


if __name__ == "__main__":
    if len(sys.argv) not in (3, 4):
        sys.exit(__doc__)
    trace(sys.argv[1], sys.argv[2], scale=3, inner=int(sys.argv[3]) if len(sys.argv) == 4 else 60)   # lower = more inner lines
