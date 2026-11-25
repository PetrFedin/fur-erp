"use client";

import type { Dispatch, SetStateAction } from "react";
import { SEG_GROUP, segCls } from "@/components/segmented";
import type { FurKind, TableRow } from "@/lib/fur-table";

type Group = "item" | "year" | "auction" | "lots";
/** Строка управления над таблицей: «Строки по», порядок уровней года, сортировка списка лотов, «Выбрано … снять выбор». */
export function RowsToolbar({ variant, kind, lockItem, group, setGroup, yearOrder, setYearOrder, yearRows, setExpanded, lotSort, setLotSort, selectedHere, allVisible, setSelected, setOnlySelected }: {
  variant: "main" | "years"; kind: FurKind; lockItem?: string; group: Group; setGroup: Dispatch<SetStateAction<Group>>;
  yearOrder: "item" | "auction"; setYearOrder: Dispatch<SetStateAction<"item" | "auction">>; yearRows: TableRow[]; setExpanded: Dispatch<SetStateAction<Set<string>>>;
  lotSort: "num" | "recv" | "used" | "rem"; setLotSort: Dispatch<SetStateAction<"num" | "recv" | "used" | "rem">>; selectedHere: number; allVisible: string[];
  setSelected: Dispatch<SetStateAction<string[]>>; setOnlySelected: Dispatch<SetStateAction<boolean>>;
}) {
  return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-1 text-xs text-neutral-500">
        {variant === "years" ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-neutral-800">
            <div role="group" aria-label="Порядок уровней" className={SEG_GROUP}>
              {([["item", "Год → сырьё → аукцион"], ["auction", "Год → аукцион → сырьё"]] as const).map(([k, t]) => <button key={k} type="button" aria-pressed={yearOrder === k} onClick={() => { setYearOrder(k); setExpanded(new Set([...(yearRows[0] ? [`g/year:${yearRows[0].key}`] : [])])); }} className={segCls(yearOrder === k)}>{t}</button>)}
            </div>
          </div>
        ) : (
        <>
        <div role="tablist" aria-label="Строки по" className="flex flex-wrap items-center gap-1.5">
          <span>Строки по:</span>
          {((lockItem ? [["auction", "Аукциону"], ["year", "Году закупки"], ["lots", "Списком лотов"]] : [["item", kind === "lining" ? "Ткани" : "Виду меха"], ["year", "Году закупки"] as const, ["lots", "Списком лотов"]] as const) as ReadonlyArray<readonly ["item" | "year" | "auction" | "lots", string]>).map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={group === id} onClick={() => { setGroup(id); setExpanded(new Set()); }}
              className={"rounded-lg border px-3 py-1.5 text-xs " + (group === id ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50")}>{label}</button>
          ))}
        </div>
        {/* «Год закупки» (мех): порядок уровней под годом — вид → аукцион или аукцион → вид (раньше это была отдельная таблица «Динамика по годам»). */}
        {group === "year" && !lockItem && kind === "fur" ? (
          <div role="group" aria-label="Порядок уровней" className={SEG_GROUP}>
            {([["item", "Год → сырьё → аукцион"], ["auction", "Год → аукцион → сырьё"]] as const).map(([k, t]) => (
              <button key={k} type="button" aria-pressed={yearOrder === k} onClick={() => { setYearOrder(k); setExpanded(new Set([...(yearRows[0] ? [`g/year:${yearRows[0].key}`] : [])])); }} className={segCls(yearOrder === k)}>{t}</button>
            ))}
          </div>
        ) : null}
        </>
        )}
        {group === "lots" && (
          <label className="inline-flex items-center gap-1.5">
            Сортировка:
            <select value={lotSort} onChange={(e) => setLotSort(e.target.value as typeof lotSort)} className="rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-xs text-neutral-700">
              <option value="num">№ лота</option>
              <option value="recv">Куплено, ₽ (по убыванию)</option>
              <option value="used">Использовано, ₽ (по убыванию)</option>
              <option value="rem">Остаток, ₽ (по убыванию)</option>
            </select>
          </label>
        )}
        {selectedHere > 0 && (
          <span>
            Выбрано: <b className="text-neutral-900">{selectedHere}</b> из {allVisible.length}
            <button type="button" onClick={() => { setSelected([]); setOnlySelected(false); }} className="ml-2 underline">снять выбор</button>
          </span>
        )}
      </div>
  );
}
