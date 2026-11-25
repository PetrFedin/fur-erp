"use client";
import { formatMoney, formatPercent } from "@/lib/utils";
import { useVatDisplay } from "@/lib/vat-display";
import { useScope } from "../lots-state";
import { TotalLabel } from "@/components/total-label";

const pct = (v: number, total: number) => {
  if (Math.abs(total) < 0.005) return "–";
  const p = Math.round((v / total) * 1000) / 10;
  return formatPercent(p);
};

/** «Из чего складывается стоимость»: вертикальный список частей с долями; сумма частей = полной стоимости. */
export function CostPartsBlock({ scope, title }: { scope: string; title?: string }) {
  const view = useScope(scope);
  const { mode } = useVatDisplay();
  const b = view.breakdown;
  const val = (l: { incl: number; excl: number }) => (mode === "excl" ? l.excl : l.incl);
  const total = mode === "excl" ? b.totalExcl : b.totalIncl;
  // «Не разложено» < 10 ₽ либо < 0,001 % итога — накопленное округление НДС, строку не показываем;
  // пояснение «нет детализации» уместно только при заметном остатке.
  const isNotable = (v: number) => Math.abs(v) >= 10 && Math.abs(v) >= Math.abs(total) * 0.00001;
  const lines = b.lines.filter((l) => (l.kind === "unresolved" ? isNotable(val(l)) : Math.abs(val(l)) >= 0.005));
  const sum = lines.reduce((s, l) => s + val(l), 0);
  const roundingHidden = b.lines.some((l) => l.kind === "unresolved") && !lines.some((l) => l.kind === "unresolved");
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-3" data-cost-parts>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3">
        <p className="text-sm font-semibold">{title ?? "Состав стоимости"}</p>
        <p className="text-xs text-neutral-500">
          {view.label} · {mode === "excl" ? "без НДС" : "с НДС"}
        </p>
      </div>
      {view.basis.length === 0 ? (
        <p className="text-sm text-neutral-500">Нет лотов для расчёта</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {lines.map((l) => {
            const v = val(l);
            const share = total !== 0 ? Math.max(0, Math.min(100, (v / total) * 100)) : 0;
            return (
              <li key={l.key} data-cost-line={l.key} className={l.kind === "unresolved" ? "text-amber-700" : undefined}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0 flex-1 break-words">
                    {l.title}
                    {l.hint && (l.kind !== "unresolved" || isNotable(v)) && <span className="block text-xs text-neutral-500">{l.hint}</span>}
                  </span>
                  <span className="whitespace-nowrap font-medium tabular-nums">{formatMoney(v)}</span>
                  <span className="w-14 whitespace-nowrap text-right text-xs text-neutral-500 tabular-nums">{pct(v, total)}</span>
                </div>
                <div className="mt-0.5 h-1 rounded bg-neutral-100">
                  <div className={`h-1 rounded ${l.kind === "unresolved" ? "bg-amber-400" : "bg-neutral-700"}`} style={{ width: `${share}%` }} />
                </div>
              </li>
            );
          })}
          <li className="row-total mt-1 flex items-baseline justify-between gap-3 px-1 py-1.5 text-sm">
            <span><TotalLabel note="полная себестоимость" /></span>
            <span className="whitespace-nowrap tabular-nums" data-cost-total>
              {formatMoney(total)}
            </span>
            <span className="w-14 text-right text-xs font-normal text-neutral-500">{formatPercent(100)}</span>
          </li>
          {/* Допуск: округление цены за шкуру у каждого лота (в режиме «без НДС» набегает до ~1/100 000 суммы), это не ошибка. */}
          <li className={Math.abs(sum - total) < Math.max(roundingHidden ? 10 : 1, Math.abs(total) * 1e-5) ? "sr-only" : "text-xs text-amber-700"}>
            Сумма частей {formatMoney(sum)} {Math.abs(sum - total) < Math.max(roundingHidden ? 10 : 1, Math.abs(total) * 1e-5) ? "= итогу" : "≠ итогу"}.
            {b.skippedUnallocated && " Расходы закупки не входят: выбрана часть лотов."}
          </li>
        </ul>
      )}
    </div>
  );
}

/** Блок разбивки внутри счёта (сворачиваемый). */
export function PurchaseCostParts({ purchaseId }: { purchaseId: string }) {
  return (
    <details className="rounded-md border border-neutral-200 bg-white">
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium hover:bg-neutral-50">Состав стоимости счёта</summary>
      <div className="p-2">
        <CostPartsBlock scope={purchaseId} title="Состав стоимости" />
      </div>
    </details>
  );
}
