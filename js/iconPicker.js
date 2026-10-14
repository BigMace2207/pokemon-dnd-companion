// A graphical "pick any icon" modal over the full bundled icon set (see
// server.py's /api/icons) — used for the Bag page's "Assign Icon" flow,
// when an item's name doesn't resolve to one automatically.

import { el } from "./components.js";
import { loadIconIndex, iconPath } from "./itemIcons.js";

const SHOWN_LIMIT = 300;

export async function openIconPicker(onPick) {
  const index = await loadIconIndex();
  const allIcons = [];
  for (const [category, files] of Object.entries(index)) {
    for (const filename of files) allIcons.push({ category, filename });
  }

  const overlay = el("div", { class: "modal-overlay" });
  const searchInput = el("input", { type: "text", placeholder: "Search icons by name…" });
  const countNote = el("p", { class: "view-sub" }, "");
  const grid = el("div", { class: "icon-picker-grid" });
  const closeBtn = el("button", { class: "btn secondary" }, "Cancel");
  closeBtn.addEventListener("click", () => overlay.remove());

  function renderGrid() {
    const q = searchInput.value.trim().toLowerCase();
    const matches = q
      ? allIcons.filter((i) => i.filename.toLowerCase().includes(q) || i.category.toLowerCase().includes(q))
      : allIcons;
    const shown = matches.slice(0, SHOWN_LIMIT);
    grid.innerHTML = "";
    shown.forEach(({ category, filename }) => {
      const item = el("div", { class: "icon-picker-item", title: `${category}/${filename}` }, [
        el("img", { src: iconPath(category, filename), alt: filename, loading: "lazy" }),
      ]);
      item.addEventListener("click", () => { onPick({ category, filename }); overlay.remove(); });
      grid.appendChild(item);
    });
    countNote.textContent = matches.length > SHOWN_LIMIT
      ? `Showing ${SHOWN_LIMIT} of ${matches.length} — type to narrow it down.`
      : `${matches.length} icon${matches.length === 1 ? "" : "s"}.`;
  }
  searchInput.addEventListener("input", renderGrid);
  renderGrid();

  overlay.appendChild(el("div", { class: "modal-box icon-picker-box" }, [
    el("h4", {}, "Choose an Icon"),
    searchInput,
    countNote,
    grid,
    closeBtn,
  ]));
  document.body.appendChild(overlay);
  searchInput.focus();
}
