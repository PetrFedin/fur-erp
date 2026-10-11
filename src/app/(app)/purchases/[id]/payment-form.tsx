"use client";

import { useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/confirm-dialog";
import { Input, Select } from "@/components/ui/input";
import { addPurchasePayment } from "../actions";

// balanceDue оставлен в сигнатуре для совместимости со страницей: остаток проверяет сервер.
export function PurchasePaymentForm({ purchaseId }: { purchaseId: string; balanceDue?: string }) {
  const uid = useId();
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const bound = addPurchasePayment.bind(null, purchaseId);
  const { ask, node: confirmNode } = useConfirm();
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);
    // Подтверждение даты в будущем — здесь; переплату (по закупке или по аукциону целиком) проверяет сервер.
    // Форма не сбрасывается при отказе и ошибке: введённое сохраняется, очистка — только после успеха.
    const paidAt = String(formData.get("paidAt") ?? "");
    if (!paidAt) { setError("Укажите дату оплаты"); return; }
    if (paidAt > today && !(await ask(`Дата оплаты (${paidAt}) в будущем. Всё равно записать?`, { ok: "Записать" }))) return;
    setError("");
    startTransition(async () => {
      try {
        let res = await bound(formData);
        if (res?.confirm) {
          if (!(await ask(res.confirm, { ok: "Всё равно записать" }))) return;
          formData.set("confirmOverpay", "1");
          res = await bound(formData);
        }
        if (res?.error) {
          setError(res.error);
          return;
        }
        form.reset();
      } catch {
        setError("Не удалось сохранить: сервер отклонил запрос или пропала связь. Попробуйте ещё раз.");
      }
    });
  }

  return (
    <form
      onSubmit={submit}
      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 items-end gap-2"
    >
      {confirmNode}
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
      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 sm:col-span-2 lg:col-span-5">
          {error}
        </p>
      )}
      <div className="sm:col-span-2 lg:col-span-5 flex justify-end">
        <Button type="submit" variant="outline" size="sm" disabled={pending}>
          + Добавить оплату
        </Button>
      </div>
    </form>
  );
}
