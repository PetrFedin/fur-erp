"use client";

import Link from "next/link";
import { createContext, useActionState, useContext, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { VatInput } from "@/components/vat-input";
import { Tr, Td } from "@/components/ui/table";
import { RowCard, type RowField } from "@/components/responsive-rows";
import type { FormState, OrderRef } from "../actions";
import type { MaterialUnit } from "@prisma/client";
import { ColorSelect, type ColorSelectOption } from "@/components/color-select";
import { useKeepingForm } from "@/lib/use-keeping-form";

const initialState: FormState = {};

const UNIT_LABELS: Record<string, string> = {
  PIECE: "шт.",
  KG: "кг",
  M2: "м²",
  M: "м",
  SET: "компл.",
};

type MaterialOption = { id: string; name: string; unit: MaterialUnit };

type Shared = { colorOptions: ColorSelectOption[]; canAddColor: boolean; materials: MaterialOption[]; currency: string };
const SharedCtx = createContext<Shared | null>(null);

/**
 * Общие для всех строк закупки справочники (цвета, материалы, валюта) — передаём один раз на страницу.
 * Раньше список цветов уходил отдельным свойством в каждую строку (десятки строк × два вида = сотни копий в странице).
 */
export function ItemRowShared({ value, children }: { value: Shared; children: ReactNode }) {
  return <SharedCtx.Provider value={value}>{children}</SharedCtx.Provider>;
}

export function PurchaseItemRow({
  colSpan,
  children,
  removeAction,
  updateAction,
  canEditFinancials,
  lockedNote,
  lockedOrders,
  canEditMaterial,
  defaults,
  variant = "row",
  card,
}: {
  /** «card» — карточка для телефона: вместо ячеек (children) берутся поля card. */
  variant?: "row" | "card";
  card?: { title: ReactNode; subtitle?: ReactNode; fields: RowField[]; details?: RowField[]; extra?: ReactNode };
  colSpan: number;
  children: ReactNode;
  removeAction?: () => Promise<void>;
  updateAction?: (formData: FormData) => Promise<FormState>;
  canEditFinancials: boolean;
  lockedNote?: string;
  lockedOrders?: OrderRef[];
  canEditMaterial: boolean;
  defaults: {
    rawMaterialId: string;
    rawMaterialName: string;
    quantity: string;
    unitPrice: string;
    vatRate: string;
    lotNumber: string;
    grade: string;
    color: string;
    colorRefId: string;
    /** Версия записи на момент открытия (защита от тихой перезаписи чужой правки). */
    version?: string;
  };
}) {
  const { colorOptions, canAddColor, materials, currency } = useContext(SharedCtx) ?? { colorOptions: [], canAddColor: false, materials: [], currency: "RUB" };
  const [isEditing, setIsEditing] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [state, formAction, pending] = useActionState(async (_prev: FormState, fd: FormData) => {
    if (!updateAction) return {};
    return (await updateAction(fd)) ?? {};
  }, initialState);
  const { setForm: keepRef, onSubmit: keepSubmit } = useKeepingForm(formAction, state, pending);

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

  const actions = (updateAction || removeAction) && (
            <div className="flex gap-2">
              {updateAction && (
                <Button type="button" variant={variant === "card" ? "outline" : "ghost"} size="sm" className="max-md:h-10" onClick={() => setIsEditing((v) => !v)}>
                  {isEditing ? "Закрыть" : "Изменить"}
                </Button>
              )}
              {removeAction && (
                <form
                  action={removeAction}
                  onSubmit={(e) => {
                    if (!window.confirm("Удалить позицию из закупки?")) e.preventDefault();
                  }}
                >
                  <Button type="submit" variant={variant === "card" ? "outline" : "ghost"} size="sm" className="max-md:h-10">
                    Удалить
                  </Button>
                </form>
              )}
            </div>
  );
  const editForm = (
            <form
              ref={keepRef}
              onSubmit={(e) => { setSubmitted(true); keepSubmit(e); }}
              className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 items-end gap-2 py-2"
            >
              {defaults.version && <input type="hidden" name="_v" value={defaults.version} />}
              <div className="col-span-2">
                <label className="mb-1 block text-xs text-neutral-500">Материал</label>
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
                  <VatInput name="vatRate" defaultValue={defaults.vatRate} required />
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
                <ColorSelect refs={colorOptions} canCreate={canAddColor} defaultValue={defaults.color} defaultRefId={defaults.colorRefId} />
              </div>
              <div className="col-span-2 sm:col-span-4 lg:col-span-8 flex items-center justify-between gap-4">
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
  );
  if (variant === "card" && card) {
    return (
      <RowCard
        title={card.title}
        subtitle={card.subtitle}
        fields={card.fields}
        details={card.details}
        extra={
          (card.extra || actions || (isEditing && updateAction)) && (
            <div className="flex flex-col gap-2">
              {card.extra}
              {actions}
              {isEditing && updateAction && <div className="rounded-md bg-neutral-50 p-2">{editForm}</div>}
            </div>
          )
        }
      />
    );
  }

  return (
    <>
      <Tr>
        {children}
        {(updateAction || removeAction) && (
          <Td>{actions}</Td>
        )}
      </Tr>
      {isEditing && updateAction && (
        <Tr>
          <Td colSpan={colSpan} className="bg-neutral-50">
            {editForm}
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
