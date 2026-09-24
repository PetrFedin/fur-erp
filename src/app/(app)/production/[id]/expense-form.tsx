"use client";

import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { addProductionExpense } from "../actions";
import type { ExpenseCategory } from "@prisma/client";

export function ProductionExpenseForm({
  orderId,
  categories,
}: {
  orderId: string;
  categories: ExpenseCategory[];
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const bound = addProductionExpense.bind(null, orderId);

  return (
    <form
      ref={formRef}
      action={async (formData) => {
        await bound(formData);
        formRef.current?.reset();
      }}
      className="grid grid-cols-5 items-end gap-2"
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
        <label className="mb-1 block text-xs text-neutral-500">Сумма, ₽</label>
        <Input name="amount" type="number" step="0.01" min="0" required />
      </div>
      <div className="col-span-2">
        <label className="mb-1 block text-xs text-neutral-500">Описание</label>
        <Input name="description" />
      </div>
      <div className="col-span-5 flex justify-end">
        <Button type="submit" variant="outline" size="sm">
          + Добавить расход
        </Button>
      </div>
    </form>
  );
}
