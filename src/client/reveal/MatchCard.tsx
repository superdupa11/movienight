type Props = {
  eyebrow: string;
  opacity: number;
  scale: number;
  eyebrowOpacity: number;
};

export default function MatchCard({ eyebrow, opacity, scale, eyebrowOpacity }: Props) {
  if (opacity <= 0.001) return null;
  return (
    <div
      className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-4"
      style={{ opacity, transform: `scale(${scale})` }}
    >
      <p
        className="font-mono text-[10px] font-medium tracking-[.3em]"
        style={{ color: "#e0a34a", opacity: eyebrowOpacity }}
      >
        {eyebrow}
      </p>
      <h2 className="max-w-[300px] text-center font-display text-[62px] uppercase leading-[.88] tracking-[.01em] text-white">
        You have a match!
      </h2>
    </div>
  );
}
