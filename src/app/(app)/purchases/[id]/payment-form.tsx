"use client";

import { useId, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { addPurchasePayment } from "../actions";

// balanceDue оставлен в сигнатуре для совместимости со страницей: остаток проверяет сервер.
export function PurchasePaymentForm({ purchaseId }: { purchaseId: string; balanceDue?: string }) {
  const uid = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const bound = addPurchasePayment.bind(null, purchaseId);
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  return (
    <form
      ref={formRef}
      action={async (formData) => {
        // Подтверждение даты в будущем — здесь; переплату (по закупке или по аукциону целиком) проверяет сервер.
        const paidAt = String(formData.get("paidAt") ?? "");
        if (paidAt > today && !window.confirm(`Дата оплаты (${paidAt}) в будущем. Всё равно записать?`)) return;
        let res = await bound(formData);
        if (res?.confirm) {
          if (!window.confirm(res.confirm)) return;
          formData.set("confirmOverpay", "1");
          res = await bound(formData);
        }
        if (res?.error) {
          window.alert(res.error);
          return;
        }
        formRef.current?.reset();
      }}
      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 items-end gap-2"
    >
      <div>
        <label htmlFor={`${uid}-amount`} className="mb-1 block text-xs text-neutral-500">Сумма, ₽</label>
        <Input id={`${uid}-amount`} name="amount" inputMode="decimal" autoComplete="off" required />
      </div>
      <div>
        <label htmlFor={`${uid}-method`} className="mb-1 block text-xs text-neutral-500">Способ оплаты</label>
        <Select id={`${uid}-method`} name="method" defaultValue="BANK_TRANSFER">
          <option value="BANK_TRANSFER">Банк. перевод</option>
          <option value="CASH">Наличные</option>
          <option value="CARD">Карта</option>
          <option value="OTHER">Другое</option>
        </Select>
      </div>
      <div>
        <label htmlFor={`${uid}-paidAt`} className="mb-1 block text-xs text-neutral-500">Дата</label>
        <Input id={`${uid}-paidAt`} name="paidAt" type="date" defaultValue={today} required />
      </div>
      <div className="sm:col-span-2">
        <label htmlFor={`${uid}-notes`} className="mb-1 block text-xs text-neutral-500">Заметка</label>
        <Input id={`${uid}-notes`} name="notes" />
      </div>
      <div className="sm:col-span-2 lg:col-span-5 flex justify-end">
        <Button type="submit" variant="outline" size="sm">
          + Добавить оплату
        </Button>
      </div>
    </form>
  );
}
