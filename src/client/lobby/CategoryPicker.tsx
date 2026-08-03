import type { CategoryId, CategoryOption } from "../../shared/types";
import { CATEGORY_GREY_OUT_BELOW } from "../../shared/types";

type Props = {
  categories: CategoryOption[];
  value: CategoryId[];
  onToggle: (category: CategoryId) => void;
};

export default function CategoryPicker({ categories, value, onToggle }: Props) {
  return (
    <div className="flex flex-wrap gap-2">
      {categories.map((c) => (
        <Chip key={c.id} label={c.label} count={c.count} selected={value.includes(c.id)} onClick={() => onToggle(c.id)} />
      ))}
    </div>
  );
}

function Chip({
  label,
  count,
  selected,
  onClick,
}: {
  label: string;
  count: number;
  selected: boolean;
  onClick: () => void;
}) {
  const greyed = count < CATEGORY_GREY_OUT_BELOW;
  return (
    <button
      onClick={onClick}
      className={[
        "rounded-full px-4 py-2 text-sm font-medium transition ring-1 active:scale-95",
        selected ? "bg-white text-ink-950 ring-white" : "bg-ink-800 text-white ring-white/10",
        greyed && !selected ? "opacity-40" : "",
      ].join(" ")}
    >
      {label} <span className="opacity-60">({count})</span>
    </button>
  );
}
