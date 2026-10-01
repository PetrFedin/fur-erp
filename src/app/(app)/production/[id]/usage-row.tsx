"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Tr, Td } from "@/components/ui/table";
import { formatMoney, formatQty, formatDate } from "@/lib/utils";
import { Money } from "@/components/money";
import { CostBreakdownToggle } from "../../lots/cost-breakdown-toggle";
import type { FormState } from "../actions";

const initialState: FormState = {};

// Lot options for the edit dropdown must include lots with zero remaining
// stock too (unlike the add-usage form's picker): the usage's own current
// lot is very often fully consumed by this very usage, and it still has to
// appear pre-selected. updateMaterialUsage returns the old quantity to its
// lot before drawing the new one, so picking the same lot back is always
// valid regardless of what "remaining" shows here.
export type EditableLotOption = {
  id: string;
  lotNumber: string | null;
  grade: string | null;
  color: string | null;
  rawMaterialId: string;
  rawMaterialName: string;
  unit: string;
  quantityRemaining: string;
  unitCost: string;
};

const UNIT_LABELS: Record<string, string> = {
  PIECE: "шт.",
  KG: "кг",
  M2: "м²",
  M: "м",
  SET: "компл.",
};

export function UsageRow({
  usage,
  lots,
  updateAction,
  removeAction,
  readOnly = false,
}: {
  usage: {
    id: string;
    date: Date;
    rawMaterialName: string;
    lotId: string;
    lotNumber: string | null;
    quantity: string;
    unit: string;
    lotCostExclVat: string;
    lotVatRate: string;
    totalCost: string;
    totalCostExclVat: string;
    costBreakdown: unknown;
    lotUnitCostExcl: string;
    lotUnitCostIncl: string;
  };
  lots: EditableLotOption[];
  updateAction: (formData: FormData) => Promise<FormState>;
  removeAction: () => Promise<void>;
  /** No edit rights: hide the change/remove buttons. */
  readOnly?: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [state, formAction, pending] = useActionState(async (_prev: FormState, fd: FormData) => {
    return (await updateAction(fd)) ?? {};
  }, initialState);

  // Close the edit form once a submitted save comes back without an error —
  // same pattern as PurchaseItemRow.
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
        <Td title={`Списано ${formatDate(usage.date)}`}>{usage.lotNumber ?? "без номера"}</Td>
        <Td>{usage.rawMaterialName}</Td>
        <Td>
          {formatQty(usage.quantity)} {UNIT_LABELS[usage.unit] ?? usage.unit}
        </Td>
        <Td>{formatMoney(usage.lotCostExclVat)}</Td>
        <Td>{usage.lotVatRate}%</Td>
        <Td className="text-right font-medium">
          <Money incl={usage.totalCost} excl={usage.totalCostExclVat} />
          {usage.costBreakdown != null && (
            <CostBreakdownToggle
              breakdown={usage.costBreakdown as never}
              unitCostExcl={usage.lotUnitCostExcl}
              unitCostIncl={usage.lotUnitCostIncl}
            />
          )}
        </Td>
        <Td>
          {!readOnly && <div className="flex gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setIsEditing((v) => !v)}>
              {isEditing ? "Закрыть" : "Изменить"}
            </Button>
            <form
              action={removeAction}
              onSubmit={(e) => {
                if (!confirm(`Удалить списание: ${usage.rawMaterialName}, лот ${usage.lotNumber ?? "без номера"}, ${formatQty(usage.quantity)} ${UNIT_LABELS[usage.unit] ?? usage.unit}?`))
                  e.preventDefault();
              }}
            >
              <Button type="submit" variant="ghost" size="sm">
                Удалить
              </Button>
            </form>
          </div>}
        </Td>
      </Tr>
      {isEditing && !readOnly && (
        <Tr>
          <Td colSpan={7} className="bg-neutral-50">
            <form
              action={formAction}
              onSubmit={() => setSubmitted(true)}
              className="grid grid-cols-2 sm:grid-cols-4 items-end gap-2 py-2"
            >
              <div className="col-span-2">
                <label className="mb-1 block text-xs text-neutral-500">Лот</label>
                <Select name="lotId" required defaultValue={usage.lotId}>
                  {lots.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.rawMaterialName} — {l.lotNumber ?? "без номера"}
                      {[l.grade, l.color].filter(Boolean).length > 0
                        ? ` (${[l.grade, l.color].filter(Boolean).join(", ")})`
                        : ""}{" "}
                      — остаток {formatQty(l.quantityRemaining)} по {formatMoney(l.unitCost)}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-neutral-500">Количество</label>
                <Input name="quantity" type="number" step="0.001" min="0" required defaultValue={usage.quantity} />
              </div>
              <div className="flex items-center justify-between gap-4">
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
