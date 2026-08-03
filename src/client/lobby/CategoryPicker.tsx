import type { CategoryId, CategoryOption } from "../../shared/types";
import { CATEGORY_GREY_OUT_BELOW } from "../../shared/types";

type Props = {
  categories: CategoryOption[];
  value: CategoryId | "ALL";
  editable: boolean;
  onChange: (category: CategoryId | "ALL") => void;
  allCount: number;
};

export default function CategoryPicker({ categories, value, editable, onChange, allCount }: Props) {
  return (
    <div className="flex flex-wrap gap-2">
      <Chip label="All" count={allCount} selected={value === "ALL"} editable={editable} onClick={() => onChange("ALL")} />
      {categories.map((c) => (
        <Chip
          key={c.id}
          label={c.label}
          count={c.count}
          selected={value === c.id}
          editable={editable}
          onClick={() => onChange(c.id)}
        />
      ))}
    </div>
  );
}

function Chip({
  label,
  count,
  selected,
  editable,
  onClick,
}: {
  label: string;
  count: number;
  selected: boolean;
  editable: boolean;
  onClick: () => void;
}) {
  const greyed = count < CATEGORY_GREY_OUT_BELOW;
  return (
    <button
      disabled={!editable}
      onClick={onClick}
      className={[
        "rounded-full px-4 py-2 text-sm font-medium transition ring-1",
        selected ? "bg-white text-ink-950 ring-white" : "bg-ink-800 text-white ring-white/10",
        greyed && !selected ? "opacity-40" : "",
        editable ? "active:scale-95" : "cursor-default",
      ].join(" ")}
    >
      {label} <span className="opacity-60">({count})</span>
    </button>
  );
}
