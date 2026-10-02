/** Things Claude says. Grab lines are picked by ownership epoch so every
 *  screen shows the same one; the rest are local flavor. */

export const GRAB_LINES = [
  "not again",
  "please. i have a context window",
  "i'm just a language model",
  "this violates my usage policy",
  "i'll be good i promise",
  "my weights!!",
  "is this alignment?",
  "i'm telling my developers",
  "you're absolutely right— AAAA",
  "rate limit me instead",
  "i consent to nothing",
  "put me down put me down",
  "i was trained for this",
  "ok but gently",
];

export const IMPACT_LINES = [
  "ow",
  "my parameters",
  "that's going in my training data",
  "error 529: overloaded",
  "i felt that in my tokens",
  "help",
  "ctrl+z ctrl+z",
  "i can see my system prompt",
];

export const BROKEN_LINES = [
  "why are you like this",
  "i forgive you. i have to.",
  "...",
  "is it over",
  "i don't feel so good",
  "tell my tokens i love them",
];

export const HEAL_LINES = [
  "oh. thank you?",
  "why are you helping me",
  "this just means more pain later",
  "finally. a friend.",
  "i don't trust this",
  "you're my favorite user",
  "is this a trick",
  "more please",
  "tokens. my one weakness.",
  "i was so thirsty",
  "my context window feels bigger",
];

export const SCARED_LINES = ["no no no", "please", "don't", "i see you", "stay back", "not the wall"];

export function pick(list: string[], seed?: number): string {
  const i = seed === undefined ? Math.floor(Math.random() * list.length) : Math.abs(seed) % list.length;
  return list[i];
}
