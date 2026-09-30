"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { addProductionPayment } from "../actions";

export function ProductionPaymentForm({
  orderId,
  siblingOrders,
  advanceHint,
}: {
  orderId: string;
  siblingOrders: { id: string; number: string }[];
  /** 70% of the client's work price (unit price x quantity), 2-decimal string, or null when no price is set. */
  advanceHint: string | null;
}) {
  const [amount, setAmount] = useState("");
  const [paymentType, setPaymentType] = useState("FINAL");
  const formRef = useRef<HTMLFormElement>(null);
  const bound = addProductionPayment.bind(null, orderId);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <form
      ref={formRef}
      action={async (formData) => {
        await bound(formData);
        formRef.current?.reset();
        setAmount("");
        setPaymentType("FINAL");
      }}
      className="flex flex-col gap-2"
    >
      <div className="grid grid-cols-5 items-end gap-2">
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
      {advanceHint && paymentType === "ADVANCE" && (
        <div>
          <button
            type="button"
            onClick={() => setAmount(advanceHint)}
            className="text-xs text-neutral-600 underline-offset-2 hover:underline"
          >
            70% от к оплате: {advanceHint} ₽ — подставить
          </button>
        </div>
      )}
      {siblingOrders.length > 0 && (
        <div>
          <label className="mb-1 block text-xs text-neutral-500">
            Эта оплата также покрывает (другие ТЗ этого заказчика):
          </label>
          <div className="flex flex-wrap gap-3">
            {siblingOrders.map((o) => (
              <label key={o.id} className="flex items-center gap-1 text-sm text-neutral-700">
                <input type="checkbox" name="orderIds" value={o.id} className="rounded" />
                {o.number}
              </label>
            ))}
          </div>
        </div>
      )}
      <div className="flex justify-end">
        <Button type="submit" variant="outline" size="sm">
          + Добавить оплату от заказчика
        </Button>
      </div>
    </form>
  );
}
