"use client";
import { useMemo, type ReactNode } from "react";
import { Tr, Td } from "@/components/ui/table";
import { Money } from "@/components/money";
import { formatRate, formatQtyTrim } from "@/lib/utils";
import { computeTotals, type LotRow } from "@/lib/lot-table";
import { InfoHint } from "@/components/info-hint";
import { useLots } from "../lots-state";

// Общие части таблиц лотов (вынесены из lots-table.tsx без изменений): подписи, подсказки итогов, разделение «с ТЗ / без ТЗ».
export const rateFmt = (n: number) => formatRate(n);
export const symbol = (c: string) => (c === "USD" ? "$" : c);

export const TIP = {
  sum: "Σ — сумма по строкам итога",
  avg: "ср. взвеш. — взвешено по количеству шкур: Σ(значение × кол-во) ÷ Σ кол-во",
  uniq: "уник. — сколько разных значений в колонке (пустые не считаются)",
  rate: "ср. взвеш. курс — взвешено по сумме закупки в валюте (цена × кол-во). «мин–макс» — разброс курса по лотам. Курс и цена в валюте от режима НДС не зависят.",
  unit: "ср. взвеш. себестоимость шкуры — взвешено по количеству шкур: «Себестоимость всего» ÷ Σ шкур, в выбранном режиме С НДС / Без НДС",
  price: "ср. взвеш. цена лота — взвешено по количеству шкур: Σ(цена × кол-во) ÷ Σ шкур. Цена в валюте от НДС не зависит; в ₽ — по курсу лота, в выбранном режиме НДС.",
};

export function Stat({ k, tip, children }: { k: string; tip: string; children: ReactNode }) {
  return (
    <div className="whitespace-nowrap">
      <abbr title={tip} className="mr-1 cursor-help text-[11px] font-semibold uppercase text-neutral-500 no-underline">
        {k}
      </abbr>
      <span className="text-[13px] font-medium">{children}</span>
    </div>
  );
}
export const Note = ({ children }: { children: ReactNode }) => <div className="text-[11px] font-normal text-neutral-500">{children}</div>;

/** Колонки, которые видны в заголовке/итогах (без чекбокса и кнопки правки). */
export const heads = (currency: string) => [
  "Материал",
  "№ лота",
  "Сорт / размер",
  "Операция",
  "Кол-во",
  `Цена за шк., ${currency}`,
  "Курс",
  "Себестоимость ед.",
  "Себестоимость всего",
  "Остаток на складе",
  "Использован в ТЗ",
];
export function Legend() {
  return (
    <InfoHint label="Как считаются итоги" wide>
      <p>
        «Всего, ₽» считается по выбранным лотам, а если выбора нет — по лотам, оставшимся после фильтров. <b>Σ</b> — сумма, <b>ср. взвеш.</b> — среднее
        взвешенное по количеству шкур (курс — по сумме закупки в валюте; никогда не простое среднее), <b>уник.</b> — число разных значений. Цена в валюте и курс от режима
        «С НДС / Без НДС» не зависят.
      </p>
    </InfoHint>
  );
}

/** Лот без ТЗ — по нему нет списаний в производство. */
export const hasTz = (r: LotRow) => r.usages.length > 0;

/**
 * Разделение лотов: основной блок — лоты со списаниями в ТЗ, в конце таблицы отдельным сворачиваемым блоком — лоты без ТЗ.
 * Σ «с ТЗ» + Σ «без ТЗ» = «Всего, ₽» (оба считаются по тем же показанным лотам, что и итог без выбора).
 */
export function useTzSplit(rows: LotRow[]) {
  const { fields, extraOf } = useLots();
  return useMemo(() => {
    const withTz = rows.filter(hasTz);
    const noTz = rows.filter((r) => !hasTz(r));
    return {
      withTz,
      noTz,
      withTotals: computeTotals(withTz, fields, extraOf),
      noTotals: computeTotals(noTz, fields, extraOf),
    };
  }, [rows, fields, extraOf]);
}

export function TzBlockFigures({ t, count }: { t: ReturnType<typeof computeTotals>; count: number }) {
  return (
    <span className="whitespace-nowrap text-xs font-normal text-neutral-600">
      {count} лот. · Σ {formatQtyTrim(t.qty)} шт. · Σ <Money incl={t.totalIncl} excl={t.totalExcl} />
      {t.qty > 0 && (
        <>
          {" · ср. взвеш. "}
          <Money incl={t.totalIncl / t.qty} excl={t.totalExcl / t.qty} />
          {"/шт."}
        </>
      )}
    </span>
  );
}

/** Строки-итоги «Лоты с ТЗ» и заголовок сворачиваемого блока «Лоты без ТЗ — не использованы» (внутри <tbody>). */
export function TzSplitHeader({ split, colSpan, open, onToggle }: { split: ReturnType<typeof useTzSplit>; colSpan: number; open: boolean; onToggle: () => void }) {
  if (split.noTz.length === 0) return null;
  return (
    <>
      {split.withTz.length > 0 && (
      <Tr className="bg-neutral-50 text-sm font-medium" data-tz-block="with">
        <Td colSpan={colSpan}>
          Лоты с ТЗ <TzBlockFigures t={split.withTotals} count={split.withTz.length} />
        </Td>
      </Tr>
      )}
      <Tr className="cursor-pointer border-t-2 border-neutral-300 bg-amber-50/60 text-sm font-medium hover:bg-amber-50" data-tz-block="without" onClick={onToggle}>
        <Td colSpan={colSpan}>
          <button type="button" aria-expanded={open} onClick={(e) => { e.stopPropagation(); onToggle(); }} className="mr-2 text-left">
            <span aria-hidden className={"mr-1 inline-block text-neutral-500 transition-transform " + (open ? "rotate-90" : "")}>›</span>
            Лоты без ТЗ — не использованы
          </button>
          <TzBlockFigures t={split.noTotals} count={split.noTz.length} />
        </Td>
      </Tr>
    </>
  );
}
