// Each player's cursor colour on shared boards (the Pokémon hub). Picked in Settings → Appearance and kept in the
// player's save (save.trainer.cursorColor), so it follows them to every device. Until someone picks one, a colour is
// chosen from their id so two players rarely start out the same.

export const CURSOR_COLORS = ["#ff5a4e", "#ff9f1c", "#ffd23f", "#6fdc6a", "#2ec4b6", "#4ea8ff", "#8a7dff", "#e36bff", "#ff6fa8", "#f5f5f5"];

export function cursorColorOf(save) {
  const picked = save?.trainer?.cursorColor;
  if (typeof picked === "string" && /^#[0-9a-f]{6}$/i.test(picked)) return picked;
  const id = String(save?.networkId || "");
  const n = [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  return CURSOR_COLORS[n % CURSOR_COLORS.length];
}
