"use client";

import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { addPurchasePayment } from "../actions";

export function PurchasePaymentForm({ purchaseId, balanceDue }: { purchaseId: string; balanceDue: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const bound = addPurchasePayment.bind(null, purchaseId);
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  return (
    <form
      ref={formRef}
      action={async (formData) => {
        // Подтверждения (не блокируем): сумма больше остатка, дата в будущем.
        const amount = Number(String(formData.get("amount") ?? "").replace(/\s/g, "").replace(",", "."));
        const due = Number(balanceDue);
        const paidAt = String(formData.get("paidAt") ?? "");
        if (Number.isFinite(amount) && Number.isFinite(due) && amount > due + 0.005) {
          const msg = due > 0
            ? `Сумма оплаты (${amount.toLocaleString("ru-RU")} ₽) больше остатка к оплате (${due.toLocaleString("ru-RU")} ₽). Всё равно записать?`
            : `Закупка уже полностью оплачена (остаток ${due.toLocaleString("ru-RU")} ₽). Записать ещё одну оплату?`;
          if (!window.confirm(msg)) return;
        }
        if (paidAt > today && !window.confirm(`Дата оплаты (${paidAt}) в будущем. Всё равно записать?`)) return;
        const res = await bound(formData);
        if (res?.error) {
          window.alert(res.error);
          return;
        }
        formRef.current?.reset();
      }}
      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 items-end gap-2"
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
      <div className="sm:col-span-2">
        <label className="mb-1 block text-xs text-neutral-500">Заметка</label>
        <Input name="notes" />
      </div>
      <div className="sm:col-span-2 lg:col-span-5 flex justify-end">
        <Button type="submit" variant="outline" size="sm">
          + Добавить оплату
        </Button>
      </div>
    </form>
  );
}
