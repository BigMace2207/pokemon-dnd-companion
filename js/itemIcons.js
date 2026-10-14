// Matches a Bag entry's name to one of the ~1050 bundled icons in
// app/sprites/icons/ (see server.py's /api/icons and the folder's own
// readme — a legacy Bulbapedia-style set, kept for exactly this kind of
// reuse). Matching is "best effort, existence-checked" — for anything that
// doesn't resolve (an unusual key item, a homebrew held item, ...) the
// caller falls back to the etc/unknown-item.png placeholder and lets the
// trainer manually assign one via the icon-picker page.

import { getIconIndex } from "./network.js";

function slugify(s) {
  return s
    .toLowerCase()
    .replace(/é/g, "e").replace(/[''`]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

let indexPromise = null;
export function loadIconIndex() {
  if (!indexPromise) indexPromise = getIconIndex();
  return indexPromise;
}

export function iconPath(category, filename) {
  return `sprites/icons/${category}/${filename}`;
}
export const PLACEHOLDER_ICON = { category: "etc", filename: "unknown-item.png" };

function has(index, category, filename) {
  return index[category]?.includes(filename);
}

// index: the { category: [filenames] } map from loadIconIndex().
// Returns { category, filename } or null if nothing matched.
export function resolveIcon(index, { name, section, moveType }) {
  if (section === "ball") {
    const slug = slugify(name.replace(/\s*ball$/i, ""));
    if (has(index, "ball", `${slug}.png`)) return { category: "ball", filename: `${slug}.png` };
  } else if (section === "medicine") {
    const slug = slugify(name);
    if (has(index, "medicine", `${slug}.png`)) return { category: "medicine", filename: `${slug}.png` };
  } else if (section === "tm") {
    const slug = slugify(moveType || "");
    if (has(index, "tm", `${slug}.png`)) return { category: "tm", filename: `${slug}.png` };
  } else if (section === "held") {
    const slug = slugify(name);
    const foldersExact = ["hold-item", "mega-stone", "z-crystals", "other-item"];
    for (const folder of foldersExact) {
      if (has(index, folder, `${slug}.png`)) return { category: folder, filename: `${slug}.png` };
    }
    const strippedFolders = { berry: /\s*berry$/i, plate: /\s*plate$/i, gem: /\s*gem$/i, incense: /\s*incense$/i, scarf: /\s*scarf$/i };
    for (const [folder, suffix] of Object.entries(strippedFolders)) {
      const strippedSlug = slugify(name.replace(suffix, ""));
      if (has(index, folder, `${strippedSlug}.png`)) return { category: folder, filename: `${strippedSlug}.png` };
    }
  } else {
    // key items (and anything else): try key-item, then other-item.
    const slug = slugify(name);
    if (has(index, "key-item", `${slug}.png`)) return { category: "key-item", filename: `${slug}.png` };
    if (has(index, "other-item", `${slug}.png`)) return { category: "other-item", filename: `${slug}.png` };
  }
  return null;
}
