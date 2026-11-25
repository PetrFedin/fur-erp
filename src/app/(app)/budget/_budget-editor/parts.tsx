"use client";

import type { ReactNode } from "react";
import { formatNum } from "@/lib/utils";
import { type Agg } from "@/lib/budget-calc";
import { money, qty } from "../ui";

/** Общие мелкие элементы редактора бюджета (вынесено из budget-editor.tsx). */

/** Мелкая подпись под суммой: средняя цена шкуры / метра подкладки / работы на изделие. */
export function Avg({ sum, per, unit, d = 0 }: { sum: number; per: number; unit: string; d?: number }) {
  if (!(per > 0) || !(sum > 0)) return null;
  const v = sum / per;
  return <div className="sub-cap mt-0.5 whitespace-normal text-[11px] font-normal leading-tight text-neutral-600">ср. {unit.startsWith("₽") ? formatNum(Math.round(v / 1000) * 1000, 0) : formatNum(v, d > 0 ? 10 : 1)} {unit}</div>;
}

export const ZERO: Agg = { pcs: 0, hides: 0, mex: 0, meters: 0, lining: 0, work: 0, c4: 0, total: 0, nowTotal: 0, nowPcs: 0, cmpTotal: 0 };
export type NumKey = "pcs" | "hides" | "hidePrice" | "meters" | "meterPrice" | "work";
export type UpKey = "upFur" | "upLining" | "upWork";
export const KIND_LABEL = { fur: "тип сырья", cat: "категория", len: "длина", art: "артикул" } as const;
export const ICON_BTN = "btn-accent inline-flex h-10 min-w-10 items-center justify-center rounded-md border border-neutral-200 bg-white px-1.5 text-sm text-neutral-600 hover:border-neutral-400 hover:text-neutral-900 disabled:opacity-40 md:h-8 md:min-w-8";
export const DOT = { ok: "bg-emerald-500", warn: "bg-amber-500", bad: "bg-red-500", manual: "bg-neutral-400" } as const;

/** Короткая подпись колонки + единица второй строкой + «i»-подсказка (title). Вертикально по центру. */
export function Th({ children, tip, unit, className = "" }: { children: ReactNode; tip: string; unit?: string; className?: string }) {
  return (
    <th scope="col" className={"h-10 whitespace-nowrap px-1 py-1 text-right align-middle text-[11px] font-medium leading-tight print:text-[8.5px] 2xl:px-2 2xl:text-xs text-neutral-500 " + className}>
      <span className="inline-flex flex-col items-end">
        <span className="inline-flex items-center gap-0.5">
          {children}
          <span title={tip} aria-label={tip} className="inline-flex h-3 w-3 cursor-help items-center justify-center rounded-full border border-neutral-300 text-[11px] font-normal leading-none text-neutral-600">i</span>
        </span>
        {unit ? <span className="max-w-[72px] whitespace-normal text-[11px] font-normal opacity-80">{unit}</span> : null}
      </span>
    </th>
  );
}

export const sepL = "border-l border-neutral-200";
/** В таблицах нулевые значения — «—». */
export const mz = (v: number | null | undefined) => (v ? money(v) : "–");
/** В сводной таблице без «₽»: единица стоит в заголовке колонки (так таблица вмещается в ширину). */
export const mt = (v: number | null | undefined) => (v ? money(v).replace(" ₽", "") : "–");
export const qz = (v: number | null | undefined, d = 0) => (v ? qty(v, d) : "–");
