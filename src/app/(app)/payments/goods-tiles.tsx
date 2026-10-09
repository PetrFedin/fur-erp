"use client";

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { formatMoney } from "@/lib/utils";

/** ТЗ с неоплаченной работой: что именно не оплачено. */
export type OwedOrder = { id: string; label: string; article: string; fur: string; batch: number | null; year: number | null; qty: number; work: number; work4?: number; paid: number };
export type BatchRow = { key: string; label: string; year: number | null; work: number; paid: number };
type Props = {
  work: number;
  /** 4% за мех и подкладку (входит в «К оплате»). */
  surcharge: number;
  /** Шкуры подрядчика: сырьё, в «За производство» не учитываются. */
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
  const rest = (w: number, p: number) => (Math.abs(w - p) <= 0.5 ? <span className="text-neutral-400">—</span> : w > p ? <span className="font-medium text-amber-700">{rub(w - p)}</span> : <span className="font-medium text-emerald-700">+{rub(p - w)}</span>);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-sm">
        <thead>
          <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
            <th className="py-1.5 pr-2 font-medium">Партия</th>
            <th className="px-2 py-1.5 text-right font-medium">К оплате</th>
            <th className="px-2 py-1.5 text-right font-medium">Оплачено</th>
            <th className="px-2 py-1.5 text-right font-medium">Остаток</th>
          </tr>
        </thead>
        <tbody>
          {years.map((y) => {
            const list = rows.filter((r) => r.year === y).sort((a, b) => a.key.localeCompare(b.key, "ru", { numeric: true }));
            return (
              <Fragment key={y ?? "none"}>
                <tr className="bg-neutral-100 text-xs font-semibold uppercase tracking-wide text-neutral-600">
                  <td className="px-2 py-1.5" colSpan={4}>{y ?? "Без года"}</td>
                </tr>
                {list.map((r) => (
                  <tr key={r.key} className="border-b border-neutral-100">
                    <td className="py-1.5 pr-2">{r.label}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{rub(r.work)}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{rub(r.paid)}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{rest(r.work, r.paid)}</td>
                  </tr>
                ))}
              </Fragment>
            );
          })}
          {advances > 0.5 ? (
            <tr className="border-b border-neutral-100">
              <td className="py-1.5 pr-2">Авансы без привязки к ТЗ</td>
              <td className="px-2 py-1.5 text-right text-neutral-400">—</td>
              <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{rub(advances)}</td>
              <td className="px-2 py-1.5 text-right text-neutral-400">—</td>
            </tr>
          ) : null}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-neutral-300 font-semibold">
            <td className="py-1.5 pr-2">Итого</td>
            <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{rub(work)}</td>
            <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{rub(paid)}</td>
            <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{rest(work, paid)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function Tile({ label, value, onOpen, valueClass, hint, sub }: { label: string; value: string; onOpen: () => void; valueClass?: string; hint?: ReactNode; sub?: [string, number][] }) {
  return (
    <div className="relative">
      <button type="button" onClick={onOpen} aria-haspopup="dialog" className="w-full rounded-lg border border-neutral-200 bg-white p-3 text-left shadow-sm transition hover:border-neutral-400 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700">
        <div className="text-xs text-neutral-500">{label}</div>
        <div className={"mt-1 break-words text-base font-semibold sm:text-lg " + (valueClass ?? "")}>{value}</div>
        {sub?.map(([k, v]) => (
          <div key={k} className="mt-0.5 flex justify-between gap-3 text-xs text-neutral-600"><span>{k}</span><span className="tabular-nums">{rub(v)}</span></div>
        ))}
      </button>
      {hint ? <div className="absolute right-3 top-3">{hint}</div> : null}
    </div>
  );
}

export function GoodsTiles({ total, paid, balance, unallocated, rows, owed, hint }: Props) {
  const [open, setOpen] = useState<null | "bars" | "debt">(null);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (open && d && !d.open) d.showModal();
  }, [open]);
  return (
    <>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-3" data-goods-tiles>
        <Tile label="К оплате" value={rub(total)} onOpen={() => setOpen("bars")} />
        <Tile label="Оплачено" value={rub(paid)} onOpen={() => setOpen("bars")} />
        <Tile label="Остаток к оплате" value={rub(balance)} onOpen={() => setOpen("debt")} valueClass={balance > 0.5 ? "text-amber-700" : ""} hint={hint} />
      </div>
      {open && (
        <dialog ref={ref} onClose={() => setOpen(null)} onClick={(e) => { if (e.target === ref.current) ref.current?.close(); }} className="m-auto w-[calc(100vw-2rem)] max-w-4xl rounded-xl border border-neutral-200 bg-white p-0 text-left shadow-xl backdrop:bg-black/40">
          <div className="max-h-[88vh] overflow-y-auto p-4">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{open === "debt" ? "Остаток к оплате — за что не оплатили" : "К оплате и оплачено — по партиям"}</div>
                {open === "debt" ? <div className="text-sm text-neutral-700">Остаток <b className="text-amber-700">{rub(balance)}</b></div> : null}
              </div>
              <button type="button" onClick={() => ref.current?.close()} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50">✕ Закрыть</button>
            </div>
            {open === "debt" ? (
              <OwedTable owed={owed} advances={unallocated} balance={balance} />
            ) : (
              <BatchTable rows={rows} advances={unallocated} />
            )}
          </div>
        </dialog>
      )}
    </>
  );
}

/** Расшифровка остатка: все ТЗ, по которым работа оплачена не полностью, по партиям; минус авансы без ТЗ = остаток. */
function OwedTable({ owed, advances, balance }: { owed: OwedOrder[]; advances: number; balance: number }) {
  const batches = Array.from(new Set(owed.map((o) => o.batch))).sort((a, b) => (a ?? 9999) - (b ?? 9999));
  const left = (o: OwedOrder) => o.work - o.paid;
  const total = owed.reduce((s, o) => s + left(o), 0);
  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
              <th className="py-1.5 pr-2 font-medium">ТЗ</th>
              <th className="px-2 py-1.5 font-medium">Артикул</th>
              <th className="px-2 py-1.5 font-medium">Мех</th>
              <th className="px-2 py-1.5 text-right font-medium">Кол-во</th>
              <th className="px-2 py-1.5 text-right font-medium">К оплате</th>
              <th className="px-2 py-1.5 text-right font-medium">Оплачено</th>
              <th className="px-2 py-1.5 text-right font-medium">Не оплачено</th>
            </tr>
          </thead>
          <tbody>
            {batches.map((b) => {
              const list = owed.filter((o) => o.batch === b).sort((x, y) => x.label.localeCompare(y.label, "ru", { numeric: true }));
              const w = list.reduce((s, o) => s + o.work, 0);
              const p = list.reduce((s, o) => s + o.paid, 0);
              return (
                <Fragment key={b ?? "none"}>
                  <tr className="bg-neutral-100 font-semibold">
                    <td className="px-2 py-1.5" colSpan={3}>{b != null ? `Партия ${b}` : "Без партии"}{list[0]?.year ? ` · ${list[0].year}` : ""} · {list.length} ТЗ</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{list.reduce((s, o) => s + o.qty, 0).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} шт.</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{rub(w)}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{rub(p)}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-amber-700">{rub(w - p)}</td>
                  </tr>
                  {list.map((o) => (
                    <tr key={o.id} className="border-b border-neutral-100">
                      <td className="whitespace-nowrap py-1.5 pr-2"><a href={`/production/${o.id}`} className="text-blue-700 hover:underline">ТЗ {o.label} ›</a></td>
                      <td className="whitespace-nowrap px-2 py-1.5">{o.article}</td>
                      <td className="px-2 py-1.5 text-neutral-600">{o.fur}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{o.qty.toLocaleString("ru-RU", { maximumFractionDigits: 1 })} шт.</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{rub(o.work)}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{rub(o.paid)}</td>
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
        <div className="flex justify-between gap-4"><dt className="text-neutral-600">Не оплачено по ТЗ ({owed.length})</dt><dd className="tabular-nums">{rub(total)}</dd></div>
        {advances > 0.5 ? <div className="flex justify-between gap-4"><dt className="text-neutral-600">Минус авансы без привязки к ТЗ</dt><dd className="tabular-nums text-emerald-700">−{rub(advances)}</dd></div> : null}
        <div className="flex justify-between gap-4 border-t border-neutral-200 pt-1 font-semibold"><dt>Остаток к оплате</dt><dd className="tabular-nums text-amber-700">{rub(balance)}</dd></div>
      </dl>
    </div>
  );
}

