"use client";

import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { addProductionPayment } from "../actions";

export function ProductionPaymentForm({ orderId }: { orderId: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const bound = addProductionPayment.bind(null, orderId);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <form
      ref={formRef}
      action={async (formData) => {
        await bound(formData);
        formRef.current?.reset();
      }}
      className="grid grid-cols-5 items-end gap-2"
    >
      <div>
        <label className="mb-1 block text-xs text-neutral-500">Сумма, ₽</label>
        <Input name="amount" type="number" step="0.01" min="0" required />
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
      <div className="col-span-2">
        <label className="mb-1 block text-xs text-neutral-500">Заметка</label>
        <Input name="notes" />
      </div>
      <div className="col-span-5 flex justify-end">
        <Button type="submit" variant="outline" size="sm">
          + Добавить оплату от заказчика
        </Button>
      </div>
    </form>
  );
}
