// Dungeon rendering for the planner whiteboard's dungeon nodes (js/planner/boardView.js): the connected map, and for every
// room its contents plus each exit (direction, door, passage, where it leads). genDungeon itself is in engine/generators.js.

import { el, chip } from "../ui.js";

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const SVG = "http://www.w3.org/2000/svg";
const svgEl = (tag, attrs = {}, text) => { const n = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); if (text != null) n.textContent = text; return n; };
const DOOR_MARK = { "open archway": "", "wooden door": "|", "stuck door": "|", "locked door": "L", "iron-bound door": "B", "secret door": "S", "portcullis": "#", "trapped door": "!", "collapsed doorway": "x" };
const ROLE_LABEL = { entrance: "Entrance", lair: "Lair", vault: "Vault", junction: "Junction", chamber: "Chamber" };
const OPP = { N: "S", S: "N", E: "W", W: "E" };

const kv = (rows) => el("table", { class: "data-table dnd-kv" }, rows.filter(([, v]) => v).map(([k, v]) => el("tr", {}, [el("th", {}, k), el("td", {}, v)])));

export function dungeonText(d) {
  const nm = d.dirName;
  return d.rooms.map((r) => [
    `Room ${r.id}: ${cap(r.type)} (${ROLE_LABEL[r.role]}, ${r.w}x${r.h} ft)`,
    `  ${cap(r.light)}; air ${r.air}. ${cap(r.feature)}.`,
    `  Inside: ${r.occupant}${r.threat ? ` - ${r.threat}` : ""}${r.trap ? `. Trap: ${r.trap}` : ""}${r.treasure ? `. Treasure: ${r.treasure}` : ""}`,
    ...r.exits.map((e) => `  ${cap(nm[e.dir])}: ${e.door} -> ${e.passage} (${e.length} ft${e.vertical ? `, ${e.vertical}` : ""}) -> room ${e.to}`),
  ].join("\n")).join("\n\n");
}

export function dungeonMap(d, onPick) {
  const CW = 150, CH = 112, PAD = 24;
  const svg = svgEl("svg", { viewBox: `0 0 ${d.cols * CW + PAD * 2} ${d.rows * CH + PAD * 2}`, class: "dnd-dmap", role: "img", "aria-label": `Dungeon map with ${d.rooms.length} rooms` });
  const box = (r) => {
    const w = Math.round(52 + r.w * 1.45), h = Math.round(40 + r.h * 0.95);
    const cx = PAD + r.gx * CW + CW / 2, cy = PAD + r.gy * CH + CH / 2;
    return { x: cx - w / 2, y: cy - h / 2, w, h, cx, cy };
  };
  const boxes = new Map(d.rooms.map((r) => [r.id, box(r)]));
  const edge = (b, dir) => ({ N: [b.cx, b.y], S: [b.cx, b.y + b.h], E: [b.x + b.w, b.cy], W: [b.x, b.cy] }[dir]);
  const drawn = new Set();
  const links = svgEl("g"), doors = svgEl("g");
  for (const r of d.rooms) for (const e of r.exits) {
    const id = [r.id, e.to].sort().join("-");
    if (drawn.has(id)) continue;
    drawn.add(id);
    const a = edge(boxes.get(r.id), e.dir), b = edge(boxes.get(e.to), OPP[e.dir]);
    links.append(svgEl("line", { x1: a[0], y1: a[1], x2: b[0], y2: b[1], class: `corr${e.vertical ? " stairs" : ""}${/chasm/.test(e.passage) ? " bridge" : ""}${/flooded/.test(e.passage) ? " flood" : ""}` }));
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const g = svgEl("g", { class: `door ${e.door.split(" ")[0]}` });
    g.append(svgEl("title", {}, `${e.door}, ${e.passage} (${e.length} ft)`), svgEl("circle", { cx: mid[0], cy: mid[1], r: 9 }));
    if (DOOR_MARK[e.door]) g.append(svgEl("text", { x: mid[0], y: mid[1] + 4, "text-anchor": "middle" }, DOOR_MARK[e.door]));
    if (e.vertical) g.append(svgEl("text", { x: mid[0], y: mid[1] - 13, "text-anchor": "middle", class: "stair-arrow" }, e.vertical === "down" ? "↓" : "↑"));
    doors.append(g);
  }
  svg.append(links);
  for (const r of d.rooms) {
    const b = boxes.get(r.id);
    const g = svgEl("g", { class: `room ${r.role}`, tabindex: "0", role: "button", "aria-label": `Room ${r.id}, ${r.type}` });
    g.append(
      svgEl("rect", { x: b.x, y: b.y, width: b.w, height: b.h, rx: 6 }),
      svgEl("text", { x: b.cx, y: b.cy + 6, "text-anchor": "middle", class: "num" }, String(r.id)),
      svgEl("text", { x: b.cx, y: b.y + b.h - 8, "text-anchor": "middle", class: "sz" }, `${r.w}×${r.h}`),
    );
    if (r.trap) g.append(svgEl("text", { x: b.x + 10, y: b.y + 16, class: "ico" }, "⚠"));
    if (r.threat) g.append(svgEl("text", { x: b.x + b.w - 10, y: b.y + 16, "text-anchor": "end", class: "ico" }, "⚔"));
    if (r.treasure) g.append(svgEl("text", { x: b.x + b.w - 10, y: b.y + b.h - 22, "text-anchor": "end", class: "ico" }, "◆"));
    g.addEventListener("click", () => onPick(r.id));
    g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(r.id); } });
    svg.append(g);
  }
  svg.append(doors);
  return svg;
}

export function roomCard(d, r) {
  const nm = d.dirName;
  const rows = r.exits.map((e) => el("tr", {}, [
    el("td", { class: "dnd-strong" }, cap(nm[e.dir])),
    el("td", {}, [cap(e.door), el("div", { class: "dnd-tiny dnd-muted" }, e.doorNote)]),
    el("td", {}, `${cap(e.passage)}, ${e.length} ft${e.vertical ? ` (${e.vertical})` : ""}`),
    el("td", {}, [`Room ${e.to}`, el("div", { class: "dnd-tiny dnd-muted" }, cap(d.rooms.find((x) => x.id === e.to).type))]),
  ]));
  return el("div", { class: `card dnd-room-card ${r.role}`, id: `dungeon-room-${r.id}` }, [
    el("div", { class: "dnd-section-head" }, [
      el("h4", {}, `${r.id}. ${cap(r.type)}`),
      el("div", { class: "dnd-row tight" }, [chip(ROLE_LABEL[r.role], r.role === "lair" ? "bad" : r.role === "vault" ? "gold" : r.role === "entrance" ? "good" : ""), chip(`${r.w}×${r.h} ft`), chip(`${r.distance} step${r.distance === 1 ? "" : "s"} from the entrance`)]),
    ]),
    kv([["Light", cap(r.light)], ["Air", cap(r.air)], ["Notable", cap(r.feature)], ["Inside", r.occupant], ["Threat", r.threat], ["Trap", r.trap], ["Treasure", r.treasure && cap(r.treasure)]]),
    el("h5", {}, `Exits (${r.exits.length})`),
    el("div", { class: "dnd-table-scroll" }, el("table", { class: "data-table" }, [
      el("thead", {}, el("tr", {}, ["Direction", "Door", "Passage", "Leads to"].map((h) => el("th", {}, h)))),
      el("tbody", {}, rows),
    ])),
  ]);
}
