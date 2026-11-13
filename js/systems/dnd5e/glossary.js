// The rules glossary: every doc entry on the Rules page (conditions, skills, damage types, rules sections, racial extras...)
// is also a *keyword*. Anywhere rules text is shown, keywords are found and turned into links that open that entry, with a
// hover card giving the short version. On the Rules page itself they are also coloured and bold. Matching (`makeMatcher`) is
// pure so Node can test it; the DOM part is `linkKeywords`.

import { loadSet } from "./data.js";
import { getSettings } from "./store.js";
import { getViewState, setViewState } from "../../viewState.js";
import { plainText, joinParagraphs } from "../../markdown.js";
import { DRAGONS } from "./engine/dragons.js";

// Entries the SRD data has no page for, written out so the keywords that mention them have somewhere to go.
const EXTRAS = [
  {
    id: "x:draconic-ancestry", name: "Draconic Ancestry", terms: ["Draconic Ancestry", "Draconic Ancestor"],
    desc: ["A dragonborn picks a type of dragon. It decides the damage type of the **Breath Weapon** and the damage you resist.", ...DRAGONS.map((d) => `- **${d.color}**: ${d.damage} damage, ${d.shape} (${d.save} save)`)],
  },
  {
    id: "x:breath-weapon", name: "Breath Weapon", terms: ["Breath Weapon"],
    desc: ["You can use your action to exhale destructive energy. The damage type, the area and the saving throw come from your **Draconic Ancestry**. Each creature in the area makes the saving throw (DC 8 + your Constitution modifier + your proficiency bonus); it takes 2d6 damage on a failure, half as much on a success. The damage rises to 3d6 at 6th level, 4d6 at 11th and 5d6 at 16th. After you use it you must finish a short or long rest to use it again."],
  },
  { id: "x:darkvision", name: "Darkvision", terms: ["Darkvision", "Superior Darkvision"], desc: ["You can see in dim light within the stated range as if it were bright light, and in darkness as if it were dim light. You can't discern colour in darkness, only shades of grey."] },
  { id: "x:fey-ancestry", name: "Fey Ancestry", terms: ["Fey Ancestry"], desc: ["You have advantage on saving throws against being **charmed**, and magic can't put you to sleep."] },
  { id: "x:trance", name: "Trance", terms: ["Trance"], desc: ["Elves don't need to sleep. Instead they meditate deeply, remaining semiconscious, for 4 hours a day, and gain the same benefit a human does from 8 hours of sleep."] },
  { id: "x:lucky", name: "Lucky (halfling)", terms: [], desc: ["When you roll a 1 on the d20 for an attack roll, ability check or saving throw, you can reroll the die and must use the new roll."] },
];
const EXTRA_GROUP = "Racial traits";

// Phrases (any case) that point at a Rules-page section, by section id.
const RULE_TERMS = {
  "advantage-and-disadvantage": ["advantage", "disadvantage"],
  "proficiency-bonus": ["proficiency bonus"],
  "saving-throws": ["saving throw", "saving throws", "death saving throw"],
  "ability-checks": ["ability check", "ability checks"],
  "resting": ["short rest", "long rest"],
  "cover": ["half cover", "three-quarters cover", "total cover"],
  "attunement": ["attunement", "attuned", "attune"],
  "actions-in-combat": ["opportunity attack", "bonus action", "reaction", "dodge action", "dash action", "disengage action"],
  "movement-and-position": ["difficult terrain"],
  "casting-a-spell": ["concentration", "spell slot", "spell slots", "ritual"],
  "damage-and-healing": ["temporary hit points", "hit points", "resistance", "vulnerability", "instant death", "unconscious"],
  "making-an-attack": ["critical hit", "attack roll", "unarmed strike"],
  "the-order-of-combat": ["initiative", "surprised"],
};
const PROPERTY_WORDS = new Set(["finesse", "versatile", "thrown", "loading", "ammunition", "two-handed"]);

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const GROUP_CLASS = { Conditions: "cond", "Damage types": "dmg", Skills: "stat", "Ability scores": "stat", "Schools of magic": "magic", "Weapon properties": "item", "Weapon mastery": "item", Rules: "rule", [EXTRA_GROUP]: "race" };

const HAS_RULE_CHAPTERS = new Set(["2014"]);
// Everything the Rules page lists, in order. 2014 also has the long rules chapters; 2024 does not.
export async function docItems(edition) {
  const [conditions, skills, ref] = await Promise.all([loadSet(edition, "conditions"), loadSet(edition, "skills"), loadSet(edition, "reference")]);
  const items = [];
  let rulesNote = null;
  try {
    if (!HAS_RULE_CHAPTERS.has(edition)) throw new Error("no chapters");   // (don't ask the server for a file that isn't there)
    const rules = await loadSet(edition, "rules");
    for (const cat of rules.categories) for (const id of cat.sections) {
      const s = rules.sections[id];
      if (s) items.push({ id: `rule:${id}`, name: s.name, group: cat.name, kind: "md", md: s.md, ruleId: id });
    }
  } catch { rulesNote = "The long rules chapters are not part of this version's SRD. Conditions, skills and the references below follow the rules this campaign uses."; }
  for (const c of (conditions.list || conditions)) items.push({ id: `cond:${c.id}`, name: c.name, group: "Conditions", kind: "desc", desc: c.desc });
  for (const s of (skills.list || skills)) items.push({ id: `skill:${s.id}`, name: s.name, group: "Skills", kind: "desc", desc: s.desc, sub: s.ability });
  const r = ref.list || ref;
  for (const a of r.abilityScores || []) items.push({ id: `ab:${a.id}`, name: a.name, group: "Ability scores", kind: "desc", desc: a.desc, sub: (a.skills || []).join(", ") });
  for (const a of r.alignments || []) items.push({ id: `al:${a.abbr}`, name: a.name, group: "Alignments", kind: "desc", desc: [].concat(a.desc) });
  for (const a of r.damageTypes || []) items.push({ id: `dt:${a.name}`, name: a.name, group: "Damage types", kind: "desc", desc: [].concat(a.desc) });
  for (const a of r.schools || []) items.push({ id: `sc:${a.name}`, name: a.name, group: "Schools of magic", kind: "desc", desc: [].concat(a.desc) });
  for (const a of r.weaponProperties || []) items.push({ id: `wp:${a.name}`, name: a.name, group: "Weapon properties", kind: "desc", desc: [].concat(a.desc) });
  for (const a of r.masteries || []) items.push({ id: `wm:${a.name}`, name: a.name, group: "Weapon mastery", kind: "desc", desc: [].concat(a.desc) });
  for (const x of EXTRAS) items.push({ id: x.id, name: x.name, group: EXTRA_GROUP, kind: "desc", desc: x.desc });
  for (const a of r.languages || []) items.push({ id: `lg:${a.name}`, name: a.name, group: "Languages", kind: "desc", desc: [`${a.type || ""}${a.script ? ` · script: ${a.script}` : ""}`, a.speakers?.length ? `Typical speakers: ${a.speakers.join(", ")}` : ""].filter(Boolean) });
  return { items, rulesNote };
}

const summaryOf = (item) => {
  const text = plainText(item.kind === "md" ? item.md.replace(/^#+[^\n]*\n/, "") : joinParagraphs(item.desc || []));
  return text.length > 230 ? `${text.slice(0, 227).replace(/\s+\S*$/, "")}…` : text;
};

// Turn doc items into keyword entries with the phrases that should match them.
export function buildEntries(items) {
  const byId = new Map(items.map((i) => [i.id, i]));
  const entries = [];
  const add = (item, terms, extra = {}) => { if (terms.length) entries.push({ id: item.id, name: item.name, group: item.group === "Conditions" || item.group in GROUP_CLASS ? item.group : "Rules", cls: GROUP_CLASS[item.group] || "rule", summary: summaryOf(item), terms, ...extra }); };
  for (const it of items) {
    if (it.group === "Conditions") add(it, [{ t: it.name }]);
    else if (it.group === "Skills" || it.group === "Ability scores") add(it, [{ t: it.name, cs: true }]);
    else if (it.group === "Damage types") add(it, [{ t: it.name, after: /^\s+damage/i }]);
    else if (it.group === "Schools of magic") add(it, [{ t: it.name }]);
    else if (it.group === "Weapon properties") add(it, PROPERTY_WORDS.has(it.name.toLowerCase()) ? [{ t: it.name }] : []);
    else if (it.group === "Weapon mastery") add(it, [{ t: it.name, cs: true }]);
  }
  for (const [ruleId, terms] of Object.entries(RULE_TERMS)) {
    const it = byId.get(`rule:${ruleId}`);
    if (it) add(it, terms.map((t) => ({ t })), { group: "Rules", cls: "rule" });
  }
  for (const x of EXTRAS) { const it = byId.get(x.id); if (it) add(it, x.terms.map((t) => ({ t })), { group: EXTRA_GROUP, cls: "race" }); }
  return entries;
}

// find(text) -> [{ start, end, entry }] (longest match wins, no overlaps)
export function makeMatcher(entries) {
  const ci = new Map(), cs = new Map(), after = new Map();
  for (const e of entries) for (const term of e.terms) {
    const key = term.t.toLowerCase();
    if (term.cs) cs.set(term.t, e); else if (term.after) after.set(key, [e, term.after]); else ci.set(key, e);
  }
  const build = (words, flags) => (words.length ? new RegExp(`(?<![\\w-])(?:${words.sort((a, b) => b.length - a.length).map(esc).join("|")})(?![\\w-])`, flags) : null);
  const reCi = build([...ci.keys()], "gi"), reCs = build([...cs.keys()], "g"), reAfter = build([...after.keys()], "gi");
  return {
    find(text) {
      const hits = [];
      const run = (re, pick) => { if (!re) return; re.lastIndex = 0; let m; while ((m = re.exec(text))) { const e = pick(m[0], text.slice(m.index + m[0].length)); if (e) hits.push({ start: m.index, end: m.index + m[0].length, entry: e }); } };
      run(reCi, (w) => ci.get(w.toLowerCase()));
      run(reCs, (w) => cs.get(w));
      run(reAfter, (w, rest) => { const [e, rx] = after.get(w.toLowerCase()) || []; return e && rx.test(rest) ? e : null; });
      hits.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
      const out = [];
      for (const h of hits) if (!out.length || h.start >= out[out.length - 1].end) out.push(h);
      return out;
    },
  };
}

// ---------------------------------------------------------------- loading
const cache = {};   // edition -> { items, rulesNote, matcher, entries }
export async function ensureGlossary(edition) {
  cache[edition] ||= docItems(edition).then(({ items, rulesNote }) => { const entries = buildEntries(items); return { items, rulesNote, entries, matcher: makeMatcher(entries) }; });
  return cache[edition];
}
const ready = {};
export function warmGlossary(edition = getSettings().edition) { return ensureGlossary(edition).then((g) => { ready[edition] = g; return g; }).catch(() => null); }

// ---------------------------------------------------------------- DOM
const SKIP = "a, button, input, textarea, select, code, pre, script, style, .kw, [data-nokw]";

// Wrap keywords inside `root` in links. opts.all links every occurrence (the Rules page, where they are also bold);
// otherwise only the first mention of each keyword is linked, which keeps ordinary text readable.
export function linkKeywords(root, { all = false } = {}) {
  const g = ready[getSettings().edition];
  if (!g || !root) return root;
  const seen = new Set();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  for (let n = walker.nextNode(); n && nodes.length < 4000; n = walker.nextNode()) if (n.nodeValue.trim().length > 2 && !n.parentElement?.closest(SKIP)) nodes.push(n);
  for (const node of nodes) {
    const text = node.nodeValue;
    const hits = g.matcher.find(text).filter((h) => all || !seen.has(h.entry.id));
    if (!hits.length) continue;
    const frag = document.createDocumentFragment();
    let last = 0;
    for (const h of hits) {
      if (!all && seen.has(h.entry.id)) continue;
      seen.add(h.entry.id);
      if (h.start > last) frag.append(text.slice(last, h.start));
      const a = document.createElement("a");
      a.className = `kw kw-${h.entry.cls}`;
      a.href = "#dndRules";
      a.dataset.kw = h.entry.id;
      a.dataset.tipTitle = h.entry.name;
      a.dataset.tip = h.entry.summary;
      a.dataset.tipHint = "Click to open in Rules";
      a.textContent = text.slice(h.start, h.end);
      frag.append(a);
      last = h.end;
    }
    frag.append(text.slice(last));
    node.replaceWith(frag);
  }
  return root;
}

// Open a Rules entry from anywhere.
export function openRules(id) {
  const key = `dnd:rules:${getSettings().edition}`;
  setViewState(key, { ...(getViewState(key, {}) || {}), q: "", filters: {}, sel: id });
  if (location.hash === "#dndRules") window.dispatchEvent(new CustomEvent("dnd-open-rules"));
  else location.hash = "dndRules";
}

let wired = false;
export function wireKeywordClicks() {
  if (wired) return;
  wired = true;
  document.addEventListener("click", (e) => {
    const a = e.target.closest?.("a.kw");
    if (!a) return;
    e.preventDefault();
    openRules(a.dataset.kw);
  });
}
