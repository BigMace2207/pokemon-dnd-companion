// Scenarios (DM only): write an adventure as a title, a hook, a summary and an ordered list of scenes. Each scene has
// read-aloud text, details, NPCs, foes, secrets and clues, rewards and "if the players..." branches, and a Generate
// menu that drops a generated NPC, encounter, route and so on into the scene. Start from a template, export to
// Markdown, or turn the scenes into a prep checklist.

import { el, btn, chip, selectEl, textInput, field, debounce, toast, confirmDialog, download } from "../systems/dnd5e/ui.js";
import { getPlan, mutatePlan, newScenario, newScene, newList, batched } from "./store.js";
import { textGenerators, resultText } from "./textGens.js";
import { getSettings } from "../systems/dnd5e/store.js";

const KINDS = [["social", "Social"], ["exploration", "Exploration"], ["combat", "Combat"], ["puzzle", "Puzzle / trap"], ["travel", "Travel"], ["boss", "Boss"], ["reveal", "Reveal"], ["rest", "Rest / downtime"]];
const STATUS = [["draft", "Draft"], ["ready", "Ready to run"], ["played", "Played"]];
const FIELDS = [["location", "Location", 1], ["readAloud", "Read aloud", 3], ["body", "What happens", 4], ["npcs", "NPCs", 2], ["foes", "Foes and encounters", 3], ["secrets", "Secrets and clues", 3], ["rewards", "Rewards", 2], ["branches", "If the players…", 3]];

const scene = (title, kind, body = "") => ({ ...newScene(title, kind), body });
const TEMPLATES = {
  dnd5e: [
    ["Three-act one-shot", { hook: "Something small is wrong in town, and it points to something much bigger.", summary: "Act 1 draws the party in, act 2 raises the stakes with a twist, act 3 is a showdown with a real choice in it.", scenes: [scene("Act 1: the hook", "social", "Introduce the problem and a reason each character cares."), scene("Act 1: the road", "travel", "A short scene that shows the world and hints at the danger."), scene("Act 2: the complication", "exploration", "The obvious plan fails. Something is not what it seemed."), scene("Act 2: the twist", "reveal", "Reveal who is really behind it, or what it really is."), scene("Act 3: the showdown", "boss", "The final confrontation. Give the party a choice, not just a fight."), scene("Epilogue", "rest", "What changed? Rewards, rumours, and a hook for next time.")] }],
    ["Dungeon crawl", { hook: "A map, a rumour of treasure, and a ruin nobody has come back from.", summary: "Approach, a guardian, a puzzle, the lair, and a way out.", scenes: [scene("Approach", "travel", "Signs of what lives here."), scene("The guardian", "combat", "A gatekeeper creature or construct."), scene("The puzzle room", "puzzle", "A trap or puzzle with more than one solution."), scene("The lair", "boss", "The master of the place and its treasure."), scene("Getting out", "exploration", "The place reacts: collapse, reinforcements, a chase.")] }],
    ["Mystery", { hook: "Someone is dead, missing or robbed, and everyone has a reason to lie.", summary: "Establish the crime, gather clues from three sources, hit a false lead, then reveal.", scenes: [scene("The scene of the crime", "exploration", "Three clues, each pointing at a different suspect."), scene("Interviews", "social", "Each witness knows one thing and hides another."), scene("The false lead", "combat", "A trail that ends in the wrong person."), scene("The reveal", "reveal", "Put the true culprit and the proof in front of the party."), scene("Confrontation", "boss", "How does the culprit react when cornered?")] }],
    ["Heist", { hook: "A job with a big payday and a very short window.", summary: "Plan, infiltrate, deal with a complication, escape.", scenes: [scene("The plan", "social", "Let the players case the place and choose a plan."), scene("Infiltration", "exploration", "Guards, locks and a way in for each character's skills."), scene("The complication", "puzzle", "Something unplanned. Make them improvise."), scene("The escape", "travel", "A chase, a double-cross, or a quiet walk out.")] }],
  ],
  "pokemon-dnd": [
    ["Route adventure", { hook: "The only way to the next town is a route that has been getting stranger lately.", summary: "Cross the route: trainers, a wild Pokémon event, a rival, and a reward at the end.", scenes: [scene("Arriving at the route", "travel", "Describe the terrain and the first signs that something is off."), scene("Trainer battles", "combat", "Two or three trainers on the way. Use the Trainer generator."), scene("The wild event", "exploration", "A rare Pokémon, a lost child's Pokémon, or a nest to protect."), scene("The rival", "boss", "The rival turns up with a stronger team than last time."), scene("Reward", "rest", "Items, a TM or a shortcut, and the road to the next town.")] }],
    ["Gym challenge", { hook: "The next badge is in a town where nobody wants to talk about the gym.", summary: "Rumours, the gym's gimmick, the apprentices, the leader and the badge ceremony.", scenes: [scene("Town and rumours", "social", "What does the town think of the leader? What does the leader want?"), scene("The gym puzzle", "puzzle", "The type-themed gimmick that gets you to the leader."), scene("Apprentices", "combat", "Two to four trainers with themed teams."), scene("The leader", "boss", "Use the Gym leader generator for a team that scales with the badge number."), scene("Badge ceremony", "rest", "The badge, the TM, and a hint of the next challenge.")] }],
    ["Team hideout", { hook: "Pokémon are going missing, and a gang's logo has been seen near the scene.", summary: "Spot the gang, get inside, beat the grunts, face the boss, deal with the aftermath.", scenes: [scene("Spotting the gang", "exploration", "Tracks, witnesses, a stolen delivery."), scene("Getting in", "puzzle", "A disguise, a back door, or a loud front entrance."), scene("The grunts", "combat", "Several quick battles with Poison and Dark teams."), scene("The boss", "boss", "Their commander and a captured Pokémon at stake."), scene("Aftermath", "social", "The rescued Pokémon and what the gang was really after.")] }],
    ["Pokémon rescue", { hook: "A call for help from someone whose Pokémon has gone missing.", summary: "Find the trail, overcome an obstacle, confront whatever took it, and bring it home.", scenes: [scene("The request", "social", "Who asks, and what are they not saying?"), scene("Tracking", "exploration", "Footprints, berries and a wild Pokémon that saw something."), scene("The obstacle", "puzzle", "A cave-in, a river, a locked gate."), scene("The confrontation", "boss", "Not always a villain: maybe the Pokémon is scared or protecting an egg."), scene("Home again", "rest", "A thank-you, a reward, and perhaps an unexpected gift.")] }],
  ],
};

export function scenarioToMarkdown(s) {
  const out = [`# ${s.title || "Untitled scenario"}`, `*${(STATUS.find(([v]) => v === s.status) || [, ""])[1]}${s.level ? ` · level ${s.level}` : ""}${s.players ? ` · ${s.players} players` : ""}*`, ""];
  if (s.hook) out.push("## Hook", s.hook, "");
  if (s.summary) out.push("## Summary", s.summary, "");
  out.push("## Scenes", "");
  s.scenes.forEach((sc, i) => {
    out.push(`### ${i + 1}. ${sc.title || "Scene"} (${(KINDS.find(([v]) => v === sc.kind) || [, sc.kind])[1]})${sc.done ? " — done" : ""}`);
    for (const [key, label] of FIELDS) if (sc[key]?.trim()) out.push(key === "readAloud" ? `> ${sc[key].trim().replace(/\n/g, "\n> ")}` : `**${label}:** ${sc[key].trim()}`, "");
  });
  return out.join("\n");
}

export function renderScenariosTab(panel, { system }) {
  let selected = getPlan().scenarios[0]?.id || null;
  const list = el("div", { class: "dnd-list", role: "listbox" });
  const editor = el("div", { class: "card dnd-detail pl-scenario" });
  const templates = TEMPLATES[system] || TEMPLATES.dnd5e;
  const scenarios = () => getPlan().scenarios;

  const create = selectEl([["", "+ New scenario…"], ["blank", "Blank scenario"], ...templates.map(([n], i) => [`t${i}`, `Template: ${n}`])], "", (v) => {
    if (!v) return;
    const s = newScenario(v === "blank" ? "Untitled scenario" : templates[Number(v.slice(1))][0]);
    if (v !== "blank") { const t = templates[Number(v.slice(1))][1]; s.hook = t.hook; s.summary = t.summary; s.scenes = t.scenes.map((x) => ({ ...x, id: newScene().id })); }
    mutatePlan((p) => { p.scenarios.unshift(s); });
    selected = s.id; create.value = ""; drawList(); drawEditor();
  });

  function drawList() {
    const rows = scenarios().sort((a, b) => b.updated - a.updated);
    list.replaceChildren(...(rows.length ? rows.map((s) => {
      const done = s.scenes.filter((x) => x.done).length;
      const b = el("button", { type: "button", class: `dnd-list-item${s.id === selected ? " active" : ""}`, role: "option", "aria-selected": String(s.id === selected) }, [
        el("span", { class: "dnd-grow" }, s.title || "Untitled"), el("span", { class: "meta" }, `${(STATUS.find(([v]) => v === s.status) || [, ""])[1]} · ${done}/${s.scenes.length}`),
      ]);
      b.addEventListener("click", () => { selected = s.id; drawList(); drawEditor(); });
      return b;
    }) : [el("p", { class: "view-sub", style: "padding:12px" }, "No scenarios yet. Choose a template to get started.")]));
  }

  const patch = (id, fn) => mutatePlan((p) => { const s = p.scenarios.find((x) => x.id === id); if (s) { fn(s); s.updated = Date.now(); } });

  function drawEditor() {
    const s = scenarios().find((x) => x.id === selected);
    if (!s) { editor.replaceChildren(el("p", { class: "view-sub" }, "Pick a scenario, or create one from a template.")); return; }
    const saveTop = batched((fns) => patch(s.id, (x) => fns.forEach((f) => f(x))), 400);
    const title = textInput(s.title, (v) => { saveTop((x) => { x.title = v; }); const r = list.querySelector(".active .dnd-grow"); if (r) r.textContent = v || "Untitled"; }, { placeholder: "Scenario title", ariaLabel: "Scenario title" });
    title.classList.add("dnd-name-input");
    const area = (label, key, rows) => field(label, textInput(s[key] || "", (v) => saveTop((x) => { x[key] = v; }), { multiline: true, rows, ariaLabel: label }));
    const scenesHost = el("div", { class: "dnd-stack" });

    function drawScenes() {
      const cur = scenarios().find((x) => x.id === s.id);
      scenesHost.replaceChildren(...cur.scenes.map((sc, i) => sceneCard(cur, sc, i)));
    }
    function sceneCard(cur, sc, i) {
      const saveScene = batched((fns) => patch(cur.id, (x) => { const r = x.scenes.find((y) => y.id === sc.id); if (r) fns.forEach((f) => f(r)); }), 400);
      const inputs = {};
      const fieldEls = FIELDS.map(([key, label, rows]) => {
        const ta = textInput(sc[key] || "", (v) => saveScene((r) => { r[key] = v; }), { multiline: rows > 1, rows, ariaLabel: label });
        inputs[key] = ta;
        return field(label, ta);
      });
      const gens = textGenerators(system);
      const genSel = selectEl(gens.map((g) => [g.id, g.label]), gens[0]?.id, () => {});
      const into = selectEl(FIELDS.map(([k, l]) => [k, l]), "body", () => {});
      const insert = btn("Generate and insert", async (e) => {
        const g = gens.find((x) => x.id === genSel.value);
        const ctx = { level: parseInt(cur.level, 10) || 5, size: parseInt(cur.players, 10) || 4, difficulty: "medium", edition: getSettings().edition };
        const orig = e.currentTarget; orig.disabled = true;
        try {
          const text = resultText(await g.run(ctx, Math.random));
          const ta = inputs[into.value];
          ta.value = ta.value.trim() ? `${ta.value.trim()}\n\n${text}` : text;
          saveScene((r) => { r[into.value] = ta.value; });
          toast("Added to the scene.", "good");
        } catch (err) { toast(`Couldn't generate that: ${err.message || err}`, "bad"); }
        orig.disabled = false;
      }, "btn secondary small");
      const title = textInput(sc.title, (v) => saveScene((r) => { r.title = v; }), { placeholder: "Scene title", ariaLabel: "Scene title" });
      const kind = selectEl(KINDS, sc.kind, (v) => saveScene((r) => { r.kind = v; }));
      const done = el("input", { type: "checkbox", "aria-label": "Scene played" });
      done.checked = !!sc.done;
      done.addEventListener("change", () => { patch(cur.id, (x) => { x.scenes.find((y) => y.id === sc.id).done = done.checked; }); drawList(); });
      const move = (d) => { patch(cur.id, (x) => { const j = i + d; if (j >= 0 && j < x.scenes.length) [x.scenes[i], x.scenes[j]] = [x.scenes[j], x.scenes[i]]; }); drawScenes(); };
      return el("details", { class: "dnd-fold pl-scene", open: i === 0 ? "" : null }, [
        el("summary", {}, [el("span", { class: "pl-scene-n" }, String(i + 1)), " ", sc.title || "Scene", " ", chip((KINDS.find(([v]) => v === sc.kind) || [, sc.kind])[1])]),
        el("div", { class: "dnd-row" }, [done, el("span", { class: "dnd-small" }, "played"), el("div", { class: "dnd-grow" }, title), kind]),
        el("div", { class: "dnd-grid-2" }, fieldEls),
        el("div", { class: "dnd-row" }, [el("span", { class: "dnd-small dnd-muted" }, "Generate:"), genSel, el("span", { class: "dnd-small dnd-muted" }, "into"), into, insert]),
        el("div", { class: "dnd-row" }, [
          btn("↑ Up", () => move(-1), "btn secondary tiny"), btn("↓ Down", () => move(1), "btn secondary tiny"),
          btn("Duplicate", () => { patch(cur.id, (x) => { x.scenes.splice(i + 1, 0, { ...sc, id: newScene().id, title: `${sc.title} (copy)`, done: false }); }); drawScenes(); }, "btn secondary tiny"),
          btn("Delete scene", async () => { if (await confirmDialog(`Delete the scene "${sc.title}"?`, { ok: "Delete", danger: true })) { patch(cur.id, (x) => { x.scenes = x.scenes.filter((y) => y.id !== sc.id); }); drawScenes(); drawList(); } }, "btn danger tiny"),
        ]),
      ].filter(Boolean));
    }
    const addKind = selectEl(KINDS, "social", () => {});
    drawScenes();
    editor.replaceChildren(
      title,
      el("div", { class: "dnd-grid-2" }, [
        field("Status", selectEl(STATUS, s.status, (v) => { patch(s.id, (x) => { x.status = v; }); drawList(); })),
        field("Party level / players", el("div", { class: "dnd-row" }, [
          textInput(s.level, (v) => saveTop((x) => { x.level = v; }), { placeholder: "level", ariaLabel: "Party level" }),
          textInput(s.players, (v) => saveTop((x) => { x.players = v; }), { placeholder: "players", ariaLabel: "Number of players" }),
        ])),
      ]),
      area("Hook", "hook", 3), area("Summary", "summary", 4),
      el("div", { class: "dnd-section-head" }, [el("h4", {}, "Scenes"), el("div", { class: "dnd-row" }, [addKind, btn("+ Add scene", () => { patch(s.id, (x) => { x.scenes.push(newScene("New scene", addKind.value)); }); drawScenes(); drawList(); }, "btn secondary small")])]),
      scenesHost,
      el("div", { class: "dnd-row" }, [
        btn("Copy as Markdown", () => { navigator.clipboard?.writeText(scenarioToMarkdown(scenarios().find((x) => x.id === s.id))); toast("Copied.", "good"); }, "btn secondary small"),
        btn("Download .md", () => { const cur = scenarios().find((x) => x.id === s.id); download(`${(cur.title || "scenario").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.md`, scenarioToMarkdown(cur), "text/markdown"); }, "btn secondary small"),
        btn("Make a prep checklist", () => { const cur = scenarios().find((x) => x.id === s.id); mutatePlan((p) => { p.lists.unshift(newList(`Prep: ${cur.title || "scenario"}`, cur.scenes.map((sc) => `Prepare: ${sc.title}`))); }); toast("Added to your checklists.", "good"); }, "btn secondary small"),
        btn("Delete scenario", async () => { if (await confirmDialog(`Delete "${s.title || "this scenario"}" and all its scenes?`, { ok: "Delete", danger: true })) { mutatePlan((p) => { p.scenarios = p.scenarios.filter((x) => x.id !== s.id); }); selected = scenarios()[0]?.id || null; drawList(); drawEditor(); } }, "btn danger small"),
      ]),
    );
  }

  panel.append(
    el("p", { class: "pl-banner" }, "Private to you: players never see your scenarios."),
    el("div", { class: "dnd-split" }, [el("div", {}, [el("div", { class: "card", style: "margin-bottom:12px" }, create), list]), editor]),
  );
  drawList(); drawEditor();
}
