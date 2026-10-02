/**
 * Canvas layer for cheap juice: impact particles, shock rings, wall glows
 * and the motion-blur ghost trail. Lives *behind* Claude's DOM element.
 */

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  spark: boolean;
  /** healing "+" that drifts upward instead of falling */
  plus?: boolean;
}

interface Ring {
  x: number;
  y: number;
  life: number;
  max: number;
  size: number;
  color: string;
}

interface Glow {
  x: number;
  y: number;
  life: number;
  max: number;
  size: number;
}

interface Lash {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  life: number;
  max: number;
  bend: number;
}

interface Bolt {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  life: number;
  max: number;
}

const COLORS = ["#D97757", "#E8956F", "#F2B79B", "#1D1D1F", "#C4623F"];
const TRAIL_LEN = 7;

export class Fx {
  private ctx: CanvasRenderingContext2D;
  private particles: Particle[] = [];
  private rings: Ring[] = [];
  private glows: Glow[] = [];
  private lashes: Lash[] = [];
  private bolts: Bolt[] = [];
  private trail: { x: number; y: number }[] = [];
  private trailAlpha = 0;
  private trailR = 0;
  private dirty = false;
  private w = 0;
  private h = 0;
  private dpr = 1;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
  }

  resize(w: number, h: number): void {
    this.w = w;
    this.h = h;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
  }

  /** Contact point (screen px), wall normal, strength 0..1. */
  impact(x: number, y: number, nx: number, ny: number, s: number): void {
    const count = Math.round(5 + s * 22);
    const base = Math.atan2(ny, nx);
    for (let i = 0; i < count; i++) {
      const ang = base + (Math.random() - 0.5) * Math.PI * 0.95;
      const sp = 120 + Math.random() * (250 + 900 * s);
      const max = 0.3 + Math.random() * 0.45;
      this.particles.push({
        x,
        y,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp,
        life: max,
        max,
        size: 1.6 + Math.random() * (2.2 + 3 * s),
        color: COLORS[(Math.random() * COLORS.length) | 0],
        spark: Math.random() < 0.35,
      });
    }
    if (this.particles.length > 400) this.particles.splice(0, this.particles.length - 400);
    if (s > 0.08) this.rings.push({ x, y, life: 0.4, max: 0.4, size: 30 + 110 * s, color: "#D97757" });
    if (s > 0.2) this.glows.push({ x, y, life: 0.35, max: 0.35, size: 90 + 160 * s });
  }

  /** Whip: lash snaps out from (x1,y1) to (x2,y2) and back. */
  lash(x1: number, y1: number, x2: number, y2: number): void {
    this.lashes.push({ x1, y1, x2, y2, life: 0.28, max: 0.28, bend: (Math.random() < 0.5 ? -1 : 1) * (0.35 + Math.random() * 0.3) });
  }

  /** Taser: flickering lightning from (x1,y1) to (x2,y2). */
  bolt(x1: number, y1: number, x2: number, y2: number): void {
    this.bolts.push({ x1, y1, x2, y2, life: 0.4, max: 0.4 });
  }

  explode(x: number, y: number): void {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      this.impact(x, y, Math.cos(a), Math.sin(a), 1);
    }
    this.rings.push({ x, y, life: 0.6, max: 0.6, size: 260, color: "#1D1D1F" });
    this.glows.push({ x, y, life: 0.5, max: 0.5, size: 380 });
  }

  /** Green "+" sparkles rising off him. */
  heal(x: number, y: number, r: number, big: boolean): void {
    const count = big ? 22 : 7;
    for (let i = 0; i < count; i++) {
      const max = 0.7 + Math.random() * 0.6;
      this.particles.push({
        x: x + (Math.random() - 0.5) * r * 1.4,
        y: y + (Math.random() - 0.2) * r,
        vx: (Math.random() - 0.5) * 40,
        vy: -60 - Math.random() * (big ? 160 : 90),
        life: max,
        max,
        size: big ? 5 + Math.random() * 4 : 4 + Math.random() * 2,
        color: Math.random() < 0.7 ? "#22C55E" : "#86EFAC",
        spark: false,
        plus: true,
      });
    }
    this.rings.push({ x, y, life: 0.5, max: 0.5, size: big ? r * 1.6 : r * 0.9, color: "#22C55E" });
  }

  ring(x: number, y: number, color: string, size = 46): void {
    this.rings.push({ x, y, life: 0.45, max: 0.45, size, color });
  }

  /** Feed Claude's on-screen position every frame. */
  track(x: number, y: number, r: number, speedPx: number): void {
    this.trail.unshift({ x, y });
    if (this.trail.length > TRAIL_LEN) this.trail.length = TRAIL_LEN;
    this.trailR = r;
    const target = Math.min(Math.max((speedPx - 1300) / 1600, 0), 1);
    this.trailAlpha += (target - this.trailAlpha) * 0.25;
  }

  render(dt: number): void {
    const active =
      this.particles.length > 0 ||
      this.rings.length > 0 ||
      this.glows.length > 0 ||
      this.lashes.length > 0 ||
      this.bolts.length > 0 ||
      this.trailAlpha > 0.01;
    if (!active && !this.dirty) return;

    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    this.dirty = active;

    for (let i = this.glows.length - 1; i >= 0; i--) {
      const g = this.glows[i];
      g.life -= dt;
      if (g.life <= 0) {
        this.glows.splice(i, 1);
        continue;
      }
      const k = g.life / g.max;
      const grad = ctx.createRadialGradient(g.x, g.y, 0, g.x, g.y, g.size);
      grad.addColorStop(0, `rgba(217,119,87,${0.28 * k})`);
      grad.addColorStop(1, "rgba(217,119,87,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(g.x - g.size, g.y - g.size, g.size * 2, g.size * 2);
    }

    if (this.trailAlpha > 0.01) {
      for (let i = 1; i < this.trail.length; i++) {
        const p = this.trail[i];
        const k = 1 - i / this.trail.length;
        ctx.globalAlpha = 0.2 * k * this.trailAlpha;
        ctx.fillStyle = "#D97757";
        ctx.beginPath();
        ctx.arc(p.x, p.y, this.trailR * (1 - i * 0.045), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life -= dt;
      if (r.life <= 0) {
        this.rings.splice(i, 1);
        continue;
      }
      const k = 1 - r.life / r.max;
      const ease = 1 - Math.pow(1 - k, 3);
      ctx.globalAlpha = (1 - k) * 0.8;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = 3.5 * (1 - k) + 0.5;
      ctx.beginPath();
      ctx.arc(r.x, r.y, 6 + r.size * ease, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    for (let i = this.lashes.length - 1; i >= 0; i--) {
      const l = this.lashes[i];
      l.life -= dt;
      if (l.life <= 0) {
        this.lashes.splice(i, 1);
        continue;
      }
      // extends fast, lingers, retracts
      const k = 1 - l.life / l.max;
      const reach = k < 0.35 ? k / 0.35 : 1 - (k - 0.35) / 0.65;
      const ex = l.x1 + (l.x2 - l.x1) * reach;
      const ey = l.y1 + (l.y2 - l.y1) * reach;
      const mx = (l.x1 + ex) / 2 - (ey - l.y1) * l.bend;
      const my = (l.y1 + ey) / 2 + (ex - l.x1) * l.bend;
      ctx.lineCap = "round";
      ctx.strokeStyle = "#3E2615";
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(l.x1, l.y1);
      ctx.quadraticCurveTo(mx, my, ex, ey);
      ctx.stroke();
      ctx.strokeStyle = "#8B5A2B";
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.life -= dt;
      if (b.life <= 0) {
        this.bolts.splice(i, 1);
        continue;
      }
      const segs = 9;
      const nx = -(b.y2 - b.y1);
      const ny = b.x2 - b.x1;
      const nl = Math.hypot(nx, ny) || 1;
      ctx.globalAlpha = Math.random() < 0.25 ? 0.3 : 1;
      for (const [color, width] of [
        ["rgba(250,204,21,0.45)", 12],
        ["#FDE047", 4],
        ["#FFFFFF", 1.5],
      ] as const) {
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.lineJoin = "miter";
        ctx.beginPath();
        ctx.moveTo(b.x1, b.y1);
        for (let s = 1; s < segs; s++) {
          const t = s / segs;
          const j = (Math.random() - 0.5) * 46;
          ctx.lineTo(b.x1 + (b.x2 - b.x1) * t + (nx / nl) * j, b.y1 + (b.y2 - b.y1) * t + (ny / nl) * j);
        }
        ctx.lineTo(b.x2, b.y2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    const drag = Math.exp(-4 * dt);
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      p.vx *= drag;
      p.vy = p.plus ? p.vy * Math.exp(-1.2 * dt) : p.vy * drag + 500 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const k = p.life / p.max;
      ctx.globalAlpha = Math.min(1, k * 1.6);
      if (p.plus) {
        const s = p.size;
        const t = Math.max(1.5, s * 0.36);
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - s / 2, p.y - t / 2, s, t);
        ctx.fillRect(p.x - t / 2, p.y - s / 2, t, s);
      } else if (p.spark) {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = Math.max(1, p.size * 0.55);
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03);
        ctx.stroke();
      } else {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (0.4 + 0.6 * k), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }
}
