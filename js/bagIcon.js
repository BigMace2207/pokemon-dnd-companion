// The picture for a bag item (the same lookup the Bag page uses), as an image URL. Money is the trainer's cash, shown in
// the bag as a Key Item with the Coin Case's picture.

import { loadIconIndex, resolveIcon, iconPath, PLACEHOLDER_ICON } from "./itemIcons.js";
import { categorizeItem, isTmEntry, tmMoveName } from "./bagItems.js";

export const MONEY = "Money";

export async function itemIconSrc(name, state, overrides = {}) {
  if (name === MONEY) return iconPath("key-item", "coin-case.png");
  const custom = overrides[name];
  if (custom) return iconPath(custom.category, custom.filename);
  const index = await loadIconIndex();
  const section = categorizeItem(name, state);
  const raw = isTmEntry(name) ? tmMoveName(name) : name;
  const moveType = section === "tm" ? state?.moves?.[state.moveByName.get(raw)]?.type : null;
  const icon = resolveIcon(index, { name: raw, section, moveType }) || PLACEHOLDER_ICON;
  return iconPath(icon.category, icon.filename);
}
