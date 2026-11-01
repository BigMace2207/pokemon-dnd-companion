// Names used in battle text and pickers. A trainer who never typed a name, an NPC without one, or a Pokémon added
// before its level was set must never read as "null's Pikachu" or "Lv.null" on screen or in the Battle Log.

export const monName = (mon) => mon?.nickname || mon?.name || "Pokémon";
export const levelText = (level) => (level === null || level === undefined || level === "" ? "?" : level);
export const monWithLevel = (mon) => `${monName(mon)} (Lv.${levelText(mon?.level)})`;
export const ownerName = (c) => c?.sourceLabel || (c?.sourceKind === "npc" ? "NPC" : c?.sourceKind === "wild" ? "Wild" : "A trainer");
export const combatantLabel = (c) => `${ownerName(c)}'s ${monName(c?.mon)}`;
