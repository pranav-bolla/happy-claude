"use client";

import { ITEMS, ITEM_ORDER, type ItemId } from "@/lib/items";
import { ITEM_ART } from "@/lib/client/itemArt";

export type Cooldowns = Partial<Record<ItemId, { at: number; ms: number }>>;

/** Hotbar. Click a slot or press 1-5, then click Claude to use it. */
export function Inventory({
  selected,
  cooldowns,
  onSelect,
}: {
  selected: ItemId;
  cooldowns: Cooldowns;
  onSelect: (id: ItemId) => void;
}) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(max(1.25rem,env(safe-area-inset-bottom))+3.25rem)] flex justify-center sm:bottom-20">
      <div className="pointer-events-auto flex gap-1.5 rounded-2xl border border-ink/10 bg-white/80 p-1.5 shadow-[0_8px_30px_-12px_rgba(29,29,31,0.35)] backdrop-blur-md">
        {ITEM_ORDER.map((id) => {
          const def = ITEMS[id];
          const cd = cooldowns[id];
          const active = id === selected;
          return (
            <button
              key={id}
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => onSelect(id)}
              aria-label={`${def.name} (${def.key})`}
              aria-pressed={active}
              className={`inv-slot ${active ? "is-active" : ""}`}
            >
              <span className="inv-icon" dangerouslySetInnerHTML={{ __html: ITEM_ART[id] }} />
              <span className="inv-key">{def.key}</span>
              {cd && <span key={cd.at} className="inv-cooldown" style={{ animationDuration: `${cd.ms}ms` }} />}
              <span className="inv-name">{def.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
