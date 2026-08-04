export type Stage = { width: number; height: number };

export type KernelSeed = {
  vx: number;
  vy: number;
  x0: number;
  y0: number;
  delay: number;
  size: number;
  z: number;
  squish: number;
  spin: number;
  tint: readonly [string, string, string];
  rest: number;
};

export type KernelPlacement = { x: number; y: number; rot: number };

const TINTS: readonly (readonly [string, string, string])[] = [
  ["#fffaf0", "#fff3dc", "#f0dcb4"],
  ["#fff6e3", "#f6e2ba", "#dfc28c"],
  ["#fdeecd", "#f3d79a", "#cf9c4d"],
  ["#f7e3b6", "#e0a34a", "#b5772e"],
];

// Fixed seed keeps the burst art-directed (same shape every match) rather
// than reshuffling every time. mulberry32, ported from the design prototype.
const SEED = 20260804;
// The prototype was art-directed at a 402x874 stage; scaling G/speed by the
// real height keeps the arc shape identical on any phone.
const REFERENCE_HEIGHT = 874;
const GRAVITY = 2400; // px/s^2 at REFERENCE_HEIGHT

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeSeeds(count: number, burstPower: number, stage: Stage): KernelSeed[] {
  const n = Math.max(4, Math.round(count));
  const { width: W, height: H } = stage;
  const cx = W / 2;
  const cy = H * 0.425;
  const heightScale = H / REFERENCE_HEIGHT;
  const rand = mulberry32(SEED);
  const seeds: KernelSeed[] = [];

  for (let i = 0; i < n; i++) {
    const ang = -Math.PI / 2 + (rand() - 0.5) * 2.5;
    const speed = (700 + rand() * 900) * burstPower * heightScale;
    const z = rand();
    const vx = Math.cos(ang) * speed * (1.15 + rand() * 0.5);
    const vy = Math.sin(ang) * speed;
    const x0 = cx + (rand() - 0.5) * 44;
    const y0 = cy + (rand() - 0.5) * 30;
    const delay = rand() * 0.11;
    const size = 7 + z * 21;
    const squish = 0.72 + rand() * 0.5;
    const spin = (rand() - 0.5) * 900;
    const tint = TINTS[Math.floor(rand() * TINTS.length)]!;
    // Slow-moving kernels rest higher, near the center -> rough mound shape.
    const rest = H - 4 - rand() * 26 - 40 * Math.exp(-Math.pow(vx / (620 * heightScale), 2));

    seeds.push({ vx, vy, x0, y0, delay, size, z, squish, spin, tint, rest });
  }

  return seeds;
}

/** Analytic flight — position is a pure function of (seed, t), so seek/replay is exact. */
export function place(seed: KernelSeed, tb: number, stage: Stage): KernelPlacement {
  const heightScale = stage.height / REFERENCE_HEIGHT;
  const g = GRAVITY * heightScale;
  const tt = tb - seed.delay;
  if (tt <= 0) return { x: seed.x0, y: seed.y0, rot: 0 };

  let x = seed.x0 + seed.vx * tt * (1 - 0.3 * Math.min(tt, 1));
  let y = seed.y0 + seed.vy * tt + 0.5 * g * tt * tt;

  const drop = seed.y0 - seed.rest;
  const landTime = (-seed.vy + Math.sqrt(Math.max(0, seed.vy * seed.vy - 2 * g * drop))) / g;

  if (tt > landTime) {
    const dt = tt - landTime;
    const impact = Math.abs(seed.vy + g * landTime);
    const amp = Math.min(46, impact * 0.055) * Math.exp(-4.2 * dt);
    y = seed.rest - amp * Math.abs(Math.sin(15 * dt));
    const xAtLanding = seed.x0 + seed.vx * landTime * (1 - 0.3 * Math.min(landTime, 1));
    x = xAtLanding + seed.vx * 0.16 * dt * Math.exp(-3.4 * dt);
  }

  // Reflect off the screen edges so nothing leaves the stage.
  const pad = seed.size * 0.6;
  const lo = pad;
  const hi = stage.width - pad;
  const span = hi - lo;
  let u = (x - lo) % (2 * span);
  if (u < 0) u += 2 * span;
  x = lo + (u > span ? 2 * span - u : u);

  const rot = seed.spin * Math.min(tt, landTime + 0.25);
  return { x, y, rot };
}
