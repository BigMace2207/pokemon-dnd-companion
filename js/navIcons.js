// Sidebar nav icons -- each one a real sprite pulled from the bundled
// library (see app/sprites/, and js/itemIcons.js for the same folder used
// for Bag items), picked to thematically match its nav item. Rendered as
// <img> tags sized by .nav-icon in style.css (see app.js's nav-item wiring
// that prepends these into each button).

function spriteIcon(path) {
  return `<img src="${path}" alt="" style="width:100%;height:100%;object-fit:contain;image-rendering:pixelated">`;
}

export const NAV_ICONS = {
  pokedex: spriteIcon("sprites/icons/ball/poke.png"),
  moves: spriteIcon("sprites/icons/tm/normal.png"),
  statcalc: spriteIcon("sprites/icons/medicine/carbos.png"),
  damagecalc: spriteIcon("sprites/icons/battle-item/x-attack.png"),
  battleview: spriteIcon("sprites/icons/storage/battle-pocket.png"),
  team: spriteIcon("sprites/icons/storage/pokemon-box.png"),
  bag: spriteIcon("sprites/icons/key-item/seal-bag.png"),
  trainer: spriteIcon("sprites/trainers/acetrainer.png"),
  trainersOnline: spriteIcon("sprites/trainers/acetrainercouple.png"),
  controlcentre: spriteIcon("sprites/icons/ball/master.png"),
  typechart: spriteIcon("sprites/icons/plate/zap.png"),
  tierguide: spriteIcon("sprites/icons/exp-candy/m.png"),
  settings: spriteIcon("sprites/icons/key-item/rule-book.png"),
};

// Line icons for the D&D and shared pages (they follow the theme's text colour).
const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const DND_ICONS = {
  dndHome: svg('<path d="M4 21V9l3-2V4h2v2h2V4h2v2h2V4h2v3l3 2v12z"/><path d="M10 21v-5a2 2 0 0 1 4 0v5"/>'),
  dndCharacters: svg('<circle cx="9" cy="8" r="3.2"/><path d="M3 20a6 6 0 0 1 12 0"/><circle cx="17" cy="9" r="2.4"/><path d="M16 14.2A5 5 0 0 1 21 19"/>'),
  dndSheet: svg('<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4M9 12h7M9 16h7"/>'),
  dndDice: svg('<path d="M12 2l9 5v10l-9 5-9-5V7z"/><path d="M12 2v20M3 7l9 5 9-5M3 17l9-5 9 5" opacity=".55"/>'),
  dndParty: svg('<circle cx="12" cy="7" r="3"/><circle cx="5.5" cy="10" r="2.3"/><circle cx="18.5" cy="10" r="2.3"/><path d="M6 20a6 6 0 0 1 12 0M1.5 18a4 4 0 0 1 4-3.5M22.5 18a4 4 0 0 0-4-3.5"/>'),
  dndCombat: svg('<path d="M4 20L16 8M14 4l6-1-1 6-4 1-1-4z"/><path d="M20 20L8 8M10 4L4 3l1 6 4 1 1-4z"/><path d="M5 19l-2 2M19 19l2 2"/>'),
  dndSpells: svg('<path d="M5 19L17 7"/><path d="M17 3v4M15 5h4M20 12v3M18.5 13.5h3M7 3v2M6 4h2"/><path d="M3 21l2-2" />'),
  dndBestiary: svg('<path d="M3 9c3-3 6-4 9-4s6 1 9 4c-1 5-4 9-9 11C7 18 4 14 3 9z"/><circle cx="9" cy="11" r="1.2"/><circle cx="15" cy="11" r="1.2"/><path d="M10 16h4"/>'),
  dndItems: svg('<path d="M5 8h14l1 12H4z"/><path d="M8 8V6a4 4 0 0 1 8 0v2M9 13h6"/>'),
  dndClasses: svg('<path d="M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z"/><path d="M12 8v7M9 11h6"/>'),
  dndRaces: svg('<circle cx="12" cy="12" r="8"/><path d="M8 11c0-1 1-2 2-2M16 11c0-1-1-2-2-2M9 15c2 2 4 2 6 0"/>'),
  dndBackgrounds: svg('<path d="M5 4h12a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2z"/><path d="M5 18a2 2 0 0 1 2-2h12M9 8h6"/>'),
  dndRules: svg('<path d="M12 6c-2-2-5-2-9-2v14c4 0 7 0 9 2 2-2 5-2 9-2V4c-4 0-7 0-9 2z"/><path d="M12 6v14"/>'),
  dndTables: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 4v16"/>'),
  dndDmScreen: svg('<path d="M3 6l6 2v13l-6-2zM9 8l6-2v13l-6 2zM15 6l6 2v13l-6-2z"/>'),
  dndEncounter: svg('<path d="M12 3v18M5 21h14M5 8h14"/><path d="M5 8l-3 7a3.5 3.5 0 0 0 6 0zM19 8l-3 7a3.5 3.5 0 0 0 6 0z"/>'),
  dndGenerators: svg('<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="1.2"/><circle cx="15" cy="15" r="1.2"/><circle cx="15" cy="9" r="1.2"/><circle cx="9" cy="15" r="1.2"/>'),
  dndNotes: svg('<path d="M4 20l1-4L17 4l3 3L8 19z"/><path d="M14 7l3 3"/>'),
  library: svg('<path d="M4 4h4v16H4zM9 4h4v16H9z"/><path d="M14 6l4-1 3 14-4 1z"/>'),
  rulebook: svg('<path d="M5 3h12a2 2 0 0 1 2 2v16H7a2 2 0 0 1-2-2z"/><circle cx="12" cy="11" r="3.2"/><path d="M8.8 11h6.4"/>'),
};
Object.assign(NAV_ICONS, DND_ICONS);
