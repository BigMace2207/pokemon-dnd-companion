// A small reusable widget: pick a Pokémon that's already saved somewhere —
// your own My Team, any connected player's team, the DM's NPC Library, or
// the DM's Wild Library — and hand it back to the caller, so calculators
// (and the DM's Full Turn console) can load a real saved Pokémon's level/
// item/ability/status/HP instead of starting from scratch every time.
//
// "Any Player" and the libraries live on the server (read-only from here —
// this widget never writes anything back); My Team is this browser's own
// localStorage. onPick(mon, meta) — meta.sourceKind is "team"/"player"/
// "npc"/"wild" and meta.sourceId identifies the owner (a trainer/NPC/wild
// id, or null for your own team), which the Full Turn console needs to
// route HP/status changes back to the right place later.

import { el, field } from "./components.js";
import { loadSave } from "./storage.js";
import { getNpcs, getNpc, getWildList, getWildMon, listTrainers, getTrainerTeam } from "./network.js";

export function makeSavedMonPicker({ onPick, title = "Load a Saved Pokémon", defaultSource = "team" }) {
  const sourceSelect = el("select", {}, [
    el("option", { value: "team" }, "My Team (Party + PC)"),
    el("option", { value: "player" }, "Any Online Player's Pokémon"),
    el("option", { value: "npc" }, "DM's NPC Library"),
    el("option", { value: "wild" }, "DM's Wild Library"),
  ]);
  sourceSelect.value = defaultSource;
  const monSelect = el("select", {}, [el("option", { value: "" }, "Loading…")]);
  const refreshBtn = el("button", { class: "btn secondary" }, "Refresh");
  const useBtn = el("button", { class: "btn secondary" }, "Use This Pokémon");

  let entries = []; // [{ mon, label, sourceKind, sourceId, sourceLabel }]

  async function refresh() {
    monSelect.innerHTML = "";
    monSelect.appendChild(el("option", { value: "" }, "Loading…"));
    entries = [];
    if (sourceSelect.value === "team") {
      const save = loadSave();
      [...save.party, ...save.pc].filter((m) => m.name).forEach((m) => {
        entries.push({ mon: m, label: `${m.nickname || m.name} (Lv.${m.level})`, sourceKind: "team", sourceId: save.networkId, sourceLabel: save.trainer.name || "You" });
      });
    } else if (sourceSelect.value === "player") {
      const trainers = await listTrainers("");
      for (const t of trainers) {
        const res = await getTrainerTeam(t.id);
        const mons = [...(res?.team?.party || []), ...(res?.team?.pc || [])].filter((m) => m.name);
        mons.forEach((m) => {
          entries.push({ mon: m, label: `${t.name}: ${m.nickname || m.name} (Lv.${m.level})`, sourceKind: "player", sourceId: t.id, sourceLabel: t.name });
        });
      }
    } else if (sourceSelect.value === "npc") {
      const npcs = await getNpcs();
      for (const n of npcs) {
        const full = await getNpc(n.id);
        (full?.team?.party || []).filter((m) => m.name).forEach((m) => {
          entries.push({ mon: m, label: `${n.name}: ${m.nickname || m.name} (Lv.${m.level})`, sourceKind: "npc", sourceId: n.id, sourceLabel: n.name });
        });
      }
    } else {
      const list = await getWildList();
      for (const w of list) {
        const full = await getWildMon(w.id);
        if (full?.name) entries.push({ mon: full, label: `${full.nickname || full.name} (Lv.${full.level})`, sourceKind: "wild", sourceId: w.id, sourceLabel: full.nickname || full.name });
      }
    }
    monSelect.innerHTML = "";
    if (!entries.length) {
      monSelect.appendChild(el("option", { value: "" }, "None found"));
      return;
    }
    entries.forEach((e, i) => monSelect.appendChild(el("option", { value: i }, e.label)));
  }

  sourceSelect.addEventListener("change", refresh);
  refreshBtn.addEventListener("click", refresh);
  useBtn.addEventListener("click", () => {
    const entry = entries[Number(monSelect.value)];
    if (entry) onPick(entry.mon, entry);
  });
  refresh();

  return el("div", { class: "card" }, [
    el("h4", {}, title),
    el("div", { class: "grid-3" }, [field("From", sourceSelect), field("Saved Pokémon", monSelect), refreshBtn]),
    useBtn,
  ]);
}
