"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatQty, formatDec1 } from "@/lib/utils";
import { vatPeriodLabel } from "@/lib/vat-by-date";

export type LotOpt = {
  id: string;
  lotNumber: string | null;
  material: string;
  unit: string;
  grade: string | null;
  color: string | null;
  remaining: number;
  /** Цена за единицу с НДС (лот). */
  unitCost: number;
  /** Цена за единицу без НДС (lotUnitCostExclVat). */
  unitCostExcl: number;
  vatRate: number;
  /** Ставка НДС по умолчанию у материала (null — «по лоту»). */
  materialVat: number | null;
  /** Дата закупки лота (YYYY-MM-DD) — по ней «куплено до 2026 / с 2026». */
  purchaseDate: string;
  purchaseId: string | null;
  purchaseNumber: string | null;
  auction: string | null;
};

export const lotTitle = (l: LotOpt) =>
  `${l.lotNumber ?? "без номера"} · ${l.material}${[l.grade, l.color].filter(Boolean).length ? ` (${[l.grade, l.color].filter(Boolean).join(", ")})` : ""}`;

/** Выбор лота с поиском по номеру, материалу, сорту, цвету, закупке и аукциону. Показывает остаток и цену. */
export function LotPicker({
  lots, value, onChange, taken, placeholder = "Лот: номер, сорт, закупка…", ariaLabel = "Лот",
}: {
  lots: LotOpt[];
  value: string;
  onChange: (id: string) => void;
  /** Сколько уже взято из лота другими строками (чтобы показывать остаток после них). */
  taken: Record<string, number>;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const sel = lots.find((l) => l.id === value) ?? null;
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const off = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", off);
    return () => document.removeEventListener("mousedown", off);
  }, []);
  const q = text.trim().toLowerCase();
  const items = useMemo(() => {
    const hay = (l: LotOpt) => [l.lotNumber, l.material, l.grade, l.color, l.purchaseNumber, l.auction].filter(Boolean).join(" ").toLowerCase();
    const f = q ? lots.filter((l) => q.split(/\s+/).every((w) => hay(l).includes(w))) : lots;
    return f.slice(0, 40);
  }, [lots, q]);
  return (
    <div ref={box} className="relative min-w-0">
      <input
        type="text"
        aria-label={ariaLabel}
        autoComplete="off"
        placeholder={placeholder}
        value={open ? text : sel ? lotTitle(sel) : text}
        title={sel ? lotTitle(sel) : undefined}
        onFocus={() => { setText(""); setOpen(true); }}
        onChange={(e) => { setText(e.target.value); setOpen(true); }}
        className="h-8 w-full rounded-md border border-neutral-300 bg-white px-2 text-sm placeholder:text-neutral-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 max-md:h-10"
      />
      {open && (
        <ul className="absolute z-30 mt-1 max-h-72 w-[min(34rem,90vw)] overflow-auto rounded-md border border-neutral-200 bg-white text-sm shadow-lg">
          {items.map((l) => {
            const left = l.remaining - (taken[l.id] ?? 0) + (l.id === value ? 0 : 0);
            return (
              <li key={l.id}>
                <button
                  type="button"
                  className="block w-full px-3 py-1.5 text-left hover:bg-neutral-100"
                  onClick={() => { onChange(l.id); setOpen(false); setText(""); }}
                >
                  <span className="font-medium">{lotTitle(l)}</span>
                  <span className="block text-xs text-neutral-500">
                    ост. {formatDec1(l.remaining)}{left !== l.remaining ? ` (свободно ${formatDec1(left)})` : ""} · {formatDec1(l.unitCost)} ₽/ед. · НДС {l.materialVat != null && l.materialVat !== l.vatRate ? `${l.materialVat} % (в лоте ${l.vatRate} %)` : `${l.vatRate} %`} · {vatPeriodLabel(l.purchaseDate)}
                    {l.purchaseNumber ? ` · закупка ${l.purchaseNumber}` : ""}{l.auction ? ` · ${l.auction}` : ""}
                  </span>
                </button>
              </li>
            );
          })}
          {items.length === 0 && <li className="px-3 py-2 text-neutral-500">Лот не найден (или остаток 0)</li>}
        </ul>
      )}
    </div>
  );
}
