"use client";

import Link from "next/link";
import { useActionState, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Tr, Td } from "@/components/ui/table";
import type { FormState, OrderRef } from "../actions";
import type { MaterialUnit } from "@prisma/client";

const initialState: FormState = {};

const UNIT_LABELS: Record<string, string> = {
  PIECE: "шт.",
  KG: "кг",
  M2: "м²",
  M: "м",
  SET: "компл.",
};

type MaterialOption = { id: string; name: string; unit: MaterialUnit };

export function PurchaseItemRow({
  colSpan,
  children,
  removeAction,
  updateAction,
  canEditFinancials,
  lockedNote,
  lockedOrders,
  canEditMaterial,
  materials,
  currency,
  defaults,
}: {
  colSpan: number;
  children: ReactNode;
  removeAction?: () => Promise<void>;
  updateAction?: (formData: FormData) => Promise<FormState>;
  canEditFinancials: boolean;
  lockedNote?: string;
  lockedOrders?: OrderRef[];
  canEditMaterial: boolean;
  materials: MaterialOption[];
  currency: string;
  defaults: {
    rawMaterialId: string;
    rawMaterialName: string;
    quantity: string;
    unitPrice: string;
    vatRate: string;
    lotNumber: string;
    grade: string;
    color: string;
  };
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [state, formAction, pending] = useActionState(async (_prev: FormState, fd: FormData) => {
    if (!updateAction) return {};
    return (await updateAction(fd)) ?? {};
  }, initialState);

  // Close the edit form once a submitted save comes back without an error —
  // adjusting state during render (rather than in an effect) so this doesn't
  // cost an extra commit. See https://react.dev/learn/you-might-not-need-an-effect.
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
        {children}
        {(updateAction || removeAction) && (
          <Td>
            <div className="flex gap-2">
              {updateAction && (
                <Button type="button" variant="ghost" size="sm" onClick={() => setIsEditing((v) => !v)}>
                  {isEditing ? "Отмена" : "Изменить"}
                </Button>
              )}
              {removeAction && (
                <form
                  action={removeAction}
                  onSubmit={(e) => {
                    if (!window.confirm("Удалить позицию из закупки?")) e.preventDefault();
                  }}
                >
                  <Button type="submit" variant="ghost" size="sm">
                    Удалить
                  </Button>
                </form>
              )}
            </div>
          </Td>
        )}
      </Tr>
      {isEditing && updateAction && (
        <Tr>
          <Td colSpan={colSpan} className="bg-neutral-50">
            <form
              action={formAction}
              onSubmit={() => setSubmitted(true)}
              className="grid grid-cols-8 items-end gap-2 py-2"
            >
              <div className="col-span-2">
                <label className="mb-1 block text-xs text-neutral-500">Сырьё</label>
                {canEditMaterial ? (
                  <Select name="rawMaterialId" required defaultValue={defaults.rawMaterialId}>
                    {materials.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} ({UNIT_LABELS[m.unit]})
                      </option>
                    ))}
                  </Select>
                ) : (
                  <>
                    <input type="hidden" name="rawMaterialId" value={defaults.rawMaterialId} />
                    <div className="flex h-9 items-center text-sm text-neutral-500">{defaults.rawMaterialName}</div>
                  </>
                )}
              </div>
              <div>
                <label className="mb-1 block text-xs text-neutral-500">Кол-во</label>
                <Input
                  name="quantity"
                  type="number"
                  step="0.001"
                  min="0"
                  required
                  readOnly={!canEditFinancials}
                  defaultValue={defaults.quantity}
                  className={!canEditFinancials ? "bg-neutral-100 text-neutral-400" : undefined}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-neutral-500">Цена за ед., {currency} (без НДС)</label>
                <Input
                  name="unitPrice"
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  readOnly={!canEditFinancials}
                  defaultValue={defaults.unitPrice}
                  className={!canEditFinancials ? "bg-neutral-100 text-neutral-400" : undefined}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-neutral-500">НДС</label>
                {canEditFinancials ? (
                  <Select name="vatRate" defaultValue={defaults.vatRate}>
                    <option value="0">0%</option>
                    <option value="5">5%</option>
                    <option value="7">7%</option>
                    <option value="10">10%</option>
                    <option value="20">20%</option>
                    <option value="22">22%</option>
                  </Select>
                ) : (
                  <>
                    <input type="hidden" name="vatRate" value={defaults.vatRate} />
                    <div className="flex h-9 items-center text-sm text-neutral-500">{defaults.vatRate}%</div>
                  </>
                )}
              </div>
              <div>
                <label className="mb-1 block text-xs text-neutral-500">Лот (если есть)</label>
                <Input name="lotNumber" defaultValue={defaults.lotNumber} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-neutral-500">Сорт</label>
                <Input name="grade" defaultValue={defaults.grade} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-neutral-500">Цвет</label>
                <Input name="color" defaultValue={defaults.color} />
              </div>
              <div className="col-span-8 flex items-center justify-between gap-4">
                <div>
                  {!canEditFinancials && lockedNote && (
                    <p className="text-xs text-amber-600">
                      {lockedNote}
                      <OrderLinks orders={lockedOrders} />
                    </p>
                  )}
                  {state.error && (
                    <p className="text-sm text-red-600">
                      {state.error}
                      <OrderLinks orders={state.orders} />
                    </p>
                  )}
                </div>
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

function OrderLinks({ orders }: { orders?: OrderRef[] }) {
  if (!orders || orders.length === 0) return null;
  return (
    <span className="ml-1">
      {orders.map((o, i) => (
        <span key={o.id}>
          {i > 0 && ", "}
          <Link href={`/production/${o.id}`} className="underline">
            {o.number}
          </Link>
        </span>
      ))}
    </span>
  );
}
