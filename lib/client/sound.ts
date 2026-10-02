/**
 * Tiny synthesized sound kit (WebAudio, no assets). Starts muted; the
 * AudioContext is only created after the user taps the sound toggle, which
 * satisfies browser autoplay rules.
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private lastImpact = 0;
  enabled = false;

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (on && !this.ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.55;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    if (on) void this.ctx?.resume();
  }

  private ready(): AudioContext | null {
    return this.enabled && this.ctx && this.master ? this.ctx : null;
  }

  /** Soft rising "pop". */
  grab(vol = 1): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(380, t);
    o.frequency.exponentialRampToValueAtTime(760, t + 0.07);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.2 * vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + 0.18);
  }

  /** Filtered-noise woosh, brighter and louder with speed. */
  release(speed: number, vol = 1): void {
    const ctx = this.ready();
    if (!ctx || !this.noise || speed < 250) return;
    const k = Math.min(Math.max(speed / 3200, 0.15), 1);
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 1.1;
    bp.frequency.setValueAtTime(450, t);
    bp.frequency.exponentialRampToValueAtTime(600 + 2600 * k, t + 0.22);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.32 * k * vol, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);
    src.connect(bp).connect(g).connect(this.master!);
    src.start(t, Math.random() * 0.5);
    src.stop(t + 0.4);
  }

  /** Thud + click, scaled by impact strength (0..1). */
  impact(strength: number): void {
    const ctx = this.ready();
    if (!ctx || !this.noise) return;
    const now = performance.now();
    if (now - this.lastImpact < 45) return;
    this.lastImpact = now;
    const s = Math.min(Math.max(strength, 0.08), 1);
    const t = ctx.currentTime;

    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(150 + 90 * s, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.16);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5 * s, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + 0.22);

    const n = ctx.createBufferSource();
    n.buffer = this.noise;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 1600;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.16 * s, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    n.connect(hp).connect(ng).connect(this.master!);
    n.start(t, Math.random() * 0.5);
    n.stop(t + 0.06);
  }

  private burst(t: number, dur: number, type: BiquadFilterType, freq: number, gain: number): void {
    const ctx = this.ctx!;
    const n = ctx.createBufferSource();
    n.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(f).connect(g).connect(this.master!);
    n.start(t, Math.random() * 0.5);
    n.stop(t + dur + 0.02);
  }

  private tone(t: number, type: OscillatorType, f0: number, f1: number, dur: number, gain: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** Item hit sounds. */
  item(id: string, vol = 1): void {
    const ctx = this.ready();
    if (!ctx || !this.noise) return;
    const t = ctx.currentTime;
    switch (id) {
      case "whip":
        this.burst(t, 0.03, "highpass", 3000, 0.5 * vol);
        this.burst(t + 0.01, 0.12, "bandpass", 1800, 0.2 * vol);
        break;
      case "hammer":
        this.tone(t, "sine", 180, 50, 0.25, 0.55 * vol);
        this.tone(t, "square", 900, 860, 0.12, 0.05 * vol);
        this.burst(t, 0.06, "lowpass", 900, 0.3 * vol);
        break;
      case "taser":
        for (let i = 0; i < 6; i++) this.tone(t + i * 0.055, "sawtooth", 120 + Math.random() * 80, 90, 0.05, 0.09 * vol);
        this.burst(t, 0.35, "highpass", 5000, 0.08 * vol);
        break;
      case "bomb":
        this.burst(t, 0.9, "lowpass", 500, 0.8 * vol);
        this.tone(t, "sine", 90, 30, 0.7, 0.6 * vol);
        break;
      case "fuse":
        this.burst(t, 0.6, "highpass", 4000, 0.06 * vol);
        break;
    }
  }

  /** Falling flatline + crunch. */
  death(): void {
    const ctx = this.ready();
    if (!ctx || !this.noise) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "square";
    o.frequency.setValueAtTime(440, t);
    o.frequency.exponentialRampToValueAtTime(55, t + 0.9);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
    g.gain.setValueAtTime(0.12, t + 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + 1.25);
    this.impact(1);
  }

  /** Little 8-bit arpeggio. */
  revive(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    [523, 659, 784, 1047].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "square";
      o.frequency.value = f;
      const s = t + i * 0.07;
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(0.07, s + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.12);
      o.connect(g).connect(this.master!);
      o.start(s);
      o.stop(s + 0.14);
    });
  }

  /** Rising zap for ridiculous throws. */
  launch(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const lp = ctx.createBiquadFilter();
    const g = ctx.createGain();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(200, t);
    o.frequency.exponentialRampToValueAtTime(1500, t + 0.32);
    lp.type = "lowpass";
    lp.frequency.value = 2200;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.09, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
    o.connect(lp).connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + 0.45);
  }
}
