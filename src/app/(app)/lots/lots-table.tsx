"use client";

// Таблицы лотов режима «Аукцион»: выбор лотов, фильтры, строка «Итого» со смыслом по каждой колонке,
// свои столбцы и блок «Из чего складывается стоимость». Всё считается в браузере по тем же формулам,
// что и серверный итог (без фильтров цифры совпадают).
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { useVatDisplay } from "@/lib/vat-display";
import { sortRows, type LotRow, type Sort } from "@/lib/lot-table";
import { AddFieldButton, CustomFieldHeader } from "./custom-field-controls";
import { ALL_SCOPE, useLots, useScope } from "./lots-state";
import { heads, Legend, symbol, TzBlockFigures, TzSplitHeader, useTzSplit } from "./_lots-table/shared";
import { TotalsFooter, TotalsList } from "./_lots-table/totals";
import { LotsControls } from "./_lots-table/lots-controls";
import { LotCardView, LotRowView } from "./_lots-table/lot-row";
import { CostPartsBlock } from "./_lots-table/cost-parts";

// Части таблиц вынесены в ./_lots-table/ (общие подписи, итоги, панель выбора, строка лота, состав стоимости).
export { CostPartsBlock, PurchaseCostParts } from "./_lots-table/cost-parts";

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
  const split = useTzSplit(rows);
  const [noTzOpen, setNoTzOpen] = useState(split.withTz.length === 0);
  const mainRows = split.noTz.length > 0 ? split.withTz : rows;
  return (
    <div className="flex flex-col gap-2">
      <LotsControls scope={purchaseId} />
      <div className="flex flex-col gap-2 md:hidden">
        {rows.length > 0 && rows.every((r) => !r.onStock) && (
          <p className="text-xs text-neutral-500">Мех по этому счёту ещё не принят на склад — остаток появится после приёмки.</p>
        )}
        {mainRows.map((r) => (
          <LotCardView key={r.id} row={r} fields={fields} hasEditCol={hasEditCol} currency={currency} />
        ))}
        {split.noTz.length > 0 && (
          <div className="flex flex-col gap-2 rounded-md border border-amber-200 bg-amber-50/50 p-2" data-tz-block="without">
            <button type="button" aria-expanded={noTzOpen} onClick={() => setNoTzOpen((o) => !o)} className="text-left text-sm font-medium">
              <span aria-hidden className={"mr-1 inline-block text-neutral-500 transition-transform " + (noTzOpen ? "rotate-90" : "")}>›</span>
              Лоты без ТЗ — не использованы
              <span className="mt-0.5 block"><TzBlockFigures t={split.noTotals} count={split.noTz.length} /></span>
            </button>
            {noTzOpen && split.noTz.map((r) => <LotCardView key={r.id} row={r} fields={fields} hasEditCol={hasEditCol} currency={currency} />)}
          </div>
        )}
        {rows.length === 0 && (
          <p className="py-4 text-center text-sm text-neutral-500">{view.all.length === 0 ? "В закупке нет позиций" : "Нет лотов, подходящих под фильтр"}</p>
        )}
      </div>
      <div className="hidden md:block">
      <Table anchor="table:lots" label="Таблица лотов закупки">
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
          {mainRows.map((r) => (
            <LotRowView key={r.id} row={r} fields={fields} hasEditCol={hasEditCol} currency={currency} />
          ))}
          <TzSplitHeader split={split} colSpan={h.length + fields.length + 3} open={noTzOpen} onToggle={() => setNoTzOpen((o) => !o)} />
          {noTzOpen && split.noTz.map((r) => (
            <LotRowView key={r.id} row={r} fields={fields} hasEditCol={hasEditCol} currency={currency} />
          ))}
          {rows.length === 0 && (
            <Tr>
              <Td colSpan={h.length + fields.length + 3} className="py-4 text-center text-neutral-500">
                {view.all.length === 0 ? "В закупке нет позиций" : "Нет лотов, подходящих под фильтр"}
              </Td>
            </Tr>
          )}
        </Tbody>
        <TotalsFooter view={view} fields={fields} hasEditCol={hasEditCol} hasCheckCol />
      </Table>
      </div>
    </div>
  );
}
/** Итог аукциона: общие фильтры/выбор, строка «Итого» и разбивка стоимости. */
export function AuctionTotalsPanel() {
  const { fields } = useLots();
  const view = useScope(ALL_SCOPE);
  const cur = view.totals.currencies.length === 1 ? symbol(view.totals.currencies[0]) : "вал.";
  const h = heads(cur);
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-white p-3" data-auction-totals>
      <div className="flex items-center gap-2">
        <h3 className="text-base font-semibold">Всего, ₽ по аукциону</h3>
        <Legend />
      </div>
      <LotsControls scope={ALL_SCOPE} />
      <TotalsList view={view} fields={fields} />
      <div className="hidden md:block">
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
      </div>
      <CostPartsBlock scope={ALL_SCOPE} title="Состав стоимости: цена шкур и НДС" />
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
      <span className={active ? "text-neutral-900" : "text-neutral-500"}>{active ? (sort.dir === "asc" ? "↑" : "↓") : "↕"}</span>
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
  const split = useTzSplit(rows);
  const [noTzOpen, setNoTzOpen] = useState(split.withTz.length === 0);
  const mainRows = split.noTz.length > 0 ? split.withTz : rows;
  const flatCard = (r: LotRow) => {
    const m = purchases.get(r.purchaseId);
    return <LotCardView key={r.id} row={r} fields={fields} hasEditCol={false} currency={r.currency} invoice={{ label: m?.label ?? "–", number: m?.number ?? "" }} />;
  };
  const flatRow = (r: LotRow) => {
    const m = purchases.get(r.purchaseId);
    return <LotRowView key={r.id} row={r} fields={fields} hasEditCol={false} currency={r.currency} invoice={{ label: m?.label ?? "–", number: m?.number ?? "" }} />;
  };
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-white p-3" data-auction-flat>
      <div className="flex items-center gap-2">
        <h3 className="text-base font-semibold">Все лоты аукциона списком</h3>
        <Legend />
      </div>
      <LotsControls scope={ALL_SCOPE} />
      <div className="flex flex-col gap-2 md:hidden">
        {mainRows.map(flatCard)}
        {split.noTz.length > 0 && (
          <div className="flex flex-col gap-2 rounded-md border border-amber-200 bg-amber-50/50 p-2" data-tz-block="without">
            <button type="button" aria-expanded={noTzOpen} onClick={() => setNoTzOpen((o) => !o)} className="text-left text-sm font-medium">
              <span aria-hidden className={"mr-1 inline-block text-neutral-500 transition-transform " + (noTzOpen ? "rotate-90" : "")}>›</span>
              Лоты без ТЗ — не использованы
              <span className="mt-0.5 block"><TzBlockFigures t={split.noTotals} count={split.noTz.length} /></span>
            </button>
            {noTzOpen && split.noTz.map(flatCard)}
          </div>
        )}
        {rows.length === 0 && (
          <p className="py-4 text-center text-sm text-neutral-500">{view.all.length === 0 ? "У аукциона нет лотов" : "Нет лотов, подходящих под фильтр"}</p>
        )}
      </div>
      <div className="hidden md:block">
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
          {mainRows.map(flatRow)}
          <TzSplitHeader split={split} colSpan={FLAT_COLS.length + fields.length + 2} open={noTzOpen} onToggle={() => setNoTzOpen((o) => !o)} />
          {noTzOpen && split.noTz.map(flatRow)}
          {rows.length === 0 && (
            <Tr>
              <Td colSpan={FLAT_COLS.length + fields.length + 2} className="py-4 text-center text-neutral-500">
                {view.all.length === 0 ? "У аукциона нет лотов" : "Нет лотов, подходящих под фильтр"}
              </Td>
            </Tr>
          )}
        </Tbody>
        <TotalsFooter view={view} fields={fields} hasEditCol={false} hasCheckCol invoiceCol />
      </Table>
      </div>
      <CostPartsBlock scope={ALL_SCOPE} title="Состав стоимости" />
    </section>
  );
}
