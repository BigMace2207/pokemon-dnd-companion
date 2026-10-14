// Battle sprite lookup — see export_sprites.py for how app/sprites/{front,
// back}/{dex}.png got there (a one-time download keyed by the same "dex" id
// pokemon.json already uses, so no extra id mapping is needed here). Not
// every dex entry has a sprite (a handful of obscure forms 404 on PokeAPI's
// own repo), so every <img> built here has an onerror fallback to a plain
// Poké Ball placeholder rather than showing a broken-image icon.

const PLACEHOLDER = "data:image/svg+xml," + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
  '<circle cx="50" cy="50" r="45" fill="#888" opacity="0.25"/>' +
  '<path d="M5 50a45 45 0 0 1 90 0z" fill="#888" opacity="0.45"/>' +
  '<rect y="47" width="100" height="6" fill="#333"/>' +
  '<circle cx="50" cy="50" r="14" fill="#eee" stroke="#333" stroke-width="6"/>' +
  '</svg>'
);

export function spriteUrl(dex, back = false) {
  if (!dex) return PLACEHOLDER;
  return `sprites/${back ? "back" : "front"}/${dex}.png`;
}

export function spriteImg(dex, { back = false, alt = "", className = "" } = {}) {
  const img = document.createElement("img");
  img.src = spriteUrl(dex, back);
  img.alt = alt;
  if (className) img.className = className;
  img.addEventListener("error", () => { img.src = PLACEHOLDER; }, { once: true });
  return img;
}
