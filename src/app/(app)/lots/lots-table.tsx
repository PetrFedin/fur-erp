"use client";

// Таблицы лотов режима «Аукцион»: выбор лотов, фильтры, строка «Итого» со смыслом по каждой колонке,
// свои столбцы и блок «Из чего складывается стоимость». Всё считается в браузере по тем же формулам,
// что и серверный итог (без фильтров цифры совпадают).
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { Money } from "@/components/money";
import { formatCurrency, formatMoney, formatQty } from "@/lib/utils";
import { useVatDisplay } from "@/lib/vat-display";
import { formatAvg, formatExtra, type CustomFieldDef } from "@/lib/custom-fields";
import { emptyFilters, sortRows, type LotRow, type Sort } from "@/lib/lot-table";
import { CostBreakdownToggle } from "./cost-breakdown-toggle";
import { CostPlanItemEditor } from "../purchases/[id]/cost-plan-editor";
import type { CostPlanEditorItem } from "../purchases/[id]/cost-plan-editor";
import { AddFieldButton, CustomCell, CustomFieldHeader } from "./custom-field-controls";
import { FilterPanel } from "./lots-filters";
import { ALL_SCOPE, useLots, useScope, type ScopeView } from "./lots-state";

const rateFmt = (n: number) => n.toLocaleString("ru-RU", { maximumFractionDigits: 4 });
const symbol = (c: string) => (c === "USD" ? "$" : c);

const TIP = {
  sum: "Σ — сумма по строкам итога",
  avg: "ср. взвеш. — взвешено по количеству шкур: Σ(значение × кол-во) ÷ Σ кол-во",
  uniq: "уник. — сколько разных значений в колонке (пустые не считаются)",
  rate: "ср. взвеш. курс — взвешено по сумме закупки в валюте (цена × кол-во). «мин–макс» — разброс курса по лотам. Курс и цена в валюте от режима НДС не зависят.",
  unit: "ср. взвеш. себестоимость шкуры — взвешено по количеству шкур: «Себестоимость всего» ÷ Σ шкур, в выбранном режиме С НДС / Без НДС",
  price: "ср. взвеш. цена лота — взвешено по количеству шкур: Σ(цена × кол-во) ÷ Σ шкур. Цена в валюте от НДС не зависит; в ₽ — по курсу лота, в выбранном режиме НДС.",
};

function Stat({ k, tip, children }: { k: string; tip: string; children: ReactNode }) {
  return (
    <div className="whitespace-nowrap">
      <abbr title={tip} className="mr-1 cursor-help text-[10px] font-semibold uppercase text-neutral-400 no-underline">
        {k}
      </abbr>
      <span className="font-medium">{children}</span>
    </div>
  );
}
const Note = ({ children }: { children: ReactNode }) => <div className="text-[10px] font-normal text-neutral-400">{children}</div>;

/** Колонки, которые видны в заголовке/итогах (без чекбокса и кнопки правки). */
const heads = (currency: string) => [
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

function TotalsFooter({
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
    <tfoot className="border-t-2 border-neutral-300 bg-neutral-50 align-top text-sm">
      <tr data-totals-row>
        {hasCheckCol && <Td />}
        <Td className="min-w-40">
          <div className="font-semibold">Итого</div>
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
            {empty ? "0" : formatQty(q)}
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
              <Stat k="ср. взвеш. ₽" tip={TIP.price}>
                <Money incl={q > 0 ? t.priceIncl / q : 0} excl={q > 0 ? t.priceExcl / q : 0} />
              </Stat>
              <Note>цена в валюте — не зависит от НДС</Note>
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
                <div className="whitespace-nowrap text-xs text-neutral-500" title={TIP.rate}>
                  мин–макс {rateFmt(t.rateMin)}–{rateFmt(t.rateMax)}
                </div>
              )}
              <Note>не зависит от НДС</Note>
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
                {formatQty(t.remaining)}
              </Stat>
              <Note>на складе {t.onStock} лот.</Note>
            </>
          ) : (
            !empty && <Note>ещё не на складе</Note>
          )}
        </Td>
        <Td className="whitespace-nowrap">{t.used > 0 ? <Stat k="Σ" tip={TIP.sum}>{formatQty(t.used)}</Stat> : null}</Td>
        {fields.map((f) => {
          const c = t.custom[f.id];
          return (
            <Td key={f.id} className="whitespace-nowrap">
              {!c || c.n === 0 ? null : f.type === "NUMBER" ? (
                <>
                  <Stat k="Σ" tip={TIP.sum}>{formatExtra("NUMBER", c.sum)}</Stat>
                  <Stat k="ср. взвеш." tip={TIP.avg}>{c.wavg != null ? formatAvg(c.wavg) : "—"}</Stat>
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
          <tr className="font-semibold">
            <Td colSpan={lead} className="text-right">
              Всего с расходами закупки
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
function MobileSummary({ view }: { view: ScopeView }) {
  const t = view.totals;
  const single = t.currencies.length === 1;
  return (
    <p className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm md:hidden" data-totals-summary>
      <span className="font-semibold">Итого:</span>{" "}
      {t.count === 0 ? (
        <span>Σ 0</span>
      ) : (
        <>
          {formatQty(t.qty)} шкур · Σ <Money incl={t.totalIncl} excl={t.totalExcl} className="font-medium" /> ·{" "}
          {t.rateAvg == null ? "ср. взвеш. курс —" : single ? `ср. взвеш. курс ${rateFmt(t.rateAvg)}` : "ср. взвеш. курс: разные валюты"}
        </>
      )}
      <span className="block text-xs text-neutral-500">{view.label}</span>
    </p>
  );
}

/** Панель над таблицей: «Фильтр», выбор лотов, «Только выбранные», «Сбросить», «+ Столбец». */
function LotsControls({ scope }: { scope: string }) {
  const { setFilters, setSelected, canEdit } = useLots();
  const view = useScope(scope);
  const [open, setOpen] = useState(false);
  const f = view.filters;
  const selectedAll = view.selectedAll;
  const allVisibleSelected = view.visible.length > 0 && view.selectedVisible.length === view.visible.length;
  return (
    <div className="flex flex-col gap-2">
      <MobileSummary view={view} />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          data-filter-toggle
          className="inline-flex h-8 items-center gap-1 rounded-md border border-neutral-300 bg-white px-3 text-xs font-medium hover:bg-neutral-50"
        >
          Фильтр{view.filterCount > 0 ? ` (${view.filterCount})` : ""} <span className="text-neutral-400">{open ? "▴" : "▾"}</span>
        </button>
        <button
          type="button"
          className="inline-flex h-8 items-center rounded-md border border-neutral-300 bg-white px-3 text-xs hover:bg-neutral-50"
          onClick={() => setSelected(view.visible.map((r) => r.id), !allVisibleSelected)}
        >
          {allVisibleSelected ? "Снять выбор" : "Выбрать все"}
        </button>
        <label className="inline-flex h-8 cursor-pointer items-center gap-2 text-xs">
          <input type="checkbox" className="h-5 w-5 sm:h-4 sm:w-4" checked={f.onlySelected} onChange={(e) => setFilters(scope, { ...f, onlySelected: e.target.checked })} />
          Только выбранные
        </label>
        {view.filterCount > 0 && (
          <button type="button" className="inline-flex h-8 items-center text-xs text-blue-600 hover:underline" onClick={() => setFilters(scope, emptyFilters())}>
            Сбросить
          </button>
        )}
        {selectedAll > 0 && (
          <button type="button" className="inline-flex h-8 items-center text-xs text-blue-600 hover:underline" onClick={() => setSelected(view.all.map((r) => r.id), false)}>
            Снять выбор ({selectedAll})
          </button>
        )}
        {canEdit && <AddFieldButton label="Столбец" />}
        <span className="text-xs text-neutral-500" data-selection-label>
          {view.label}
        </span>
      </div>
      {view.hiddenSelected > 0 && (
        <p className="flex flex-wrap items-center gap-x-2 text-xs text-amber-700" data-hidden-selection>
          <span>
            Выбрано {selectedAll} (из них скрыто фильтром {view.hiddenSelected})
          </span>
          <button type="button" className="inline-flex h-8 items-center text-blue-600 hover:underline" onClick={() => setSelected(view.all.map((r) => r.id), false)}>
            Снять выбор
          </button>
        </p>
      )}
      {scope !== ALL_SCOPE && view.globalFilterCount > 0 && (
        <p className="text-xs text-amber-700">Действует общий фильтр аукциона ({view.globalFilterCount}) — часть лотов скрыта.</p>
      )}
      {open && <FilterPanel scope={scope} />}
    </div>
  );
}

function Legend() {
  return (
    <p className="text-xs text-neutral-500">
      «Итого» считается по выбранным лотам, а если выбора нет — по лотам, оставшимся после фильтров. <b>Σ</b> — сумма, <b>ср. взвеш.</b> — среднее
      взвешенное по количеству шкур (курс — по сумме закупки в валюте; никогда не простое среднее), <b>уник.</b> — число разных значений. Цена в валюте и курс от режима
      «С НДС / Без НДС» не зависят.
    </p>
  );
}

/** Таблица лотов одного счёта. */
export function PurchaseLotsTable({ purchaseId, currency, hasEditCol }: { purchaseId: string; currency: string; hasEditCol: boolean }) {
  const { fields, selected, setSelected, canEdit } = useLots();
  const view = useScope(purchaseId);
  const rows = view.visible;
  const allSel = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const someSel = rows.some((r) => selected.has(r.id));
  const headRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (headRef.current) headRef.current.indeterminate = someSel && !allSel;
  }, [someSel, allSel]);
  const h = heads(symbol(currency));
  return (
    <div className="flex flex-col gap-2">
      <LotsControls scope={purchaseId} />
      <Table>
        <Thead>
          <Tr>
            <Th className="w-10 sm:w-8">
              <label className="flex h-8 w-8 cursor-pointer items-center justify-center sm:h-auto sm:w-auto">
              <input
                ref={headRef}
                className="h-5 w-5 sm:h-4 sm:w-4"
                type="checkbox"
                aria-label="Выбрать все лоты счёта"
                checked={allSel}
                onChange={() => setSelected(rows.map((r) => r.id), !allSel)}
              />
              </label>
            </Th>
            {h.map((x) => (
              <Th key={x}>{x}</Th>
            ))}
            {fields.map((f, i) => (
              <Th key={f.id}>
                <CustomFieldHeader field={f} index={i} count={fields.length} />
              </Th>
            ))}
            {hasEditCol && <Th></Th>}
            <Th className="w-8">{canEdit && <AddFieldButton />}</Th>
          </Tr>
        </Thead>
        <Tbody>
          {rows.map((r) => (
            <LotRowView key={r.id} row={r} fields={fields} hasEditCol={hasEditCol} currency={currency} />
          ))}
          {rows.length === 0 && (
            <Tr>
              <Td colSpan={h.length + fields.length + 3} className="py-4 text-center text-neutral-400">
                {view.all.length === 0 ? "В закупке нет позиций" : "Нет лотов, подходящих под фильтр"}
              </Td>
            </Tr>
          )}
        </Tbody>
        <TotalsFooter view={view} fields={fields} hasEditCol={hasEditCol} hasCheckCol />
      </Table>
    </div>
  );
}

function LotRowView({
  row: r,
  fields,
  hasEditCol,
  currency,
  invoice,
}: {
  row: LotRow;
  fields: CustomFieldDef[];
  hasEditCol: boolean;
  currency: string;
  /** Плоский список: колонка «Счёт» со ссылкой на закупку */
  invoice?: { label: string; number: string };
}) {
  const { selected, setSelected } = useLots();
  const checked = selected.has(r.id);
  return (
    <Tr className={checked ? "bg-blue-50/60" : undefined} data-lot-row={r.id}>
      <Td className="w-10 sm:w-8">
        <label className="flex h-8 w-8 cursor-pointer items-center justify-center sm:h-auto sm:w-auto">
          <input type="checkbox" className="h-5 w-5 sm:h-4 sm:w-4" aria-label={`Выбрать лот ${r.lotNumber || r.material}`} checked={checked} onChange={() => setSelected([r.id], !checked)} />
        </label>
      </Td>
      <Td className="font-medium">{r.material}</Td>
      {invoice && (
        <Td className="whitespace-nowrap">
          <Link href={`/purchases/${r.purchaseId}`} className="text-blue-600 hover:underline" title={`Закупка ${invoice.number}`}>
            {invoice.label}
          </Link>
        </Td>
      )}
      <Td className="whitespace-nowrap">{r.lotNumber || "—"}</Td>
      <Td>{r.size || "—"}</Td>
      <Td className="min-w-32 text-xs text-neutral-600">{r.op || "—"}</Td>
      <Td className="whitespace-nowrap">
        {formatQty(r.qty)} {r.unit}
      </Td>
      <Td className="whitespace-nowrap">{formatCurrency(r.price, currency)}</Td>
      <Td className="whitespace-nowrap">{rateFmt(r.rate)}</Td>
      <Td className="whitespace-nowrap">
        <Money incl={r.unitIncl} excl={r.unitExcl} />
        {r.source === "price" && <div className="text-xs text-neutral-400">по цене лота, без расчёта</div>}
        {r.breakdown ? <CostBreakdownToggle breakdown={r.breakdown as never} unitCostExcl={String(r.unitExcl)} unitCostIncl={String(r.unitIncl)} /> : null}
      </Td>
      <Td className="whitespace-nowrap font-medium">
        <Money incl={r.totalIncl} excl={r.totalExcl} />
      </Td>
      <Td className="whitespace-nowrap">
        {r.onStock ? (
          r.remaining === 0 ? (
            <Badge>Израсходован</Badge>
          ) : (
            <>
              {formatQty(r.remaining)} {r.unit}
            </>
          )
        ) : (
          <span className="text-xs text-neutral-400">ещё не на складе</span>
        )}
      </Td>
      <Td>
        {r.usages.length === 0
          ? "—"
          : r.usages.map((u) => (
              <div key={u.id} className="whitespace-nowrap">
                <Link href={`/production/${u.orderId}`} className="hover:underline">
                  ТЗ {u.number}
                </Link>
                {" — "}
                {formatQty(u.qty)} {r.unit}
              </div>
            ))}
      </Td>
      {fields.map((f) => (
        <Td key={f.id}>
          <CustomCell row={r} field={f} />
        </Td>
      ))}
      {hasEditCol && (
        <Td className="whitespace-nowrap">
          {r.editor ? <CostPlanItemEditor purchaseId={r.purchaseId} currencySymbol={symbol(currency)} item={r.editor as CostPlanEditorItem} /> : null}
        </Td>
      )}
      <Td />
    </Tr>
  );
}

const pct = (v: number, total: number) => {
  if (Math.abs(total) < 0.005) return "—";
  const p = Math.round((v / total) * 1000) / 10;
  return `${(p === 0 ? 0 : p).toLocaleString("ru-RU", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
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
    <div className="rounded-md border border-neutral-200 bg-white p-3" data-cost-parts>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3">
        <p className="text-sm font-semibold">{title ?? "Из чего складывается стоимость"}</p>
        <p className="text-xs text-neutral-500">
          {view.label} · {mode === "excl" ? "без НДС" : "с НДС"}
        </p>
      </div>
      {view.basis.length === 0 ? (
        <p className="text-sm text-neutral-400">Нет лотов для расчёта</p>
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
                    {l.hint && (l.kind !== "unresolved" || isNotable(v)) && <span className="block text-xs text-neutral-400">{l.hint}</span>}
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
          <li className="mt-1 flex items-baseline justify-between gap-3 border-t border-neutral-200 pt-1.5 text-sm font-semibold">
            <span>Итого — полная себестоимость</span>
            <span className="whitespace-nowrap tabular-nums" data-cost-total>
              {formatMoney(total)}
            </span>
            <span className="w-14 text-right text-xs font-normal text-neutral-500">100 %</span>
          </li>
          <li className="text-xs text-neutral-400">
            Сумма частей {formatMoney(sum)} {Math.abs(sum - total) < (roundingHidden ? 10 : 1) ? "= итогу" : "≠ итогу"}.
            {b.skippedUnallocated && " Расходы закупки не входят: выбрана только часть лотов закупки."}
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
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium hover:bg-neutral-50">Из чего складывается стоимость счёта</summary>
      <div className="p-2">
        <CostPartsBlock scope={purchaseId} title="Из чего складывается стоимость" />
      </div>
    </details>
  );
}

/** Итог аукциона: общие фильтры/выбор, строка «Итого» и разбивка стоимости. */
export function AuctionTotalsPanel() {
  const { fields } = useLots();
  const view = useScope(ALL_SCOPE);
  const cur = view.totals.currencies.length === 1 ? symbol(view.totals.currencies[0]) : "вал.";
  const h = heads(cur);
  return (
    <section className="flex flex-col gap-3 rounded-md border border-neutral-300 bg-white p-3" data-auction-totals>
      <div>
        <h3 className="text-base font-semibold">Итого по аукциону</h3>
        <Legend />
      </div>
      <LotsControls scope={ALL_SCOPE} />
      <Table>
        <Thead>
          <Tr>
            <Th className="w-8"></Th>
            {h.map((x) => (
              <Th key={x}>{x}</Th>
            ))}
            {fields.map((f) => (
              <Fragment key={f.id}>
                <Th>{f.name}</Th>
              </Fragment>
            ))}
            <Th className="w-8"></Th>
          </Tr>
        </Thead>
        <TotalsFooter view={view} fields={fields} hasEditCol={false} hasCheckCol />
      </Table>
      <CostPartsBlock scope={ALL_SCOPE} title="Из чего складывается стоимость аукциона" />
    </section>
  );
}

const FLAT_COLS: { key: string; label: (cur: string) => string }[] = [
  { key: "material", label: () => "Материал" },
  { key: "invoice", label: () => "Счёт" },
  { key: "lotNumber", label: () => "№ лота" },
  { key: "size", label: () => "Сорт / размер" },
  { key: "op", label: () => "Операция" },
  { key: "qty", label: () => "Кол-во" },
  { key: "price", label: (c) => `Цена за шк., ${c}` },
  { key: "rate", label: () => "Курс" },
  { key: "unit", label: () => "Себестоимость ед." },
  { key: "total", label: () => "Себестоимость всего" },
  { key: "remaining", label: () => "Остаток на складе" },
  { key: "used", label: () => "Использован в ТЗ" },
];

function SortButton({ k, sort, onSort, label, children }: { k: string; sort: Sort | null; onSort: (k: string) => void; label: string; children?: ReactNode }) {
  const active = sort?.key === k;
  return (
    <button
      type="button"
      onClick={() => onSort(k)}
      data-sort={k}
      aria-label={`Сортировать по колонке «${label}»`}
      className={"inline-flex items-center gap-1 whitespace-nowrap uppercase tracking-wide hover:text-neutral-900 " + (active ? "text-neutral-900" : "")}
    >
      {children}
      <span className={active ? "text-neutral-900" : "text-neutral-300"}>{active ? (sort.dir === "asc" ? "↑" : "↓") : "↕"}</span>
    </button>
  );
}

/** Вид «Списком лотов»: одна плоская таблица всех лотов аукциона с колонкой «Счёт», сортировкой, фильтрами, выбором и «Итого». */
export function FlatLotsPanel() {
  const { fields, purchases, selected, setSelected, extraOf, canEdit } = useLots();
  const { mode } = useVatDisplay();
  const view = useScope(ALL_SCOPE);
  const [sort, setSort] = useState<Sort | null>(null);
  const label = (id: string) => purchases.get(id)?.label ?? "";
  const rows = useMemo(() => sortRows(view.visible, sort, mode, extraOf, label), [view.visible, sort, mode, extraOf, purchases]); // eslint-disable-line react-hooks/exhaustive-deps
  const onSort = (k: string) => setSort((p) => (p?.key === k ? { key: k, dir: p.dir === "asc" ? "desc" : "asc" } : { key: k, dir: "asc" }));
  const allSel = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const someSel = rows.some((r) => selected.has(r.id));
  const headRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (headRef.current) headRef.current.indeterminate = someSel && !allSel;
  }, [someSel, allSel]);
  const cur = view.totals.currencies.length === 1 ? symbol(view.totals.currencies[0]) : "вал.";
  return (
    <section className="flex flex-col gap-3 rounded-md border border-neutral-300 bg-white p-3" data-auction-flat>
      <div>
        <h3 className="text-base font-semibold">Все лоты аукциона списком</h3>
        <Legend />
      </div>
      <LotsControls scope={ALL_SCOPE} />
      <Table>
        <Thead>
          <Tr>
            <Th className="w-10 sm:w-8">
              <label className="flex h-8 w-8 cursor-pointer items-center justify-center sm:h-auto sm:w-auto">
                <input
                  ref={headRef}
                  className="h-5 w-5 sm:h-4 sm:w-4"
                  type="checkbox"
                  aria-label="Выбрать все показанные лоты"
                  checked={allSel}
                  onChange={() => setSelected(rows.map((r) => r.id), !allSel)}
                />
              </label>
            </Th>
            {FLAT_COLS.map((c) => (
              <Th key={c.key}>
                <SortButton k={c.key} sort={sort} onSort={onSort} label={c.label(cur)}>
                  {c.label(cur)}
                </SortButton>
              </Th>
            ))}
            {fields.map((f, i) => (
              <Th key={f.id}>
                <div className="flex items-center gap-1">
                  {canEdit ? <CustomFieldHeader field={f} index={i} count={fields.length} /> : <span>{f.name}</span>}
                  <SortButton k={f.id} sort={sort} onSort={onSort} label={f.name} />
                </div>
              </Th>
            ))}
            <Th className="w-8">{canEdit && <AddFieldButton />}</Th>
          </Tr>
        </Thead>
        <Tbody>
          {rows.map((r) => {
            const m = purchases.get(r.purchaseId);
            return <LotRowView key={r.id} row={r} fields={fields} hasEditCol={false} currency={r.currency} invoice={{ label: m?.label ?? "—", number: m?.number ?? "" }} />;
          })}
          {rows.length === 0 && (
            <Tr>
              <Td colSpan={FLAT_COLS.length + fields.length + 2} className="py-4 text-center text-neutral-400">
                {view.all.length === 0 ? "У аукциона нет лотов" : "Нет лотов, подходящих под фильтр"}
              </Td>
            </Tr>
          )}
        </Tbody>
        <TotalsFooter view={view} fields={fields} hasEditCol={false} hasCheckCol invoiceCol />
      </Table>
      <CostPartsBlock scope={ALL_SCOPE} title="Из чего складывается стоимость" />
    </section>
  );
}
