"use client";

import { useTransition } from "react";
import { Tr, Td } from "@/components/ui/table";
import { formatMoney } from "@/lib/utils";
import { useConfirm } from "@/components/confirm-dialog";
import type { FormState } from "../actions";
import { SelectCell, TextCell } from "./inline-cell";

/**
 * Строка расхода ТЗ в таблице «Расчёт и списание»: статья, описание и сумма правятся по месту (Enter / уход фокуса).
 * Расходы не облагаются НДС и 4%.
 */
export function ExpenseRow({
  expense,
  categories,
  updateAction,
  removeAction,
  readOnly = false,
}: {
  expense: { id: string; categoryId: string; categoryName: string; amount: string; description: string | null };
  categories: { id: string; name: string }[];
  updateAction: (formData: FormData) => Promise<FormState>;
  removeAction: () => Promise<void>;
  readOnly?: boolean;
}) {
  const [busy, startBusy] = useTransition();
  const { ask, node } = useConfirm();
  const build = (patch: { categoryId?: string; amount?: string; description?: string }) => {
    const fd = new FormData();
    fd.set("categoryId", patch.categoryId ?? expense.categoryId);
    fd.set("amount", patch.amount ?? expense.amount);
    fd.set("description", patch.description ?? expense.description ?? "");
    return fd;
  };
  return (
    <Tr>
      <Td className="min-w-[13rem]">
        <SelectCell value={expense.categoryId} label="Статья расходов" readOnly={readOnly} options={categories.map((c) => ({ value: c.id, label: c.name }))} onSave={(v) => updateAction(build({ categoryId: v }))} />
      </Td>
      <Td>
        <TextCell value={expense.description ?? ""} label="Описание" placeholder="описание" readOnly={readOnly} onSave={(v) => updateAction(build({ description: v }))} />
      </Td>
      <Td colSpan={4} className="text-xs text-neutral-400">без НДС и без 4%</Td>
      <Td className="min-w-[8.5rem]">
        <TextCell value={expense.amount} type="number" step="0.01" min="0" align="right" label="Сумма" suffix="₽" readOnly={readOnly} onSave={(v) => updateAction(build({ amount: v }))} />
      </Td>
      <Td className="w-8 text-center">
        {!readOnly && (
          <>
            <button
              type="button"
              disabled={busy}
              aria-label="Удалить расход"
              title="Удалить расход"
              className="rounded px-1.5 py-0.5 text-neutral-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
              onClick={async () => {
                if (!(await ask(`Удалить расход «${expense.categoryName}» на ${formatMoney(expense.amount)}?`, { ok: "Удалить", danger: true }))) return;
                startBusy(async () => {
                  await removeAction();
                });
              }}
            >
              ×
            </button>
            {node}
          </>
        )}
      </Td>
    </Tr>
  );
}
