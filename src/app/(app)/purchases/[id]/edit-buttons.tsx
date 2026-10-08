"use client";

import { EditDialog, Field } from "@/components/edit-dialog";
import { Input, Select } from "@/components/ui/input";
import { VatInput } from "@/components/vat-input";
import { updatePurchaseExpense, updatePurchasePayment } from "../actions";

export function ExpenseEditButton({
  purchaseId,
  expenseId,
  version,
  categories,
  defaults,
}: {
  purchaseId: string;
  expenseId: string;
  version: string;
  categories: { id: string; name: string }[];
  defaults: { categoryId: string; amount: string; vatRate: string; description: string };
}) {
  return (
    <EditDialog
      title="Изменить расход закупки"
      variant="outline"
      action={(fd) => updatePurchaseExpense(purchaseId, expenseId, fd)}
      version={version}
      hint="Себестоимость закупки пересчитается; подтверждение закупки сбросится."
    >
      <Field label="Статья расходов" wide>
        <Select name="categoryId" defaultValue={defaults.categoryId} required>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Сумма, ₽ (без НДС)">
        <Input name="amount" inputMode="decimal" defaultValue={defaults.amount} required />
      </Field>
      <Field label="НДС, %">
        <VatInput name="vatRate" defaultValue={defaults.vatRate} />
      </Field>
      <Field label="Комментарий" wide>
        <Input name="description" defaultValue={defaults.description} maxLength={500} />
      </Field>
    </EditDialog>
  );
}

export function PaymentEditButton({
  purchaseId,
  paymentId,
  version,
  defaults,
  targets,
}: {
  purchaseId: string;
  paymentId: string;
  version: string;
  defaults: { amount: string; paidAt: string; method: string; status: string; docRef: string; notes: string };
  /** Другие закупки того же поставщика, на которые можно перенести оплату. */
  targets: { id: string; label: string }[];
}) {
  return (
    <EditDialog
      title="Изменить оплату"
      variant="outline"
      action={(fd) => updatePurchasePayment(purchaseId, paymentId, fd)}
      version={version}
      hint="Остаток по закупке и аукциону пересчитается; отметка «подтверждено» и подтверждение закупки сбросятся. Платёжку (файл) заменяйте в блоке «Документы»."
    >
      <Field label="Сумма, ₽">
        <Input name="amount" inputMode="decimal" defaultValue={defaults.amount} required />
      </Field>
      <Field label="Дата оплаты">
        <Input name="paidAt" type="date" defaultValue={defaults.paidAt} required />
      </Field>
      <Field label="Способ оплаты">
        <Select name="method" defaultValue={defaults.method}>
          <option value="BANK_TRANSFER">Банк. перевод</option>
          <option value="CASH">Наличные</option>
          <option value="CARD">Карта</option>
          <option value="OTHER">Другое</option>
        </Select>
      </Field>
      <Field label="Статус">
        <Select name="status" defaultValue={defaults.status}>
          <option value="COMPLETED">Оплачена</option>
          <option value="PENDING">Запланирована</option>
        </Select>
      </Field>
      <Field label="№ платёжного поручения / счёта">
        <Input name="docRef" defaultValue={defaults.docRef} maxLength={200} />
      </Field>
      {targets.length > 0 && (
        <Field label="Закупка (перенос оплаты)">
          <Select name="targetPurchaseId" defaultValue={purchaseId}>
            <option value={purchaseId}>Эта закупка</option>
            {targets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field label="Заметка" wide>
        <Input name="notes" defaultValue={defaults.notes} maxLength={1000} />
      </Field>
    </EditDialog>
  );
}
