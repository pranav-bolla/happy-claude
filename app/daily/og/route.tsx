import { ImageResponse } from "next/og";
import { ITEM_ART } from "@/lib/client/itemArt";
import { dailySpec, decodeRun, moveColor } from "@/lib/daily";
import type { ItemId } from "@/lib/items";
import { CLAUDE, CREAM, INK, OG_SIZE, mascotSrc, ogFonts } from "@/lib/og";

/** Shown when the link carries no result. */
const SAMPLE = {
  actions: ["hand", "whip", "hand", "hammer", "hand", "bomb"] as ItemId[],
  grid: [8, 22, 0, 40, 18, 30],
  killed: true,
};

function itemSrc(id: ItemId): string {
  const svg = ITEM_ART[id].replace('width="100%" height="100%"', 'width="16" height="16"');
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

/**
 * Link-preview image for /daily. With ?r=<run> it draws that player's
 * moves ("KO in 6/10, can you beat it?"); without, a generic card.
 */
export async function GET(req: Request) {
  const run = decodeRun(new URL(req.url).searchParams.get("r"));
  const spec = run ? dailySpec(run.day) : null;
  const { actions, grid, killed } = run ?? SAMPLE;

  const label = run && spec ? `DAILY CLAUDE #${run.day} · ${spec.modifier.name.toUpperCase()}` : "NEW PUZZLE EVERY DAY";
  const title = run && spec ? (killed ? `KO in ${grid.length}/${spec.moves}` : "He survived.") : "Daily Claude";
  const subtitle = run
    ? "Same Claude for everyone today."
    : "KO him in as few moves as you can. Same puzzle for everyone.";
  const footer = run ? "can you beat it? →" : "6/10 · can you beat it?";

  const tile = Math.min(64, Math.floor((620 - (grid.length - 1) * 10) / grid.length));

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          background: INK,
          padding: "0 80px",
          gap: 60,
          fontFamily: "Inter",
          fontWeight: 500,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
          <div style={{ fontFamily: "Mono", fontSize: 24, letterSpacing: 5, color: CLAUDE }}>{label}</div>
          <div style={{ marginTop: 14, fontSize: 96, fontWeight: 900, lineHeight: 1, letterSpacing: -2, color: CREAM }}>
            {title}
          </div>
          <div style={{ marginTop: 20, fontSize: 32, lineHeight: 1.3, color: "rgba(247,245,242,0.7)" }}>{subtitle}</div>

          <div style={{ marginTop: 36, display: "flex", gap: 10 }}>
            {grid.map((d, i) => {
              const isKill = killed && i === grid.length - 1;
              return (
                <div key={i} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div
                    style={{
                      width: tile,
                      height: tile,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: "rgba(247,245,242,0.1)",
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={itemSrc(actions[i])} width={tile * 0.75} height={tile * 0.75} alt="" />
                  </div>
                  <div
                    style={{
                      width: tile,
                      height: tile,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: isKill ? CREAM : moveColor(d),
                      border: d < 1 && !isKill ? "3px solid rgba(247,245,242,0.25)" : "none",
                    }}
                  >
                    {isKill && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={mascotSrc("dead")} width={tile * 0.9} height={tile * 0.9} alt="" />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 22, fontFamily: "Mono", fontSize: 26, letterSpacing: 2, color: CREAM }}>{footer}</div>
        </div>

        <div
          style={{
            display: "flex",
            width: 340,
            height: 340,
            flexShrink: 0,
            background: CREAM,
            boxShadow: `16px 16px 0 ${CLAUDE}`,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={mascotSrc(killed ? "dead" : "panic")}
            width={300}
            height={300}
            style={{ transform: `rotate(${killed ? 8 : -8}deg)` }}
            alt=""
          />
        </div>
      </div>
    ),
    {
      ...OG_SIZE,
      fonts: await ogFonts(),
      headers: { "cache-control": "public, max-age=86400, immutable" },
    },
  );
}
