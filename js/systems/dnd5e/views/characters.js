// Your characters: the list (open, switch, copy, export, delete), import from a file,
// and the entrance to the builder.

import { el, asyncView, btn, section, chip, confirmDialog, toast, download, pickFile, readText } from "../ui.js";
import { loadCtx } from "../data.js";
import {
  listCharacters, activeCharacter, setActive, deleteCharacter, duplicateCharacter, createCharacter,
  exportCharacterJson, importCharacterJson, saveCharacter,
} from "../store.js";
import { derive, classLabel } from "../engine/character.js";
import { hpBar } from "../components/hpBar.js";
import { renderBuilder } from "./builder.js";
import { pageTitle } from "./common.js";

export function renderCharacters(container) {
  container.replaceChildren(...pageTitle("Characters", "Everything you play is saved to your account and follows you to other devices."));
  const holder = el("div");
  container.append(holder);

  async function draw() {
    await asyncView(holder, async () => {
      const chars = listCharacters();
      const active = activeCharacter();
      const rows = [];
      const actions = el("div", { class: "dnd-row" }, [
        btn("New character", openBuilder, "btn"),
        btn("Quick blank sheet", () => { const c = createCharacter(); toast("Blank character created.", "good"); location.hash = "dndSheet"; void c; }, "btn secondary"),
        btn("Import file", importFile, "btn secondary"),
      ]);
      rows.push(section("", actions));
      if (!chars.length) {
        rows.push(section("No characters yet", el("p", {}, "Start the builder for a guided character, or import a character file you've exported before.")));
      } else {
        const ctxByEd = {};
        const cards = [];
        for (const c of chars) {
          ctxByEd[c.edition] ||= await loadCtx(c.edition);
          cards.push(card(c, ctxByEd[c.edition], c.id === active?.id));
        }
        rows.push(el("div", { class: "dnd-grid-auto wide" }, cards));
      }
      return rows;
    });
  }

  function card(c, ctx, isActive) {
    const d = derive(c, ctx);
    const head = el("div", { class: "dnd-char-head" }, [
      c.portrait ? el("img", { class: "dnd-portrait", src: c.portrait, alt: "" }) : el("div", { class: "dnd-portrait placeholder" }, (c.name || "?").charAt(0).toUpperCase()),
      el("div", { class: "dnd-grow" }, [
        el("h3", { class: "dnd-char-name", style: "font-size:calc(24px*var(--s))" }, c.name || "Unnamed"),
        el("div", { class: "dnd-muted dnd-small" }, `${c.race?.name || "—"} · ${classLabel(c, ctx)}`),
        el("div", { class: "dnd-chip-row", style: "margin-top:4px" }, [chip(`Level ${d.level}`), chip(`AC ${d.ac.value}`), chip(c.edition === "2024" ? "2024 rules" : "2014 rules"), isActive ? chip("Active", "gold") : null].filter(Boolean)),
      ]),
    ]);
    const open = btn("Open sheet", () => { setActive(c.id); location.hash = "dndSheet"; }, "btn small");
    const use = isActive ? null : btn("Make active", () => { setActive(c.id); draw(); }, "btn secondary small");
    const copy = btn("Duplicate", () => { duplicateCharacter(c.id); draw(); toast("Copied.", "good"); }, "btn secondary small");
    const exp = btn("Export", () => download(`${(c.name || "character").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.json`, exportCharacterJson(c)), "btn secondary small");
    const del = btn("Delete", async () => {
      if (await confirmDialog(`Delete ${c.name || "this character"}? This can't be undone (export first if you might want it back).`, { ok: "Delete", danger: true })) { deleteCharacter(c.id); draw(); }
    }, "btn secondary small");
    return el("div", { class: `card dnd-char-card${isActive ? " active" : ""}` }, [head, hpBar(d.hp.current, d.hp.max, d.hp.temp), el("div", { class: "dnd-row", style: "margin-top:10px" }, [open, use, copy, exp, del].filter(Boolean))]);
  }

  function openBuilder() {
    renderBuilder(container, {
      onDone: () => { location.hash = "dndSheet"; renderCharacters(container); },
      onCancel: () => renderCharacters(container),
    });
  }

  async function importFile() {
    const file = await pickFile(".json,application/json");
    if (!file) return;
    try {
      const added = importCharacterJson(await readText(file));
      toast(`Imported ${added.map((a) => a.name || "a character").join(", ")}.`, "good");
      draw();
    } catch (e) { toast(e.message || "Couldn't read that file.", "bad"); }
  }

  draw();
  void saveCharacter;
}
