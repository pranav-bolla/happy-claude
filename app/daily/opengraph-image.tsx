import { ImageResponse } from "next/og";
import { moveColor } from "@/lib/daily";
import { CLAUDE, CREAM, INK, OG_SIZE, mascotSrc, ogFonts } from "@/lib/og";

export const alt = "Daily Claude: KO him in as few moves as you can. New puzzle every day.";
export const size = OG_SIZE;
export const contentType = "image/png";

/** A sample result, drawn like the share grid. */
const SAMPLE = [8, 22, 0, 40, 18];

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          background: INK,
          padding: "0 90px",
          gap: 70,
          fontFamily: "Inter",
          fontWeight: 500,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
          <div style={{ fontFamily: "Mono", fontSize: 24, letterSpacing: 6, color: CLAUDE }}>NEW PUZZLE EVERY DAY</div>
          <div style={{ marginTop: 14, fontSize: 96, fontWeight: 900, lineHeight: 1, letterSpacing: -2, color: CREAM }}>
            Daily Claude
          </div>
          <div style={{ marginTop: 24, fontSize: 34, lineHeight: 1.3, color: "rgba(247,245,242,0.7)" }}>
            KO him in as few moves as you can. Same puzzle for everyone.
          </div>

          <div style={{ marginTop: 40, display: "flex", gap: 12 }}>
            {SAMPLE.map((d, i) => (
              <div
                key={i}
                style={{
                  width: 64,
                  height: 64,
                  background: moveColor(d),
                  border: d < 1 ? "3px solid rgba(247,245,242,0.25)" : "none",
                }}
              />
            ))}
            <div
              style={{
                width: 64,
                height: 64,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: CREAM,
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={mascotSrc("dead")} width={58} height={58} alt="" />
            </div>
          </div>
          <div style={{ marginTop: 18, fontFamily: "Mono", fontSize: 26, letterSpacing: 2, color: CREAM }}>
            6/10 · can you beat it?
          </div>
        </div>

        <div
          style={{
            display: "flex",
            width: 380,
            height: 380,
            flexShrink: 0,
            background: CREAM,
            boxShadow: `16px 16px 0 ${CLAUDE}`,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={mascotSrc("dead")} width={330} height={330} style={{ transform: "rotate(8deg)" }} alt="" />
        </div>
      </div>
    ),
    { ...size, fonts: await ogFonts() },
  );
}
