"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
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
  const [categoryId, setCategoryId] = useState("");
  const [amount, setAmount] = useState("");
  const [vatRate, setVatRate] = useState(String(defaultVatRate));
  const [description, setDescription] = useState("");
  const [showDescription, setShowDescription] = useState(false);

  const canAdd = categoryId !== "" && Number(amount) > 0;

  function submit() {
    if (!canAdd) return;
    const fd = new FormData();
    fd.set("categoryId", categoryId);
    fd.set("amount", amount);
    fd.set("vatRate", vatRate);
    if (description.trim()) fd.set("description", description.trim());
    startTransition(async () => {
      await addPurchaseExpense(purchaseId, fd);
      setAmount("");
      setDescription("");
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {categories.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setCategoryId(c.id)}
            aria-pressed={categoryId === c.id}
            className={`rounded-full border px-3 py-1 text-sm ${
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
          <label className="mb-1 block text-xs text-neutral-500">Сумма, ₽ (без НДС)</label>
          <Input
            type="number"
            step="0.01"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
            className="w-40"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-neutral-500">НДС</label>
          <Select value={vatRate} onChange={(e) => setVatRate(e.target.value)} className="w-28">
            <option value="0">0%</option>
            <option value="5">5%</option>
            <option value="7">7%</option>
            <option value="10">10%</option>
            <option value="20">20%</option>
            <option value="22">22%</option>
          </Select>
        </div>
        {showDescription ? (
          <div>
            <label className="mb-1 block text-xs text-neutral-500">Комментарий</label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} className="w-56" />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowDescription(true)}
            className="pb-2 text-xs text-neutral-500 hover:underline"
          >
            + комментарий
          </button>
        )}
        <Button type="button" variant="outline" size="sm" disabled={pending || !canAdd} onClick={submit}>
          + Добавить расход
        </Button>
      </div>
      {categoryId === "" && <p className="text-xs text-neutral-400">Выберите статью, затем введите сумму.</p>}
    </div>
  );
}
