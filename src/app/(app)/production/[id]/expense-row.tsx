"use client";

import { useState, useTransition } from "react";
import { Tr, Td } from "@/components/ui/table";
import { formatMoney } from "@/lib/utils";
import { useConfirm } from "@/components/confirm-dialog";
import type { FormState } from "../actions";
import { DraftInput, SelectCell } from "./inline-cell";
import { DraftBar, useDraftEdit } from "./change-window";
import { useDirtyMark } from "./edit-guard";

/**
 * Строка расхода ТЗ: статья, описание и сумма копятся в строке, «Сохранить» (или Enter) открывает окно «что изменится».
 * Расходы не облагаются НДС и 4%.
 */
export function ExpenseRow({
  expense,
  orderId,
  categories,
  updateAction,
  removeAction,
  readOnly = false,
}: {
  orderId: string;
  expense: { id: string; categoryId: string; categoryName: string; amount: string; description: string | null };
  categories: { id: string; name: string }[];
  updateAction: (formData: FormData) => Promise<FormState>;
  removeAction: () => Promise<void>;
  readOnly?: boolean;
}) {
  const [busy, startBusy] = useTransition();
  const { ask, node } = useConfirm();
  const [cat, setCat] = useState(expense.categoryId);
  const [amount, setAmount] = useState(expense.amount);
  const [desc, setDesc] = useState(expense.description ?? "");
  const sig = `${expense.categoryId}|${expense.amount}|${expense.description ?? ""}`;
  const [seenSig, setSeenSig] = useState(sig);
  if (seenSig !== sig) {
    setSeenSig(sig);
    setCat(expense.categoryId);
    setAmount(expense.amount);
    setDesc(expense.description ?? "");
  }
  const ch = useDraftEdit(orderId);
  const amountNorm = amount.trim().replace(",", ".");
  const dirty = cat !== expense.categoryId || amountNorm !== expense.amount.trim() || desc.trim() !== (expense.description ?? "").trim();
  useDirtyMark(dirty);
  const cancel = () => { setCat(expense.categoryId); setAmount(expense.amount); setDesc(expense.description ?? ""); ch.setError(null); };
  const catName = (id: string) => categories.find((c) => c.id === id)?.name ?? "–";
  const save = async () => {
    if (!dirty || ch.busy) return;
    const fd = new FormData();
    fd.set("categoryId", cat);
    fd.set("amount", amountNorm);
    fd.set("description", desc.trim());
    const fields: { label: string; before: string; after: string }[] = [];
    if (cat !== expense.categoryId) fields.push({ label: "Статья", before: expense.categoryName, after: catName(cat) });
    if (amountNorm !== expense.amount.trim()) fields.push({ label: "Сумма", before: formatMoney(expense.amount), after: formatMoney(amountNorm) });
    if (desc.trim() !== (expense.description ?? "").trim()) fields.push({ label: "Описание", before: expense.description || "–", after: desc.trim() || "–" });
    await ch.run(
      `Изменить расход «${expense.categoryName}»`,
      { kind: "expense", expenseId: expense.id, categoryId: cat, amount: amountNorm, description: desc.trim() },
      fields,
      () => updateAction(fd),
    );
  };
  return (
    <Tr>
      <Td className="min-w-[13rem]">
        <SelectCell value={cat} label="Статья расходов" readOnly={readOnly} options={categories.map((c) => ({ value: c.id, label: c.name }))} onSave={async () => undefined} onPick={setCat} />
      </Td>
      <Td>
        <DraftInput type="text" value={expense.description ?? ""} draft={desc} onChange={setDesc} onEnter={save} onEscape={cancel} label="Описание" placeholder="описание" readOnly={readOnly} disabled={ch.busy} />
      </Td>
      <Td colSpan={4} className="text-xs text-neutral-400">без НДС и без 4 %</Td>
      <Td className="min-w-[8.5rem]">
        <DraftInput value={expense.amount} draft={amount} onChange={setAmount} onEnter={save} onEscape={cancel} step="0.01" min="0" align="right" label="Сумма" suffix="₽" readOnly={readOnly} disabled={ch.busy} />
        <DraftBar dirty={dirty} busy={ch.busy} error={ch.error} onSave={save} onCancel={cancel} />
        {ch.node}
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
