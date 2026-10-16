// Seeded random numbers, so every run can be reproduced exactly: xoshiro128** seeded by splitmix32.

function splitmix32(x: number): () => number {
  return () => {
    x = (x + 0x9e3779b9) >>> 0;
    let z = x;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
}

export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(seed: number) {
    const sm = splitmix32(seed >>> 0);
    this.a = sm();
    this.b = sm();
    this.c = sm();
    this.d = sm();
    if ((this.a | this.b | this.c | this.d) === 0) this.a = 1;
  }

  private u32(): number {
    const result = Math.imul(((Math.imul(this.b, 5) << 7) | (Math.imul(this.b, 5) >>> 25)), 9) >>> 0;
    const t = (this.b << 9) >>> 0;
    this.c ^= this.a;
    this.d ^= this.b;
    this.b ^= this.c;
    this.a ^= this.d;
    this.c = (this.c ^ t) >>> 0;
    this.d = ((this.d << 11) | (this.d >>> 21)) >>> 0;
    this.a >>>= 0;
    this.b >>>= 0;
    return result;
  }

  /** Uniform in [0, 1), with 32 random bits. */
  next(): number {
    return this.u32() / 4294967296;
  }

  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  normal(): number {
    const u = 1 - this.next();
    const v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  pick<T>(xs: readonly T[]): T {
    return xs[this.int(xs.length)];
  }

  shuffle<T>(xs: T[]): T[] {
    for (let i = xs.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [xs[i], xs[j]] = [xs[j], xs[i]];
    }
    return xs;
  }

  /** An independent generator for a labelled sub-stream (world, agents, perception, run). */
  fork(label: number): Rng {
    return new Rng((this.u32() ^ Math.imul(label + 1, 0x27d4eb2d)) >>> 0);
  }
}
