// Pages, widget sizes and where things snap on a D&D hub. Plain functions, so they can be tested in Node
// (tests/js/paper.test.mjs). Everything is in board units (the hub's world coordinates), so it is the same at any zoom.
//
//   widget sizes  1x1 (one square), 1x2 (two wide, one tall) and 2x2, like Apple's small, medium and large widgets
//   a page        A4 in proportion, with a header, ruled lines and a grid of cells for widgets
//   snapping      widgets and places drop into the page's grid; typed text drops onto its lines and wraps round what is there
//   no overlap    a widget dropped on another settles next to it instead (resolveOverlap)
//   saving        a page and what is on it packs into plain data and back (packPage, unpackPage)

export const UNIT = 160, GAP = 12;                      // a 1x1 widget is 160 square; neighbours sit 12 apart
export const SIZES = { "1x1": [1, 1], "1x2": [2, 1], "2x2": [2, 2] };   // [columns, rows]
export const SIZE_NAMES = Object.keys(SIZES);
export const PAGE_W = 900, PAGE_H = 1273;               // the server holds the same two numbers (HUB_PAGE_W, HUB_PAGE_H)
export const PAGE = { marginX: 64, headH: 120, lineH: 36 };

/** A widget size in board units: [width, height]. */
export function sizePx(size) {
  const [c, r] = SIZES[size] || SIZES["1x1"];
  return [c * UNIT + (c - 1) * GAP, r * UNIT + (r - 1) * GAP];
}

/** The size nearest to a width and height the pointer has dragged out (the corner snaps to one of the three). */
export function nearestSize(w, h) {
  let best = "1x1", bestD = Infinity;
  for (const name of SIZE_NAMES) {
    const [sw, sh] = sizePx(name);
    const d = Math.hypot(w - sw, h - sh);
    if (d < bestD) { bestD = d; best = name; }
  }
  return best;
}

/** The topmost page (the last in the list) holding a board point, or null. */
export function pageAt(pages, x, y) {
  let hit = null;
  for (const pg of pages) if (x >= pg.x && x <= pg.x + PAGE_W && y >= pg.y && y <= pg.y + PAGE_H) hit = pg;
  return hit;
}

export const GRID = { cols: 4, rows: 6 };   // what fits on a page: four columns of six rows of 1x1 widgets
const CELL = UNIT + GAP;

/** Where a widget, place or card dropped at (x, y) on a page lands: the corner of the grid cell nearest it, kept on the page. */
export function snapToCell(page, x, y) {
  const ox = page.x + PAGE.marginX, oy = page.y + PAGE.headH;
  const c = Math.max(0, Math.min(GRID.cols - 1, Math.round((x - ox) / CELL)));
  const r = Math.max(0, Math.min(GRID.rows - 1, Math.round((y - oy) / CELL)));
  return { x: ox + c * CELL, y: oy + r * CELL, col: c, row: r };
}
/** The corner of a grid cell on a page. */
export function cellXY(page, col, row) {
  return { x: page.x + PAGE.marginX + col * CELL, y: page.y + PAGE.headH + row * CELL };
}

/** The pages the Widgets pull-out starts from: a title and the widgets that arrive on it, in grid cells (a 1x2 takes two columns). */
export const PAGE_TEMPLATES = {
  blank: { title: "Blank page", blurb: "Ruled lines to write on, draw on and pin widgets to.", widgets: [] },
  battle: { title: "Battle tracker", blurb: "Whose turn it is, the initiative order, your character and the latest from the fight.", widgets: [
    { widget: "turn", size: "1x2", col: 0, row: 0 }, { widget: "mine", size: "1x2", col: 2, row: 0 },
    { widget: "order", size: "2x2", col: 0, row: 1 }, { widget: "battles", size: "2x2", col: 2, row: 1 }] },
  sheet: { title: "Character sheet", blurb: "Your health, your fight, your purse and a die to roll.", widgets: [
    { widget: "vitals", size: "1x2", col: 0, row: 0 }, { widget: "purse", size: "1x1", col: 2, row: 0 }, { widget: "dice", size: "1x1", col: 3, row: 0 },
    { widget: "mine", size: "1x2", col: 0, row: 1 }, { widget: "here", size: "1x1", col: 2, row: 1 }, { widget: "clock", size: "1x1", col: 3, row: 1 }] },
  log: { title: "Area log", blurb: "Where everyone is, recent battles and the time, with room to write below.", widgets: [
    { widget: "positions", size: "2x2", col: 0, row: 0 }, { widget: "battles", size: "2x2", col: 2, row: 0 },
    { widget: "here", size: "1x1", col: 0, row: 2 }, { widget: "clock", size: "1x1", col: 1, row: 2 }, { widget: "online", size: "1x1", col: 2, row: 2 }] },
};

/** The same four pages for a Pokemon campaign: its own widgets (the team, trainers' teams, money, the battle). */
export const POKEMON_PAGE_TEMPLATES = {
  blank: PAGE_TEMPLATES.blank,
  battle: { title: "Battle tracker", blurb: "Whether a battle is on and whose turn it is, your team and the latest from the fight.", widgets: [
    { widget: "battle", size: "2x2", col: 0, row: 0 }, { widget: "team", size: "2x2", col: 2, row: 0 }, { widget: "battles", size: "2x2", col: 0, row: 2 }] },
  sheet: { title: "Trainer sheet", blurb: "Your team, your money, where you are and who is here.", widgets: [
    { widget: "team", size: "2x2", col: 0, row: 0 }, { widget: "money", size: "1x1", col: 2, row: 0 }, { widget: "clock", size: "1x1", col: 3, row: 0 },
    { widget: "here", size: "1x1", col: 2, row: 1 }, { widget: "online", size: "1x1", col: 3, row: 1 }] },
  log: { title: "Area log", blurb: "Where everyone is, recent battles and the time, with room to write below.", widgets: [
    { widget: "positions", size: "2x2", col: 0, row: 0 }, { widget: "battles", size: "2x2", col: 2, row: 0 },
    { widget: "here", size: "1x1", col: 0, row: 2 }, { widget: "clock", size: "1x1", col: 1, row: 2 }, { widget: "online", size: "1x1", col: 2, row: 2 }] },
};
export const pageTemplates = (system) => (system === "pokemon" ? POKEMON_PAGE_TEMPLATES : PAGE_TEMPLATES);

export const TEXT_SIZE_ON_PAGE = 24;
const OB_PAD = 8, MIN_RUN = 140;   // a gap narrower than this beside a widget is left empty

/** The text presets (the Text tool's pills): a size each. How each looks is css: .hub-text[data-style]. The server holds the same names. */
export const TEXT_STYLES = {
  title: { label: "Title", size: 44 },
  heading: { label: "Heading", size: 32 },
  body: { label: "Body", size: 24 },
  mysterious: { label: "Mysterious", size: 28 },
  quote: { label: "Quote", size: 26 },
};
export const DEFAULT_TEXT_STYLE = "body";
const boxH = (size) => Math.round(size * 1.05);   // a line of text is this tall
/** How far a text box's top sits above the ruled line it rests on, so the writing sits just above the line. */
export const textDy = (size = TEXT_SIZE_ON_PAGE) => boxH(size) + 2;
/** How many ruled lines a row of text this big takes (a Title takes two). */
export const linesFor = (size = TEXT_SIZE_ON_PAGE) => Math.max(1, Math.ceil(textDy(size) / PAGE.lineH));

/** Where typed text clicked at (x, y) on a page lands: its first letter on the left margin, resting on the nearest ruled line it fits. */
export function snapToLine(page, x, y, size = TEXT_SIZE_ON_PAGE) {
  const first = PAGE.headH + PAGE.lineH;                      // the first ruled line, down from the page's top
  const last = Math.floor((PAGE_H - first - 20) / PAGE.lineH);
  const n = Math.max(linesFor(size) - 1, Math.min(last, Math.round((y - page.y - first) / PAGE.lineH)));
  const lineY = page.y + first + n * PAGE.lineH;
  return { x: page.x + PAGE.marginX + 8, y: lineY - textDy(size), line: n + 1, size };
}

/** Text moved on a page snaps to a grid: the margin, then a column every line-height to the right, so indents line up. */
export function snapTextX(page, x) {
  const left = page.x + PAGE.marginX + 8, step = PAGE.lineH;
  const max = Math.floor((PAGE_W - 40 - PAGE.marginX - 8 - 240) / step);   // (room is left for words before the right margin)
  return left + Math.max(0, Math.min(max, Math.round((x - left) / step))) * step;
}

/**
 * Lay text out on a page's ruled lines, the first row resting on line `line` (0 is the first): words fill each row left to right, skip over
 * anything standing on it (widgets, cards, earlier writing: `obstacles` are {x, y, w, h} in board units), and carry on at the
 * next line when they reach the page's edge. `width(str)` measures a string. Returns the runs to write, each a piece of one
 * line at its own x, and whether the page ran out of lines before the text ran out.
 */
export function flowText(text, page, line, obstacles, width, { size = TEXT_SIZE_ON_PAGE, startX = null } = {}) {
  const left = page.x + PAGE.marginX + 8, right = page.x + PAGE_W - 40, first = PAGE.headH + PAGE.lineH;
  const lastLine = Math.max(0, Math.floor((PAGE_H - first - 20) / PAGE.lineH));
  const step = linesFor(size), h = boxH(size), dy = textDy(size);   // (a big preset takes more than one ruled line a row)
  const words = String(text).split(/\s+/).filter(Boolean);
  const pieces = [];
  let i = 0;
  for (let n = Math.max(step - 1, line), row = 0; n <= lastLine && i < words.length; n += step, row++) {
    const top = page.y + first + n * PAGE.lineH - dy, bottom = top + h;
    let segs = [[row === 0 && startX != null ? Math.max(left, startX) : left, right]];
    for (const o of obstacles) {
      if (o.y >= bottom || o.y + o.h <= top) continue;
      const a = o.x - OB_PAD, b = o.x + o.w + OB_PAD;
      segs = segs.flatMap(([s, e]) => (b <= s || a >= e ? [[s, e]] : [[s, Math.min(e, a)], [Math.max(s, b), e]])).filter(([s, e]) => e - s >= MIN_RUN);
    }
    for (const [s, e] of segs) {
      let run = "";
      while (i < words.length) {
        const cand = run ? `${run} ${words[i]}` : words[i];
        if (width(cand) <= e - s) { run = cand; i++; continue; }
        if (!run && width(words[i]) > right - left) {   // a word wider than the page: break it
          let k = words[i].length - 1;
          while (k > 1 && width(words[i].slice(0, k)) > e - s) k--;
          run = words[i].slice(0, k); words[i] = words[i].slice(k);
        }
        break;
      }
      if (run) pieces.push({ x: Math.round(s), y: Math.round(top), text: run, line: n + 1 });
      if (i >= words.length) break;
    }
  }
  return { pieces, full: i < words.length };
}

// ---- widgets never cover each other ---------------------------------------------------------------------------------
const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/**
 * Where a rectangle {x, y, w, h} should sit so it covers none of `others` ({x, y, w, h}). If it already doesn't, it stays.
 * Otherwise it settles beside whatever it overlapped (right, left, below or above, `gap` apart, lined up with it or where it
 * was), the nearest free spot. `snap({x, y})` can pull a candidate onto a grid (the cells of a page). Returns {x, y}.
 */
export function resolveOverlap(rect, others, gap = GAP, snap = null) {
  const clash = (r) => others.some((o) => overlaps(r, o));
  if (!clash(rect)) return { x: rect.x, y: rect.y };
  const cands = [];
  for (const o of others) {
    cands.push(
      { x: o.x + o.w + gap, y: rect.y }, { x: o.x - rect.w - gap, y: rect.y }, { x: rect.x, y: o.y + o.h + gap }, { x: rect.x, y: o.y - rect.h - gap },
      { x: o.x + o.w + gap, y: o.y }, { x: o.x - rect.w - gap, y: o.y }, { x: o.x, y: o.y + o.h + gap }, { x: o.x, y: o.y - rect.h - gap },
    );
  }
  const free = cands.map((c) => (snap ? snap(c) : c)).filter((c) => !clash({ ...rect, x: c.x, y: c.y }))
    .sort((a, b) => Math.hypot(a.x - rect.x, a.y - rect.y) - Math.hypot(b.x - rect.x, b.y - rect.y));
  if (free.length) return { x: Math.round(free[0].x), y: Math.round(free[0].y) };
  let r = { ...rect };   // boxed in on every side: walk right past everything in the way
  for (let i = 0; i < 40 && clash(r); i++) {
    const hit = others.filter((o) => overlaps(r, o));
    r = { ...r, x: Math.max(...hit.map((o) => o.x + o.w)) + gap };
  }
  return { x: Math.round(r.x), y: Math.round(r.y) };
}

// ---- saved pages ----------------------------------------------------------------------------------------------------
const DROP_KEYS = new Set(["id", "owner", "byName", "page", "updated"]);
/** A page and what is attached to it, as plain data with positions relative to the page's corner. */
export function packPage(page, attached) {
  const items = attached.map((it) => {
    const out = {};
    for (const [k, v] of Object.entries(it)) if (!DROP_KEYS.has(k)) out[k] = v;
    if (Number.isFinite(it.x)) out.x = it.x - page.x;
    if (Number.isFinite(it.y)) out.y = it.y - page.y;
    if (it.type === "stroke") out.pts = (it.pts || []).map(([px, py]) => [px - page.x, py - page.y]);
    if (it.type === "shape") { out.x2 = it.x2 - page.x; out.y2 = it.y2 - page.y; }
    return out;
  });
  return { title: page.title, pageKind: page.pageKind || "blank", items };
}
/** A saved page set down with its corner at `at`: the page and its items with fresh ids and board positions. */
export function unpackPage(saved, at, newId) {
  const page = { type: "page", id: newId(), x: Math.round(at.x), y: Math.round(at.y), title: saved.title, pageKind: saved.pageKind || "blank" };
  const items = (saved.items || []).map((it) => {
    const out = { ...it, id: newId() };
    if (Number.isFinite(it.x)) out.x = Math.round(it.x + at.x);
    if (Number.isFinite(it.y)) out.y = Math.round(it.y + at.y);
    if (it.type === "stroke") out.pts = (it.pts || []).map(([px, py]) => [Math.round(px + at.x), Math.round(py + at.y)]);
    if (it.type === "shape") { out.x2 = Math.round(it.x2 + at.x); out.y2 = Math.round(it.y2 + at.y); }
    return out;
  });
  return { page, items };
}
