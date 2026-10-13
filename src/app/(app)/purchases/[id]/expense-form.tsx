"use client";

import { useState, useTransition } from "react";
import { DialogButtons, useCreateDialog } from "@/components/create-dialog";
import { Input } from "@/components/ui/input";
import { VatInput } from "@/components/vat-input";
import { addPurchaseExpense } from "../actions";

type Category = { id: string; name: string };

// Quick expense entry: pick the item (chips = the existing PURCHASE expense
// categories), type the amount, add. VAT preselected at 22% but changeable.
export function PurchaseExpenseForm({
  purchaseId,
  categories,
  defaultVatRate = 22,
}: {
  purchaseId: string;
  categories: Category[];
  defaultVatRate?: number;
}) {
  const [pending, startTransition] = useTransition();
  const dlg = useCreateDialog();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(0);
  const [categoryId, setCategoryId] = useState("");
  const [amount, setAmount] = useState("");
  const [vatRate, setVatRate] = useState(String(defaultVatRate));
  const [description, setDescription] = useState("");
  const [showDescription, setShowDescription] = useState(false);

  const canAdd = categoryId !== "" && Number(amount) > 0;

  function submit(more: boolean) {
    if (!canAdd || pending) return;
    setError(null);
    const fd = new FormData();
    fd.set("categoryId", categoryId);
    fd.set("amount", amount);
    fd.set("vatRate", vatRate);
    if (description.trim()) fd.set("description", description.trim());
    startTransition(async () => {
      const res = await addPurchaseExpense(purchaseId, fd);
      if (res?.error) {
        setError(res.error);
        return;
      }
      if (more) {
        // Окно остаётся: статья и НДС сохраняются, очищаются сумма и комментарий.
        setAmount("");
        setDescription("");
        setSaved((k) => k + 1);
      } else dlg?.close();
    });
  }

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        submit(((e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.name === "_more");
      }}
    >
      <div className="flex flex-wrap gap-2">
        {categories.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setCategoryId(c.id)}
            aria-pressed={categoryId === c.id}
            className={`rounded-full border px-3 py-1 text-sm max-md:min-h-8 ${
              categoryId === c.id
                ? "border-neutral-900 bg-neutral-900 text-white"
                : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50"
            }`}
          >
            {c.name}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor="expense-amount" className="mb-1 block text-xs text-neutral-500">Сумма, ₽ (без НДС)</label>
          <Input
            id="expense-amount"
            type="number"
            step="0.01"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit(false);
              }
            }}
            className="w-40"
          />
        </div>
        <div>
          <label htmlFor="expense-vat" className="mb-1 block text-xs text-neutral-500">НДС, %</label>
          <VatInput id="expense-vat" value={vatRate} onChange={(e) => setVatRate(e.target.value)} className="w-28" />
        </div>
        {showDescription ? (
          <div>
            <label htmlFor="expense-description" className="mb-1 block text-xs text-neutral-500">Комментарий</label>
            <Input id="expense-description" value={description} onChange={(e) => setDescription(e.target.value)} className="w-56" />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowDescription(true)}
            className="pb-2 text-xs text-neutral-500 hover:underline max-md:min-h-8"
          >
            + комментарий
          </button>
        )}
      </div>
      {error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <DialogButtons pending={pending} withMore saved={saved} onCancel={dlg?.close} />
      {categoryId === "" && <p className="text-xs text-neutral-500">Выберите статью, затем введите сумму.</p>}
    </form>
  );
}
