"use client";

import Link from "next/link";
import { TH as Head, THGroup } from "@/components/table-head";
import { uniqueLabelCount } from "@/lib/tz-key";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { formatMoney, formatPercent, formatQty } from "@/lib/utils";
import { WidgetRow } from "@/components/widget-row";
import { TILE_BOX, TileHead, TileValue, TileCaption, TileList, type TileItem } from "../dashboard/tile";
import { TotalLabel } from "@/components/total-label";
import { InfoHint } from "@/components/info-hint";
import { TERMS } from "@/lib/terms";

/** ТЗ с неоплаченной работой: что именно не оплачено. */
export type OwedOrder = { id: string; label: string; article: string; fur: string; batch: number | null; year: number | null; qty: number; work: number; work4?: number; paid: number };
export type BatchRow = { key: string; label: string; year: number | null; work: number; paid: number };
type Props = {
  work: number;
  /** 4% за мех и подкладку (входит в «К оплате»). */
  surcharge: number;
  /** Шкуры подрядчика: сырьё, в «За работу» не учитываются. */
  hides: number;
  total: number;
  paid: number;
  balance: number;
  /** Деньги, пришедшие без привязки к ТЗ (авансы): входят в «Оплачено», но не к конкретной партии. */
  unallocated: number;
  rows: BatchRow[];
  /** Все ТЗ, по которым работа оплачена не полностью (нужны для расшифровки остатка). */
  owed: OwedOrder[];
  hint?: ReactNode;
};
const rub = (v: number) => formatMoney(v.toFixed(2));

/** К оплате и оплачено по партиям, по годам; внизу авансы без ТЗ и итог. Без повторов: каждая цифра один раз. */
function BatchTable({ rows, advances }: { rows: BatchRow[]; advances: number }) {
  const years = Array.from(new Set(rows.map((r) => r.year))).sort((a, b) => (a ?? 9999) - (b ?? 9999));
  const work = rows.reduce((s, r) => s + r.work, 0);
  const paid = rows.reduce((s, r) => s + r.paid, 0) + advances;
  const rest = (w: number, p: number) => (Math.abs(w - p) <= 0.5 ? <span className="text-neutral-500">–</span> : w > p ? <span className="font-medium text-amber-700">{rub(w - p)}</span> : <span className="font-medium text-emerald-700">Переплата {rub(p - w)}</span>);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] table-fixed text-sm">
        <colgroup><col className="w-[170px]" /><col /><col /><col /></colgroup>
        <thead>
          <tr className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
            <th />
            <th className="border-b border-l border-neutral-200 px-2 pb-1 text-right">Расчёт</th>
            <THGroup colSpan={2}>Оплата</THGroup>
          </tr>
          <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
            <th className="py-1.5 pr-2 font-medium">Партия</th>
            <Head label="Стоимость" unit="₽" align="right" sep className="px-2" />
            <Head label="Оплачено" unit="₽" align="right" sep className="px-2" />
            <Head label="Остаток" unit="₽" align="right" className="px-2" />
          </tr>
        </thead>
        <tbody>
          {years.map((y) => {
            const list = rows.filter((r) => r.year === y).sort((a, b) => a.key.localeCompare(b.key, "ru", { numeric: true }));
            return (
              <Fragment key={y ?? "none"}>
                <tr className="border-b border-neutral-200 text-xs font-semibold uppercase tracking-wide text-neutral-600">
                  <td className="py-1.5 pr-2" colSpan={4}>{y ?? "Без года"}</td>
                </tr>
                {list.map((r) => (
                  <tr key={r.key} className="border-b border-neutral-100">
                    <td className="py-1.5 pr-2">{r.label}</td>
                    <td className="whitespace-nowrap border-l border-neutral-200 px-2 py-1.5 text-right tabular-nums">{rub(r.work)}</td>
                    <td className="whitespace-nowrap border-l border-neutral-200 px-2 py-1.5 text-right tabular-nums">{rub(r.paid)}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{rest(r.work, r.paid)}</td>
                  </tr>
                ))}
              </Fragment>
            );
          })}
          {advances > 0.5 ? (
            <tr className="border-b border-neutral-100">
              <td className="py-1.5 pr-2">Авансы без привязки к ТЗ</td>
              <td className="border-l border-neutral-200 px-2 py-1.5 text-right text-neutral-500">–</td>
              <td className="whitespace-nowrap border-l border-neutral-200 px-2 py-1.5 text-right tabular-nums">{rub(advances)}</td>
              <td className="px-2 py-1.5 text-right text-neutral-500">–</td>
            </tr>
          ) : null}
        </tbody>
        <tfoot>
          <tr className="row-total">
            <td className="py-1.5 pr-2"><TotalLabel /></td>
            <td className="whitespace-nowrap border-l border-neutral-200 px-2 py-1.5 text-right tabular-nums">{rub(work)}</td>
            <td className="whitespace-nowrap border-l border-neutral-200 px-2 py-1.5 text-right tabular-nums">{rub(paid)}</td>
            <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{rest(work, paid)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function Tile({ label, value, onOpen, valueClass, hint, items, note }: { label: string; value: string; onOpen?: () => void; valueClass?: string; hint?: ReactNode; items?: TileItem[]; note?: string }) {
  return (
    <div
      className={TILE_BOX + (onOpen ? " tile-click" : "")}
      onClick={onOpen}
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onKeyDown={onOpen ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } } : undefined}
      aria-haspopup={onOpen ? "dialog" : undefined}
      title={onOpen ? "Показать расшифровку по партиям и ТЗ" : undefined}
    >
      <TileHead>{label}</TileHead>
      {hint ? <div className="absolute right-3 top-3" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>{hint}</div> : null}
      <TileValue className={valueClass}>{value}</TileValue>
      {note ? <TileCaption>{note}</TileCaption> : null}
      {items ? <TileList items={items} /> : null}
    </div>
  );
}

export function GoodsTiles({ total, paid, balance, unallocated, rows, owed, hint }: Props) {
  // «К оплате» — остаток работы по заведённым ТЗ (не меньше нуля); неразнесённый аванс — отдельной строкой, из долга не вычитается.
  const left = Math.max(balance + unallocated, 0);
  const advItem = unallocated > 0.5 ? [{
    k: <span className="inline-flex items-center gap-1">Аванс подрядчику<InfoHint label="Что такое аванс подрядчику" align="right"><p>Оплачено сверх работы по заведённым ТЗ; погасится работой по будущим ТЗ.</p><p className="mt-1">Из остатка работы не вычитается; входит в «Оплачено».</p></InfoHint></span>,
    v: rub(unallocated),
  }] : undefined;
  const [open, setOpen] = useState<null | "bars" | "debt">(null);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (open && d && !d.open) d.showModal();
  }, [open]);
  return (
    <>
      <WidgetRow id="goods" title="Итоги" headerEnd={<Link href="/production" className="text-xs text-blue-700 hover:underline print:hidden">→ ТЗ</Link>}>
      <div className="grid grid-cols-1 items-stretch gap-3 sm:grid-cols-3 print:grid-cols-3" data-goods-tiles>
        <Tile label="Общая стоимость" value={rub(total)} onOpen={() => setOpen("bars")} />
        <Tile label="Оплачено" value={rub(paid)} onOpen={() => setOpen("bars")} note={total > 0.5 ? `${formatPercent((paid / total) * 100)}` : undefined} />
        <Tile label={TERMS.workRest} value={rub(left)} onOpen={() => setOpen("debt")} valueClass={left > 0.5 ? "text-amber-700" : ""} hint={hint} items={advItem} note={total > 0.5 ? `${formatPercent((left / total) * 100)}` : undefined} />
      </div>
      </WidgetRow>
      {open && (
        <dialog ref={ref} aria-labelledby="goods-dlg-title" onClose={() => setOpen(null)} onClick={(e) => { if (e.target === ref.current) ref.current?.close(); }} className="m-auto w-[calc(100vw-2rem)] max-w-4xl rounded-xl border border-neutral-200 bg-white p-0 text-left shadow-xl backdrop:bg-black/40">
          <div className="max-h-[88vh] overflow-y-auto p-4">
            <div className="mb-3 flex items-start justify-between gap-3 border-b border-neutral-200 pb-3">
              <div>
                <h2 id="goods-dlg-title" className="block-title">{open === "debt" ? "Остаток работы — за что не оплатили" : "Стоимость и оплачено — по партиям"}</h2>
                {open === "debt" ? <div className="text-sm text-neutral-700">Остаток работы <span className="font-medium text-amber-700">{rub(left)}</span></div> : null}
              </div>
              <button type="button" onClick={() => ref.current?.close()} autoFocus aria-label="Закрыть окно" className="btn-accent rounded-lg border border-neutral-300 px-3 py-1.5 text-sm">✕ Закрыть</button>
            </div>
            {open === "debt" ? (
              <OwedTable owed={owed} advances={unallocated} />
            ) : (
              <BatchTable rows={rows} advances={unallocated} />
            )}
          </div>
        </dialog>
      )}
    </>
  );
}

/** Расшифровка остатка: все ТЗ, по которым работа оплачена не полностью, по партиям; аванс без ТЗ — отдельной строкой. */
function OwedTable({ owed, advances }: { owed: OwedOrder[]; advances: number }) {
  const batches = Array.from(new Set(owed.map((o) => o.batch))).sort((a, b) => (a ?? 9999) - (b ?? 9999));
  const left = (o: OwedOrder) => o.work - o.paid;
  const total = owed.reduce((s, o) => s + left(o), 0);
  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
              <THGroup colSpan={3} sep={false}>Заказ</THGroup>
              <THGroup colSpan={2}>Количество и расчёт</THGroup>
              <THGroup colSpan={2}>Оплата</THGroup>
            </tr>
            <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
              <th className="py-1.5 pr-2 font-medium">ТЗ</th>
              <th className="px-2 py-1.5 font-medium">Артикул</th>
              <th className="px-2 py-1.5 font-medium">Мех</th>
              <Head label="Кол-во" unit="шт." align="right" sep className="px-2" />
              <Head label="Стоимость" unit="₽" align="right" className="px-2" />
              <Head label="Оплачено" unit="₽" align="right" sep className="px-2" />
              <Head label="Остаток" unit="₽" align="right" className="px-2" />
            </tr>
          </thead>
          <tbody>
            {batches.map((b) => {
              const list = owed.filter((o) => o.batch === b).sort((x, y) => x.label.localeCompare(y.label, "ru", { numeric: true }));
              const w = list.reduce((s, o) => s + o.work, 0);
              const p = list.reduce((s, o) => s + o.paid, 0);
              return (
                <Fragment key={b ?? "none"}>
                  <tr className="bg-neutral-50/70 font-semibold">
                    <td className="px-2 py-1.5" colSpan={3}>{b != null ? `Партия ${b}` : "Вне партий"}{list[0]?.year ? ` · ${list[0].year}` : ""} · {uniqueLabelCount(list)} ТЗ</td>
                    <td className="border-l border-neutral-200 px-2 py-1.5 text-right tabular-nums">{formatQty(list.reduce((s, o) => s + o.qty, 0))} шт.</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{rub(w)}</td>
                    <td className="whitespace-nowrap border-l border-neutral-200 px-2 py-1.5 text-right tabular-nums">{rub(p)}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-amber-700">{rub(w - p)}</td>
                  </tr>
                  {list.map((o) => (
                    <tr key={o.id} className="border-b border-neutral-100">
                      <td className="whitespace-nowrap py-1.5 pr-2"><a href={`/production/${o.id}`} className="text-blue-700 hover:underline">{o.label} ›</a></td>
                      <td className="whitespace-nowrap px-2 py-1.5">{o.article}</td>
                      <td className="px-2 py-1.5 text-neutral-600">{o.fur}</td>
                      <td className="whitespace-nowrap border-l border-neutral-200 px-2 py-1.5 text-right tabular-nums">{formatQty(o.qty)} шт.</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{rub(o.work)}</td>
                      <td className="whitespace-nowrap border-l border-neutral-200 px-2 py-1.5 text-right tabular-nums">{rub(o.paid)}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right font-medium tabular-nums text-amber-700">{rub(left(o))}</td>
                    </tr>
                  ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <dl className="grid max-w-md gap-1 text-sm">
        <div className="flex justify-between gap-4 border-t border-neutral-200 pt-1 font-semibold"><dt>Остаток работы ({uniqueLabelCount(owed)} ТЗ)</dt><dd className="tabular-nums text-amber-700">{rub(total)}</dd></div>
        {advances > 0.5 ? <div className="flex justify-between gap-4"><dt className="text-neutral-600">Аванс подрядчику, не вычтен</dt><dd className="tabular-nums">{rub(advances)}</dd></div> : null}
      </dl>
    </div>
  );
}

