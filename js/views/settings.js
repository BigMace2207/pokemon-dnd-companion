import { el, field } from "../components.js";
import { getGfx, setGfx } from "../gfx.js";
import { hubSound, hubSoundOn, setHubSoundOn, getAudioLevels, setAudioLevel, playCry } from "../hubSound.js";
import { getForcedTheme, getTheme, setTheme, getLavaFx, setLavaFx, getHiddenViews, setViewHidden, getSelectedCampaignId, clearSelectedCampaignId } from "../deviceSettings.js";
import {
  getCampaign, renameCampaign, setCampaignEdition, regenerateInviteCode, setCampaignDm, getRoster,
  removeCampaignMember, transferCampaignOwnership, deleteCampaign, listTrainers,
} from "../network.js";
import { loadSave, writeSave } from "../storage.js";
import { CURSOR_COLORS, cursorColorOf } from "../cursorColor.js";
import { getLayoutPref, setLayoutPref } from "../mobileMode.js";
import { renderAccountCard } from "../accountCard.js";
import { fetchMe } from "../account.js";
import { renderAdmin } from "./admin.js";
import { getViewState, setViewState } from "../viewState.js";
import { activeSystem } from "../systems/registry.js";
import { SIZE_PARTS, SIZE_RANGE, TEXT_RANGE, GLASS_RANGE, clampPct, getUi, setUi, setPartSize, resetSizes } from "../uiPrefs.js";

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
    if (getForcedTheme() === "lava") {
      const fx = pillGroup([["full", "Full effects"], ["calm", "Calm (no motion)"]], getLavaFx(), (mode) => setLavaFx(mode));
      return el("div", { class: "card" }, [
        el("h4", {}, "Appearance"),
        el("p", { class: "view-sub" }, "D&D campaigns use the Lava theme on every page: glass over a blurred, slowly churning lava sea. Pokémon D&D campaigns use the Cosmic theme."),
        el("h4", {}, "Lava effects"), fx,
      ]);
    }
    if (getForcedTheme() === "cosmic") {
      return el("div", { class: "card" }, [
        el("h4", {}, "Appearance"),
        el("p", { class: "view-sub" }, "Pokémon D&D campaigns use the Cosmic theme on every page: deep space, glass and white pills. D&D campaigns use the Lava theme."),
      ]);
    }
    const group = pillGroup(
      [["system", "System"], ["light", "Light"], ["dark", "Dark"], ["lava", "Lava"]],
      getTheme(),
      (theme) => setTheme(theme),
    );
    const fx = pillGroup([["full", "Full effects"], ["calm", "Calm (no motion)"]], getLavaFx(), (mode) => setLavaFx(mode));
    return el("div", { class: "card" }, [
      el("h4", {}, "Appearance"), group,
      el("p", { class: "view-sub", style: "margin-top:12px" }, "Lava: glass over a blurred, slowly churning lava sea."),
      el("h4", {}, "Lava effects"), fx,
    ]);
  }

  // Graphics (js/gfx.js): how much of the cosmic sky moves, for slower phones and laptops
  function graphicsCard() {
    const group = pillGroup([["low", "Low"], ["medium", "Medium"], ["high", "High"]], getGfx(), (level) => setGfx(level));
    return el("div", { class: "card" }, [
      el("h4", {}, "Graphics"), group,
      el("p", { class: "view-sub", style: "margin-top:12px" }, "High: the full sky, with stars at full speed, a drifting nebula and frosted glass. Medium (the default): the same sky at a gentler pace, a still nebula and solid glass. Low: a still sky that only moves when you pan or zoom. On the hub, pages and widgets follow it too: Low has no motion at all, Medium adds pages rising in, widgets gliding into place and resizing smoothly and a pulse when a widget's numbers change, and High adds a slow shine across widgets. Pick a lower setting if the hub feels slow on this device."),
    ]);
  }

  // Sound for this device (js/hubSound.js): on or off, and a level each for everything, the sound effects, the
  // background ambience (js/ambience.js) and the Pokémon cries. Letting go of a slider plays a sample at the new level.
  function soundCard() {
    const lv = getAudioLevels();
    const dnd = activeSystem()?.id === "dnd5e";   // a D&D campaign has no Pokémon cries
    const rows = [
      ["master", "Master", "Everything at once"],
      ["sfx", "Sound effects", dnd ? "Clicks, drags, drops, items, the Whiteboard and dice" : "Clicks, drags, drops, items, Whiteboard and battle moves"],
      ["ambience", "Ambience", dnd ? "The background: a lava river, crackling embers and a low drone" : "The slow, spatial background in Pokémon campaigns"],
      ...(dnd ? [] : [["pokemon", "Pokémon", "Cries when a Pokémon comes out of the Pokédex or your team"]]),
    ];
    const sample = (key) => {
      if (key === "pokemon") playCry(25, "Pikachu");
      else if (key !== "ambience") hubSound("click");
    };
    const sliders = rows.map(([key, label, hint]) => {
      const value = el("span", { class: "audio-value" }, `${lv[key]}%`);
      const input = el("input", { type: "range", min: "0", max: "100", step: "1", value: String(lv[key]), class: "audio-slider", "aria-label": `${label} volume` });
      input.style.setProperty("--fill", `${lv[key]}%`);
      input.addEventListener("input", () => { setAudioLevel(key, input.value); value.textContent = `${input.value}%`; input.style.setProperty("--fill", `${input.value}%`); });
      input.addEventListener("change", () => sample(key));
      return el("div", { class: "audio-row" }, [el("div", { class: "audio-label" }, [el("strong", {}, label), el("span", {}, hint)]), input, value]);
    });
    const list = el("div", { class: `audio-sliders${hubSoundOn() ? "" : " off"}` }, sliders);
    return el("div", { class: "card" }, [
      el("h4", {}, "Audio"),
      el("div", { class: "settings-dm-toggle" }, [toggleSwitch(hubSoundOn(), (on) => { setHubSoundOn(on); list.classList.toggle("off", !on); if (on) hubSound("click"); }), el("span", {}, "Sound on this device")]),
      list,
    ]);
  }

  // Phone layout: the separate copy of the interface built for phones (css/mobile.css, js/mobile/). Automatic turns it on
  // for a touch screen up to 820px wide; this device can also always or never use it.
  function layoutCard() {
    const group = pillGroup([["auto", "Automatic"], ["phone", "Always"], ["desktop", "Never"]], getLayoutPref(), (pref) => setLayoutPref(pref));
    return el("div", { class: "card" }, [
      el("h4", {}, "Phone layout"), group,
      el("p", { class: "view-sub", style: "margin-top:12px" }, "The phone layout puts the hub's tools and pages on one wheel at the bottom of the screen, turns panels into sheets you can drag down, and keeps everything clear of the notch. Automatic uses it on phones."),
    ]);
  }

  // The colour of your cursor (and the name tag above it) on the hub's shared board.
  function cursorCard() {
    const current = cursorColorOf(loadSave());
    const preview = el("span", { class: "cursor-preview", style: `--c:${current}` }, [el("span", { class: "cursor-preview-arrow" }), el("span", { class: "cursor-preview-name" }, loadSave().trainer?.name || "You")]);
    const pick = (c) => {
      const s2 = loadSave();
      s2.trainer = { ...(s2.trainer || {}), cursorColor: c };
      writeSave(s2);
      preview.style.setProperty("--c", c);
      row.querySelectorAll(".cursor-swatch").forEach((b) => b.classList.toggle("active", b.dataset.c === c));
      custom.value = c;
    };
    const row = el("div", { class: "cursor-swatches" }, CURSOR_COLORS.map((c) => {
      const b = el("button", { type: "button", class: `cursor-swatch${c === current ? " active" : ""}`, style: `--c:${c}`, "data-c": c, "aria-label": `Cursor colour ${c}` });
      b.addEventListener("click", () => pick(c));
      return b;
    }));
    const custom = el("input", { type: "color", value: current, "aria-label": "Any colour" });
    custom.addEventListener("input", () => pick(custom.value));
    row.append(custom);
    return el("div", { class: "card" }, [
      el("h4", {}, "Cursor colour"),
      el("p", { class: "view-sub" }, "On the hub, everyone sees your cursor in this colour with your name above it."),
      row, preview,
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
      info.system === "dnd5e" ? el("p", { class: "view-sub" }, info.edition ? `Rules version: D&D ${info.edition}. The owner decides this for everyone.` : "Rules version: not set yet, so each player picks their own.") : null,
      switchBtn,
    ].filter(Boolean)));
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
    // D&D only: which rules version the whole table plays by, so players never end up on different books
    const editionSel = el("select", {}, [el("option", { value: "2014" }, "2014 rules (SRD 5.1)"), el("option", { value: "2024" }, "2024 rules (SRD 5.2)")]);
    editionSel.value = info.edition || "2014";
    const editionBtn = el("button", { class: "btn secondary" }, info.edition ? "Change" : "Set for everyone");
    editionBtn.addEventListener("click", async () => {
      if (editionSel.value === info.edition) return;
      if (!confirm(`Switch this campaign to the ${editionSel.value} rules? Everyone sees the new rules the next time they open the app. Characters already built on the other version keep their own rules and are flagged on the Characters page.`)) return;
      await setCampaignEdition(cid, editionSel.value, save.networkId);
      refresh();
    });
    const editionRow = info.system === "dnd5e" ? [el("div", { class: "grid-2" }, [field("D&D rules version for the whole table", editionSel), editionBtn])] : [];
    panel.appendChild(el("div", { class: "card" }, [
      el("h4", {}, "Campaign Settings"),
      el("div", { class: "grid-2" }, [field("Campaign name", nameInput), renameBtn]),
      ...editionRow,
      el("div", { class: "grid-2" }, [field("Invite code", codeInput), regenCodeBtn]),
      el("p", { class: "view-sub" }, "DMs: you're always one. Make other members DMs (or stop them being one) in Members."),
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
    // names for everyone, online or not (the roster), and who is a DM
    const roster = (await getRoster()) || await listTrainers("");
    const nameById = new Map(roster.map((t) => [t.id, t.name]));
    const dmIds = new Set(info.dmIds || []);
    const rows = (info.memberIds || []).map((mid) => {
      const idLabel = `${mid.slice(0, 14)}…`;
      const trainerName = nameById.get(mid);
      const label = trainerName ? `${trainerName} (${idLabel})` : idLabel;
      const isOwnerRow = mid === info.ownerId;
      const row = el("div", { class: "settings-page-row" }, [el("span", {}, label + (isOwnerRow ? " (owner, always a DM)" : ""))]);
      if (!isOwnerRow) {
        // DM access: their DM tools (the hub's DM buttons, the Control Centre) appear or close straight away
        const dmToggle = el("div", { class: "settings-dm-toggle", title: "Can use the DM tools" }, [el("span", {}, "DM")]);
        dmToggle.prepend(toggleSwitch(dmIds.has(mid), async (on) => {
          const res = await setCampaignDm(cid, mid, on);
          if (!res || res.error) { alert(res?.error || "Couldn't change that. Check your connection."); refresh(); }
        }));
        row.append(dmToggle);
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

  // ---------------- Interface: how big each part of the hub is ----------------
  // A slider with smaller / bigger buttons and the number. Used for every size and for the text size.
  function sizeRow({ label, hint, range, value, onChange, neutral = 100 }) {
    const input = el("input", { type: "range", min: String(range.min), max: String(range.max), step: String(range.step), class: "audio-slider", "aria-label": label });
    const num = el("span", { class: "ui-size-val", "aria-live": "polite" });
    const step = (d) => { const b = el("button", { type: "button", class: "ui-size-step", "aria-label": `${d < 0 ? "Smaller" : "Bigger"}: ${label}`, title: d < 0 ? "Smaller" : "Bigger" }, d < 0 ? "−" : "+"); b.addEventListener("click", () => paint(Number(input.value) + d * range.step, true)); return b; };
    const row = el("div", { class: "ui-size-row" }, [
      el("div", { class: "ui-size-label" }, [el("strong", {}, label), hint ? el("small", {}, hint) : null].filter(Boolean)),
      el("div", { class: "ui-size-ctl" }, [step(-1), input, step(1), num]),
    ]);
    function paint(v, save) {
      const pct = clampPct(v, range);
      input.value = String(pct);
      num.textContent = `${pct}%`;
      input.style.setProperty("--fill", `${((pct - range.min) / (range.max - range.min)) * 100}%`);
      row.classList.toggle("changed", pct !== neutral);
      if (save) onChange(pct);
    }
    input.addEventListener("input", () => paint(input.value, true));
    row.paint = (v) => paint(v, false);
    paint(value, false);
    return row;
  }
  function sizesCard() {
    const ui = getUi();
    const rows = SIZE_PARTS.map((p) => sizeRow({ label: p.label, hint: p.hint, range: SIZE_RANGE, value: ui.sizes[p.id] ?? 100, onChange: (pct) => setPartSize(p.id, pct) }));
    const reset = el("button", { type: "button", class: "btn" }, "Reset all sizes");
    reset.addEventListener("click", () => { resetSizes(); rows.forEach((r) => r.paint(100)); });
    return el("div", { class: "card" }, [
      el("h4", {}, "Sizes"),
      el("p", { class: "ui-note" }, "Make a part of the hub bigger or smaller. It changes as you slide, and is kept on this device. The phone layout has its own bars: a size applies wherever its bar is."),
      ...rows, el("div", { class: "settings-actions", style: "margin-top:12px" }, [reset]),
    ]);
  }

  // How see-through the hub's bars and panels are, and whether the board has its dots
  function backgroundCard() {
    const ui = getUi();
    // (shown as transparency, 0 to 80%: the stored value is how solid they are)
    const glass = sizeRow({ label: "Transparency", hint: "Lets the board show through the bars and panels", neutral: 0,
      range: { min: 0, max: 100 - GLASS_RANGE.min, step: GLASS_RANGE.step }, value: 100 - ui.glass, onChange: (pct) => setUi({ glass: 100 - pct }) });
    const dots = el("div", { class: "settings-page-row" }, [
      el("span", {}, ["Dots on the board", el("br"), el("small", { class: "ui-note", style: "margin:0" }, "The faint grid of dots behind everything on the hub")]),
      toggleSwitch(ui.dots, (v) => setUi({ dots: v })),
    ]);
    return el("div", { class: "card" }, [el("h4", {}, "Hub look"), glass, dots]);
  }

  // ---------------- Accessibility ----------------
  function accessibilityCard() {
    const ui = getUi();
    const text = sizeRow({ label: "Text size", hint: "Scales the text and spacing across the whole app", range: TEXT_RANGE, value: ui.text, onChange: (pct) => setUi({ text: pct }) });
    const motion = pillGroup([["system", "Follow my device"], ["on", "Always reduce"]], ui.motion, (m) => setUi({ motion: m }));
    const toggleRow = (label, hint, key, on) => el("div", { class: "settings-page-row" }, [
      el("span", {}, [label, el("br"), el("small", { class: "ui-note", style: "margin:0" }, hint)]),
      toggleSwitch(on, (v) => setUi({ [key]: v })),
    ]);
    return el("div", { class: "card" }, [
      el("h4", {}, "Reading"), text,
      el("h4", { style: "margin-top:16px" }, "Motion"),
      el("p", { class: "ui-note" }, "Always reduce turns off the sliding, fading and flying: pages and panels simply appear. Your device's own setting is always respected as well."),
      motion,
      el("h4", { style: "margin-top:16px" }, "Seeing it clearly"),
      toggleRow("High contrast", "Dimmer text and thin lines become clearer", "contrast", ui.contrast),
      toggleRow("Strong focus outlines", "A thick yellow outline on whatever the keyboard is on", "focus", ui.focus),
    ]);
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
      id: "video", label: "Video", render: (panel) => {   // how it looks: the theme, how much moves, the window
        panel.appendChild(appearanceCard());
        panel.appendChild(graphicsCard());
        const windowSection = renderWindowSection();
        if (windowSection) panel.appendChild(windowSection);
        const fullscreenSection = renderFullscreenSection();
        if (fullscreenSection) panel.appendChild(fullscreenSection);
        // credits for a game's own artwork live inside that game (the Pokémon area), not on the shared screens
        const credit = activeSystem()?.credit;
        if (credit) panel.appendChild(el("p", { class: "art-credit" }, credit));
      },
    },
    { id: "audio", label: "Audio", render: (panel) => panel.appendChild(soundCard()) },
    {
      id: "interface", label: "Interface", render: (panel) => {   // how big each part is, the phone layout, your cursor, the sidebar's pages
        panel.appendChild(sizesCard());
        panel.appendChild(backgroundCard());
        panel.appendChild(layoutCard());
        panel.appendChild(cursorCard());
        if (!activeSystem()?.noSidebar) panel.appendChild(pagesCard());
      },
    },
    { id: "accessibility", label: "Accessibility", render: (panel) => panel.appendChild(accessibilityCard()) },
    { id: "admin", label: "Admin", adminOnly: true, render: (panel) => renderAdmin(panel) },   // always last; only for admins
  ];
  // (the tab someone last used may have been renamed: Appearance became Video, the Sidebar's pages moved to Interface)
  const savedTab = () => { const v = getViewState(TAB_KEY, "account"); return v === "appearance" ? "video" : v === "pages" ? "interface" : v; };

  const tabBar = el("div", { class: "settings-tabs", role: "tablist" });
  const panel = el("div", { class: "settings-panel", role: "tabpanel" });
  let isOwner = false; // learned from the campaign info; reveals the Members tab

  let isAdmin = false;
  fetchMe().then((acc) => { if (acc?.perms?.admin) { isAdmin = true; drawTabBar(savedTab()); } });
  function visibleTabs() { return tabDefs.filter((t) => (!t.ownerOnly || isOwner) && (!t.adminOnly || isAdmin)); }

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
    show(savedTab());
  }

  container.innerHTML = "";
  container.appendChild(el("h1", { class: "view-title" }, "Settings"));
  container.append(tabBar, panel);
  show(savedTab());
  // The Members tab only exists for the campaign's owner; add it as soon as we know.
  loadInfo().then((info) => {
    // Only the tab bar is redrawn -- never the panel, which may have typing in it.
    if (info?.isOwner && !isOwner) {
      isOwner = true;
      const saved = savedTab();
      if (saved === "members") show("members"); // they were last on it: now it can open
      else drawTabBar(saved);
    }
  });
}
