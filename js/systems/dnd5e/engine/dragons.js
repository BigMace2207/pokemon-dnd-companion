// The Dragonborn draconic ancestry table (SRD 5.1; the 2024 species uses the same ten ancestors). No DOM, so Node can test it.

export const DRAGONS = [
  { color: "Black", damage: "Acid", shape: "5 by 30 ft. line", save: "Dexterity" },
  { color: "Blue", damage: "Lightning", shape: "5 by 30 ft. line", save: "Dexterity" },
  { color: "Brass", damage: "Fire", shape: "5 by 30 ft. line", save: "Dexterity" },
  { color: "Bronze", damage: "Lightning", shape: "5 by 30 ft. line", save: "Dexterity" },
  { color: "Copper", damage: "Acid", shape: "5 by 30 ft. line", save: "Dexterity" },
  { color: "Gold", damage: "Fire", shape: "15 ft. cone", save: "Dexterity" },
  { color: "Green", damage: "Poison", shape: "15 ft. cone", save: "Constitution" },
  { color: "Red", damage: "Fire", shape: "15 ft. cone", save: "Dexterity" },
  { color: "Silver", damage: "Cold", shape: "15 ft. cone", save: "Constitution" },
  { color: "White", damage: "Cold", shape: "15 ft. cone", save: "Constitution" },
];

// "Draconic Ancestry (Black)", "Draconic Ancestor: Black" or "black" -> the table row.
export const dragonFor = (text) => {
  const t = String(text || "").toLowerCase();
  return DRAGONS.find((d) => t.includes(d.color.toLowerCase())) || null;
};

export const dragonLine = (d) => `${d.color} dragon: ${d.damage} damage. Breath weapon ${d.shape} (${d.save} save); you resist ${d.damage.toLowerCase()} damage.`;
