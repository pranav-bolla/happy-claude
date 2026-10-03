import { ImageResponse } from "next/og";
import { CLAUDE, CREAM, INK, OG_SIZE, mascotSrc, ogFonts } from "@/lib/og";

export const alt = "HAPPY CLAUDE: one Claude, one room, everyone online fighting over him";
export const size = OG_SIZE;
export const contentType = "image/png";

const HP = [1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0];

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          background: CREAM,
          backgroundImage: "radial-gradient(circle, rgba(29,29,31,0.08) 2px, transparent 2px)",
          backgroundSize: "36px 36px",
          padding: "0 70px 0 60px",
          gap: 40,
          fontFamily: "Inter",
          fontWeight: 500,
        }}
      >
        <div style={{ display: "flex", position: "relative", width: 400, height: 400, flexShrink: 0 }}>
          {[150, 210, 270].map((top, i) => (
            <div
              key={top}
              style={{
                position: "absolute",
                left: -30 - i * 20,
                top,
                width: 120 - i * 25,
                height: 14,
                background: CLAUDE,
                opacity: 0.5 - i * 0.12,
              }}
            />
          ))}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={mascotSrc("panic")} width={400} height={400} style={{ transform: "rotate(-14deg)" }} alt="" />
        </div>

        <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <div style={{ width: 28, height: 28, borderRadius: 28, background: CLAUDE }} />
            <div style={{ fontSize: 66, fontWeight: 900, letterSpacing: 2, color: INK, whiteSpace: "nowrap" }}>
              HAPPY CLAUDE
            </div>
          </div>
          <div style={{ marginTop: 18, fontSize: 34, lineHeight: 1.3, color: "#4A4A4A" }}>
            one Claude. one room. everyone online is fighting over him.
          </div>

          <div
            style={{
              marginTop: 38,
              display: "flex",
              flexDirection: "column",
              background: "white",
              border: "2px solid rgba(29,29,31,0.08)",
              borderRadius: 18,
              padding: "16px 22px",
              width: 540,
              fontFamily: "Mono",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 22, letterSpacing: 3 }}>
              <span style={{ color: INK }}>CLAUDE</span>
              <span style={{ color: "#EF4444" }}>43 HP</span>
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
              {HP.map((on, i) => (
                <div key={i} style={{ flex: 1, height: 18, background: on ? "#EF4444" : "rgba(29,29,31,0.09)" }} />
              ))}
            </div>
          </div>

          <div style={{ marginTop: 32, display: "flex", alignItems: "center", gap: 14, fontSize: 26, color: INK }}>
            <div style={{ width: 16, height: 16, borderRadius: 16, background: "#22C55E" }} />
            <span style={{ fontFamily: "Mono", letterSpacing: 2 }}>LIVE</span>
            <span style={{ color: "#6B6B6B" }}>grab him. whip him. kill him.</span>
          </div>
        </div>
      </div>
    ),
    { ...size, fonts: await ogFonts() },
  );
}
