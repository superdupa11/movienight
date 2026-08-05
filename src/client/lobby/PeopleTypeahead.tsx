import { useEffect, useRef, useState } from "react";
import type { PersonResult } from "../../shared/types";
import { useRoom } from "../shared/RoomContext";

type Props = {
  role: "DIRECTOR" | "ACTOR";
  placeholder: string;
  selected: { id: number; name: string }[];
  onAdd: (person: PersonResult) => void;
  onRemove: (id: number) => void;
};

export default function PeopleTypeahead({ role, placeholder, selected, onAdd, onRemove }: Props) {
  const { searchPeople, state } = useRoom();
  const [q, setQ] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    clearTimeout(debounceRef.current);
    if (q.trim().length < 2) return;
    debounceRef.current = setTimeout(() => searchPeople(q.trim(), role), 200);
    return () => clearTimeout(debounceRef.current);
  }, [q, role, searchPeople]);

  const results = state.peopleResults[role];
  const visibleResults = results.q === q.trim() ? results.people : [];

  return (
    <div className="min-w-0 flex-1">
      {selected.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1.5">
          {selected.map((s) => (
            <button
              key={s.id}
              onClick={() => onRemove(s.id)}
              className="rounded-full bg-white/15 px-2.5 py-1 text-xs text-white ring-1 ring-white/20"
            >
              {s.name} ✕
            </button>
          ))}
        </div>
      )}
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-[9px] bg-ink-950 px-3 py-2.5 text-[13px] text-white outline-none ring-1 ring-inset ring-white/10 placeholder:text-white/35 focus:ring-white/30"
      />
      {visibleResults.length > 0 && (
        <div className="mt-1 max-h-40 overflow-y-auto rounded-lg bg-ink-900 ring-1 ring-white/10">
          {visibleResults
            .filter((r) => !selected.some((s) => s.id === r.id))
            .map((r) => (
              <button
                key={r.id}
                onClick={() => {
                  onAdd(r);
                  setQ("");
                }}
                className="flex w-full justify-between px-3 py-2 text-left text-sm hover:bg-white/10"
              >
                <span>{r.name}</span>
                <span className="text-white/40">{r.movieCount}</span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
