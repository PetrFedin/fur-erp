"use client";

import { useState } from "react";
import { EditDialog } from "@/components/edit-dialog";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { saveProductionPaymentAllocation } from "@/app/(app)/production/mark-actions";
import { fromCents, splitByWeights, toCents, type AllocOrderOpt } from "@/lib/payment-alloc-core";

export type { AllocOrderOpt };

type Row = { orderId: string; amount: string };

const rub = (c: number) => (c / 100).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const parse = (s: string) => {
  const t = s.replace(/\s/g, "").replace(",", ".");
  return t === "" ? 0 : toCents(t);
};

/**
 * Разнесение оплаты производства по ТЗ: таблица «ТЗ — сумма», итог и остаток, предупреждение при Σ > суммы платежа,
 * кнопка «Разнести остаток пропорционально работе». Сохранение — saveProductionPaymentAllocation (строки помечаются «вручную»).
 */
export function AllocationEditButton({
  paymentId,
  amount,
  orders,
  initial,
  label = "Разнесение",
}: {
  paymentId: string;
  amount: string;
  orders: AllocOrderOpt[];
  initial: { orderId: string; amount: string }[];
  label?: string;
}) {
  return (
    <EditDialog
      title="Разнесение оплаты по ТЗ"
      variant="outline"
      label={label}
      wide
      action={(fd) => saveProductionPaymentAllocation(paymentId, fd)}
      hint="Сумма по ТЗ в сумме не может быть больше суммы платежа. Что не разнесено — «неразнесённый аванс», в долге заказчика он учитывается отдельной строкой."
    >
      <div className="sm:col-span-2">
        <AllocationRows amount={amount} orders={orders} initial={initial} />
      </div>
    </EditDialog>
  );
}

function AllocationRows({ amount, orders, initial }: { amount: string; orders: AllocOrderOpt[]; initial: { orderId: string; amount: string }[] }) {
  const total = toCents(amount);
  const [rows, setRows] = useState<Row[]>(initial.length ? initial.map((r) => ({ ...r })) : []);
  const byId = new Map(orders.map((o) => [o.id, o]));
  const cents = rows.map((r) => (r.orderId ? parse(r.amount) : 0));
  const sum = cents.reduce((s, c) => s + Math.max(0, c), 0);
  const rest = total - sum;
  const over = rest < 0;
  const used = new Set(rows.map((r) => r.orderId));

  const update = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows((rs) => [...rs, { orderId: "", amount: "" }]);

  const spreadRest = () => {
    if (rest <= 0) return;
    const cur = new Map(rows.filter((r) => r.orderId).map((r) => [r.orderId, parse(r.amount)]));
    const items = orders
      .filter((o) => o.linked)
      .map((o) => ({ id: o.id, weight: o.workCents, cap: Math.max(0, o.workCents - o.otherCents - (cur.get(o.id) ?? 0)) }));
    const split = splitByWeights(rest, items);
    if (split.size === 0) return;
    const next = new Map(cur);
    for (const [id, c] of split) next.set(id, (next.get(id) ?? 0) + c);
    const order = [...rows.filter((r) => r.orderId).map((r) => r.orderId), ...[...split.keys()].filter((id) => !cur.has(id))];
    setRows(order.map((id) => ({ orderId: id, amount: fromCents(next.get(id) ?? 0) })));
  };

  // «Разнести остаток на партию целиком»: тот же расчёт, что и «пропорционально работе», но по ТЗ выбранной партии (любые ТЗ заказчика).
  const [batchPick, setBatchPick] = useState("");
  const batches = [...new Set(orders.map((o) => o.batch).filter((b): b is number => b != null))].sort((a, b) => a - b);
  const spreadBatch = () => {
    const n = Number(batchPick);
    if (rest <= 0 || !batchPick) return;
    const cur = new Map(rows.filter((r) => r.orderId).map((r) => [r.orderId, parse(r.amount)]));
    const items = orders.filter((o) => o.batch === n).map((o) => ({ id: o.id, weight: o.workCents, cap: Math.max(0, o.workCents - o.otherCents - (cur.get(o.id) ?? 0)) }));
    const split = splitByWeights(rest, items);
    if (split.size === 0) return;
    const next = new Map(cur);
    for (const [id, c] of split) next.set(id, (next.get(id) ?? 0) + c);
    const order = [...rows.filter((r) => r.orderId).map((r) => r.orderId), ...[...split.keys()].filter((id) => !cur.has(id))];
    setRows(order.map((id) => ({ orderId: id, amount: fromCents(next.get(id) ?? 0) })));
  };

  const payload = JSON.stringify(rows.filter((r) => r.orderId && parse(r.amount) > 0).map((r) => ({ orderId: r.orderId, amount: fromCents(parse(r.amount)) })));
  const linked = orders.filter((o) => o.linked);
  const others = orders.filter((o) => !o.linked);

  return (
    <div className="flex flex-col gap-2 text-sm">
      <input type="hidden" name="lines" value={payload} readOnly />
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-600">
        <span>Сумма платежа: <b className="tabular-nums text-neutral-900">{rub(total)}</b> ₽</span>
        <span>Разнесено: <b className="tabular-nums text-neutral-900">{rub(sum)}</b> ₽</span>
        <span className={over ? "font-semibold text-red-600" : rest > 0 ? "text-amber-700" : "text-emerald-700"}>
          {over ? `Больше платежа на ${rub(-rest)} ₽` : rest > 0 ? `Не разнесено: ${rub(rest)} ₽` : "Разнесено полностью"}
        </span>
      </div>
      {over && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
          Сумма по ТЗ больше суммы платежа — такой вариант не сохранится. Уменьшите суммы.
        </p>
      )}
      <div className="flex flex-col gap-2">
        {rows.map((r, i) => {
          const o = r.orderId ? byId.get(r.orderId) : null;
          const room = o ? o.workCents - o.otherCents : 0;
          const exceeds = o != null && cents[i] > room + 1;
          return (
            <div key={i} className="flex flex-col gap-1 rounded-md border border-neutral-200 p-2 sm:flex-row sm:flex-wrap sm:items-center">
              <Select value={r.orderId} onChange={(e) => update(i, { orderId: e.target.value })} className="min-w-0 flex-1 sm:min-w-[14rem]" aria-label="ТЗ">
                <option value="">— выберите ТЗ —</option>
                {linked.length > 0 && (
                  <optgroup label="ТЗ этой оплаты">
                    {linked.map((x) => (
                      <option key={x.id} value={x.id} disabled={used.has(x.id) && x.id !== r.orderId}>{x.label}</option>
                    ))}
                  </optgroup>
                )}
                {others.length > 0 && (
                  <optgroup label="Другие ТЗ заказчика">
                    {others.map((x) => (
                      <option key={x.id} value={x.id} disabled={used.has(x.id) && x.id !== r.orderId}>{x.label}</option>
                    ))}
                  </optgroup>
                )}
              </Select>
              <Input
                inputMode="decimal"
                value={r.amount}
                onChange={(e) => update(i, { amount: e.target.value })}
                placeholder="Сумма, ₽"
                aria-label="Сумма по ТЗ"
                className="sm:w-40"
              />
              <Button type="button" variant="ghost" size="sm" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} aria-label="Убрать строку" className="max-md:h-10">
                Убрать
              </Button>
              {o && (
                <span className={`text-[11px] sm:basis-full ${exceeds ? "text-amber-700" : "text-neutral-500"}`}>
                  работа {rub(o.workCents)} ₽ · от других платежей {rub(o.otherCents)} ₽ · свободно {rub(Math.max(0, room))} ₽{exceeds ? " — больше остатка работы" : ""}
                </span>
              )}
            </div>
          );
        })}
        {rows.length === 0 && <p className="text-xs text-neutral-500">Пока ни одно ТЗ не указано: вся сумма — неразнесённый аванс.</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={addRow} className="max-md:h-10">+ ТЗ</Button>
        <Button type="button" variant="outline" size="sm" onClick={spreadRest} disabled={rest <= 0 || linked.length === 0} className="max-md:h-10" title="Делит неразнесённый остаток между ТЗ этой оплаты пропорционально работе, не больше остатка работы каждого ТЗ">
          Разнести остаток пропорционально работе
        </Button>
        {batches.length > 0 && (
          <>
            <Select value={batchPick} onChange={(e) => setBatchPick(e.target.value)} aria-label="Партия" className="h-9 w-44 text-xs max-md:h-10"><option value="">Партия целиком…</option>{batches.map((b) => <option key={b} value={b}>Партия {b}</option>)}</Select>
            <Button type="button" variant="outline" size="sm" onClick={spreadBatch} disabled={rest <= 0 || !batchPick} className="max-md:h-10" title="Делит неразнесённый остаток между ТЗ выбранной партии пропорционально работе, не больше остатка работы каждого ТЗ">Разнести на партию</Button>
          </>
        )}
      </div>
    </div>
  );
}
