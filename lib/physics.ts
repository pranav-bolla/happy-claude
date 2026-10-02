/**
 * Shared rigid-body simulation for Claude.
 *
 * This exact module runs in TWO places:
 *   1. On the server, as the single source of truth (authoritative sim).
 *   2. In every browser, as a *predictor* that runs at display refresh rate
 *      between server snapshots (see lib/client/engine.ts).
 *
 * Because both sides run identical, fixed-substep code, a client that is
 * handed a server snapshot can fast-forward it by the network latency and
 * land almost exactly where the server is "now". That is what keeps Claude
 * buttery on every screen without streaming 60 packets per second.
 *
 * We only ever simulate ONE disc, so a tiny hand-written integrator is a
 * better fit than a general engine like Matter.js: it is deterministic across
 * Node and browsers, trivially serializable, and every constant below can be
 * tuned for *feel* rather than realism.
 *
 * World units: the world is a fixed WORLD_W x WORLD_H box. Every client maps
 * this box onto its own viewport (see viewport mapping in the engine), so the
 * walls are always the edges of *your* screen. Speeds are reported as
 * "px/s" in world units (the world is roughly a desktop screen in size).
 */

export const WORLD_W = 1600;
export const WORLD_H = 1000;
export const RADIUS = 110;

export const MASS = 1;
/** Moment of inertia of a solid disc. */
export const INERTIA = 0.5 * MASS * RADIUS * RADIUS;

/** Fixed integration step. 240 Hz keeps the stiff grab spring stable. */
export const SUBSTEP = 1 / 240;

export const MAX_SPEED = 6000;
export const MAX_SPIN = 40;

// --- Feel tuning -----------------------------------------------------------

/** Grab spring stiffness / damping. High = Claude tracks your finger tightly. */
const GRAB_K = 1500;
const GRAB_C = 42;
/** Extra spin damping while held so he swings but settles. */
const GRAB_SPIN_DAMP = 2.6;
const GRAB_LIN_DAMP = 0.6;

/** Free-flight "air" friction. Low on purpose: throws should travel. */
const LIN_DRAG = 0.42;
/** Additional drag when slow, so he actually comes to rest. */
const SLOW_DRAG = 1.8;
const SLOW_SPEED = 140;
const SPIN_DRAG = 0.7;

/** Bounciness of the screen edges. Slightly exaggerated. */
const RESTITUTION = 0.8;
/** Fraction of tangential slip removed per wall hit (turns slides into spin). */
const WALL_GRIP = 0.3;

/** When idle for a while, Claude gently floats back to center and uprights. */
const HOME_K = 2.4;
const HOME_C = 2.9;
const UPRIGHT_K = 9;
const UPRIGHT_C = 4.5;

// ---------------------------------------------------------------------------

export interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** rotation, radians, wrapped to [-PI, PI] */
  a: number;
  /** angular velocity, rad/s */
  av: number;
}

/**
 * A grab is modelled as a stiff damped spring between a point on Claude's
 * body (offset ox/oy in Claude's LOCAL frame) and a target point (the
 * holder's pointer). Pulling off-center applies torque, which is what makes
 * him swing and whip instead of just translating.
 */
export interface GrabConstraint {
  tx: number;
  ty: number;
  /** target velocity; used for damping and to extrapolate the target */
  tvx: number;
  tvy: number;
  ox: number;
  oy: number;
}

export interface WallHit {
  /** contact point in world units */
  x: number;
  y: number;
  /** wall normal pointing back into the world */
  nx: number;
  ny: number;
  /** normal impact speed, world units/s */
  speed: number;
}

export interface StepOptions {
  grab?: GrabConstraint | null;
  homing?: boolean;
  onWall?: (hit: WallHit) => void;
}

export function createBody(): Body {
  return { x: WORLD_W / 2, y: WORLD_H / 2, vx: 0, vy: 0, a: 0, av: 0 };
}

export function copyBody(b: Body): Body {
  return { x: b.x, y: b.y, vx: b.vx, vy: b.vy, a: b.a, av: b.av };
}

export function wrapAngle(a: number): number {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}

export function speedOf(b: { vx: number; vy: number }): number {
  return Math.hypot(b.vx, b.vy);
}

export function clampSpeed(b: Body): void {
  const s = Math.hypot(b.vx, b.vy);
  if (s > MAX_SPEED) {
    const k = MAX_SPEED / s;
    b.vx *= k;
    b.vy *= k;
  }
  if (b.av > MAX_SPIN) b.av = MAX_SPIN;
  else if (b.av < -MAX_SPIN) b.av = -MAX_SPIN;
}

/** World-space position of the grab point on the body. */
export function grabPoint(b: Body, ox: number, oy: number): { x: number; y: number } {
  const c = Math.cos(b.a);
  const s = Math.sin(b.a);
  return { x: b.x + ox * c - oy * s, y: b.y + ox * s + oy * c };
}

/**
 * Advance the body by dt seconds using fixed substeps.
 * Mutates `b` in place.
 */
export function stepBody(b: Body, dt: number, opts: StepOptions = {}): void {
  let remaining = Math.min(dt, 0.35);
  let elapsed = 0;
  while (remaining > 1e-7) {
    const h = remaining < SUBSTEP ? remaining : SUBSTEP;
    substep(b, h, elapsed, opts);
    elapsed += h;
    remaining -= h;
  }
}

function substep(b: Body, h: number, elapsed: number, opts: StepOptions): void {
  const g = opts.grab;

  if (g) {
    const c = Math.cos(b.a);
    const s = Math.sin(b.a);
    const rx = g.ox * c - g.oy * s;
    const ry = g.ox * s + g.oy * c;
    const px = b.x + rx;
    const py = b.y + ry;
    // velocity of the grabbed point (v + w x r)
    const pvx = b.vx - b.av * ry;
    const pvy = b.vy + b.av * rx;
    // the target keeps moving with its own velocity inside the step
    const tx = g.tx + g.tvx * elapsed;
    const ty = g.ty + g.tvy * elapsed;

    let dx = tx - px;
    let dy = ty - py;
    // Cap the stretch so a teleporting target can't explode the sim.
    const d = Math.hypot(dx, dy);
    if (d > 500) {
      dx *= 500 / d;
      dy *= 500 / d;
    }
    const fx = GRAB_K * dx + GRAB_C * (g.tvx - pvx);
    const fy = GRAB_K * dy + GRAB_C * (g.tvy - pvy);

    b.vx += (fx / MASS) * h;
    b.vy += (fy / MASS) * h;
    b.av += ((rx * fy - ry * fx) / INERTIA) * h;

    const ld = Math.exp(-GRAB_LIN_DAMP * h);
    b.vx *= ld;
    b.vy *= ld;
    b.av *= Math.exp(-GRAB_SPIN_DAMP * h);
  } else {
    const sp = Math.hypot(b.vx, b.vy);
    const drag = sp < SLOW_SPEED ? LIN_DRAG + SLOW_DRAG * (1 - sp / SLOW_SPEED) : LIN_DRAG;
    const ld = Math.exp(-drag * h);
    b.vx *= ld;
    b.vy *= ld;
    b.av *= Math.exp(-SPIN_DRAG * h);

    if (opts.homing) {
      b.vx += (HOME_K * (WORLD_W / 2 - b.x) - HOME_C * b.vx) * h;
      b.vy += (HOME_K * (WORLD_H / 2 - b.y) - HOME_C * b.vy) * h;
      b.av += (-UPRIGHT_K * wrapAngle(b.a) - UPRIGHT_C * b.av) * h;
    }
  }

  clampSpeed(b);

  b.x += b.vx * h;
  b.y += b.vy * h;
  b.a = wrapAngle(b.a + b.av * h);

  // --- screen-edge collisions ---
  if (b.x < RADIUS) {
    b.x = RADIUS;
    collide(b, 1, 0, opts.onWall);
  } else if (b.x > WORLD_W - RADIUS) {
    b.x = WORLD_W - RADIUS;
    collide(b, -1, 0, opts.onWall);
  }
  if (b.y < RADIUS) {
    b.y = RADIUS;
    collide(b, 0, 1, opts.onWall);
  } else if (b.y > WORLD_H - RADIUS) {
    b.y = WORLD_H - RADIUS;
    collide(b, 0, -1, opts.onWall);
  }
}

/**
 * Impulse-based bounce against a wall with normal (nx, ny).
 * Includes tangential friction so glancing hits convert slide into spin,
 * and existing spin "kicks" Claude along the wall. Feels alive.
 */
function collide(b: Body, nx: number, ny: number, onWall?: (hit: WallHit) => void): void {
  // contact point relative to center
  const rx = -nx * RADIUS;
  const ry = -ny * RADIUS;
  const pvx = b.vx - b.av * ry;
  const pvy = b.vy + b.av * rx;
  const vn = pvx * nx + pvy * ny;
  if (vn >= 0) return; // already separating

  const tx = -ny;
  const ty = nx;
  const vt = pvx * tx + pvy * ty;

  const jn = -(1 + RESTITUTION) * vn * MASS;
  const rCrossT = rx * ty - ry * tx;
  const mEffT = 1 / (1 / MASS + (rCrossT * rCrossT) / INERTIA);
  const jt = -WALL_GRIP * vt * mEffT;

  const jx = jn * nx + jt * tx;
  const jy = jn * ny + jt * ty;
  b.vx += jx / MASS;
  b.vy += jy / MASS;
  b.av += (rx * jy - ry * jx) / INERTIA;
  clampSpeed(b);

  if (onWall && -vn > 25) {
    onWall({ x: b.x + rx, y: b.y + ry, nx, ny, speed: -vn });
  }
}
