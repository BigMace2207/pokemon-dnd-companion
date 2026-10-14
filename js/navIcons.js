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
