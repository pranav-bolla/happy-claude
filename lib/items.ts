/**
 * Inventory items, shared by server (effects, cooldowns, validation) and
 * client (hotbar, animations). "hand" is the default grab-and-throw.
 */

export type ItemId = "hand" | "whip" | "hammer" | "taser" | "bomb";

export interface ItemDef {
  id: ItemId;
  name: string;
  /** hotkey */
  key: string;
  cooldownMs: number;
  /** HP removed on hit (walls he's knocked into do extra) */
  damage: number;
  /** how far from Claude's center you can use it, in Claude radii */
  reach: number;
  /** comic-book word shown on hit */
  word: string;
  /** bomb only: delay before it goes off */
  fuseMs?: number;
}

export const ITEMS: Record<ItemId, ItemDef> = {
  hand: { id: "hand", name: "hand", key: "1", cooldownMs: 0, damage: 0, reach: 1.1, word: "" },
  whip: { id: "whip", name: "whip", key: "2", cooldownMs: 650, damage: 4, reach: 3.2, word: "CRACK!" },
  hammer: { id: "hammer", name: "hammer", key: "3", cooldownMs: 2000, damage: 9, reach: 1.7, word: "BONK!" },
  taser: { id: "taser", name: "taser", key: "4", cooldownMs: 2800, damage: 7, reach: 2.2, word: "ZZZAP!" },
  bomb: { id: "bomb", name: "bomb", key: "5", cooldownMs: 9000, damage: 16, reach: 2.4, word: "BOOM!", fuseMs: 900 },
};

export const ITEM_ORDER: ItemId[] = ["hand", "whip", "hammer", "taser", "bomb"];

export function isItemId(v: unknown): v is ItemId {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(ITEMS, v);
}
