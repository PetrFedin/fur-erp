"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Tr, Td } from "@/components/ui/table";
import { RowCard } from "@/components/responsive-rows";
import { formatMoney } from "@/lib/utils";
import type { FormState } from "../actions";
import type { ExpenseCategory } from "@prisma/client";

const initialState: FormState = {};

export function ExpenseRow({
  expense,
  categories,
  updateAction,
  removeAction,
  readOnly = false,
  variant = "row",
}: {
  expense: { id: string; categoryId: string; categoryName: string; amount: string; description: string | null };
  categories: ExpenseCategory[];
  updateAction: (formData: FormData) => Promise<FormState>;
  removeAction: () => Promise<void>;
  /** No edit rights: hide the change/remove buttons. */
  readOnly?: boolean;
  /** «card» — карточка для телефона вместо строки таблицы. */
  variant?: "row" | "card";
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

  const actions = !readOnly && (
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
  );
  const editForm = (
            <form
              action={formAction}
              onSubmit={() => setSubmitted(true)}
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 items-end gap-2 py-2"
            >
              <div className="sm:col-span-2">
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
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs text-neutral-500">Описание</label>
                <Input name="description" defaultValue={expense.description ?? ""} />
              </div>
              <div className="sm:col-span-2 lg:col-span-5 flex items-center justify-between gap-4">
                {state.error && <p className="text-sm text-red-600">{state.error}</p>}
                <Button type="submit" variant="outline" size="sm" disabled={pending}>
                  {pending ? "Сохраняем..." : "Сохранить"}
                </Button>
              </div>
            </form>
  );
  if (variant === "card") {
    return (
      <RowCard
        title={expense.categoryName}
        subtitle={expense.description}
        fields={[{ label: "Сумма", value: formatMoney(expense.amount), strong: true }]}
        extra={
          !readOnly && (
            <div className="flex flex-col gap-2">
              {actions}
              {isEditing && <div className="rounded-md bg-neutral-50 p-2">{editForm}</div>}
            </div>
          )
        }
      />
    );
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
          {actions}
        </Td>
      </Tr>
      {isEditing && !readOnly && (
        <Tr>
          <Td colSpan={7} className="bg-neutral-50">
            {editForm}
          </Td>
        </Tr>
      )}
    </>
  );
}
