// True once a specific Pokemon (by its own id, under the given trainer's
// networkId) is part of the DM's currently-live encounter — used to stop a
// level-up from landing mid-fight (My Team, Quick Console, and the DM's own
// Give: Levels all check this) since jumping levels — and any new moves
// that come with them — mid-turn would upend a fight everyone's still in
// the middle of. Leveling is still fine during Draft/VS Screen, just not
// once the actual battle goes live. Takes an already-fetched fullTurn
// object (callers poll it themselves) rather than fetching here, so a
// caller checking several mons at once only pays for one request.
export function monIsLiveCombatant(fullTurn, networkId, monId) {
  if (!fullTurn || fullTurn.phase !== "live") return false;
  return (fullTurn.combatants || []).some((c) => c.sourceId === networkId && c.mon?.id === monId);
}
