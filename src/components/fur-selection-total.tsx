"use client";

import { useMemo, useState } from "react";
import { formatMoney, formatQty } from "@/lib/utils";
import { useVatDisplay } from "@/lib/vat-display";

type Row = {
  id: string;
  name: string;
  unit: string;
  purchased: string;
  remaining: string;
  remainingValue: string;
  remainingValueExclVat: string;
};

const UNIT_LABELS: Record<string, string> = {
  PIECE: "шт.",
  KG: "кг",
  M2: "м²",
  M: "м",
  SET: "компл.",
};

export function FurSelectionTotal({ rows }: { rows: Row[] }) {
  const [selected, setSelected] = useState<string[]>(rows.map((r) => r.id));
  const { mode } = useVatDisplay();
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const allSelected = selected.length === rows.length;

  const total = rows
    .filter((r) => selectedSet.has(r.id))
    .reduce(
      (acc, r) => {
        acc.value += Number(mode === "excl" ? r.remainingValueExclVat : r.remainingValue);
        acc.purchased += Number(r.purchased);
        acc.remaining += Number(r.remaining);
        return acc;
      },
      { value: 0, purchased: 0, remaining: 0 },
    );

  return (
    <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">Тотал выбранного меха</div>
          <div className="mt-1 text-lg font-semibold">{formatMoney(total.value)}</div>
          <div className="mt-0.5 text-xs text-neutral-500">
            выбрано {selected.length} из {rows.length} видов · куплено {formatQty(total.purchased)} · остаток {formatQty(total.remaining)}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setSelected(allSelected ? [] : rows.map((r) => r.id))}
          className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-neutral-100"
        >
          {allSelected ? "Снять все" : "Выбрать все"}
        </button>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map((r) => (
          <label
            key={r.id}
            className="flex cursor-pointer items-center justify-between gap-3 rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm hover:bg-neutral-50"
          >
            <span className="min-w-0">
              <span className="block font-medium">{r.name}</span>
              <span className="block text-xs text-neutral-500">
                остаток {formatQty(r.remaining)} {UNIT_LABELS[r.unit] ?? r.unit} · {formatMoney(mode === "excl" ? r.remainingValueExclVat : r.remainingValue)}
              </span>
            </span>
            <input
              type="checkbox"
              checked={selectedSet.has(r.id)}
              onChange={(e) =>
                setSelected((prev) =>
                  e.target.checked ? [...prev, r.id] : prev.filter((id) => id !== r.id),
                )
              }
              aria-label={`Включить ${r.name} в тотал`}
              className="size-4 shrink-0 cursor-pointer accent-neutral-900"
            />
          </label>
        ))}
      </div>
    </div>
  );
}
