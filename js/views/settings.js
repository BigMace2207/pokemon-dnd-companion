import { el, field } from "../components.js";
import { getTheme, setTheme, getLavaFx, setLavaFx, getHiddenViews, setViewHidden, getSelectedCampaignId, clearSelectedCampaignId } from "../deviceSettings.js";
import {
  getCampaign, renameCampaign, regenerateInviteCode, regenerateDmPassword,
  removeCampaignMember, transferCampaignOwnership, deleteCampaign, listTrainers,
} from "../network.js";
import { loadSave } from "../storage.js";
import { renderAccountCard } from "../accountCard.js";
import { getViewState, setViewState } from "../viewState.js";
import { activeSystem } from "../systems/registry.js";

// Same grouping the sidebar itself uses (the active game system's nav, see
// js/systems/) -- shown in the same order so "which page is this" is obvious.
function pageGroups() {
  return activeSystem().nav.map(({ label, views }) => ({ label, views: views.map((v) => [v.id, v.label]) }));
}

function toggleSwitch(checked, onChange) {
  const input = el("input", { type: "checkbox" });
  input.checked = checked;
  input.addEventListener("change", () => onChange(input.checked));
  return el("label", { class: "toggle-switch" }, [input, el("span", { class: "slider" })]);
}

// A group of exclusive choices. When one starts out selected (active !== null)
// the highlight moves in place on click, so picking an option never has to
// rebuild the page (which would reset its scroll position).
function pillGroup(options, active, onPick) {
  const btns = options.map(([value, label]) => {
    const btn = el("button", { class: "pill-btn" + (active === value ? " active" : "") }, label);
    btn.addEventListener("click", () => {
      if (active !== null) btns.forEach((b) => b.classList.toggle("active", b === btn));
      onPick(value);
    });
    return btn;
  });
  return el("div", { class: "grid-3" }, btns);
}

// ---------------- Window mode (desktop app only) ----------------
// pywebview injects window.pywebview once its JS bridge is ready (fires
// well before a user could navigate here manually) -- absent in a regular
// browser tab, which is how this tells "running as the desktop app" apart
// from "someone's phone/laptop browser hitting the same server."
function renderWindowSection() {
  if (typeof window.pywebview === "undefined") return null;

  const statusOut = el("p", { class: "formula-note" }, "");
  const group = pillGroup(
    [["windowed", "Windowed"], ["borderless", "Borderless"], ["fullscreen", "Fullscreen"]],
    null,
    async (mode) => {
      try {
        const res = await window.pywebview.api.set_window_mode(mode);
        statusOut.textContent = res?.needsRestart
          ? "Saved — borderless mode applies next time you launch the app."
          : `Switched to ${mode}.`;
      } catch (e) {
        statusOut.textContent = `Couldn't change the window mode (${e}).`;
      }
    },
  );

  return el("div", { class: "card" }, [
    el("h4", {}, "Window"),
    group,
    statusOut,
  ]);
}

// ---------------- Fullscreen (mobile / regular browser) ----------------
// The standard Fullscreen API -- not offered inside the desktop app itself
// (the window above already covers that) and quietly hidden if the browser
// doesn't support it at all (notably iOS Safari, which only gets a real
// fullscreen, chrome-less view via "Add to Home Screen" instead).
function renderFullscreenSection() {
  if (typeof window.pywebview !== "undefined") return null;
  if (!document.fullscreenEnabled) return null;

  const btn = el("button", { class: "btn" }, document.fullscreenElement ? "Exit Fullscreen" : "Enter Fullscreen");
  btn.addEventListener("click", async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
      btn.textContent = document.fullscreenElement ? "Exit Fullscreen" : "Enter Fullscreen";
    } catch { /* ignore -- some browsers refuse without a fresh user gesture */ }
  });

  return el("div", { class: "card" }, [
    el("h4", {}, "Display"),
    btn,
  ]);
}

export function renderSettings(container) {
  const save = loadSave();
  const cid = getSelectedCampaignId();
  // One fetch per render, shared by the Campaign and Members tabs (and used to
  // decide whether the owner-only Members tab exists at all).
  let infoPromise = null;
  const loadInfo = () => (infoPromise ||= cid ? getCampaign(cid, save.networkId) : Promise.resolve(null));

  // ---------------- Appearance & display ----------------
  function appearanceCard() {
    const group = pillGroup(
      [["system", "System"], ["light", "Light"], ["dark", "Dark"], ["lava", "Lava Tower"]],
      getTheme(),
      (theme) => setTheme(theme),
    );
    const fx = pillGroup([["full", "Full effects"], ["calm", "Calm (no motion)"]], getLavaFx(), (mode) => setLavaFx(mode));
    return el("div", { class: "card" }, [
      el("h4", {}, "Appearance"), group,
      el("p", { class: "view-sub", style: "margin-top:12px" }, "Lava Tower: a grey-brick tower wall with lava, cracks of light and crumbling stone. The flame button in the top bar toggles it too."),
      el("h4", {}, "Lava effects"), fx,
    ]);
  }

  // ---------------- Campaign ----------------
  // Which campaign this device is in (see js/views/campaignSelect.js), and
  // for its owner: rename, invite code, DM password, members, delete.
  const loading = () => el("div", { class: "card" }, [el("p", { class: "view-sub" }, "Loading campaign info…")]);
  const unavailable = () => el("div", { class: "card" }, [el("p", { class: "view-sub" }, "Couldn't load campaign info — check your connection.")]);

  async function renderCampaignTab(panel) {
    if (!cid) { panel.appendChild(el("div", { class: "card" }, [el("p", { class: "view-sub" }, "You haven't picked a campaign yet.")])); return; }
    panel.appendChild(loading());
    const info = await loadInfo();
    panel.innerHTML = "";
    if (!info?.id) { panel.appendChild(unavailable()); return; }

    const switchBtn = el("button", { class: "btn secondary" }, "Switch Campaign");
    switchBtn.addEventListener("click", () => {
      if (!confirm(`Leave "${info.name}" and choose another campaign?`)) return;
      clearSelectedCampaignId();
      location.reload();
    });
    panel.appendChild(el("div", { class: "card" }, [
      el("h4", {}, info.name),
      el("p", { class: "view-sub" }, info.isOwner ? "You own this campaign." : "You're a member of this campaign."),
      switchBtn,
    ]));
    if (!info.isOwner) return;

    const nameInput = el("input", { type: "text", value: info.name });
    const renameBtn = el("button", { class: "btn secondary" }, "Rename");
    renameBtn.addEventListener("click", async () => {
      const name = nameInput.value.trim();
      if (!name) return;
      await renameCampaign(cid, name, save.networkId);
      refresh();
    });
    const codeInput = el("input", { type: "text", value: info.inviteCode });
    codeInput.readOnly = true;
    const regenCodeBtn = el("button", { class: "btn secondary" }, "New Code");
    regenCodeBtn.addEventListener("click", async () => {
      if (!confirm("Anyone still using the old invite code won't be able to join with it afterward. Continue?")) return;
      await regenerateInviteCode(cid, save.networkId);
      refresh();
    });
    const pwInput = el("input", { type: "text", value: info.dmPassword });
    pwInput.readOnly = true;
    const regenPwBtn = el("button", { class: "btn secondary" }, "New Password");
    regenPwBtn.addEventListener("click", async () => {
      if (!confirm("The current DM password will stop working. Continue?")) return;
      await regenerateDmPassword(cid, save.networkId);
      refresh();
    });
    panel.appendChild(el("div", { class: "card" }, [
      el("h4", {}, "Campaign Settings"),
      el("div", { class: "grid-2" }, [field("Campaign name", nameInput), renameBtn]),
      el("div", { class: "grid-2" }, [field("Invite code", codeInput), regenCodeBtn]),
      el("div", { class: "grid-2" }, [field("DM password", pwInput), regenPwBtn]),
    ]));

    const deleteBtn = el("button", { class: "btn secondary" }, "Delete Campaign");
    deleteBtn.addEventListener("click", async () => {
      if (!confirm(`Permanently delete "${info.name}"? Every trainer, save, and battle in it is gone for everyone — this can't be undone.`)) return;
      await deleteCampaign(cid, save.networkId);
      clearSelectedCampaignId();
      location.reload();
    });
    panel.appendChild(el("div", { class: "card settings-danger" }, [
      el("h4", {}, "Danger Zone"),
      deleteBtn,
    ]));
  }

  async function renderMembersTab(panel) {
    panel.appendChild(loading());
    const info = await loadInfo();
    panel.innerHTML = "";
    if (!info?.id) { panel.appendChild(unavailable()); return; }
    const trainers = await listTrainers("");
    const nameById = new Map(trainers.map((t) => [t.id, t.name]));
    const rows = (info.memberIds || []).map((mid) => {
      const idLabel = `${mid.slice(0, 14)}…`;
      const trainerName = nameById.get(mid);
      const label = trainerName ? `${trainerName} (${idLabel})` : idLabel;
      const isOwnerRow = mid === info.ownerId;
      const row = el("div", { class: "settings-page-row" }, [el("span", {}, label + (isOwnerRow ? " (owner)" : ""))]);
      if (!isOwnerRow) {
        const makeOwnerBtn = el("button", { class: "btn secondary" }, "Make Owner");
        makeOwnerBtn.addEventListener("click", async () => {
          if (!confirm(`Make ${label} the owner of this campaign? You'll become a regular member instead.`)) return;
          await transferCampaignOwnership(cid, mid, save.networkId);
          refresh();
        });
        const removeBtn = el("button", { class: "btn secondary" }, "Remove");
        removeBtn.addEventListener("click", async () => {
          if (!confirm(`Remove ${label} from this campaign? They'll need the invite code again to come back.`)) return;
          await removeCampaignMember(cid, mid, save.networkId);
          refresh();
        });
        row.append(makeOwnerBtn, removeBtn);
      }
      return row;
    });
    panel.appendChild(el("div", { class: "card" }, [el("h4", {}, `Members (${rows.length})`), ...rows]));
  }

  // ---------------- Sidebar pages ----------------
  function pagesCard() {
    const hidden = getHiddenViews();
    const groupEls = pageGroups().map(({ label, views }) => {
      const rows = views.map(([key, name]) => el("div", { class: "settings-page-row" }, [
        el("span", {}, name),
        toggleSwitch(!hidden.has(key), (visible) => setViewHidden(key, !visible)),
      ]));
      return el("div", {}, [label ? el("h4", { style: "margin-top:14px" }, label) : null, ...rows].filter(Boolean));
    });
    return el("div", { class: "card" }, [el("h4", {}, "Sidebar Pages"), ...groupEls]);
  }

  // ---------------- Tabs ----------------
  const TAB_KEY = "settings:tab";
  const tabDefs = [
    { id: "account", label: "Account", render: (panel) => panel.appendChild(renderAccountCard()) },
    { id: "campaign", label: "Campaign", render: renderCampaignTab },
    { id: "members", label: "Members", ownerOnly: true, render: renderMembersTab },
    {
      id: "appearance", label: "Appearance", render: (panel) => {
        panel.appendChild(appearanceCard());
        const windowSection = renderWindowSection();
        if (windowSection) panel.appendChild(windowSection);
        const fullscreenSection = renderFullscreenSection();
        if (fullscreenSection) panel.appendChild(fullscreenSection);
      },
    },
    { id: "pages", label: "Sidebar", render: (panel) => panel.appendChild(pagesCard()) },
  ];

  const tabBar = el("div", { class: "settings-tabs", role: "tablist" });
  const panel = el("div", { class: "settings-panel", role: "tabpanel" });
  let isOwner = false; // learned from the campaign info; reveals the Members tab

  function visibleTabs() { return tabDefs.filter((t) => !t.ownerOnly || isOwner); }

  function drawTabBar(activeId) {
    tabBar.innerHTML = "";
    visibleTabs().forEach((t) => {
      const btn = el("button", { class: "pill-btn" + (t.id === activeId ? " active" : ""), role: "tab", "aria-selected": String(t.id === activeId) }, t.label);
      btn.addEventListener("click", () => show(t.id));
      tabBar.appendChild(btn);
    });
  }

  function show(id) {
    const found = visibleTabs().find((t) => t.id === id);
    const tab = found || visibleTabs()[0];
    if (found) setViewState(TAB_KEY, tab.id); // a fallback (e.g. owner-only tab before ownership is known) isn't a choice
    drawTabBar(tab.id);
    panel.innerHTML = "";
    panel.classList.remove("tab-enter"); void panel.offsetWidth; panel.classList.add("tab-enter");
    tab.render(panel);
  }

  // Re-fetches the campaign info (after a rename, new code, removal, ...) and
  // redraws the current tab.
  function refresh() {
    infoPromise = null;
    show(getViewState(TAB_KEY, "account"));
  }

  container.innerHTML = "";
  container.appendChild(el("h1", { class: "view-title" }, "Settings"));
  container.append(tabBar, panel);
  show(getViewState(TAB_KEY, "account"));
  // The Members tab only exists for the campaign's owner; add it as soon as we know.
  loadInfo().then((info) => {
    // Only the tab bar is redrawn -- never the panel, which may have typing in it.
    if (info?.isOwner && !isOwner) {
      isOwner = true;
      const saved = getViewState(TAB_KEY, "account");
      if (saved === "members") show("members"); // they were last on it: now it can open
      else drawTabBar(saved);
    }
  });
}
