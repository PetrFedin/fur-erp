import type { SupplierDebt } from "@/lib/supplier-debt";
import { InfoHint } from "@/components/info-hint";
import { formatMoney } from "@/lib/utils";
import { yearLabel, type YearFilter } from "@/lib/year-filter";

const m = (v: { toString(): string }) => formatMoney(v.toString());

/** Значок «i» у долга поставщику: из чего он складывается, три части, таблица по аукционам, правила года и 4%. Цифры — из loadSupplierDebt. */
export function SupplierDebtHint({ debt, year = "all", align = "left" }: { debt: SupplierDebt; year?: YearFilter; align?: "left" | "right" }) {
  const rows = debt.byAuction.slice(0, 14);
  const rest = debt.byAuction.length - rows.length;
  return (
    <InfoHint wide align={align} label="Из чего складывается долг поставщику">
      <p>
        <b>Долг поставщику (Веллмех), с НДС.</b> Стоимость закупок без отменённых <b>{m(debt.total)}</b> − оплачено <b>{m(debt.paid)}</b> − авансы без привязки{" "}
        <b>{m(debt.unlinkedAdvances)}</b> = <b>{m(debt.debt)}</b>. Переплата одного аукциона не гасит долг другого.
      </p>
      <table className="mt-2 w-full border-collapse text-xs">
        <tbody>
          <tr className="border-t border-neutral-200">
            <td className="py-1 pr-2">
              <b>К оплате по УПД и счетам</b>
              <div className="text-neutral-500">мех получен, УПД есть; из этой части вычтены авансы без привязки ({m(debt.unlinkedAdvances)})</div>
            </td>
            <td className="whitespace-nowrap py-1 text-right font-semibold">{m(debt.receivedNet)}</td>
          </tr>
          <tr className="border-t border-neutral-200">
            <td className="py-1 pr-2">
              <b>Счёт выставлен, не оплачен</b>
              <div className="text-neutral-500">мех ещё не получен (черновик закупки), но Веллмех уже выставил счёт</div>
            </td>
            <td className="whitespace-nowrap py-1 text-right font-semibold">{m(debt.invoiced)}</td>
          </tr>
          <tr className="border-t border-neutral-200">
            <td className="py-1 pr-2">
              <b>Ожидаемые закупки</b>
              <div className="text-neutral-500">не получены, счёта на эту часть ещё нет</div>
            </td>
            <td className="whitespace-nowrap py-1 text-right font-semibold">{m(debt.expected)}</td>
          </tr>
          <tr className="border-t border-neutral-300">
            <td className="py-1 pr-2 font-semibold">Итого долг</td>
            <td className="whitespace-nowrap py-1 text-right font-semibold">{m(debt.debt)}</td>
          </tr>
        </tbody>
      </table>
      {rows.length > 0 && (
        <>
          <p className="mt-2 font-medium">По аукционам (остаток)</p>
          <table className="mt-1 w-full border-collapse text-xs">
            <thead>
              <tr className="text-left text-neutral-500">
                <th className="py-0.5 pr-2 font-normal">Аукцион</th>
                <th className="py-0.5 pr-2 text-right font-normal">Остаток</th>
                <th className="py-0.5 pr-2 text-right font-normal">получен</th>
                <th className="py-0.5 pr-2 text-right font-normal">счёт</th>
                <th className="py-0.5 text-right font-normal">ожид.</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.name} className="border-t border-neutral-100" title={a.invoiceDocs ?? undefined}>
                  <td className="py-0.5 pr-2">{a.name}</td>
                  <td className="whitespace-nowrap py-0.5 pr-2 text-right">{m(a.due)}</td>
                  <td className="whitespace-nowrap py-0.5 pr-2 text-right">{a.dueReceived.greaterThan(0.5) ? m(a.dueReceived) : "—"}</td>
                  <td className="whitespace-nowrap py-0.5 pr-2 text-right">{a.dueInvoiced.greaterThan(0.5) ? m(a.dueInvoiced) : "—"}</td>
                  <td className="whitespace-nowrap py-0.5 text-right">{a.dueExpected.greaterThan(0.5) ? m(a.dueExpected) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rest > 0 && <p className="mt-1 text-neutral-500">Ещё аукционов с остатком: {rest}.</p>}
          {rows.some((a) => a.invoiceDocs) && (
            <p className="mt-1 text-neutral-500">
              Счета: {rows.filter((a) => a.invoiceDocs).map((a) => `${a.name} — ${a.invoiceDocs}`).join("; ")}.
            </p>
          )}
        </>
      )}
      <p className="mt-2 text-neutral-500">
        Период: {yearLabel(year)}.
        {year !== "all" && " Берутся закупки года (по дате заказа), оплаты, привязанные к ним и их аукционам, и авансы без привязки с датой оплаты в этом году."}{" "}
        Переключатель «С 4%» долг и оплаты поставщику не меняет: 4% — надбавка на сырьё в себестоимости ТЗ, поставщику её не платим.
      </p>
    </InfoHint>
  );
}
