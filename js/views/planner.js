// The Whiteboard (it used to be called the Campaign Planner; its page id is still "planner"): one full-screen page in every game system (Pokémon D&D and D&D 5e), different for the DM and players.
//
// The whiteboard (js/planner/boardView.js) is the whole interface. Notes, checklists, generator results and dungeons are
// nodes you drag onto it. The longer tools open as drawers over the board, from buttons in its top bar:
//
//   Everyone: the Notebook (notes, NPCs, quests, locations, session recaps), Maps, the Party map the DM shares, and Sharing (the name your DM sees you as).
//   DM:       also Scenarios and Party plans (everyone's boards, notes and checklists, read-only). "DM" means the campaign's
//             DM password has been entered, the same unlock the other DM pages use; a player sees a "DM tools" button
//             where that password goes. A DM's own planner is private.

import { el, asyncView, textInput, field } from "../systems/dnd5e/ui.js";
import { getDmToken, withDm } from "../systems/dnd5e/dmAccess.js";
import { checkDmToken } from "../network.js";
import { activeSystem } from "../systems/registry.js";
import { setDmMode, pushShared, getPlan, mutatePlan, batched, displayName } from "../planner/store.js";
import { renderMapsTab } from "../planner/mapsTab.js";
import { renderNotesTab } from "../planner/notesTab.js";
import { renderPartyMapTab } from "../planner/partyMapTab.js";
import { renderScenariosTab } from "../planner/scenariosTab.js";
import { renderPartyTab } from "../planner/partyTab.js";
import { renderBoardApp } from "../planner/boardView.js";

export function renderPlanner(container) {
  container.replaceChildren();
  const holder = el("div", { class: "pl-page" });
  container.append(holder);
  const system = activeSystem()?.id || "dnd5e";

  asyncView(holder, async () => {
    const token = getDmToken();
    const dm = !!(token && await checkDmToken(token));
    setDmMode(dm);
    if (!dm) pushShared();   // a player's plan reaches the DM as soon as they open the planner

    const shared = { dm, system };
    const extras = [
      // Pokémon campaigns have no Notebook here: the DM's private notes are DM-only notes on the hub instead
      ...(system === "pokemon-dnd" ? [] : [{ id: "notes", label: dm ? "Notebook (private)" : "Notes (shared with your DM)", icon: "note", render: (host) => renderNotesTab(host, shared) }]),
      // Pokémon campaigns have the Map editor as its own page (a hub button, js/views/mapEditor.js)
      ...(system === "pokemon-dnd" ? [] : [{ id: "maps", label: dm ? "Map editor" : "Maps", icon: "map", full: true, render: (host, close, arg) => renderMapsTab(host, shared, arg) }]),
      { id: "partymap", label: dm ? "Hub map (what players see)" : "Hub map", icon: "compass", render: (host) => renderPartyMapTab(host) },
    ];
    if (dm) {
      extras.push(
        { id: "scenarios", label: "Scenarios", icon: "scroll", render: (host) => renderScenariosTab(host, shared) },
        { id: "party", label: "Party plans", icon: "users", render: (host) => renderPartyTab(host, { token }) },
      );
    } else {
      extras.push(
        { id: "share", label: "Sharing", icon: "share", render: sharingPanel },
        { id: "dm", label: "DM tools", icon: "lock", render: (host) => lockedDmTab(host, () => renderPlanner(container)) },
      );
    }
    const host = el("div", { class: "pl-host" });
    renderBoardApp(host, { system, extras });
    return [host];
  });
}

function sharingPanel(host) {
  const saveName = batched((fns) => mutatePlan((p) => fns.forEach((f) => f(p))), 600);
  host.append(
    el("p", { class: "view-sub" }, "Your DM can read your whiteboards, notes and checklists, so they can build the story around what you want to do. They cannot change them, and the DM's own planning stays private to the DM."),
    field("Shown to your DM as", textInput(getPlan().displayName || "", (v) => saveName((p) => { p.displayName = v.trim().slice(0, 60); }), { placeholder: displayName(), ariaLabel: "The name your DM sees" })),
    el("p", { class: "dnd-tiny dnd-muted" }, "A picture you upload as a board background stays on this device and is never shared."),
  );
}

function lockedDmTab(host, onUnlocked) {
  host.append(el("p", { class: "view-sub" }, "The DM gets scenarios and a view of every player's plans."));
  const gate = el("div");
  host.append(gate);
  withDm(gate, () => { onUnlocked(); }, { title: "Unlock DM tools" });
}
