import { randomBytes } from "node:crypto";
import type { PlayerIdentity } from "../lib/protocol";

const ADJECTIVES = [
  "orange", "chaos", "blue", "sleepy", "turbo", "feral", "crispy", "spicy",
  "cosmic", "soggy", "tiny", "mega", "wobbly", "sneaky", "velvet", "rogue",
  "quantum", "salty", "zesty", "fluffy", "grumpy", "hyper", "lunar", "neon",
  "rusty", "silly", "sonic", "sticky", "wild", "jazzy", "frosty", "lucky",
  "moody", "goofy", "dizzy", "chunky", "spooky", "glitchy", "bouncy", "sassy",
];

const NOUNS = [
  "Penguin", "Monkey", "Potato", "Goblin", "Noodle", "Raccoon", "Pickle",
  "Waffle", "Otter", "Gremlin", "Taco", "Moth", "Llama", "Capybara", "Burrito",
  "Pigeon", "Frog", "Toast", "Badger", "Walrus", "Dumpling", "Nugget", "Possum",
  "Yeti", "Crab", "Ferret", "Bagel", "Narwhal", "Hamster", "Gecko", "Muffin",
  "Shrimp", "Beetle", "Koala", "Pretzel",
];

export const ACCENT_COLORS = [
  "#3B82F6", "#8B5CF6", "#EC4899", "#10B981", "#F59E0B", "#06B6D4",
  "#EF4444", "#65A30D", "#6366F1", "#14B8A6", "#F43F5E", "#A855F7",
];

const NAME_RE = /^[a-z]{3,10}[A-Z][a-z]{2,10}$/;

function pick<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

/**
 * Every connection gets a fresh temporary id. A client may ask to keep the
 * name/color it had earlier in the same browser tab (so a reconnect doesn't
 * rename you); anything that doesn't look like one of ours is replaced.
 */
export function createIdentity(requested?: { name?: unknown; color?: unknown }): PlayerIdentity {
  const id = randomBytes(6).toString("base64url");
  const name =
    typeof requested?.name === "string" && NAME_RE.test(requested.name)
      ? requested.name
      : pick(ADJECTIVES) + pick(NOUNS);
  const color =
    typeof requested?.color === "string" && ACCENT_COLORS.includes(requested.color)
      ? requested.color
      : pick(ACCENT_COLORS);
  return { id, name, color };
}

/**
 * Coarse location, only from headers a hosting edge may already attach
 * (Vercel, Cloudflare, or a custom proxy). We never ask the browser for
 * location and never call third-party geo APIs.
 */
export function cityFromHeaders(headers: Record<string, string | string[] | undefined>): string | null {
  const raw =
    headers["x-vercel-ip-city"] ?? headers["cf-ipcity"] ?? headers["x-geo-city"] ?? null;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;
  try {
    const city = decodeURIComponent(value).trim();
    return city.length > 0 && city.length < 40 ? city : null;
  } catch {
    return null;
  }
}
