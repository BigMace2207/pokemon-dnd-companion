// A hover (desktop) / tap (touch) info popover for a Battle screen
// combatant — type(s), which trainer/source they belong to, ability, held
// item, and status. Thin wrapper around js/infoTooltip.js's shared
// tooltip (also used by the Pokédex, Move Dex, and Bag).

import { el, typePill } from "./components.js";
import { attachInfoTooltip, tooltipTitle, tooltipRow } from "./infoTooltip.js";

function buildContent(c, species) {
  const mon = c.mon;
  const rows = [
    tooltipTitle(mon.nickname || mon.name),
    species ? el("div", {}, [typePill(species.type1), species.type2 ? typePill(species.type2) : null].filter(Boolean)) : null,
    tooltipRow(`Trainer: ${c.sourceLabel}`),
    tooltipRow(`Level ${mon.level ?? "?"}`),
    mon.ability ? tooltipRow(`Ability: ${mon.ability}`) : null,
    mon.item ? tooltipRow(`Held item: ${mon.item}`) : null,
    tooltipRow(`Status: ${mon.status && mon.status !== "None" ? mon.status : "None"}`),
  ];
  return rows.filter(Boolean);
}

// hudEl: the element to attach hover/tap to (the HUD, not the sprite, so it
// doesn't fight with click-to-target). species: already-resolved dex row
// or null.
export function attachCombatantInfo(hudEl, c, species) {
  attachInfoTooltip(hudEl, () => buildContent(c, species));
}
