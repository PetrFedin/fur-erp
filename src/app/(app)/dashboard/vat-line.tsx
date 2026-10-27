"use client";

import { useVatDisplay } from "@/lib/vat-display";
import { formatMoney } from "@/lib/utils";
import type { VatByRate } from "@/lib/dashboard-data";

/** Ставки в виде [ставка, ₽] по возрастанию, без нулевых. */
export const vatEntries = (v: VatByRate | undefined): [string, number][] =>
  Object.entries(v ?? {}).filter(([, x]) => Math.abs(x) >= 0.5).sort((a, b) => Number(a[0]) - Number(b[0]));

const rub0 = (v: number) => formatMoney(Math.round(v));
const rub2 = (v: number) => formatMoney(v.toFixed(2));

/**
 * Мелкая строка под суммой плитки: «в т.ч. НДС: 20% — X ₽ · 22% — Y ₽» (одна ставка — «НДС 22% — X ₽»).
 * Сумма НДС одна и та же в обоих режимах шапки: при «С НДС» она лежит внутри суммы, при «Без НДС» — не входит в неё.
 * Резервирует высоту (minRem), чтобы плитки ряда стояли на одном уровне.
 */
export function VatLine({ v, minRem = 0, className = "mt-2" }: { v: VatByRate | undefined; minRem?: number; className?: string }) {
  const { mode } = useVatDisplay();
  const e = vatEntries(v);
  const incl = mode === "incl";
  const title = e.length ? `${incl ? "НДС внутри суммы" : "НДС, не входящий в сумму"}: ${e.map(([r, x]) => `${r}% — ${rub2(x)}`).join("; ")}` : undefined;
  return (
    <div className={`${className} text-[11px] leading-4 text-neutral-500`} style={minRem ? { minHeight: `${minRem}rem` } : undefined} title={title} data-vat-line>
      {e.length === 0 ? null : e.length === 1 ? (
        <span>{incl ? "в т.ч. " : "не вх. "}НДС {e[0][0]}% — <span className="whitespace-nowrap tabular-nums">{rub0(e[0][1])}</span></span>
      ) : (
        <span>
          {incl ? "в т.ч. НДС: " : "НДС (не вх.): "}
          {e.map(([r, x], i) => (
            <span key={r}>
              {i > 0 ? " · " : ""}
              {r}% — <span className="whitespace-nowrap tabular-nums">{rub0(x)}</span>
            </span>
          ))}
        </span>
      )}
    </div>
  );
}

const fmtEntries = (v: VatByRate | undefined) => {
  const e = vatEntries(v);
  return e.length ? e.map(([r, x]) => `${r}% — ${rub0(x)}`).join(" · ") : "–";
};

/** Абзацы для «i» таблиц: НДС по ставкам для меха и подкладки (куплено / использовано без 4% / остаток). */
export function VatTriplesHint({ fur, lining }: { fur: { recv: VatByRate; used: VatByRate; rem: VatByRate }; lining: { recv: VatByRate; used: VatByRate; rem: VatByRate } }) {
  const line = (name: string, t: { recv: VatByRate; used: VatByRate; rem: VatByRate }) => (
    <p className="mt-1"><b>НДС, {name}:</b> куплено — {fmtEntries(t.recv)}; использовано (без 4%) — {fmtEntries(t.used)}; остаток — {fmtEntries(t.rem)}.</p>
  );
  return (
    <>
      <p className="mt-1">Ставки НДС — внутри сумм «с НДС» (в режиме «без НДС» они в сумму не входят); это те же значения, что под суммой плиток «Сырьё».</p>
      {line("мех", fur)}
      {line("подкладка", lining)}
    </>
  );
}
