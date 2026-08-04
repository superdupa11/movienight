import { describe, expect, it } from "vitest";
import { makeSeeds, place } from "../popcorn";

const STAGE = { width: 402, height: 874 };

describe("popcorn physics", () => {
  it("is deterministic for a given seed and stage", () => {
    const a = makeSeeds(46, 1, STAGE);
    const b = makeSeeds(46, 1, STAGE);
    expect(a).toEqual(b);
  });

  it("parks a kernel at its origin before its delay elapses", () => {
    const [seed] = makeSeeds(1, 1, STAGE);
    const q = place(seed!, 0, STAGE);
    expect(q).toEqual({ x: seed!.x0, y: seed!.y0, rot: 0 });
  });

  it("rises then falls before settling near its resting height", () => {
    const seeds = makeSeeds(46, 1, STAGE);
    for (const seed of seeds) {
      const ys: number[] = [];
      for (let tb = 0; tb <= 3; tb += 0.05) ys.push(place(seed, tb, STAGE).y);

      const minY = Math.min(...ys);
      const minIdx = ys.indexOf(minY);
      // Rises (y decreases) to a peak, then falls (y increases) after — not
      // monotonically increasing from frame zero.
      expect(minIdx).toBeGreaterThan(0);

      const settled = place(seed, 3, STAGE).y;
      expect(settled).toBeGreaterThan(seed.rest - 5);
      expect(settled).toBeLessThanOrEqual(seed.rest + 0.01);
    }
  });

  it("never leaves the stage horizontally, at any point in the flight", () => {
    const seeds = makeSeeds(46, 1, STAGE);
    for (const seed of seeds) {
      for (let tb = 0; tb <= 3; tb += 0.05) {
        const { x } = place(seed, tb, STAGE);
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(STAGE.width);
      }
    }
  });

  it("scales gravity/speed with stage height so the arc shape holds on a smaller phone", () => {
    const small = { width: 320, height: 700 };
    const seedsRef = makeSeeds(1, 1, STAGE);
    const seedsSmall = makeSeeds(1, 1, small);
    const scale = small.height / STAGE.height;
    expect(seedsSmall[0]!.vy / seedsRef[0]!.vy).toBeCloseTo(scale, 5);
  });
});
