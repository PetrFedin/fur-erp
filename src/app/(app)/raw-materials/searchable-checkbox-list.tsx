"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";

/**
 * A checkbox multi-select with a client-side text filter, for picklists too
 * long for a plain checkbox row (e.g. 400+ lot numbers) — every checkbox is
 * still rendered so the whole thing works inside a plain GET <form> with no
 * JS required to submit, the search box only hides/shows rows.
 */
export function SearchableCheckboxList({
  name,
  options,
  selected,
  placeholder,
}: {
  name: string;
  options: { value: string; label: string }[];
  selected: string[];
  placeholder?: string;
}) {
  const [search, setSearch] = useState("");
  const term = search.trim().toLowerCase();
  const visible = term ? options.filter((o) => o.label.toLowerCase().includes(term)) : options;

  return (
    <div className="flex flex-col gap-1">
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={placeholder ?? "Фильтр…"}
        className="h-8"
      />
      <div className="flex max-h-40 flex-col gap-0.5 overflow-y-auto rounded-md border border-neutral-200 p-2">
        {options.map((o) => (
          <label
            key={o.value}
            className="flex items-center gap-1.5 text-sm text-neutral-700"
            style={{ display: visible.includes(o) ? "flex" : "none" }}
          >
            <input
              type="checkbox"
              name={name}
              value={o.value}
              defaultChecked={selected.includes(o.value)}
              className="rounded"
            />
            {o.label}
          </label>
        ))}
        {options.length === 0 && <span className="text-sm text-neutral-400">Нет вариантов</span>}
      </div>
      {term && visible.length === 0 && <span className="text-xs text-neutral-400">Ничего не найдено</span>}
    </div>
  );
}
