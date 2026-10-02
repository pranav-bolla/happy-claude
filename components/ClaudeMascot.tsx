"use client";

import { memo } from "react";
import type { Expression } from "@/lib/client/engine";

const INK = "#1D1D1F";
const BODY = "#D97757";
const LIGHT = "#E8936F";
const SHADE = "#B65E40";
const TEAR = "#8FD0F7";

/**
 * Pixel-art alien on a 10px grid (viewBox 200x200). Limbs animate via CSS
 * classes keyed off the expression; `damage` (0-3) layers on bandages,
 * cracks, a black eye and smoke. Body desaturates with --dmg (0..1).
 */
function ClaudeMascot({ expression, damage }: { expression: Expression; damage: number }) {
  const panicking = expression === "grabbed";
  const scared = expression === "curious";
  const dead = expression === "dead";
  const limbs = dead
    ? "limp"
    : panicking
      ? "flail"
      : expression === "woozy"
        ? "tucked"
        : scared
          ? "nervous"
          : "idle";

  return (
    <svg
      viewBox="0 0 200 200"
      width="100%"
      height="100%"
      shapeRendering="crispEdges"
      aria-label="Claude"
      role="img"
      className={`alien limbs-${limbs} ${panicking || scared ? "tremble" : ""} ${damage >= 3 && !dead ? "glitch" : ""} ${dead ? "is-dead" : ""}`}
      style={{ overflow: "visible" }}
    >
      <g className="alien-flip">
      <g className="alien-body">
        {/* legs */}
        <rect className="leg leg-a" x="40" y="130" width="10" height="30" fill={SHADE} />
        <rect className="leg leg-b" x="70" y="130" width="10" height="30" fill={SHADE} />
        <rect className="leg leg-b" x="120" y="130" width="10" height="30" fill={SHADE} />
        <rect className="leg leg-a" x="150" y="130" width="10" height="30" fill={SHADE} />

        {/* arms */}
        <rect className="arm arm-l" x="10" y="80" width="20" height="20" fill={BODY} />
        <rect className="arm arm-r" x="170" y="80" width="20" height="20" fill={BODY} />

        {/* torso */}
        <rect x="30" y="50" width="140" height="80" fill={BODY} />
        <rect x="30" y="50" width="140" height="10" fill={LIGHT} />
        <rect x="30" y="120" width="140" height="10" fill={SHADE} />

        <Damage level={damage} />

        <g key={expression} className="face-pop">
          <Face expression={expression} />
        </g>
      </g>
      </g>

      {dead && (
        <g className="ghost" opacity="0.85">
          <rect x="80" y="20" width="40" height="30" fill="#FFFFFF" />
          <rect x="75" y="30" width="5" height="25" fill="#FFFFFF" />
          <rect x="120" y="30" width="5" height="25" fill="#FFFFFF" />
          <rect x="80" y="50" width="10" height="8" fill="#FFFFFF" />
          <rect x="95" y="50" width="10" height="8" fill="#FFFFFF" />
          <rect x="110" y="50" width="10" height="8" fill="#FFFFFF" />
          <rect x="90" y="30" width="5" height="10" fill={INK} />
          <rect x="105" y="30" width="5" height="10" fill={INK} />
        </g>
      )}

      {damage >= 3 && !dead && (
        <g fill="#8A8580">
          <rect className="smoke smoke-1" x="60" y="30" width="10" height="10" />
          <rect className="smoke smoke-2" x="100" y="30" width="10" height="10" />
          <rect className="smoke smoke-3" x="135" y="30" width="10" height="10" />
        </g>
      )}
    </svg>
  );
}

function Damage({ level }: { level: number }) {
  if (level <= 0) return null;
  return (
    <>
      {level >= 2 && (
        <>
          {/* black eye */}
          <rect x="120" y="60" width="30" height="40" fill="#5B3A6B" opacity="0.45" />
          {/* cracks */}
          <g fill="#5A2416">
            <rect x="150" y="60" width="5" height="10" />
            <rect x="145" y="70" width="5" height="10" />
            <rect x="150" y="80" width="5" height="10" />
            <rect x="40" y="105" width="10" height="5" />
            <rect x="50" y="110" width="5" height="5" />
            <rect x="55" y="115" width="10" height="5" />
          </g>
        </>
      )}
      {/* bandage */}
      <g transform="rotate(-18 60 58)">
        <rect x="35" y="52" width="50" height="14" fill="#F1D2B3" stroke="#C9A27F" strokeWidth="2" />
        <rect x="54" y="52" width="12" height="14" fill="#E4BD98" />
      </g>
      {level >= 3 && <rect x="160" y="50" width="10" height="10" fill="#F7F5F2" />}
    </>
  );
}

function Face({ expression }: { expression: Expression }) {
  switch (expression) {
    case "curious":
      // scared: eyes track you, teeth clenched, sweating
      return (
        <>
          <g className="eye-look">
            <g className="blink">
              <rect x="60" y="68" width="10" height="22" fill={INK} />
              <rect x="130" y="68" width="10" height="22" fill={INK} />
            </g>
          </g>
          <rect x="80" y="100" width="40" height="10" fill="#FFF8F0" />
          <g fill={INK}>
            <rect x="80" y="98" width="40" height="2" />
            <rect x="80" y="110" width="40" height="2" />
            <rect x="89" y="100" width="2" height="10" />
            <rect x="99" y="100" width="2" height="10" />
            <rect x="109" y="100" width="2" height="10" />
          </g>
          <g className="sweat" fill={TEAR}>
            <rect x="160" y="35" width="5" height="5" />
            <rect x="157" y="40" width="10" height="10" />
          </g>
        </>
      );

    case "grabbed":
      // pure panic: wide eyes, screaming, crying
      return (
        <>
          <rect x="50" y="62" width="25" height="25" fill="#FFF8F0" />
          <rect x="125" y="62" width="25" height="25" fill="#FFF8F0" />
          <g className="pupil-look" fill={INK}>
            <rect x="58" y="70" width="9" height="9" />
            <rect x="133" y="70" width="9" height="9" />
          </g>
          <rect x="85" y="98" width="30" height="20" fill={INK} />
          <rect x="90" y="110" width="20" height="8" fill="#E0566B" />
          <g fill={TEAR}>
            <rect className="tear tear-1" x="55" y="88" width="6" height="10" />
            <rect className="tear tear-2" x="140" y="88" width="6" height="10" />
          </g>
        </>
      );

    case "woozy":
      // >< squeezed shut, wobbly mouth
      return (
        <>
          <g fill={INK}>
            <rect x="55" y="66" width="8" height="8" />
            <rect x="63" y="74" width="8" height="8" />
            <rect x="55" y="82" width="8" height="8" />
            <rect x="137" y="66" width="8" height="8" />
            <rect x="129" y="74" width="8" height="8" />
            <rect x="137" y="82" width="8" height="8" />
            <rect x="80" y="104" width="10" height="5" />
            <rect x="90" y="99" width="10" height="5" />
            <rect x="100" y="104" width="10" height="5" />
            <rect x="110" y="99" width="10" height="5" />
          </g>
        </>
      );

    case "dead":
      return (
        <g fill={INK}>
          {[56, 126].map((x) => (
            <g key={x}>
              <rect x={x} y="68" width="6" height="6" />
              <rect x={x + 12} y="68" width="6" height="6" />
              <rect x={x + 6} y="74" width="6" height="6" />
              <rect x={x} y="80" width="6" height="6" />
              <rect x={x + 12} y="80" width="6" height="6" />
            </g>
          ))}
          <rect x="85" y="104" width="30" height="4" />
        </g>
      );

    case "smashed":
      // X_X with tongue out
      return (
        <>
          <g fill={INK}>
            {[52, 122].map((x) => (
              <g key={x}>
                <rect x={x} y="64" width="7" height="7" />
                <rect x={x + 7} y="71" width="7" height="7" />
                <rect x={x + 14} y="78" width="7" height="7" />
                <rect x={x + 7} y="85" width="7" height="7" />
                <rect x={x} y="92" width="7" height="7" />
                <rect x={x + 14} y="64" width="7" height="7" />
                <rect x={x + 14} y="92" width="7" height="7" />
              </g>
            ))}
            <rect x="80" y="104" width="40" height="5" />
          </g>
          <rect x="100" y="109" width="12" height="14" fill="#E0566B" />
          <rect x="100" y="109" width="12" height="2" fill={INK} />
        </>
      );

    default:
      return (
        <g className="eye-look">
          <g className="blink">
            <rect x="60" y="70" width="10" height="20" fill={INK} />
            <rect x="130" y="70" width="10" height="20" fill={INK} />
          </g>
        </g>
      );
  }
}

export default memo(ClaudeMascot);
