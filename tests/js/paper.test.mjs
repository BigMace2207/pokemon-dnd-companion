import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { UNIT, GAP, PAGE_W, PAGE_H, PAGE, GRID, SIZE_NAMES, sizePx, nearestSize, pageAt, snapToCell, snapToLine, snapTextX, TEXT_STYLES, textDy, linesFor, cellXY, flowText, PAGE_TEMPLATES, POKEMON_PAGE_TEMPLATES, pageTemplates, resolveOverlap, packPage, unpackPage } from "../../js/hubKits/paper.js";

test("the three widget sizes: one square, two wide, two by two", () => {
  assert.deepEqual(sizePx("1x1"), [UNIT, UNIT]);
  assert.deepEqual(sizePx("1x2"), [2 * UNIT + GAP, UNIT]);
  assert.deepEqual(sizePx("2x2"), [2 * UNIT + GAP, 2 * UNIT + GAP]);
  assert.deepEqual(sizePx("nonsense"), [UNIT, UNIT], "anything else is a square");
});

test("dragging a corner snaps to the nearest of the three sizes", () => {
  assert.equal(nearestSize(170, 150), "1x1");
  assert.equal(nearestSize(230, 170), "1x1", "closer to a square than to the wide one");
  assert.equal(nearestSize(290, 165), "1x2");
  assert.equal(nearestSize(330, 230), "1x2", "wide but not tall enough for 2x2");
  assert.equal(nearestSize(340, 340), "2x2");
  assert.equal(nearestSize(900, 900), "2x2");
  assert.equal(nearestSize(10, 10), "1x1");
});

test("a page is A4 in proportion, and bigger than a few widgets", () => {
  assert.ok(Math.abs(PAGE_H / PAGE_W - 1.414) < 0.01);
  assert.ok(PAGE_W >= 4 * UNIT);
});

test("the topmost page holds a point", () => {
  const pages = [{ id: "a", x: 0, y: 0 }, { id: "b", x: 300, y: 100 }];
  assert.equal(pageAt(pages, 50, 50).id, "a");
  assert.equal(pageAt(pages, 400, 200).id, "b", "the later page is on top where they overlap");
  assert.equal(pageAt(pages, PAGE_W + 500, 50), null);
  assert.equal(pageAt(pages, PAGE_W, PAGE_H).id, "b", "the corner of a is also inside b");
  assert.equal(pageAt(pages, 100, 20).id, "a");
});

test("widgets snap into the page's grid and stay on the page", () => {
  const page = { x: 1000, y: 2000 };
  const step = UNIT + GAP;
  const a = snapToCell(page, page.x + PAGE.marginX + 30, page.y + PAGE.headH + 20);
  assert.deepEqual([a.col, a.row, a.x, a.y], [0, 0, page.x + PAGE.marginX, page.y + PAGE.headH]);
  const b = snapToCell(page, page.x + PAGE.marginX + step * 0.8, page.y + PAGE.headH + step * 1.1);
  assert.deepEqual([b.col, b.row], [1, 1]);
  const far = snapToCell(page, page.x + 5000, page.y + 5000);
  assert.ok(far.x + UNIT <= page.x + PAGE_W, "the last column still fits on the page");
  assert.ok(far.y + UNIT <= page.y + PAGE_H, "the last row still fits on the page");
  assert.equal(snapToCell(page, page.x - 400, page.y - 400).col, 0);
  assert.deepEqual([far.col, far.row], [GRID.cols - 1, GRID.rows - 1]);
});

test("typed text lands on the nearest ruled line, from the left margin", () => {
  const page = { x: 100, y: 200 };
  const first = PAGE.headH + PAGE.lineH;
  const t = snapToLine(page, page.x + 300, page.y + first + 3);
  assert.equal(t.line, 1);
  assert.equal(t.x, page.x + PAGE.marginX + 8, "always on the margin");
  const t2 = snapToLine(page, page.x + 300, page.y + first + PAGE.lineH * 3 + 10);
  assert.equal(t2.line, 4);
  assert.equal(t2.y - t.y, PAGE.lineH * 3, "lines are exactly one line apart");
  assert.equal(snapToLine(page, page.x, page.y).line, 1, "above the first line goes on the first line");
  assert.ok(snapToLine(page, page.x, page.y + PAGE_H + 900).y < page.y + PAGE_H, "never below the page");
});

test("every page template fits the page's grid, without two widgets on the same cell", () => {
  assert.deepEqual(Object.keys(PAGE_TEMPLATES), ["blank", "battle", "sheet", "log"]);
  assert.deepEqual(Object.keys(POKEMON_PAGE_TEMPLATES), ["blank", "battle", "sheet", "log"], "a Pokemon campaign has the same four kinds");
  assert.equal(pageTemplates("pokemon"), POKEMON_PAGE_TEMPLATES);
  assert.equal(pageTemplates("dnd"), PAGE_TEMPLATES);
  const page = { x: 0, y: 0 };
  for (const [kind, t] of [...Object.entries(PAGE_TEMPLATES), ...Object.entries(POKEMON_PAGE_TEMPLATES)]) {
    const taken = new Set();
    for (const w of t.widgets) {
      const [cw, ch] = { "1x1": [1, 1], "1x2": [2, 1], "2x2": [2, 2] }[w.size];
      assert.ok(w.col + cw <= GRID.cols && w.row + ch <= GRID.rows, `${kind}/${w.widget} fits`);
      for (let c = 0; c < cw; c++) for (let r = 0; r < ch; r++) { const key = `${w.col + c},${w.row + r}`; assert.ok(!taken.has(key), `${kind}/${w.widget} overlaps at ${key}`); taken.add(key); }
      const at = cellXY(page, w.col, w.row);
      assert.deepEqual([snapToCell(page, at.x, at.y).col, snapToCell(page, at.x, at.y).row], [w.col, w.row], "a cell's corner snaps to itself");
      assert.ok(!["weather", "combatdm"].includes(w.widget), "players can place every widget on a template");
    }
  }
});

test("writing flows onto the next line at the page's edge, and goes round what is on a line", () => {
  const page = { x: 0, y: 0 }, w = (s) => s.length * 10;   // ten units a letter
  const left = PAGE.marginX + 8, room = PAGE_W - 40 - left;
  const short = flowText("one two three", page, 0, [], w);
  assert.deepEqual(short.pieces.map((p) => [p.text, p.x, p.line]), [["one two three", left, 1]]);
  const long = flowText(Array(60).fill("word").join(" "), page, 0, [], w);
  assert.ok(long.pieces.length > 1 && long.pieces.every((p) => w(p.text) <= room), "every line fits the page");
  assert.deepEqual(long.pieces.map((p) => p.line), long.pieces.map((_, i) => i + 1), "one line after another");
  assert.equal(long.pieces[1].y - long.pieces[0].y, PAGE.lineH);
  // a widget in the middle of the first line: words fill the space left of it, then the space right of it, then the next line
  const first = PAGE.headH + PAGE.lineH, top = first - 27;
  const ob = { x: 300, y: top - 5, w: 160, h: 60 };
  const around = flowText(Array(30).fill("word").join(" "), page, 0, [ob], w);
  const row1 = around.pieces.filter((p) => p.y === top);
  assert.equal(row1.length, 2, "two runs on the line the widget stands on");
  assert.ok(row1[0].x + w(row1[0].text) <= ob.x, "the first stops before the widget");
  assert.ok(row1[1].x >= ob.x + ob.w, "the second starts after it");
  const row3 = flowText("hello", page, 0, [{ x: 0, y: 0, w: PAGE_W, h: first + PAGE.lineH - 12 }], w);
  assert.equal(row3.pieces[0].line, 3, "a line that is blocked all the way across is skipped");
  const full = flowText(Array(4000).fill("word").join(" "), page, 0, [], w);
  assert.equal(full.full, true);
  assert.ok(full.pieces.every((p) => p.y + 28 < PAGE_H));
  const huge = flowText("x".repeat(300), page, 0, [], w);
  assert.ok(huge.pieces.length >= 2 && huge.pieces.every((p) => w(p.text) <= room));
  assert.equal(huge.pieces.map((p) => p.text).join(""), "x".repeat(300));
});

test("a widget dropped on another settles beside it, and nothing moves if nothing is in the way", () => {
  const hit = (r, o) => r.x < o.x + o.w && r.x + r.w > o.x && r.y < o.y + o.h && r.y + r.h > o.y;
  const a = { x: 0, y: 0, w: 332, h: 160 };
  assert.deepEqual(resolveOverlap({ x: 400, y: 0, w: 160, h: 160 }, [a]), { x: 400, y: 0 }, "no overlap: it stays");
  assert.deepEqual(resolveOverlap({ x: 400, y: 0, w: 160, h: 160 }, []), { x: 400, y: 0 });
  const dropped = { x: 300, y: 20, w: 160, h: 160 };
  const to = resolveOverlap(dropped, [a]);
  assert.deepEqual(to, { x: 344, y: 20 }, "to the right of it, where it was vertically");
  assert.ok(!hit({ ...dropped, ...to }, a));
  const ring = [{ x: 0, y: 0, w: 160, h: 160 }, { x: 172, y: 0, w: 160, h: 160 }, { x: 0, y: 172, w: 160, h: 160 }];
  const out = resolveOverlap({ x: 100, y: 100, w: 160, h: 160 }, ring);
  for (const o of ring) assert.ok(!hit({ x: out.x, y: out.y, w: 160, h: 160 }, o), "clear of every neighbour");
  // on a page it lands in a cell of the grid
  const page = { x: 0, y: 0 }, c0 = cellXY(page, 0, 0);
  const cell = (c) => { const s = snapToCell(page, c.x, c.y); return { x: s.x, y: s.y }; };
  const occupied = { x: c0.x, y: c0.y, w: 160, h: 160 };
  const moved = resolveOverlap({ ...occupied }, [occupied], GAP, cell);
  assert.notDeepEqual(moved, c0, "it left the occupied cell");
  assert.deepEqual(cell(moved), moved, "and is on a cell");
});

test("a page packs up with what is on it and sets down again anywhere", () => {
  const page = { id: "p", title: "Notes", pageKind: "log", x: 1000, y: 500 };
  const attached = [
    { id: "w", type: "widget", widget: "clock", size: "1x1", x: 1064, y: 620, owner: "me", byName: "Me", page: "p", updated: 5 },
    { id: "s", type: "stroke", pts: [[1100, 700], [1150, 760]], color: "#fff", width: 3, owner: "me", page: "p" },
    { id: "h", type: "shape", shape: "rect", x: 1200, y: 800, x2: 1260, y2: 860, color: "#fff", width: 3, page: "p" },
    { id: "t", type: "text", x: 1072, y: 600, text: "hello", size: 24, color: "#e9c27a", page: "p" },
  ];
  const saved = packPage(page, attached);
  assert.deepEqual(JSON.parse(JSON.stringify(saved)), saved, "plain data: it can be stored");
  assert.equal(saved.title, "Notes");
  assert.deepEqual(saved.items[0], { type: "widget", widget: "clock", size: "1x1", x: 64, y: 120 }, "no ids, owners or page link, and relative to the page");
  assert.deepEqual(saved.items[1].pts, [[100, 200], [150, 260]]);
  assert.deepEqual([saved.items[2].x2, saved.items[2].y2], [260, 360]);
  let n = 0;
  const back = unpackPage(saved, { x: 5000, y: 300 }, () => `id${++n}`);
  assert.deepEqual([back.page.x, back.page.y, back.page.title, back.page.pageKind], [5000, 300, "Notes", "log"]);
  assert.equal(new Set([back.page.id, ...back.items.map((i) => i.id)]).size, 5, "fresh ids for everything");
  assert.deepEqual([back.items[0].x, back.items[0].y], [5064, 420]);
  assert.deepEqual(back.items[1].pts, [[5100, 500], [5150, 560]]);
  assert.deepEqual([back.items[2].x2, back.items[2].y2], [5260, 660]);
  assert.equal(back.items[3].text, "hello");
});

test("the client and the server agree on pages and widgets", () => {
  const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8");
  const server = read("server.py"), widgets = read("js/hubKits/widgets.js"), hub = read("js/views/hub.js");
  const tuple = (name) => JSON.parse(server.match(new RegExp("^" + name + " = (\\([^)]*\\))", "m"))[1].replace("(", "[").replace(")", "]"));
  const [w, h] = server.match(/^HUB_PAGE_W, HUB_PAGE_H = (\d+), (\d+)/m).slice(1).map(Number);
  assert.deepEqual([w, h], [PAGE_W, PAGE_H], "a page is the same size on both sides");
  assert.deepEqual(tuple("HUB_WIDGET_SIZES"), SIZE_NAMES, "the same three widget sizes");
  assert.deepEqual(tuple("HUB_PAGE_KINDS"), Object.keys(PAGE_TEMPLATES), "the same page kinds");
  assert.deepEqual(tuple("HUB_TEXT_STYLES"), Object.keys(TEXT_STYLES), "the same text presets");
  assert.equal(Number(server.match(/^HUB_MAX_PAGES = (\d+)/m)[1]), Number(hub.match(/^const MAX_PAGES = (\d+)/m)[1]), "the same page limit");
  const ids = [...widgets.matchAll(/id: "(\w+)", size: "(\dx\d)"/g)];
  assert.deepEqual(ids.map((m) => m[1]).sort(), [...tuple("HUB_WIDGETS")].sort(), "every widget the client has, the server accepts, and no more");
  for (const m of ids) assert.ok(SIZE_NAMES.includes(m[2]), `${m[1]} has a size that exists`);
  // every widget on a page template exists for that template's own system (a D&D page never holds a Pokemon widget, nor the reverse)
  const only = new Map([...widgets.matchAll(/id: "(\w+)", size: "\dx\d"(?:, only: "(\w+)")?/g)].map((m) => [m[1], m[2] || ""]));
  for (const [system, set] of [["dnd", PAGE_TEMPLATES], ["pokemon", POKEMON_PAGE_TEMPLATES]]) {
    for (const [kind, t] of Object.entries(set)) for (const w of t.widgets) assert.ok(only.has(w.widget) && (!only.get(w.widget) || only.get(w.widget) === system), `${system}/${kind}/${w.widget} is a widget for ${system}`);
  }
  for (const id of tuple("HUB_DM_WIDGETS")) assert.ok(widgets.includes(`id: "${id}", size: "1x2", title:`) || widgets.includes(`id: "${id}", size:`), `${id} exists`);
});

test("text presets: five of them, each a size, and a big one takes more ruled lines and still rests on a line", () => {
  assert.deepEqual(Object.keys(TEXT_STYLES), ["title", "heading", "body", "mysterious", "quote"]);
  for (const [k, v] of Object.entries(TEXT_STYLES)) assert.ok(v.label && v.size >= 12 && v.size <= 120, k);
  assert.equal(linesFor(TEXT_STYLES.body.size), 1);
  assert.equal(linesFor(TEXT_STYLES.title.size), 2, "a title takes two ruled lines");
  const page = { x: 0, y: 0 }, first = PAGE.headH + PAGE.lineH;
  const body = snapToLine(page, 100, 0, 24), title = snapToLine(page, 100, 0, 44);
  assert.equal(body.line, 1);
  assert.equal(title.line, 2, "a title clicked on the first line moves down to the second so it fits above its line");
  assert.equal(title.y + textDy(44), first + PAGE.lineH, "its box rests just above that line");
  assert.equal(snapToLine(page, 100, first + 36 * 6, 44).line, 7);
});

test("text moved on a page snaps to the margin or a column of the grid, and never past the page", () => {
  const page = { x: 100, y: 0 }, left = 100 + PAGE.marginX + 8;
  assert.equal(snapTextX(page, -500), left);
  assert.equal(snapTextX(page, left + 10), left);
  assert.equal(snapTextX(page, left + PAGE.lineH * 2 + 5), left + PAGE.lineH * 2);
  assert.ok(snapTextX(page, 99999) + 240 <= 100 + PAGE_W - 40, "room is left for words before the right margin");
  assert.equal((snapTextX(page, left + 130) - left) % PAGE.lineH, 0, "always on a column");
});

test("a preset's size and an indent change how text flows", () => {
  const page = { x: 0, y: 0 }, w = (s) => s.length * 10, left = PAGE.marginX + 8;
  const big = flowText(Array(30).fill("word").join(" "), page, 0, [], w, { size: 44 });
  assert.equal(big.pieces[0].line, 2, "a title starts on the second ruled line");
  assert.equal(big.pieces[1].line - big.pieces[0].line, 2, "and each row takes two");
  const indented = flowText("one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen", page, 0, [], w, { startX: left + 72 });
  assert.equal(indented.pieces[0].x, left + 72, "the first row starts at the indent");
  assert.equal(indented.pieces[1].x, left, "the rows after it return to the margin");
});
