// The gate screen shown before the rest of the app -- pick which campaign
// this device is playing in, create a new one, or join one with an invite
// code. Not part of the normal VIEWS router (see js/app.js): it renders
// straight into the main container and only calls onEnter() once a
// campaign has actually been chosen, at which point app.js mounts the
// real app scoped to that campaign (js/network.js's setActiveCampaign).

import { el, field } from "../components.js";
import { listMyCampaigns, createCampaign, joinCampaign } from "../network.js";
import { listSystems, getSystem } from "../systems/registry.js";

export async function renderCampaignSelect(container, networkId, onEnter) {
  container.innerHTML = "";
  container.appendChild(el("h1", { class: "view-title" }, "Choose Your Campaign"));

  const listCard = el("div", { class: "card" }, [el("p", { class: "view-sub" }, "Loading your campaigns…")]);
  container.appendChild(listCard);

  const nameInput = el("input", { type: "text", placeholder: "Campaign name, e.g. \"Kanto Sunday Group\"" });
  const systemSelect = el("select", {}, listSystems().map((s) =>
    el("option", s.status === "preview" ? { value: s.id, disabled: "" } : { value: s.id }, s.name + (s.status === "preview" ? " (coming soon)" : ""))));
  const systemHint = el("p", { class: "view-sub" }, "");
  const showHint = () => { systemHint.textContent = getSystem(systemSelect.value)?.tagline || ""; };
  systemSelect.addEventListener("change", showHint);
  showHint();
  const createBtn = el("button", { class: "btn" }, "Create Campaign");
  const createMsg = el("span", { class: "view-sub" }, "");
  const createCard = el("div", { class: "card" }, [
    el("h4", {}, "Create a New Campaign"),
    el("div", { class: "grid-2" }, [field("Campaign name", nameInput), field("Game system", systemSelect)]),
    systemHint,
    createBtn,
    createMsg,
  ]);
  container.appendChild(createCard);

  const codeInput = el("input", { type: "text", placeholder: "Invite code from the campaign owner" });
  const joinBtn = el("button", { class: "btn secondary" }, "Join Campaign");
  const joinMsg = el("span", { class: "view-sub" }, "");
  container.appendChild(el("div", { class: "card" }, [
    el("h4", {}, "Join an Existing Campaign"),
    el("div", { class: "grid-2" }, [field("Invite code", codeInput), joinBtn]),
    joinMsg,
  ]));

  container.appendChild(el("p", { class: "art-credit" },
    "All Pokémon art is provided by PokeAPI and originates from Nintendo, Game Freak and The Pokémon Company. This is an unofficial fan project and is not affiliated with or endorsed by them."));

  function campaignRow(c) {
    const enterBtn = el("button", { class: "btn secondary" }, "Enter");
    enterBtn.addEventListener("click", () => onEnter(c.id));
    return el("div", { class: "card", style: "display:flex;align-items:center;gap:14px;flex-wrap:wrap" }, [
      el("div", { style: "flex:1;min-width:160px" }, [
        el("div", { style: "font-weight:700;font-size:17px" }, [
          c.name, c.isOwner ? el("span", { class: "type-pill", style: "background:var(--gold);margin-left:8px;font-size:11px;vertical-align:middle" }, "OWNER") : null,
        ].filter(Boolean)),
        el("div", { class: "view-sub" }, `${getSystem(c.system)?.name || "Pokémon D&D"} · ${c.memberCount} member${c.memberCount === 1 ? "" : "s"}`),
      ]),
      enterBtn,
    ]);
  }

  async function refreshList() {
    const campaigns = await listMyCampaigns(networkId);
    listCard.innerHTML = "";
    if (!campaigns.length) {
      listCard.appendChild(el("p", { class: "view-sub" }, "You're not in any campaigns yet on this device — create one, or ask whoever's running yours for their invite code."));
      return;
    }
    listCard.remove();
    const rows = campaigns.map(campaignRow);
    container.insertBefore(el("div", {}, rows), createCard);
  }

  createBtn.addEventListener("click", async () => {
    if (!nameInput.value.trim()) { createMsg.textContent = "Give it a name first."; return; }
    createBtn.disabled = true;
    const result = await createCampaign(nameInput.value.trim(), networkId, systemSelect.value);
    createBtn.disabled = false;
    if (!result?.id) { createMsg.textContent = "Couldn't create the campaign — check your connection and try again."; return; }
    onEnter(result.id);
  });

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

  await refreshList();
}
