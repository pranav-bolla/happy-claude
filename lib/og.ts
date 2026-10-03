/** Shared bits for the link-preview images (the opengraph-image.tsx files in app/). */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const OG_SIZE = { width: 1200, height: 630 };

/** Bundled in assets/fonts (OFL); the built-in font has no bold weight. */
export async function ogFonts() {
  const load = (file: string) => readFile(join(process.cwd(), "assets/fonts", file));
  const [inter500, inter900, mono700] = await Promise.all([
    load("inter-latin-500-normal.woff"),
    load("inter-latin-900-normal.woff"),
    load("jetbrains-mono-latin-700-normal.woff"),
  ]);
  return [
    { name: "Inter", data: inter500, weight: 500 as const, style: "normal" as const },
    { name: "Inter", data: inter900, weight: 900 as const, style: "normal" as const },
    { name: "Mono", data: mono700, weight: 700 as const, style: "normal" as const },
  ];
}

export const CREAM = "#F7F5F2";
export const INK = "#1D1D1F";
export const CLAUDE = "#D97757";

/** The in-game mascot (components/ClaudeMascot.tsx) as a static SVG data URI. */
export function mascotSrc(face: "panic" | "dead"): string {
  const faceSvg =
    face === "panic"
      ? `<rect x="50" y="62" width="25" height="25" fill="#FFF8F0"/><rect x="125" y="62" width="25" height="25" fill="#FFF8F0"/>
         <rect x="58" y="70" width="9" height="9" fill="${INK}"/><rect x="133" y="70" width="9" height="9" fill="${INK}"/>
         <rect x="85" y="98" width="30" height="20" fill="${INK}"/><rect x="90" y="110" width="20" height="8" fill="#E0566B"/>
         <rect x="55" y="88" width="6" height="10" fill="#8FD0F7"/><rect x="140" y="88" width="6" height="10" fill="#8FD0F7"/>`
      : [56, 126]
          .map(
            (x) =>
              `<rect x="${x}" y="68" width="6" height="6"/><rect x="${x + 12}" y="68" width="6" height="6"/><rect x="${x + 6}" y="74" width="6" height="6"/><rect x="${x}" y="80" width="6" height="6"/><rect x="${x + 12}" y="80" width="6" height="6"/>`,
          )
          .join("")
          .replace(/<rect/g, `<rect fill="${INK}"`) + `<rect x="85" y="104" width="30" height="4" fill="${INK}"/>`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" shape-rendering="crispEdges">
    <rect x="40" y="130" width="10" height="30" fill="#B65E40"/><rect x="70" y="130" width="10" height="30" fill="#B65E40"/>
    <rect x="120" y="130" width="10" height="30" fill="#B65E40"/><rect x="150" y="130" width="10" height="30" fill="#B65E40"/>
    <rect x="10" y="${face === "panic" ? 60 : 80}" width="20" height="20" fill="${CLAUDE}"/>
    <rect x="170" y="${face === "panic" ? 60 : 80}" width="20" height="20" fill="${CLAUDE}"/>
    <rect x="30" y="50" width="140" height="80" fill="${CLAUDE}"/>
    <rect x="30" y="50" width="140" height="10" fill="#E8936F"/>
    <rect x="30" y="120" width="140" height="10" fill="#B65E40"/>
    <g transform="rotate(-18 60 58)"><rect x="35" y="52" width="50" height="14" fill="#F1D2B3" stroke="#C9A27F" stroke-width="2"/><rect x="54" y="52" width="12" height="14" fill="#E4BD98"/></g>
    ${faceSvg}
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}
