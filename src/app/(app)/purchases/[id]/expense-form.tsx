"use client";

import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { addPurchaseExpense } from "../actions";
import type { ExpenseCategory } from "@prisma/client";

export function PurchaseExpenseForm({
  purchaseId,
  categories,
}: {
  purchaseId: string;
  categories: ExpenseCategory[];
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const bound = addPurchaseExpense.bind(null, purchaseId);

  return (
    <form
      ref={formRef}
      action={async (formData) => {
        await bound(formData);
        formRef.current?.reset();
      }}
      className="grid grid-cols-6 items-end gap-2"
    >
      <div className="col-span-2">
        <label className="mb-1 block text-xs text-neutral-500">Статья расходов</label>
        <Select name="categoryId" required defaultValue="">
          <option value="" disabled>
            Выберите статью
          </option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <label className="mb-1 block text-xs text-neutral-500">Сумма, ₽ (без НДС)</label>
        <Input name="amount" type="number" step="0.01" min="0" required />
      </div>
      <div>
        <label className="mb-1 block text-xs text-neutral-500">НДС</label>
        <Select name="vatRate" defaultValue="0">
          <option value="0">0% / не облагается</option>
          <option value="5">5%</option>
          <option value="7">7%</option>
          <option value="10">10%</option>
          <option value="20">20%</option>
          <option value="22">22%</option>
        </Select>
      </div>
      <div className="col-span-2">
        <label className="mb-1 block text-xs text-neutral-500">Описание</label>
        <Input name="description" />
      </div>
      <div className="col-span-6 flex justify-end">
        <Button type="submit" variant="outline" size="sm">
          + Добавить расход
        </Button>
      </div>
    </form>
  );
}
