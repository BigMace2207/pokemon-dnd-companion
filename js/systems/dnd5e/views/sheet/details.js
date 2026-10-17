// Sheet > Details & Notes: portrait, XP, identity, personality, backstory, notes,
// a dated journal, and the export / duplicate / delete tools.

import { el, field, btn, chip, section, textInput, numInput, selectEl, checkbox, toast, confirmDialog, download, pickFile } from "../../ui.js";
import { ALIGNMENTS } from "../../engine/rules.js";
import { deleteCharacter, duplicateCharacter, exportCharacterJson, setSettings } from "../../store.js";

export function renderDetailsTab(panel, S) {
  const { char, d } = S;
  const cols = el("div", { class: "dnd-sheet-cols" });
  const left = el("div", { class: "dnd-stack" }), right = el("div", { class: "dnd-stack" });
  cols.append(left, right);
  panel.append(cols);

  // ---- identity & portrait
  const portraitBox = el("div", { class: "dnd-row" }, [
    char.portrait ? el("img", { class: "dnd-portrait big", src: char.portrait, alt: "Portrait" }) : el("div", { class: "dnd-portrait big placeholder" }, (char.name || "?").charAt(0).toUpperCase()),
    el("div", { class: "dnd-stack" }, [
      btn("Upload portrait", async () => {
        const file = await pickFile("image/*");
        if (!file) return;
        try { char.portrait = await toSmallJpeg(file, 192); S.commit(); toast("Portrait saved.", "good"); } catch { toast("Couldn't read that image.", "bad"); }
      }, "btn secondary small"),
      char.portrait ? btn("Remove", () => { char.portrait = ""; S.commit(); }, "btn secondary small") : null,
    ].filter(Boolean)),
  ]);
  left.append(section("Identity", [
    portraitBox,
    field("Player", textInput(char.player, (v) => { char.player = v; S.save(); })),
    field("Alignment", selectEl([["", "—"], ...ALIGNMENTS.map((a) => [a, a])], char.alignment, (v) => { char.alignment = v; S.commit(); })),
    el("div", { class: "dnd-grid-2" }, [
      ["age", "Age"], ["height", "Height"], ["weight", "Weight"], ["eyes", "Eyes"], ["skin", "Skin"], ["hair", "Hair"],
    ].map(([k, l]) => field(l, textInput(char.details[k], (v) => { char.details[k] = v; S.save(); })))),
  ]));

  // ---- experience
  const xp = numInput(char.xp || 0, (v) => { char.xp = Math.max(0, v || 0); S.commit(); }, { min: 0 });
  const addXp = el("input", { type: "number", value: "100", class: "dnd-num", inputmode: "numeric", "aria-label": "XP to add" });
  left.append(section("Experience", [
    checkbox("Use milestone levelling (hide XP)", char.milestone, (v) => { char.milestone = v; S.commit(); }),
    el("div", { class: "dnd-row" }, [field("Experience points", xp), el("div", { class: "dnd-row", style: "align-items:flex-end;margin-bottom:13px" }, [addXp, btn("Add XP", () => { char.xp = (Number(char.xp) || 0) + (Number(addXp.value) || 0); S.commit(); toast("XP added.", "good"); }, "btn secondary small")])]),
    el("p", { class: "dnd-small dnd-muted" }, d.xpNext ? `${(d.xpNext - (Number(char.xp) || 0)).toLocaleString()} XP to level ${d.level + 1}.` : "Maximum level reached."),
  ]));

  // ---- the writing
  const text = (label, key, rows = 4) => field(label, textInput(char.details[key], (v) => { char.details[key] = v; S.save(); }, { multiline: true, rows }));
  right.append(section("Personality", [text("Personality traits", "traits", 3), text("Ideals", "ideals", 2), text("Bonds", "bonds", 2), text("Flaws", "flaws", 2)]));
  right.append(section("Story", [text("Appearance", "appearance", 3), text("Backstory", "backstory", 6), text("Allies & organisations", "allies", 3)]));

  // ---- journal
  const journalHost = el("div");
  const entry = textInput("", () => {}, { multiline: true, rows: 3, placeholder: "What happened this session?" });
  function drawJournal() {
    journalHost.replaceChildren(...char.journal.slice(0, 50).map((j) => el("div", { class: "dnd-journal" }, [
      el("div", { class: "dnd-row between" }, [el("span", { class: "dnd-muted dnd-small" }, new Date(j.ts).toLocaleString()), btn("✕", async () => { if (await confirmDialog("Delete this entry?", { ok: "Delete", danger: true })) { char.journal = char.journal.filter((x) => x.id !== j.id); S.commit(); } }, "btn secondary tiny dnd-icon-btn", { "aria-label": "Delete entry" })]),
      el("p", {}, j.text),
    ])));
  }
  drawJournal();
  right.append(section("Journal", [
    entry,
    btn("Add entry", () => { const t = entry.value.trim(); if (!t) return; char.journal.unshift({ id: String(Date.now()), ts: Date.now(), text: t }); entry.value = ""; S.commit(); }, "btn secondary small"),
    journalHost,
  ]));
  right.append(section("Notes", text("Scratch notes", "notes", 6)));

  // ---- management
  left.append(section("Manage", [
    el("div", { class: "dnd-row" }, [
      btn("Export to file", () => download(`${(char.name || "character").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.json`, exportCharacterJson(char)), "btn secondary small"),
      btn("Duplicate", () => { duplicateCharacter(char.id); toast("Copied — find it under Characters.", "good"); }, "btn secondary small"),
      btn("Print sheet", () => window.print(), "btn secondary small"),
    ]),
    el("div", { class: "dnd-row", style: "margin-top:8px" }, [
      btn("Delete character", async () => {
        if (!(await confirmDialog(`Delete ${char.name || "this character"} forever?`, { ok: "Delete", danger: true }))) return;
        deleteCharacter(char.id);
        location.hash = "dndCharacters";
      }, "btn danger small"),
    ]),
    el("p", { class: "dnd-small dnd-muted", style: "margin-top:8px" }, "Characters are saved automatically to your account."),
  ]));
  void chip; void setSettings;
}

// Downscale an image file to a square-cropped JPEG data URL (small enough to sync with the save).
function toSmallJpeg(file, size) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("bad image"));
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = c.height = size;
        const s = Math.min(img.width, img.height);
        c.getContext("2d").drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
        resolve(c.toDataURL("image/jpeg", 0.82));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}
