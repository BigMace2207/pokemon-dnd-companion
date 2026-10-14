// Pokémon Showdown-style team import/export, adapted to what this app
// actually tracks per mon (no EVs/IVs/nature — those are fixed assumptions
// everywhere else in the app, see calc.js) — level, held item, ability,
// status, and up to 4 moves. Lets trainers move a team between devices by
// copy/pasting a plain text block, and the DM do the same for an NPC.
//
// Format (one mon):
//   Nickname (Species) @ Item
//   Ability: Static
//   Level: 50
//   Status: Paralysis
//   - Thunderbolt
//   - Volt Tackle
//
// Multiple mons are separated by a blank line, same as Showdown's own
// export/import box.

function monToText(mon) {
  const namePart = mon.nickname ? `${mon.nickname} (${mon.name})` : mon.name;
  const lines = [mon.item ? `${namePart} @ ${mon.item}` : namePart];
  if (mon.ability) lines.push(`Ability: ${mon.ability}`);
  lines.push(`Level: ${mon.level || 5}`);
  if (mon.status && mon.status !== "None") lines.push(`Status: ${mon.status}`);
  (mon.moves || []).filter(Boolean).forEach((m) => lines.push(`- ${m}`));
  return lines.join("\n");
}

export function teamToText(party) {
  return party.filter((m) => m.name).map(monToText).join("\n\n");
}

function newId() {
  return crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now();
}

// Resolves a typed species name against the real dex (case-insensitive,
// exact match only — this is a data-entry aid, not a fuzzy search) so an
// imported mon feeds the same calculators/sprites as one built by hand.
function resolveSpecies(state, name) {
  const lower = name.trim().toLowerCase();
  return state.pokemon.find((p) => p.name.toLowerCase() === lower) || null;
}

function parseMonBlock(state, block) {
  const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return null;

  const headerLine = lines[0];
  const atIdx = headerLine.lastIndexOf(" @ ");
  const namePart = atIdx === -1 ? headerLine : headerLine.slice(0, atIdx).trim();
  const item = atIdx === -1 ? "" : headerLine.slice(atIdx + 3).trim();

  let nickname = "", speciesName = namePart;
  const nickMatch = namePart.match(/^(.*)\s+\(([^)]+)\)\s*$/);
  if (nickMatch) { nickname = nickMatch[1].trim(); speciesName = nickMatch[2].trim(); }

  const species = resolveSpecies(state, speciesName);
  let ability = "", level = 5, status = "None";
  const moves = [];
  for (const line of lines.slice(1)) {
    const abilityM = line.match(/^Ability:\s*(.+)$/i);
    const levelM = line.match(/^Level:\s*(\d+)/i);
    const statusM = line.match(/^Status:\s*(.+)$/i);
    const moveM = line.match(/^[-*]\s*(.+)$/);
    if (abilityM) ability = abilityM[1].trim();
    else if (levelM) level = Number(levelM[1]);
    else if (statusM) status = statusM[1].trim();
    else if (moveM) moves.push(moveM[1].trim());
  }
  while (moves.length < 4) moves.push("");

  return {
    id: newId(),
    dex: species ? species.dex : null,
    name: species ? species.name : speciesName, // kept even if unrecognized, so it's visible to fix by hand
    nickname, level: Math.min(100, Math.max(1, level || 1)),
    currentHp: null, item, ability,
    status: status || "None",
    moves: moves.slice(0, 4),
    unrecognized: !species,
  };
}

// Returns { mons, unrecognizedCount } — mons with unrecognized:true still
// come back (named exactly as typed) so the caller can show a warning
// instead of silently dropping them.
export function parseTeamText(state, text) {
  const blocks = text.split(/\n\s*\n+/).map((b) => b.trim()).filter(Boolean);
  const mons = blocks.map((b) => parseMonBlock(state, b)).filter(Boolean);
  return { mons, unrecognizedCount: mons.filter((m) => m.unrecognized).length };
}

export function npcToText(npc) {
  return `=== ${npc.name || "NPC"} ===\n\n${teamToText(npc.team?.party || [])}`;
}

export function parseNpcText(state, text) {
  const headerMatch = text.match(/^===\s*(.+?)\s*===\s*/);
  const name = headerMatch ? headerMatch[1].trim() : "";
  const body = headerMatch ? text.slice(headerMatch[0].length) : text;
  const { mons, unrecognizedCount } = parseTeamText(state, body);
  return { name, party: mons, unrecognizedCount };
}
