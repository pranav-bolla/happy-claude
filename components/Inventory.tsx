"use client";

import { Fragment } from "react";
import { ITEMS, ITEM_ORDER, isHealing, type ItemId } from "@/lib/items";
import { ITEM_ART } from "@/lib/client/itemArt";

export type Cooldowns = Partial<Record<ItemId, { at: number; ms: number }>>;

/** Hotbar. Click a slot or press 1-7, then click Claude to use it.
 *  Hurt items on the left, healing items after the divider. */
export function Inventory({
  selected,
  cooldowns,
  onSelect,
  items = ITEM_ORDER,
  counts,
}: {
  selected: ItemId;
  cooldowns: Cooldowns;
  onSelect: (id: ItemId) => void;
  /** which slots to show (Daily shows only today's loadout) */
  items?: ItemId[];
  /** uses left per item; missing = unlimited */
  counts?: Partial<Record<ItemId, number>>;
}) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(max(1.25rem,env(safe-area-inset-bottom))+3.25rem)] flex justify-center sm:bottom-20">
      <div className="pointer-events-auto flex max-w-[calc(100vw-1rem)] gap-1 overflow-x-auto rounded-2xl border border-ink/10 bg-white/80 p-1.5 shadow-[0_8px_30px_-12px_rgba(29,29,31,0.35)] backdrop-blur-md sm:gap-1.5">
        {items.map((id, i) => {
          const def = ITEMS[id];
          const cd = cooldowns[id];
          const active = id === selected;
          const heal = isHealing(id);
          const firstHeal = heal && i > 0 && !isHealing(items[i - 1]);
          const count = counts?.[id];
          return (
            <Fragment key={id}>
              {firstHeal && <span className="inv-divider" aria-hidden />}
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => onSelect(id)}
                aria-label={`${def.name} (${def.key})`}
                aria-pressed={active}
                className={`inv-slot shrink-0 ${heal ? "is-heal" : ""} ${active ? "is-active" : ""} ${count === 0 ? "is-empty" : ""}`}
              >
                <span className="inv-icon" dangerouslySetInnerHTML={{ __html: ITEM_ART[id] }} />
                <span className="inv-key">{def.key}</span>
                {count !== undefined && <span className="inv-count">×{count}</span>}
                {cd && <span key={cd.at} className="inv-cooldown" style={{ animationDuration: `${cd.ms}ms` }} />}
                <span className="inv-name">{def.name}</span>
              </button>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
