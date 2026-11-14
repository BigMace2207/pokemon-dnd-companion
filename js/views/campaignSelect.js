// The start screen: shown after signing in and before the rest of the app -- pick which campaign this device is playing in,
// create a new one, or join one with an invite code. It is two screens side by side (one above the other on a phone): the
// Dungeons & Dragons side, lava, and the Pokémon D&D side, deep space with Rayquaza's constellation as its logo. Each side lists
// that game's campaigns and creates new ones for that game. Not part of the normal VIEWS router (see js/app.js): it renders straight
// into the main container and only calls onEnter() once a campaign has actually been chosen, at which point app.js mounts the real
// app scoped to that campaign (js/network.js's setActiveCampaign).

import { el } from "../components.js";
import { listMyCampaigns, createCampaign, joinCampaign } from "../network.js";
import { getSystem } from "../systems/registry.js";
import { rayquazaConstellation } from "../constellation.js";
import { lavaSky } from "../lavaTheme.js";
import { logout } from "../account.js";

// the two sides: which game, what to call it, and the picture at the top
const SIDES = [
  { id: "dnd5e", cls: "dnd", title: "Dungeons & Dragons", blurb: "Characters, spells, monsters, dice and combat. A hub of lava and iron.", create: "Start a D&D campaign" },
  { id: "pokemon-dnd", cls: "pokemon", title: "Pokémon D&D", blurb: "Trainers, Pokémon, dice-based battles and catching, under a sky full of stars.", create: "Start a Pokémon campaign" },
];

// a d20 in lava colours: the Dungeons & Dragons side's logo
const D20 = `<svg viewBox="0 0 120 120" class="start-emblem" aria-hidden="true">
  <defs><linearGradient id="start-d20" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd27a"/><stop offset=".55" stop-color="#ff7a2a"/><stop offset="1" stop-color="#c8280e"/></linearGradient></defs>
  <polygon points="60,6 108,34 108,86 60,114 12,86 12,34" fill="rgba(24,6,3,.6)" stroke="url(#start-d20)" stroke-width="3" stroke-linejoin="round"/>
  <polygon points="60,6 108,86 12,86" fill="none" stroke="url(#start-d20)" stroke-width="2" stroke-linejoin="round"/>
  <path d="M12 34L60 60L108 34M60 60V114M60 60L12 86M60 60L108 86" fill="none" stroke="url(#start-d20)" stroke-width="1.6" stroke-linejoin="round" opacity=".7"/>
  <text x="60" y="76" text-anchor="middle" font-family="Cinzel, Georgia, serif" font-size="26" font-weight="700" fill="url(#start-d20)">20</text>
</svg>`;

export async function renderCampaignSelect(container, networkId, onEnter) {
  container.innerHTML = "";

  // ---- one side: its backdrop, logo, title, campaigns, and a way to start a new one
  const lists = new Map();
  function sidePanel(side) {
    const bg = el("div", { class: "start-bg", "aria-hidden": "true" }, side.cls === "dnd" ? [lavaSky("hub-lava-sky")] : [el("div", { class: "start-stars" }), el("div", { class: "start-nebula" })]);
    const logo = el("div", { class: "start-logo" });
    if (side.cls === "dnd") logo.innerHTML = D20; else logo.append(rayquazaConstellation("start-constellation"));
    const list = el("div", { class: "start-list" });
    lists.set(side.id, list);

    const name = el("input", { type: "text", class: "start-input", placeholder: "Name your campaign", "aria-label": `${side.title} campaign name`, maxlength: "60" });
    const edition = side.id === "dnd5e" ? el("select", { class: "start-input start-edition", "aria-label": "D&D rules version" }, [el("option", { value: "2014" }, "2014 rules (SRD 5.1)"), el("option", { value: "2024" }, "2024 rules (SRD 5.2)")]) : null;
    const go = el("button", { type: "button", class: "start-btn" }, "Create");
    const msg = el("p", { class: "start-msg", role: "status" });
    async function create() {
      if (!name.value.trim()) { msg.textContent = "Give it a name first."; return; }
      go.disabled = true; msg.textContent = "";
      const result = await createCampaign(name.value.trim(), networkId, side.id, edition ? edition.value : "2014");
      go.disabled = false;
      if (!result?.id) { msg.textContent = "Couldn't create the campaign. Check your connection and try again."; return; }
      onEnter(result.id);
    }
    go.addEventListener("click", create);
    name.addEventListener("keydown", (e) => { if (e.key === "Enter") create(); });

    return el("section", { class: `start-panel ${side.cls}`, "aria-label": side.title }, [
      bg,
      logo,
      el("h2", { class: "start-title" }, side.title),
      el("p", { class: "start-tag" }, side.blurb),
      list,
      el("div", { class: "start-new" }, [el("h3", {}, side.create), el("div", { class: "start-new-row" }, [name, go]), edition, msg].filter(Boolean)),
    ]);
  }

  function campaignRow(c) {
    const meta = `${c.memberCount} member${c.memberCount === 1 ? "" : "s"}`;
    const b = el("button", { type: "button", class: "start-camp", "aria-label": `Enter ${c.name}` }, [
      el("span", { class: "start-camp-main" }, [el("strong", {}, c.name), el("small", {}, meta)]),
      c.isOwner ? el("span", { class: "start-owner" }, "Owner") : null,
      el("span", { class: "start-go", "aria-hidden": "true" }, "→"),
    ].filter(Boolean));
    b.addEventListener("click", () => onEnter(c.id));
    return b;
  }

  // ---- join with a code (the code knows which game it is for)
  const codeInput = el("input", { type: "text", class: "start-input", placeholder: "Invite code from the campaign owner", "aria-label": "Invite code" });
  const joinBtn = el("button", { type: "button", class: "start-btn ghost" }, "Join a campaign");
  const joinMsg = el("span", { class: "start-msg", role: "status" });
  joinBtn.addEventListener("click", async () => {
    const code = codeInput.value.trim();
    if (!code) { joinMsg.textContent = "Enter an invite code first."; return; }
    joinBtn.disabled = true;
    const result = await joinCampaign(code, networkId);
    joinBtn.disabled = false;
    if (!result?.id) { joinMsg.textContent = "No campaign found with that invite code."; return; }
    onEnter(result.id);
  });
  codeInput.addEventListener("keydown", (e) => { if (e.key === "Enter") joinBtn.click(); });
  const signOut = el("button", { type: "button", class: "start-link" }, "Sign out");
  signOut.addEventListener("click", async () => { await logout(); location.reload(); });

  container.appendChild(el("div", { class: "start-page" }, [
    el("div", { class: "start-panels" }, SIDES.map(sidePanel)),
    el("div", { class: "start-join" }, [codeInput, joinBtn, joinMsg, signOut]),
  ]));

  // ---- fill in each side's campaigns
  const campaigns = (await listMyCampaigns(networkId)) || [];
  for (const side of SIDES) {
    const mine = campaigns.filter((c) => (getSystem(c.system) ? c.system : "pokemon-dnd") === side.id);
    lists.get(side.id).replaceChildren(...(mine.length ? mine.map(campaignRow) : [el("p", { class: "start-empty" }, "No campaigns yet. Start one below, or join with an invite code.")]));
  }
}
