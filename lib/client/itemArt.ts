import type { ItemId } from "../items";

type Cell = [x: number, y: number, w: number, h: number];

function art(layers: [color: string, cells: Cell[]][]): string {
  const rects = layers
    .map(([c, cells]) => cells.map(([x, y, w, h]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c}"/>`).join(""))
    .join("");
  return `<svg viewBox="0 0 16 16" width="100%" height="100%" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg">${rects}</svg>`;
}

/** 16x16 pixel icons, used by the hotbar and the in-world animations. */
export const ITEM_ART: Record<ItemId, string> = {
  hand: art([
    ["#F2C6A0", [[4, 3, 2, 5], [6, 2, 2, 6], [8, 2, 2, 6], [10, 3, 2, 5], [4, 7, 8, 6], [2, 8, 2, 3]]],
    ["#D9A57E", [[4, 12, 8, 1], [6, 6, 1, 2], [8, 6, 1, 2], [10, 6, 1, 2]]],
  ]),
  whip: art([
    ["#3E2615", [[2, 12, 2, 2], [3, 11, 2, 2], [4, 10, 2, 2]]],
    ["#8B5A2B", [[6, 9, 1, 1], [7, 8, 1, 1], [8, 7, 1, 1], [9, 6, 2, 1], [11, 5, 2, 1], [13, 4, 1, 2], [12, 6, 1, 2], [11, 8, 1, 1]]],
    ["#F5D06A", [[12, 9, 1, 1]]],
  ]),
  hammer: art([
    ["#7C8794", [[3, 2, 10, 4]]],
    ["#A9B3BF", [[3, 2, 10, 1]]],
    ["#5B636D", [[3, 5, 10, 1]]],
    ["#8B5A2B", [[7, 6, 2, 9]]],
    ["#5E3B1C", [[7, 13, 2, 2]]],
  ]),
  taser: art([
    ["#FACC15", [[8, 1, 3, 2], [7, 3, 3, 2], [6, 5, 3, 2], [5, 7, 7, 2], [8, 9, 3, 2], [7, 11, 3, 2], [6, 13, 3, 2]]],
    ["#FEF3C7", [[9, 1, 1, 2], [8, 3, 1, 2], [7, 5, 1, 2]]],
  ]),
  bomb: art([
    ["#1D1D1F", [[4, 6, 8, 8], [5, 5, 6, 1], [5, 14, 6, 1], [3, 7, 1, 6], [12, 7, 1, 6]]],
    ["#6B6B6B", [[5, 7, 2, 2]]],
    ["#8B5A2B", [[9, 3, 1, 2], [10, 2, 2, 1]]],
    ["#F59E0B", [[12, 1, 2, 2]]],
    ["#FDE68A", [[12, 1, 1, 1]]],
  ]),
};
