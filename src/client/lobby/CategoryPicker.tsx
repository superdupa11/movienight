import type { CategoryId, CategoryOption } from "../../shared/types";
import { CATEGORY_GREY_OUT_BELOW } from "../../shared/types";

type Props = {
  categories: CategoryOption[];
  value: CategoryId[];
  onToggle: (category: CategoryId) => void;
};

// category.count is already filter-aware (server recomputes it against the
// room's active DeckFilters on lobby:filters) — see src/server/deck/filters.ts.
export default function CategoryPicker({ categories, value, onToggle }: Props) {
  const sorted = [...categories].sort((a, b) => a.label.localeCompare(b.label));
  const maxEligible = Math.max(1, ...categories.map((c) => c.count));
  const selectedTotal = Math.max(
    1,
    categories.filter((c) => value.includes(c.id)).reduce((sum, c) => sum + c.count, 0),
  );

  return (
    <div className="flex flex-col gap-1">
      {sorted.map((c) => {
        const selected = value.includes(c.id);
        return (
          <GenreRow
            key={c.id}
            label={c.label}
            count={c.count}
            selected={selected}
            barPct={Math.max(2, Math.round((c.count / maxEligible) * 100))}
            sharePct={Math.round((c.count / selectedTotal) * 100)}
            greyed={!selected && c.count < CATEGORY_GREY_OUT_BELOW}
            onClick={() => onToggle(c.id)}
          />
        );
      })}
    </div>
  );
}

function GenreRow({
  label,
  count,
  selected,
  barPct,
  sharePct,
  greyed,
  onClick,
}: {
  label: string;
  count: number;
  selected: boolean;
  barPct: number;
  sharePct: number;
  greyed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        "relative flex items-center justify-between gap-2.5 overflow-hidden rounded-lg bg-ink-900 px-[14px] py-[13px] text-left ring-1 ring-inset transition-[box-shadow,opacity] duration-[180ms] active:scale-95",
        selected ? "ring-[#e0a34a]" : "ring-white/[0.06]",
        greyed ? "opacity-[0.35]" : "",
      ].join(" ")}
    >
      <span
        aria-hidden
        className={[
          "absolute inset-y-0 left-0 motion-safe:transition-[width] motion-safe:duration-[350ms] motion-safe:ease-[cubic-bezier(0.2,0.8,0.3,1)]",
          selected ? "bg-[#e0a34a] opacity-[0.26]" : "bg-white/[0.07]",
        ].join(" ")}
        style={{ width: `${barPct}%` }}
      />
      <span className={`relative text-[14px] font-medium ${selected ? "text-[#e0a34a]" : "text-white"}`}>{label}</span>
      <span
        className={`relative whitespace-nowrap font-mono text-[10.5px] tracking-[0.1em] ${
          selected ? "text-white/[0.62]" : "text-white/35"
        }`}
      >
        {selected ? `${sharePct}% of deck` : `${count} titles`}
      </span>
    </button>
  );
}
