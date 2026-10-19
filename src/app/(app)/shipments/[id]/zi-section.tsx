import { formatQty } from "@/lib/utils";
import { ZI_STATUS_LABEL, type ZiPriceDiff, type ZiStatus, type ZiSupply } from "@/lib/shipment-zi";

export type ZiRow = {
  id: string;
  label: string;
  article: string;
  color: string;
  size: string;
  quantity: number;
  inZi: number;
  status: ZiStatus;
  supplies: string[];
  /** Только для нашей стороны. */
  boutiques?: string[];
  sum?: number;
};

const money = (n: number) => n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const TONE: Record<ZiStatus, string> = { accepted: "bg-emerald-50 text-emerald-800", partial: "bg-sky-50 text-sky-800", rejected: "bg-red-50 text-red-800" };

/** «Приёмка в ЦУМ по накладным ЗИ»: что вошло в накладные бутиков (принято) и чего в них нет (не принято). Подрядчику — без бутиков и сумм. */
export function ZiSection({ rows, supplies, priceDiffs, unmatched, staff }: { rows: ZiRow[]; supplies: ZiSupply[]; priceDiffs: ZiPriceDiff[]; unmatched: number; staff: boolean }) {
  const plan = rows.reduce((t, r) => t + r.quantity, 0);
  const inZi = rows.reduce((t, r) => t + r.inZi, 0);
  const notIn = rows.reduce((t, r) => t + Math.max(0, r.quantity - r.inZi), 0);
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-neutral-200 bg-white p-4" aria-label="Приёмка в ЦУМ по накладным ЗИ" data-zi>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="block-title">Приёмка в ЦУМ по накладным ЗИ</h2>
        <p className="text-sm text-neutral-700" data-zi-total>В накладных (принято) <b className="tabular-nums">{formatQty(inZi)}</b> из <b className="tabular-nums">{formatQty(plan)}</b> шт.; нет в накладных (не принято) <b className="tabular-nums">{formatQty(notIn)}</b> шт.</p>
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-600">
        {supplies.map((s) => (
          <li key={s.code}><span className="font-medium text-neutral-800">Поставка {s.code}</span> · ЗИ {s.ziNumbers.join(", ")} · файл от {s.savedOn.split("-").reverse().join(".")}</li>
        ))}
      </ul>
      <div className="overflow-x-auto rounded-md border border-neutral-200">
        <table className="w-full min-w-[640px] text-xs">
          <thead className="bg-neutral-50 text-left text-neutral-500">
            <tr>
              <th className="px-2 py-1.5">ТЗ</th><th className="px-2 py-1.5">Артикул</th><th className="px-2 py-1.5">Цвет</th><th className="px-2 py-1.5">Размер</th>
              <th className="px-2 py-1.5 text-right">План, шт.</th><th className="px-2 py-1.5 text-right">В накладных, шт.</th><th className="px-2 py-1.5">Итог</th><th className="px-2 py-1.5">Поставка</th>
              {staff && <th className="px-2 py-1.5">Бутик</th>}
              {staff && <th className="px-2 py-1.5 text-right">Сумма без НДС, ₽</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {rows.map((r) => (
              <tr key={r.id} data-zi-row={r.status}>
                <td className="px-2 py-1.5 whitespace-nowrap">{r.label}</td><td className="px-2 py-1.5">{r.article}</td><td className="px-2 py-1.5">{r.color || "—"}</td><td className="px-2 py-1.5">{r.size || "—"}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{formatQty(r.quantity)}</td><td className="px-2 py-1.5 text-right tabular-nums">{formatQty(r.inZi)}</td>
                <td className="px-2 py-1.5"><span className={"rounded px-1.5 py-0.5 text-[11px] font-medium " + TONE[r.status]}>{ZI_STATUS_LABEL[r.status]}</span></td>
                <td className="px-2 py-1.5">{r.supplies.join(", ") || "—"}</td>
                {staff && <td className="px-2 py-1.5">{r.boutiques?.join(", ") || "—"}</td>}
                {staff && <td className="px-2 py-1.5 text-right tabular-nums">{r.sum ? money(r.sum) : "—"}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {unmatched > 0 && <p className="text-xs text-amber-800">В накладных есть {unmatched} шт., которых нет в составе отгрузки (артикул/размер не совпали) — проверьте состав.</p>}
      {staff && priceDiffs.length > 0 && (
        <div className="flex flex-col gap-1" data-zi-price-diffs>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Расхождения: заказ ЦУМ ↔ накладная поставщика (цена за единицу, с НДС)</h3>
          <div className="overflow-x-auto rounded-md border border-neutral-200">
            <table className="w-full min-w-[480px] text-xs">
              <thead className="bg-neutral-50 text-left text-neutral-500"><tr><th className="px-2 py-1.5">Артикул</th><th className="px-2 py-1.5 text-right">Заказ ЦУМ, ₽</th><th className="px-2 py-1.5 text-right">Накладная, ₽</th><th className="px-2 py-1.5 text-right">Разница, ₽</th></tr></thead>
              <tbody className="divide-y divide-neutral-100">
                {priceDiffs.map((d) => (
                  <tr key={d.article}><td className="px-2 py-1.5">{d.article}</td><td className="px-2 py-1.5 text-right tabular-nums">{money(d.orderPrice)}</td><td className="px-2 py-1.5 text-right tabular-nums">{money(d.invoicePrice)}</td><td className={"px-2 py-1.5 text-right tabular-nums " + (d.diff < 0 ? "text-red-700" : "text-neutral-700")}>{money(d.diff)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-neutral-500">Разница = заказ ЦУМ − накладная; минус значит, что в накладной цена выше заказа. Причина по документам не названа.</p>
        </div>
      )}
    </section>
  );
}
