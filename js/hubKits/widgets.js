// Smart widgets for a D&D hub: small, clean cards the table puts on the shared board that show what's happening and keep
// themselves up to date. A widget is { id, size, title, blurb, dm?, every?, load(ctx, getItem, st), view(model, ctx, getItem, st, size) }:
// load() fetches what it shows (from a cache shared by every widget, so twelve widgets don't mean twelve requests),
// and view() draws it for the size the card is: 1x1 shows the one thing that matters, 1x2 a little more, 2x2 the detail.
// The card redraws only when the model (or its size) changes, so nothing flickers and typing isn't interrupted.
//
// Widgets show what the person looking is allowed to see: they ask the server as the viewer (the map as a player gets it,
// the combat as it's published), so a widget on the shared board never gives away something to anyone who couldn't read it
// elsewhere. The DM's own widgets (weather, combat control) are placed by the DM alone (the server checks).
//
// ctx (built by js/views/hub.js): { me: {id, name}, dm(): bool, dmToken(): string, say(text), open(view), update(item, patch),
//   mine(): the active character's summary, openPlace(pinId, mapId) }.

import { el } from "../components.js";
import { SIZES } from "./paper.js";
import { getPartyMap, listTrainers, getTrainerTeam, getBattleLog, sendNoteToDm } from "../network.js";
import { gridRef, areaAt } from "../mapView.js";
import { fetchPublicCombat, getCombat, mutateCombat, publishCombat } from "../systems/dnd5e/combatState.js";
import { orderedCombatants, currentCombatant, nextTurn, prevTurn } from "../systems/dnd5e/engine/encounter.js";
import { roll, rollD20 } from "../systems/dnd5e/engine/dice.js";
import { activeCharacter } from "../systems/dnd5e/store.js";

const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
const ICONS = {
  positions: "M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  vitals: "M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10zM7 12h3l1.5-3 2 5 1.5-2H17",
  weather: "M7 18h10a4 4 0 0 0 .6-7.9A5.5 5.5 0 0 0 7 9.5 4.3 4.3 0 0 0 7 18z",
  turn: "M12 3l2.5 5 5.5.8-4 3.9.9 5.5-4.9-2.6-4.9 2.6.9-5.5-4-3.9 5.5-.8z",
  order: "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01",
  mine: "M6 3h9l3 3v15H6zM9 11h6M9 15h6",
  combatdm: "M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1",
  battles: "M14.5 17.5L3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2M9.5 17.5L21 6V3h-3L6.5 14.5M11 19l-6-6M8 16l-4 4M5 21l-2-2",
  here: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8v4l3 2",
  online: "M9 11a3 3 0 1 0 0-.01M3 20a6 6 0 0 1 12 0M17 11a2.5 2.5 0 1 0 0-.01M15.5 15.5A5 5 0 0 1 21 20",
  dice: "M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 3v18M4 7.5l8 4.5 8-4.5",
  purse: "M6 8h12l1 12H5zM9 8V6a3 3 0 0 1 6 0v2M9 13h6",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2",
};
export const widgetIcon = (id) => svg(ICONS[id] || ICONS.order);

// ---- shared data: one request per source every few seconds, however many widgets ask --------------------------------
const cache = new Map();
function cached(key, ttl, fn) {
  const hit = cache.get(key), now = Date.now();
  if (hit && now - hit.at < ttl) return hit.p;
  const p = fn().catch(() => null);
  cache.set(key, { at: now, p });
  return p;
}
/** Forget what's cached and let every widget ask again now (after something changed: a move, a turn, a rest). */
export function refreshWidgetData() { cache.clear(); window.dispatchEvent(new CustomEvent("hub-widgets-refresh")); }
const data = {
  map: (ctx) => cached(`map:${ctx.dm() ? "dm" : "player"}`, 2500, () => getPartyMap(ctx.dm() ? ctx.dmToken() : null, ctx.me.id)),
  combat: () => cached("combat", 2500, () => fetchPublicCombat()),
  battles: () => cached("battles", 5000, () => getBattleLog()),
  people: (ctx) => cached("people", 6000, async () => {
    const list = await listTrainers(ctx.me.id);
    const teams = await Promise.all(list.map((t) => getTrainerTeam(t.id).catch(() => null)));
    return list.map((t, i) => ({ id: t.id, name: teams[i]?.team?.dnd?.name || t.name, dnd: teams[i]?.team?.dnd || null }));
  }),
};

// ---- small pieces ---------------------------------------------------------------------------------------------------
const LV = { "1x1": 0, "1x2": 1, "2x2": 2 };   // how much a widget shows: the one thing, a little more, the detail
const empty = (text) => el("p", { class: "hub-widget-empty" }, text);
const big = (value, label, cls = "") => el("div", { class: `hub-big${cls ? ` ${cls}` : ""}` }, [el("strong", {}, value), label ? el("small", {}, label) : null].filter(Boolean));
const initial = (n) => (n || "?").trim()[0]?.toUpperCase() || "?";
const avatar = (name, color) => el("span", { class: "me-avatar", style: `--c:${color || "#5aa8f0"}` }, initial(name));
const hpBar = (hp, max) => {
  const pct = max ? Math.max(0, Math.min(100, (hp / max) * 100)) : 100;
  return el("span", { class: "dnd-hpbar" }, el("span", { class: pct > 50 ? "good" : pct > 20 ? "warn" : "bad", style: `width:${pct}%` }));
};
const chips = (list) => (list?.length ? el("div", { class: "hub-wchips" }, list.map((c) => el("span", { class: "dnd-cond" }, c))) : null);
const pad = (n) => String(n).padStart(2, "0");
const fmtTime = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
const pill = (label, fn, cls = "") => { const b = el("button", { type: "button", class: `hub-pill${cls}` }, label); b.addEventListener("click", fn); return b; };
const joined = (parts) => parts.filter((p) => p !== "" && p != null).flatMap((p, i) => (i ? [" · ", ...[].concat(p)] : [].concat(p)));
const ago = (ts) => {
  const s = Math.max(0, Date.now() / 1000 - ts);
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
};
const myPc = (ft, ctx) => ft?.combatants?.find((c) => c.kind === "pc" && (c.owner === ctx.me.id || c.pcId === activeCharacter()?.id));
/** A place's name as a link to it on the map: players get the map centred on it, the DM gets the Map editor there. */
const placeLink = (at, mapId, ctx) => {
  const a = el("a", { class: "hub-wplace", href: "#", title: "Show it on the map" }, at.name);
  a.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); ctx.openPlace(at.id, mapId); });
  return a;
};

// weather and time
const WEATHER = [["clear", "☀️", "Clear"], ["cloudy", "☁️", "Cloudy"], ["rain", "🌧️", "Rain"], ["storm", "⛈️", "Storm"], ["snow", "❄️", "Snow"], ["fog", "🌫️", "Fog"], ["wind", "💨", "Windy"], ["heat", "🥵", "Hot"], ["cold", "🥶", "Cold"]];
export const WEATHER_DEFAULT = { weather: "clear", temp: "", time: 8 * 60, day: 1, note: "" };
const phaseOf = (min) => (min < 300 ? "Night" : min < 420 ? "Dawn" : min < 690 ? "Morning" : min < 810 ? "Midday" : min < 1020 ? "Afternoon" : min < 1140 ? "Dusk" : min < 1260 ? "Evening" : "Night");
const skyIcon = (w, min) => {
  const night = min < 330 || min >= 1230;
  if (w === "clear") return night ? "🌙" : min < 420 || (min >= 1050 && min < 1230) ? "🌅" : "☀️";
  return (WEATHER.find(([k]) => k === w) || WEATHER[0])[1];
};

// ---- the widgets ----------------------------------------------------------------------------------------------------
export const WIDGETS = [
  {
    id: "positions", size: "1x2", title: "Where everyone is", blurb: "Each player's place on the map. Drag one onto a place to move them there.",
    async load(ctx) {
      const map = await data.map(ctx);
      if (!map) return { none: true };
      const atPin = (t) => (map.pins || []).find((p) => Math.hypot(t.x - p.x, t.y - p.y) < 0.012 && p.label);   // standing on a named place (only the ones this viewer can see)
      return { map: map.name || "Map", mapId: map.id || "", tokens: (map.tokens || []).map((t) => { const pin = atPin(t); return { id: t.id, name: t.name, color: t.color || "#5aa8f0", ref: gridRef(map, t.x, t.y), area: areaAt(map, t.x, t.y)?.name || "", at: pin ? { id: pin.id, name: pin.label } : null }; }) };
    },
    view(m, ctx, _g, _st, size) {
      if (m.none) return empty("No map on the hub yet.");
      if (!m.tokens.length) return empty("Nobody is on the map yet.");
      const lv = LV[size];
      const mk = (node, t) => {   // you drag yourself, the DM drags anyone, onto a place on the hub
        if (ctx.dm() || t.id === ctx.me.id) {
          node.setAttribute("draggable", "true"); node.title = `Drag ${t.name} onto a place on the hub to move them there`; node.classList.add("movable");
          node.addEventListener("dragstart", (e) => { e.dataTransfer.setData("application/x-hub-player", JSON.stringify({ id: t.id, name: t.name, color: t.color })); e.dataTransfer.effectAllowed = "move"; });
        }
        return node;
      };
      if (lv === 0) return [big(String(m.tokens.length), m.tokens.length === 1 ? "on the map" : "on the map"), el("div", { class: "hub-avatars" }, m.tokens.slice(0, 6).map((t) => mk(el("span", { class: "hub-wav", title: t.name }, avatar(t.name, t.color)), t)))];
      return m.tokens.slice(0, lv === 1 ? 3 : 12).map((t) => mk(el("div", { class: "hub-wrow" }, [
        avatar(t.name, t.color),
        el("span", { class: "hub-wrow-main" }, [el("strong", {}, t.name), el("small", {}, joined([t.at ? ["At ", placeLink(t.at, m.mapId, ctx)] : t.area, lv === 2 ? t.ref : "", lv === 2 && t.at ? t.area : ""]))]),
      ]), t));
    },
  },
  {
    id: "vitals", size: "1x2", title: "Party health", blurb: "Hit points, armour class and conditions for everyone who is online.",
    async load(ctx) {
      const mine = ctx.mine();
      const others = (await data.people(ctx)) || [];
      const rows = [...(mine ? [{ ...mine, you: true }] : []), ...others.filter((p) => p.dnd).map((p) => ({ name: p.dnd.name || p.name, label: p.dnd.classes, level: p.dnd.level, hp: p.dnd.hp, maxHp: p.dnd.maxHp, ac: p.dnd.ac, conditions: p.dnd.conditions || [] }))];
      return { rows };
    },
    view(m, _c, _g, _st, size) {
      if (!m.rows.length) return empty("No characters online yet.");
      const lv = LV[size], frac = (r) => (r.maxHp ? (r.hp ?? r.maxHp) / r.maxHp : 1);
      if (lv === 0) {   // whoever is hurt worst
        const r = [...m.rows].sort((a, b) => frac(a) - frac(b))[0];
        return [big(`${r.hp ?? r.maxHp ?? "–"}${r.maxHp ? `/${r.maxHp}` : ""}`, r.name), r.maxHp ? hpBar(r.hp ?? r.maxHp, r.maxHp) : null, chips(r.conditions.slice(0, 2))].filter(Boolean);
      }
      return m.rows.slice(0, lv === 1 ? 3 : 8).map((r) => el("div", { class: "hub-wcard" }, [
        el("div", { class: "hub-wline" }, [el("strong", {}, `${r.name}${r.you ? " (you)" : ""}`), el("small", {}, lv === 2 ? [r.label || (r.level ? `Level ${r.level}` : ""), r.ac != null ? `AC ${r.ac}` : ""].filter(Boolean).join(" · ") : "")]),
        r.maxHp ? el("div", { class: "hub-wline" }, [hpBar(r.hp ?? r.maxHp, r.maxHp), el("span", { class: "hub-whp" }, `${r.hp ?? r.maxHp}/${r.maxHp}`)]) : null,
        lv === 2 ? chips(r.conditions) : null,
      ].filter(Boolean)));
    },
  },
  {
    id: "weather", size: "1x2", title: "Weather and time", dm: true, every: 8000, blurb: "The day, the hour and the weather. The DM sets it; everyone sees it.",
    load(ctx, getIt) { return { ...WEATHER_DEFAULT, ...(getIt()?.data || {}), dm: ctx.dm() }; },
    view(m, ctx, getIt, _st, size) {
      const lv = LV[size];
      const save = (patch) => ctx.update(getIt(), { data: { ...WEATHER_DEFAULT, ...(getIt().data || {}), ...patch } });
      const advance = (mins) => { const d = { ...WEATHER_DEFAULT, ...(getIt().data || {}) }; const t = d.time + mins; save({ time: ((t % 1440) + 1440) % 1440, day: Math.max(1, d.day + Math.floor(t / 1440)) }); };
      const label = WEATHER.find(([k]) => k === m.weather) || WEATHER[0];
      if (lv === 0) return el("div", { class: "hub-sky one" }, [el("span", { class: "hub-sky-icon", "aria-hidden": "true" }, skyIcon(m.weather, m.time)), el("strong", { class: "hub-sky-time" }, fmtTime(m.time)), el("small", {}, label[2])]);
      const out = [
        el("div", { class: "hub-sky" }, [
          el("span", { class: "hub-sky-icon", "aria-hidden": "true" }, skyIcon(m.weather, m.time)),
          el("div", {}, [el("strong", { class: "hub-sky-time" }, fmtTime(m.time)), el("small", {}, `Day ${m.day} · ${phaseOf(m.time)}`)]),
          el("div", { class: "hub-sky-now" }, [el("strong", {}, label[2]), m.temp ? el("small", {}, m.temp) : null].filter(Boolean)),
        ]),
        lv === 2 && m.note ? el("p", { class: "hub-sky-note" }, m.note) : null,
      ];
      if (m.dm) {
        out.push(el("div", { class: "hub-wpicks", role: "group", "aria-label": "Weather" }, WEATHER.map(([k, icon, name]) => {
          const b = el("button", { type: "button", class: `hub-wpick${m.weather === k ? " on" : ""}`, title: name, "aria-label": name, "aria-pressed": String(m.weather === k) }, icon);
          b.addEventListener("click", () => save({ weather: k }));
          return b;
        })));
        if (lv === 2) {
          const note = el("input", { type: "text", class: "hub-input", maxlength: "120", placeholder: "A note for the table", value: m.note, "aria-label": "Weather note" });
          note.addEventListener("change", () => save({ note: note.value.trim() }));
          const temp = el("input", { type: "text", class: "hub-input", maxlength: "12", placeholder: "Temp", value: m.temp, "aria-label": "Temperature", style: "max-width:80px" });
          temp.addEventListener("change", () => save({ temp: temp.value.trim() }));
          out.push(el("div", { class: "hub-wacts" }, [pill("−1 h", () => advance(-60)), pill("+1 h", () => advance(60)), pill("+8 h", () => advance(480)), temp]), note);
        }
      }
      return out.filter(Boolean);
    },
  },
  {
    id: "turn", size: "1x1", title: "Whose turn", every: 3000, blurb: "Big and plain: the round and whose turn it is in the fight.",
    async load(ctx) {
      const ft = await data.combat();
      if (!ft || !ft.combatants.length || ft.phase === "draft") return { live: false };
      const n = ft.combatants.length, cur = ft.combatants[ft.currentIndex];
      const upcoming = [];
      for (let k = 1; k < n && upcoming.length < 3; k++) { const c = ft.combatants[(ft.currentIndex + k) % n]; if (c && !c.dead) upcoming.push(c.name); }
      return { live: true, round: ft.round, name: cur?.name || "", upcoming, you: !!cur && cur.kind === "pc" && (cur.owner === ctx.me.id || cur.pcId === activeCharacter()?.id) };
    },
    view(m, _c, _g, _st, size) {
      if (!m.live) return empty("No fight right now.");
      const lv = LV[size];
      return [
        el("div", { class: `hub-turn${m.you ? " you" : ""}` }, [el("small", {}, `Round ${m.round}`), el("strong", {}, lv === 0 ? m.name : `${m.name}’s turn`), m.you ? el("span", { class: "hub-turn-you" }, "That’s you!") : null].filter(Boolean)),
        lv === 2 && m.upcoming.length ? el("div", { class: "hub-wchips" }, [el("small", { class: "hub-wround" }, "Up next"), ...m.upcoming.map((n) => el("span", { class: "dnd-cond" }, n))]) : null,
      ].filter(Boolean);
    },
  },
  {
    id: "order", size: "1x2", title: "Initiative order", every: 3000, blurb: "The order of the fight, who's acting, and how hurt everyone looks.",
    async load() {
      const ft = await data.combat();
      if (!ft || !ft.combatants.length || ft.phase === "draft") return { live: false };
      return { live: true, round: ft.round, cur: ft.currentIndex, list: ft.combatants.map((c) => ({ name: c.name, init: c.init, pc: c.kind === "pc", hp: c.hp, maxHp: c.maxHp, status: c.status, dead: c.dead, conditions: c.conditions || [] })) };
    },
    view(m, _c, _g, _st, size) {
      if (!m.live) return empty("No fight right now. When the DM publishes one, the order shows here.");
      const lv = LV[size], now = m.list[m.cur];
      if (lv === 0) return big(now?.name || "–", `Round ${m.round} · ${m.list.length} in the fight`);
      const start = lv === 1 ? m.cur : 0, rows = lv === 1 ? [...m.list.slice(start), ...m.list.slice(0, start)].slice(0, 3) : m.list;
      return [el("small", { class: "hub-wround" }, `Round ${m.round}`), ...rows.map((c) => {
        const i = m.list.indexOf(c);
        return el("div", { class: `hub-wcard${i === m.cur ? " acting" : ""}${c.dead ? " dead" : ""}` }, [
          el("div", { class: "hub-wline" }, [el("strong", {}, c.name), el("small", {}, [c.init != null ? `Init ${c.init}` : "", i === m.cur ? "Acting" : ""].filter(Boolean).join(" · "))]),
          lv === 2 ? (c.pc && c.maxHp != null ? el("div", { class: "hub-wline" }, [hpBar(c.hp, c.maxHp), el("span", { class: "hub-whp" }, `${c.hp}/${c.maxHp}`)]) : el("small", { class: "hub-wstatus" }, c.status || "")) : null,
          lv === 2 ? chips(c.conditions) : null,
        ].filter(Boolean));
      })];
    },
  },
  {
    id: "mine", size: "1x2", title: "My character in the fight", every: 3000, blurb: "Your hit points and conditions in the fight, and a way to tell the DM your initiative.",
    async load(ctx) {
      const ft = await data.combat();
      const live = !!ft && ft.combatants.length && ft.phase !== "draft";
      const c = live ? myPc(ft, ctx) : null;
      const mine = ctx.mine();
      return { live, fighting: !!c, name: c?.name || mine?.name || "", hp: c ? c.hp : mine?.hp, maxHp: c ? c.maxHp : mine?.maxHp, ac: c ? c.ac : mine?.ac, conditions: (c ? c.conditions : mine?.conditions) || [], init: c?.init ?? null, acting: !!c?.active, saves: c?.deathSaves || null, has: !!(c || mine) };
    },
    view(m, ctx, _g, st, size) {
      if (!m.has) return empty("Make a character first.");
      const lv = LV[size];
      const state = m.fighting ? (m.acting ? "Your turn" : m.init != null ? `Init ${m.init}` : "In the fight") : m.live ? "Not in this fight" : "No fight right now";
      const hp = m.maxHp ? el("div", { class: "hub-wline" }, [hpBar(m.hp ?? m.maxHp, m.maxHp), el("span", { class: "hub-whp" }, `${m.hp ?? m.maxHp}/${m.maxHp}`)]) : null;
      if (lv === 0) return [big(m.maxHp ? `${m.hp ?? m.maxHp}` : "–", m.name), hp, el("small", { class: `hub-wstatus${m.acting ? " now" : ""}` }, state)].filter(Boolean);
      const out = [
        el("div", { class: "hub-wline" }, [el("strong", {}, m.name), el("small", {}, [state, m.ac != null ? `AC ${m.ac}` : ""].filter(Boolean).join(" · "))]),
        hp, chips(m.conditions),
      ];
      if (lv === 2) {
        if (m.saves) out.push(el("small", { class: "hub-wstatus" }, `Death saves: ${m.saves.s} success, ${m.saves.f} failure`));
        const input = el("input", { type: "number", class: "hub-input", min: "-10", max: "40", placeholder: "Init", "aria-label": "My initiative", value: st.init ?? "", style: "max-width:84px" });
        input.addEventListener("input", () => { st.init = input.value; });
        out.push(el("div", { class: "hub-wacts" }, [input, pill("Send to the DM", () => {
          if (st.init === "" || st.init == null) { ctx.say("Type your initiative first."); return; }
          sendNoteToDm(m.name || "Player", `Initiative: ${st.init}`);
          ctx.say("Sent to the DM.");
        }, " solid")]));
      }
      return out.filter(Boolean);
    },
  },
  {
    id: "combatdm", size: "1x2", title: "Combat control", dm: true, every: 3000, blurb: "The DM's turn controls: the round, whose turn it is, previous and next.",
    load() {
      const c = getCombat();
      const cur = currentCombatant(c);
      return { started: !!c.started, live: !!c.live, round: c.round, cur: cur?.name || "", count: orderedCombatants(c).length };
    },
    view(m, ctx, _g, _st, size) {
      const lv = LV[size];
      const step = async (fn) => {
        mutateCombat((c) => fn(c));
        if (getCombat().live) { try { await publishCombat(ctx.dmToken()); } catch { ctx.say("Couldn't publish the turn."); } }
        refreshWidgetData();
      };
      if (!m.count) return [empty("No fight is set up."), lv ? el("div", { class: "hub-wacts" }, [pill("Open the tracker", () => ctx.open("dndCombat"))]) : null].filter(Boolean);
      if (lv === 0) return [big(m.started ? m.cur : "Not started", `Round ${m.round}`), el("div", { class: "hub-wacts" }, [pill("Next ▶", () => step(nextTurn), " solid")])];
      return [
        el("div", { class: "hub-turn" }, [el("small", {}, `Round ${m.round}${m.live ? " · live" : " · not published"}`), el("strong", {}, m.started ? `${m.cur}’s turn` : "Not started")]),
        el("div", { class: "hub-wacts" }, [pill("◀ Back", () => step(prevTurn)), pill("Next turn ▶", () => step(nextTurn), " solid"), lv === 2 ? pill("Open the tracker", () => ctx.open("dndCombat")) : null].filter(Boolean)),
        lv === 2 ? el("small", { class: "hub-wstatus" }, `${m.count} in the fight`) : null,
      ].filter(Boolean);
    },
  },
  {
    id: "battles", size: "1x2", title: "Recent battles", every: 6000, blurb: "The latest from the battle log: rolls, hits and how recent fights ended.",
    async load() {
      const list = (await data.battles()) || [];
      return { rows: list.slice(-6).reverse().map((e) => ({ who: e.fromName, text: e.text, ts: Math.floor(e.ts / 60) * 60 })) };
    },
    view(m, _c, _g, _st, size) {
      if (!m.rows.length) return empty("Nothing in the battle log yet.");
      const lv = LV[size];
      return m.rows.slice(0, lv === 0 ? 1 : lv === 1 ? 3 : 6).map((r) => el("div", { class: `hub-wcard${lv === 1 ? " tight" : ""}` }, [el("div", { class: "hub-wline" }, [el("strong", {}, r.who || "Someone"), el("small", {}, ago(r.ts))]), el("p", { class: `hub-wtext${lv < 2 ? " clamp" : ""}` }, r.text)]));
    },
  },
  {
    id: "here", size: "1x1", title: "Where I am", blurb: "The map square and the area you're standing in.",
    async load(ctx) {
      const map = await data.map(ctx);
      if (!map) return { none: true };
      const me = (map.tokens || []).find((t) => t.id === ctx.me.id);
      if (!me) return { off: true, map: map.name || "Map" };
      return { map: map.name || "Map", ref: gridRef(map, me.x, me.y), area: areaAt(map, me.x, me.y)?.name || "" };
    },
    view(m, ctx, _g, _st, size) {
      if (m.none) return empty("No map on the hub yet.");
      const lv = LV[size];
      if (m.off) return [empty("You're not on the map yet."), lv ? el("div", { class: "hub-wacts" }, [pill("Open the map", () => ctx.open("map"))]) : null].filter(Boolean);
      return [
        el("div", { class: "hub-turn" }, [lv ? el("small", {}, m.map) : null, el("strong", {}, m.area || "Open country"), el("span", { class: "hub-turn-you" }, m.ref)].filter(Boolean)),
        lv === 2 ? el("div", { class: "hub-wacts" }, [pill("Open the map", () => ctx.open("map"))]) : null,
      ].filter(Boolean);
    },
  },
  {
    id: "online", size: "1x1", title: "Who's here", every: 6000, blurb: "Everyone at the table right now.",
    async load(ctx) { const list = (await data.people(ctx)) || []; return { names: [ctx.mine()?.name || ctx.me.name, ...list.map((p) => p.name)].filter(Boolean) }; },
    view(m, _c, _g, _st, size) {
      const lv = LV[size];
      if (lv === 0) return [big(String(m.names.length), m.names.length === 1 ? "at the table" : "at the table"), el("div", { class: "hub-avatars" }, m.names.slice(0, 6).map((n) => el("span", { class: "hub-wav", title: n }, avatar(n))))];
      return el("div", { class: "hub-wchips big" }, m.names.slice(0, lv === 1 ? 6 : 16).map((n) => el("span", { class: "hub-wname" }, [el("i", { class: "me-avatar" }, initial(n)), n])));
    },
  },
  {
    id: "dice", size: "1x2", title: "Dice", quiet: true, every: 60000, blurb: "Quick dice: roll a d20 with advantage or disadvantage, or any other die.",
    load() { return {}; },
    view(_m, _ctx, _g, st, size) {
      const lv = LV[size];
      st.mode = st.mode || "normal"; st.log = st.log || [];
      const out = el("div", { class: "hub-dice-out", "aria-live": "polite" });
      const showLog = () => out.replaceChildren(...(st.log.length ? st.log.slice(0, lv === 2 ? 4 : 1).map((l, i) => el("div", { class: `hub-dice-row${i ? "" : " now"}` }, [el("strong", {}, l.total), el("small", {}, l.text)])) : [el("small", {}, "Roll something.")]));
      const rollIt = (sides) => {
        let entry;
        if (sides === 20) { const r = rollD20({ mode: st.mode }); entry = { total: r.total, text: `d20${st.mode === "normal" ? "" : st.mode === "adv" ? " advantage" : " disadvantage"}: ${r.rolls.join(", ")}${r.crit ? " (natural 20!)" : r.fumble ? " (natural 1)" : ""}` }; }
        else { const r = roll(`1d${sides}`); entry = { total: r.total, text: `d${sides}` }; }
        st.log.unshift(entry); st.log.length = Math.min(st.log.length, 4); showLog();
      };
      const dieBtn = (n, cls = "") => { const b = el("button", { type: "button", class: `hub-die${cls}` }, `d${n}`); b.addEventListener("click", () => rollIt(n)); return b; };
      showLog();
      if (lv === 0) return [dieBtn(20, " one"), out];
      const out2 = [el("div", { class: "hub-dice-btns" }, (lv === 1 ? [4, 6, 8, 10, 12, 20] : [4, 6, 8, 10, 12, 20, 100]).map((n) => dieBtn(n)))];
      if (lv === 2) {
        const modes = el("div", { class: "me-seg" }, [["normal", "Normal"], ["adv", "Adv"], ["dis", "Dis"]].map(([k, label]) => {
          const b = el("button", { type: "button", class: st.mode === k ? "on" : "", "aria-pressed": String(st.mode === k) }, label);
          b.addEventListener("click", () => { st.mode = k; modes.querySelectorAll("button").forEach((x) => { const on = x === b; x.classList.toggle("on", on); x.setAttribute("aria-pressed", String(on)); }); });
          return b;
        }));
        out2.push(modes);
      }
      out2.push(out);
      return out2;
    },
  },
  {
    id: "purse", size: "1x1", title: "My purse", every: 4000, blurb: "Your coins and how much you're carrying.",
    load() {
      const c = activeCharacter();
      if (!c) return { none: true };
      return { name: c.name, coins: c.currency || {}, items: (c.inventory || []).filter((i) => i?.name).length, names: (c.inventory || []).filter((i) => i?.name).slice(0, 5).map((i) => i.name) };
    },
    view(m, _c, _g, _st, size) {
      if (m.none) return empty("Make a character first.");
      const lv = LV[size];
      const coins = ["pp", "gp", "ep", "sp", "cp"].filter((k) => Number(m.coins[k]) > 0);
      if (lv === 0) { const k = coins.includes("gp") ? "gp" : coins[0]; return k ? big(String(m.coins[k]), k) : empty("No coins."); }
      return [
        coins.length ? el("div", { class: "dnd-coins" }, coins.map((k) => el("span", { class: `dnd-coin ${k}` }, [el("strong", {}, String(m.coins[k])), ` ${k}`]))) : empty("No coins."),
        el("small", { class: "hub-wstatus" }, `${m.items} item${m.items === 1 ? "" : "s"} carried`),
        lv === 2 && m.names.length ? el("div", { class: "hub-wchips" }, m.names.map((n) => el("span", { class: "dnd-cond" }, n))) : null,
      ].filter(Boolean);
    },
  },
  {
    id: "clock", size: "1x1", title: "Table clock", quiet: true, every: 1000, blurb: "The real time, for knowing when to stop for the night.",
    load() { const d = new Date(); return { time: `${pad(d.getHours())}:${pad(d.getMinutes())}`, date: d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" }), min: Math.floor(Date.now() / 60000) }; },
    view(m, _c, _g, st, size) {
      const lv = LV[size];
      st.start = st.start || m.min;
      const at = m.min - st.start;
      return el("div", { class: "hub-turn" }, [lv ? el("small", {}, m.date) : null, el("strong", { class: "hub-sky-time" }, m.time), lv === 2 ? el("small", {}, `At the table ${Math.floor(at / 60)}h ${pad(at % 60)}m`) : null].filter(Boolean));
    },
  },
];
const BY_ID = new Map(WIDGETS.map((w) => [w.id, w]));
export const widgetDef = (id) => BY_ID.get(id) || null;
export const defaultSize = (id) => BY_ID.get(id)?.size || "1x1";

/** Names of the players standing at a place on the hub (their token is on its label on the map). Only where the label is known to the viewer. */
export async function placeHere(ctx, it) {
  if (!it.pin) return [];
  const map = await data.map(ctx);
  const pin = map?.pins?.find((q) => q.id === it.pin);
  if (!pin) return [];
  return (map.tokens || []).filter((t) => Math.hypot(t.x - pin.x, t.y - pin.y) < 0.012).map((t) => t.name);
}

// ---- the card on the board ------------------------------------------------------------------------------------------
const sizeOf = (def, it) => (SIZES[it?.size] ? it.size : def.size || "1x1");

function mount(def, body, node, ctx) {
  const st = {};          // what a widget keeps between redraws (a half-typed number, the dice's last rolls)
  let lastModel = null, lastSize = null, stopped = false, busy = false;
  const getIt = () => node.__item;
  const stop = () => { stopped = true; clearInterval(timer); window.removeEventListener("hub-widgets-refresh", tick); window.removeEventListener("dnd5e-changed", tick); };
  async function tick() {
    if (stopped || busy) return;
    if (!body.isConnected) { stop(); return; }
    if (document.hidden) return;
    busy = true;
    try {
      const model = await def.load(ctx, getIt, st);
      const key = JSON.stringify(model), size = sizeOf(def, getIt());
      if ((key !== lastModel || size !== lastSize) && !stopped) {
        const changed = lastModel !== null && key !== lastModel;
        lastModel = key; lastSize = size;
        body.replaceChildren(...[].concat(def.view(model, ctx, getIt, st, size)).filter(Boolean));
        body.classList.remove("swap"); void body.offsetWidth; body.classList.add("swap");   // (the effect, if graphics allow it, is css)
        if (changed && !def.quiet) { node.classList.remove("pulse"); void node.offsetWidth; node.classList.add("pulse"); setTimeout(() => node.classList.remove("pulse"), 1000); }
      }
    } catch { /* offline: the card keeps what it last showed */ }
    busy = false;
  }
  const timer = setInterval(tick, def.every || 4000);
  window.addEventListener("hub-widgets-refresh", tick);
  window.addEventListener("dnd5e-changed", tick);
  tick();
  return { dispose: stop, tick, shownSize: () => lastSize };
}

/** Fill a widget's card on the board (idempotent: the hub calls this on every sync, and nothing happens unless the widget changed). */
export function fillWidget(node, it, ctx) {
  const def = widgetDef(it.widget);
  const size = sizeOf(def || {}, it);
  node.className = `hub-card kind-widget w-${it.widget} s-${size}`;
  const sig = JSON.stringify([it.widget, it.data]);
  if (node.__widget?.sig === sig) {
    if (!node.querySelector(".hub-widget-grip")) node.append(el("span", { class: "hub-widget-grip", "aria-hidden": "true", title: "Drag to resize" }));
    if (node.__widget.shownSize() !== size) node.__widget.tick();   // (a new size redraws the card at the new level of detail)
    return;
  }
  node.__widget?.dispose();
  node.__widget = null;
  if (!def) { node.replaceChildren(empty("An unknown widget.")); return; }
  const head = el("div", { class: "hub-widget-head" }, [el("span", { class: "hub-widget-icon" }), el("strong", {}, def.title)]);
  head.firstChild.innerHTML = svg(ICONS[def.id] || ICONS.order);
  const body = el("div", { class: "hub-widget-body" });
  node.replaceChildren(head, body, el("span", { class: "hub-widget-grip", "aria-hidden": "true", title: "Drag to resize" }));
  node.__widget = { sig, ...mount(def, body, node, ctx) };
}
