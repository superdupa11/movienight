import type { KernelSeed, Stage } from "./popcorn";
import { place } from "./popcorn";

type Props = {
  seeds: KernelSeed[];
  t: number; // burst-local clock (tb)
  stage: Stage;
  fade: number; // 0-1, fades kernels out near the end of the burst
};

export default function PopcornLayer({ seeds, t, stage, fade }: Props) {
  if (t <= 0 || fade <= 0.01) return null;

  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      {seeds.map((seed, i) => {
        const { x, y, rot } = place(seed, t, stage);
        if (y > stage.height + 60) return null;
        const w = seed.size * (1 + 0.14 * Math.sin(rot / 40));
        const h = seed.size * seed.squish;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              width: w,
              height: h,
              borderRadius: "50% 46% 52% 48% / 48% 52% 46% 50%",
              background: `radial-gradient(circle at 34% 28%, ${seed.tint[0]}, ${seed.tint[1]} 58%, ${seed.tint[2]} 100%)`,
              boxShadow: `0 0 ${seed.size * 0.7}px rgba(224,163,74,${0.12 + seed.z * 0.2})`,
              filter: seed.z < 0.45 ? `blur(${(0.45 - seed.z) * 5.5}px)` : undefined,
              opacity: (0.5 + seed.z * 0.5) * fade,
              transform: `translate(${x - w / 2}px, ${y - h / 2}px) rotate(${rot}deg)`,
              willChange: "transform",
            }}
          />
        );
      })}
    </div>
  );
}
