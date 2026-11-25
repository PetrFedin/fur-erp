"use client";
import { type ReactNode } from "react";
import { Td } from "@/components/ui/table";
import { Money } from "@/components/money";
import { formatCurrency, formatQtyTrim } from "@/lib/utils";
import { formatAvg, formatExtra, type CustomFieldDef } from "@/lib/custom-fields";
import { type ScopeView } from "../lots-state";
import { TotalLabel } from "@/components/total-label";
import { Note, rateFmt, Stat, TIP } from "./shared";

export function TotalsFooter({
  view,
  fields,
  hasEditCol,
  hasCheckCol,
  invoiceCol = false,
}: {
  view: ScopeView;
  fields: CustomFieldDef[];
  hasEditCol: boolean;
  hasCheckCol: boolean;
  invoiceCol?: boolean;
}) {
  const t = view.totals;
  const b = view.breakdown;
  const single = t.currencies.length === 1 ? t.currencies[0] : null;
  const q = t.qty;
  const empty = t.count === 0;
  const withExp = b.unallocatedIncl !== 0 || b.unallocatedExcl !== 0;
  const tail = fields.length + (hasEditCol ? 1 : 0) + 1; // свои столбцы + правка + «+»
  const lead = (hasCheckCol ? 1 : 0) + (invoiceCol ? 1 : 0) + 8;
  return (
    <tfoot className="align-top text-[13px] [&_td]:px-2">
      <tr data-totals-row className="row-total">
        {hasCheckCol && <Td />}
        <Td className="min-w-40">
          <div><TotalLabel /></div>
          <div className="text-xs font-normal text-neutral-500" data-totals-label>
            {view.label}
          </div>
        </Td>
        {invoiceCol && <Td />}
        <Td>{!empty && <Stat k="уник." tip={TIP.uniq}>{t.uniq.lotNumber}</Stat>}</Td>
        <Td>{!empty && <Stat k="уник." tip={TIP.uniq}>{t.uniq.size}</Stat>}</Td>
        <Td>{!empty && <Stat k="уник." tip={TIP.uniq}>{t.uniq.op}</Stat>}</Td>
        <Td className="whitespace-nowrap">
          <Stat k="Σ" tip={TIP.sum}>
            {empty ? "0" : formatQtyTrim(q)}
          </Stat>
        </Td>
        <Td>
          {!empty && t.avgPrice != null && (
            <>
              {single ? (
                <Stat k="ср. взвеш." tip={TIP.price}>
                  {formatCurrency(t.avgPrice, single)}
                </Stat>
              ) : (
                <Note>разные валюты</Note>
              )}
              <Stat k="ср. взвеш., в рублях" tip={TIP.price}>
                <Money incl={q > 0 ? t.priceIncl / q : 0} excl={q > 0 ? t.priceExcl / q : 0} />
              </Stat>
            </>
          )}
        </Td>
        <Td>
          {!empty && t.rateAvg != null && !single && <Note>разные валюты</Note>}
          {!empty && t.rateAvg != null && single && (
            <>
              <Stat k="ср. взвеш." tip={TIP.rate}>
                {rateFmt(t.rateAvg)}
              </Stat>
              {t.rateMin != null && t.rateMax != null && t.rateMin !== t.rateMax && (
                <div className="whitespace-nowrap text-[11px] text-neutral-500" title={TIP.rate}>
                  мин–макс {rateFmt(t.rateMin)}–{rateFmt(t.rateMax)}
                </div>
              )}
            </>
          )}
        </Td>
        <Td>
          {!empty && q > 0 && (
            <Stat k="ср. взвеш." tip={TIP.unit}>
              <Money incl={t.totalIncl / q} excl={t.totalExcl / q} />
            </Stat>
          )}
        </Td>
        <Td className="whitespace-nowrap">
          {empty ? (
            <Stat k="Σ" tip={TIP.sum}>
              0
            </Stat>
          ) : (
            <Stat k="Σ" tip={TIP.sum}>
              <Money incl={t.totalIncl} excl={t.totalExcl} />
            </Stat>
          )}
        </Td>
        <Td className="whitespace-nowrap">
          {t.onStock > 0 ? (
            <>
              <Stat k="Σ" tip={TIP.sum}>
                {formatQtyTrim(t.remaining)}
              </Stat>
              <Note>на складе {t.onStock} лот.</Note>
            </>
          ) : (
            !empty && <Note>ещё не на складе</Note>
          )}
        </Td>
        <Td className="whitespace-nowrap">{t.used > 0 ? <Stat k="Σ" tip={TIP.sum}>{formatQtyTrim(t.used)}</Stat> : null}</Td>
        {fields.map((f) => {
          const c = t.custom[f.id];
          return (
            <Td key={f.id} className="whitespace-nowrap">
              {!c || c.n === 0 ? null : f.type === "NUMBER" ? (
                <>
                  <Stat k="Σ" tip={TIP.sum}>{formatExtra("NUMBER", c.sum)}</Stat>
                  <Stat k="ср. взвеш." tip={TIP.avg}>{c.wavg != null ? formatAvg(c.wavg) : "–"}</Stat>
                  <Note>заполнено у {c.n} из {t.count}</Note>
                </>
              ) : f.type === "BOOLEAN" ? (
                <>
                  <Stat k="лотов" tip="Сколько лотов с ответом «Да» и сколько с «Нет» (пустые не считаются)">
                    Да {c.yes} / Нет {c.no}
                  </Stat>
                  <Note>заполнено у {c.n} из {t.count}</Note>
                </>
              ) : (
                <Stat k="уник." tip={TIP.uniq}>{c.uniq}</Stat>
              )}
            </Td>
          );
        })}
        {hasEditCol && <Td />}
        <Td />
      </tr>
      {withExp && (
        <>
          <tr>
            <Td colSpan={lead} className="text-right text-xs text-neutral-600">
              Расходы закупки (не распределены по лотам)
            </Td>
            <Td className="whitespace-nowrap text-xs">
              <Money incl={b.unallocatedIncl} excl={b.unallocatedExcl} />
            </Td>
            <Td colSpan={tail + 2} />
          </tr>
          <tr className="row-total">
            <Td colSpan={lead} className="text-right">
              <TotalLabel note="с расходами закупки" />
            </Td>
            <Td className="whitespace-nowrap">
              <Money incl={b.totalIncl} excl={b.totalExcl} />
            </Td>
            <Td colSpan={tail + 2} />
          </tr>
        </>
      )}
    </tfoot>
  );
}

/** Компактная сводка «Итого» для телефона: строка итога в таблице уходит за правый край. */
export function MobileSummary({ view }: { view: ScopeView }) {
  const t = view.totals;
  const single = t.currencies.length === 1;
  return (
    <p className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm md:hidden" data-totals-summary>
      <span className="font-semibold">Всего, ₽:</span>{" "}
      {t.count === 0 ? (
        <span>Σ 0</span>
      ) : (
        <>
          {formatQtyTrim(t.qty)} шкур · Σ <Money incl={t.totalIncl} excl={t.totalExcl} className="font-medium" /> ·{" "}
          {t.rateAvg == null ? "ср. взвеш. курс —" : single ? `ср. взвеш. курс ${rateFmt(t.rateAvg)}` : "ср. взвеш. курс: разные валюты"}
        </>
      )}
      <span className="block text-xs text-neutral-500">{view.label}</span>
    </p>
  );
}

/** Итог аукциона для телефона: список «подпись: значение» вместо таблицы шириной в тысячу пикселей. */
export function TotalsList({ view, fields }: { view: ScopeView; fields: CustomFieldDef[] }) {
  const t = view.totals;
  const b = view.breakdown;
  const single = t.currencies.length === 1 ? t.currencies[0] : null;
  const q = t.qty;
  const empty = t.count === 0;
  const withExp = b.unallocatedIncl !== 0 || b.unallocatedExcl !== 0;
  const items: { label: string; value: ReactNode }[] = [
    { label: "Лотов", value: t.count },
    { label: "Кол-во шкур", value: empty ? "0" : formatQtyTrim(q) },
  ];
  if (!empty && t.avgPrice != null && single) items.push({ label: "Цена за шк., ср. взвеш.", value: formatCurrency(t.avgPrice, single) });
  if (!empty && t.rateAvg != null && single) items.push({ label: "Курс, ср. взвеш.", value: rateFmt(t.rateAvg) });
  if (!empty && q > 0) items.push({ label: "Себестоимость ед., ср. взвеш.", value: <Money incl={t.totalIncl / q} excl={t.totalExcl / q} /> });
  items.push({ label: "Себестоимость всего", value: empty ? "0" : <Money incl={t.totalIncl} excl={t.totalExcl} /> });
  items.push({ label: "Остаток на складе", value: t.onStock > 0 ? `${formatQtyTrim(t.remaining)} (на складе ${t.onStock} лот.)` : empty ? "–" : "ещё не на складе" });
  if (t.used > 0) items.push({ label: "Использовано в ТЗ", value: formatQtyTrim(t.used) });
  for (const f of fields) {
    const c = t.custom[f.id];
    if (!c || c.n === 0) continue;
    items.push({
      label: f.name,
      value: f.type === "NUMBER" ? `Σ ${formatExtra("NUMBER", c.sum)}` : f.type === "BOOLEAN" ? `Да ${c.yes} / Нет ${c.no}` : `уник. ${c.uniq}`,
    });
  }
  if (withExp) {
    items.push({ label: "Расходы закупки (не распределены)", value: <Money incl={b.unallocatedIncl} excl={b.unallocatedExcl} /> });
    items.push({ label: "Всего, ₽ с расходами закупки", value: <Money incl={b.totalIncl} excl={b.totalExcl} /> });
  }
  return (
    <ul className="flex flex-col divide-y divide-neutral-100 rounded-lg border border-neutral-200 bg-neutral-50 px-3 text-sm md:hidden" data-totals-list>
      {items.map((it) => (
        <li key={it.label} className="flex items-baseline justify-between gap-3 py-1.5">
          <span className="text-neutral-500">{it.label}:</span>
          <span className="text-right font-medium tabular-nums">{it.value}</span>
        </li>
      ))}
    </ul>
  );
}
