"use client";

import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { addProductionPayment } from "../actions";

type PaymentOrder = {
  id: string;
  /** "ТЗ №N" or "Заказ П-…" when the ТЗ has no number. */
  label: string;
  /** Work price x quantity, 2-decimal string; null when no client work price is set. */
  due: string | null;
  /** Gross amount of every payment touching this ТЗ, 2-decimal string. */
  paid: string;
};

const nf = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const rub = (n: number) => nf.format(n);

export function ProductionPaymentForm({
  orderId,
  orders,
}: {
  orderId: string;
  /** All ТЗ of this client (including the current one), sorted by number. */
  orders: PaymentOrder[];
}) {
  const [amount, setAmount] = useState("");
  const [paymentType, setPaymentType] = useState("FINAL");
  const [selected, setSelected] = useState<Set<string>>(() => new Set([orderId]));
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const chosen = orders.filter((o) => selected.has(o.id) && o.due !== null);
  const dueSum = chosen.reduce((sum, o) => sum + Number(o.due), 0);
  const restSum = chosen.reduce((sum, o) => sum + (Number(o.due) - Number(o.paid)), 0);
  let hint: { text: string; value: string } | null = null;
  if (chosen.length > 0 && paymentType === "ADVANCE") {
    const v = Math.round(dueSum * 0.7 * 100) / 100;
    hint = { value: v.toFixed(2), text: `70% от к оплате по выбранным ТЗ: ${rub(v)} ₽ — подставить` };
  } else if (chosen.length > 0 && paymentType === "PARTIAL") {
    const v = Math.max(0, Math.round(restSum * 100) / 100);
    hint = { value: v.toFixed(2), text: `Остаток по выбранным ТЗ: ${rub(v)} ₽ — подставить` };
  }
  const bound = addProductionPayment.bind(null, orderId);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <form
      ref={formRef}
      onSubmit={(e) => {
        // Soft guard: paying more than the remaining "К оплате" needs a confirmation.
        const value = Number(amount);
        if (chosen.length > 0 && Number.isFinite(value) && value > Math.max(0, restSum) + 0.005) {
          const ok = confirm(
            `Сумма оплаты ${rub(value)} ₽ больше остатка к оплате по выбранным ТЗ (${rub(Math.max(0, restSum))} ₽). Всё равно добавить?`
          );
          if (!ok) e.preventDefault();
        }
      }}
      action={(formData) =>
        startTransition(async () => {
          const result = await bound(formData);
          setError(result.error ?? null);
          if (result.error) return;
          formRef.current?.reset();
          setAmount("");
          setPaymentType("FINAL");
          setSelected(new Set([orderId]));
        })
      }
      className="flex flex-col gap-2"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 items-end gap-2">
        <div>
          <label className="mb-1 block text-xs text-neutral-500">Сумма, ₽</label>
          <Input name="amount" type="number" step="0.01" min="0" required value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-neutral-500">Тип оплаты</label>
          <Select name="paymentType" value={paymentType} onChange={(e) => setPaymentType(e.target.value)}>
            <option value="ADVANCE">Аванс</option>
            <option value="PARTIAL">Доплата</option>
            <option value="FINAL">Окончательная</option>
          </Select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-neutral-500">Способ оплаты</label>
          <Select name="method" defaultValue="BANK_TRANSFER">
            <option value="BANK_TRANSFER">Банк. перевод</option>
            <option value="CASH">Наличные</option>
            <option value="CARD">Карта</option>
            <option value="OTHER">Другое</option>
          </Select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-neutral-500">Дата</label>
          <Input name="paidAt" type="date" defaultValue={today} required />
        </div>
        <div>
          <label className="mb-1 block text-xs text-neutral-500">Заметка</label>
          <Input name="notes" />
        </div>
      </div>
      {hint && (
        <div>
          <button
            type="button"
            onClick={() => setAmount(hint.value)}
            className="text-xs text-neutral-600 underline-offset-2 hover:underline"
          >
            {hint.text}
          </button>
        </div>
      )}
      {orders.length > 1 && (
        <div>
          <label className="mb-1 block text-xs text-neutral-500">
            Эта оплата покрывает ТЗ этого заказчика (текущее отмечено всегда):
          </label>
          <div className="flex max-h-48 flex-col gap-1 overflow-y-auto rounded-md border border-neutral-200 p-2">
            {orders.map((o) => {
              const current = o.id === orderId;
              const due = o.due !== null ? Number(o.due) : null;
              const paid = Number(o.paid);
              return (
                <label key={o.id} className="flex items-start gap-2 text-xs text-neutral-700 sm:text-sm">
                  <input
                    type="checkbox"
                    name={current ? undefined : "orderIds"}
                    value={o.id}
                    className="mt-0.5 shrink-0 rounded"
                    checked={selected.has(o.id)}
                    disabled={current}
                    onChange={(e) =>
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(o.id);
                        else next.delete(o.id);
                        return next;
                      })
                    }
                  />
                  {o.label}
                  {" — "}
                  {due !== null ? `К оплате ${rub(due)} ₽` : "цена работы не указана"} (оплачено {rub(paid)} ₽)
                  {current && <span className="text-xs text-neutral-400">· это ТЗ</span>}
                </label>
              );
            })}
          </div>
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex justify-end">
        <Button type="submit" variant="outline" size="sm" disabled={pending}>
          + Добавить оплату от заказчика
        </Button>
      </div>
    </form>
  );
}
