// A graphical portrait picker over the trainer sprites in
// app/sprites/trainers/ (see export_trainer_sprites.py) — shared by the
// trainer's own character sheet and the DM's NPC Library. Shows the
// current pick as a preview thumbnail; "Choose Portrait" opens a
// searchable grid of every portrait to click, instead of typing into a
// dropdown.

import { el } from "./components.js";
import { getTrainerSpriteFiles } from "./network.js";

export function trainerSpriteUrl(file) {
  return file ? `sprites/trainers/${encodeURIComponent(file)}` : null;
}
function displayName(file) { return file.replace(/\.png$/i, "").replace(/-/g, " "); }

const GRID_LIMIT = 300;

// initial: current filename (e.g. "ash.png") or "" for none.
// onSelect(filename) fires with the new filename, or "" when cleared.
export function makeTrainerSpritePicker({ initial = "", onSelect = () => {} } = {}) {
  let current = initial;
  const preview = el("img", { class: "trainer-sprite-preview", alt: "" });
  const nameLabel = el("span", { class: "trainer-sprite-name" }, "");
  const chooseBtn = el("button", { class: "btn secondary" }, "Choose Portrait");
  const clearBtn = el("button", { class: "btn secondary" }, "Clear");

  function setPreview(file) {
    current = file || "";
    if (current) { preview.src = trainerSpriteUrl(current); preview.style.display = ""; nameLabel.textContent = displayName(current); }
    else { preview.removeAttribute("src"); preview.style.display = "none"; nameLabel.textContent = "No portrait selected"; }
  }
  setPreview(initial);

  let filesPromise = null;
  async function openPicker() {
    if (!filesPromise) filesPromise = getTrainerSpriteFiles();
    const files = await filesPromise;

    const overlay = el("div", { class: "modal-overlay" });
    const searchInput = el("input", { type: "text", placeholder: "Search portraits by name…" });
    const countNote = el("p", { class: "view-sub" }, "");
    const grid = el("div", { class: "icon-picker-grid trainer-portrait-grid" });
    const cancelBtn = el("button", { class: "btn secondary" }, "Cancel");
    cancelBtn.addEventListener("click", () => overlay.remove());

    function renderGrid() {
      const q = searchInput.value.trim().toLowerCase();
      const matches = q ? files.filter((f) => f.toLowerCase().includes(q.replace(/\s+/g, "-"))) : files;
      const shown = matches.slice(0, GRID_LIMIT);
      grid.innerHTML = "";
      shown.forEach((file) => {
        const item = el("div", {
          class: "icon-picker-item trainer-portrait-item" + (file === current ? " selected" : ""),
          title: displayName(file),
        }, [el("img", { src: trainerSpriteUrl(file), alt: displayName(file), loading: "lazy" })]);
        item.addEventListener("click", () => { setPreview(file); onSelect(file); overlay.remove(); });
        grid.appendChild(item);
      });
      countNote.textContent = matches.length > GRID_LIMIT
        ? `Showing ${GRID_LIMIT} of ${matches.length} — type to narrow it down.`
        : `${matches.length} portrait${matches.length === 1 ? "" : "s"}.`;
    }
    searchInput.addEventListener("input", renderGrid);
    renderGrid();

    overlay.appendChild(el("div", { class: "modal-box icon-picker-box" }, [
      el("h4", {}, "Choose a Trainer Portrait"),
      searchInput,
      countNote,
      grid,
      cancelBtn,
    ]));
    document.body.appendChild(overlay);
    searchInput.focus();
  }
  chooseBtn.addEventListener("click", openPicker);
  clearBtn.addEventListener("click", () => { setPreview(""); onSelect(""); });

  const wrap = el("div", { class: "trainer-sprite-picker" }, [
    preview,
    el("div", { class: "trainer-sprite-picker-controls" }, [nameLabel, chooseBtn, clearBtn]),
  ]);
  wrap.setValue = (file) => setPreview(file || "");
  return wrap;
}
