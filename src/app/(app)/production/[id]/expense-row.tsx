"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Tr, Td } from "@/components/ui/table";
import { formatMoney } from "@/lib/utils";
import type { FormState } from "../actions";
import type { ExpenseCategory } from "@prisma/client";

const initialState: FormState = {};

export function ExpenseRow({
  expense,
  categories,
  updateAction,
  removeAction,
}: {
  expense: { id: string; categoryId: string; categoryName: string; amount: string; description: string | null };
  categories: ExpenseCategory[];
  updateAction: (formData: FormData) => Promise<FormState>;
  removeAction: () => Promise<void>;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [state, formAction, pending] = useActionState(async (_prev: FormState, fd: FormData) => {
    return (await updateAction(fd)) ?? {};
  }, initialState);

  const [prevPending, setPrevPending] = useState(pending);
  if (pending !== prevPending) {
    setPrevPending(pending);
    if (submitted && !pending) {
      if (!state.error) setIsEditing(false);
      setSubmitted(false);
    }
  }

  return (
    <>
      <Tr>
        <Td colSpan={5}>
          {expense.categoryName}
          {expense.description && <span className="text-neutral-500"> — {expense.description}</span>}
        </Td>
        <Td className="text-right font-medium">{formatMoney(expense.amount)}</Td>
        <Td>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setIsEditing((v) => !v)}>
              {isEditing ? "Закрыть" : "Изменить"}
            </Button>
            <form
              action={removeAction}
              onSubmit={(e) => {
                if (!confirm(`Удалить расход «${expense.categoryName}» на ${formatMoney(expense.amount)}?`)) e.preventDefault();
              }}
            >
              <Button type="submit" variant="ghost" size="sm">
                Удалить
              </Button>
            </form>
          </div>
        </Td>
      </Tr>
      {isEditing && (
        <Tr>
          <Td colSpan={7} className="bg-neutral-50">
            <form
              action={formAction}
              onSubmit={() => setSubmitted(true)}
              className="grid grid-cols-5 items-end gap-2 py-2"
            >
              <div className="col-span-2">
                <label className="mb-1 block text-xs text-neutral-500">Статья расходов</label>
                <Select name="categoryId" required defaultValue={expense.categoryId}>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-neutral-500">Сумма, ₽</label>
                <Input name="amount" type="number" step="0.01" min="0" required defaultValue={expense.amount} />
              </div>
              <div className="col-span-2">
                <label className="mb-1 block text-xs text-neutral-500">Описание</label>
                <Input name="description" defaultValue={expense.description ?? ""} />
              </div>
              <div className="col-span-5 flex items-center justify-between gap-4">
                {state.error && <p className="text-sm text-red-600">{state.error}</p>}
                <Button type="submit" variant="outline" size="sm" disabled={pending}>
                  {pending ? "Сохраняем..." : "Сохранить"}
                </Button>
              </div>
            </form>
          </Td>
        </Tr>
      )}
    </>
  );
}
