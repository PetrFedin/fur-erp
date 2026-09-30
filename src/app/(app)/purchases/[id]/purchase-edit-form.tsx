"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import type { FormState } from "../actions";
import type { Supplier, Warehouse } from "@prisma/client";

const initialState: FormState = {};

export function PurchaseEditForm({
  action,
  suppliers,
  warehouses,
  defaults,
}: {
  action: (formData: FormData) => Promise<FormState>;
  suppliers: Supplier[];
  warehouses: Warehouse[];
  defaults: {
    supplierId: string;
    warehouseId: string;
    currency: string;
    orderDate: string;
    auctionSession: string;
    invoiceNumber: string;
    transferDocument: string;
  };
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [state, formAction, pending] = useActionState(async (_prev: FormState, fd: FormData) => {
    return (await action(fd)) ?? {};
  }, initialState);

  const [prevPending, setPrevPending] = useState(pending);
  if (pending !== prevPending) {
    setPrevPending(pending);
    if (submitted && !pending) {
      if (!state.error) setIsEditing(false);
      setSubmitted(false);
    }
  }

  if (!isEditing) {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={() => setIsEditing(true)}>
        Изменить
      </Button>
    );
  }

  return (
    <form
      action={formAction}
      onSubmit={() => setSubmitted(true)}
      className="mt-2 grid grid-cols-2 gap-3 rounded-md border border-neutral-200 bg-neutral-50 p-3"
    >
      {suppliers.length > 1 ? (
        <div className="col-span-2">
          <Label htmlFor="supplierId">Поставщик</Label>
          <Select id="supplierId" name="supplierId" required defaultValue={defaults.supplierId}>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </div>
      ) : (
        <input type="hidden" name="supplierId" value={defaults.supplierId} />
      )}
      {warehouses.length > 1 ? (
        <div>
          <Label htmlFor="warehouseId">Склад поступления</Label>
          <Select id="warehouseId" name="warehouseId" required defaultValue={defaults.warehouseId}>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </Select>
        </div>
      ) : (
        <input type="hidden" name="warehouseId" value={defaults.warehouseId} />
      )}
      <div>
        <Label htmlFor="currency">Валюта позиций</Label>
        <Select id="currency" name="currency" defaultValue={defaults.currency}>
          <option value="RUB">RUB — рубль</option>
          <option value="USD">USD — доллар</option>
          <option value="EUR">EUR — евро</option>
        </Select>
      </div>
      <div>
        <Label htmlFor="orderDate">Дата заказа</Label>
        <Input id="orderDate" name="orderDate" type="date" defaultValue={defaults.orderDate} required />
      </div>
      <div>
        <Label htmlFor="auctionSession">Аукцион / сессия</Label>
        <Input id="auctionSession" name="auctionSession" defaultValue={defaults.auctionSession} placeholder="СП 05.25" />
      </div>
      <div>
        <Label htmlFor="invoiceNumber">№ счёта</Label>
        <Input id="invoiceNumber" name="invoiceNumber" defaultValue={defaults.invoiceNumber} placeholder="2004" />
      </div>
      <div className="col-span-2">
        <Label htmlFor="transferDocument">УПД</Label>
        <Input
          id="transferDocument"
          name="transferDocument"
          defaultValue={defaults.transferDocument}
          placeholder="№ 143 от 22.09.2025 г."
        />
      </div>
      <p className="col-span-2 text-xs text-neutral-500">
        При смене валюты курс сбрасывается на 1 — обновите его ниже.
      </p>
      {state.error && <p className="col-span-2 text-sm text-red-600">{state.error}</p>}
      <div className="col-span-2 flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => setIsEditing(false)}>
          Отмена
        </Button>
        <Button type="submit" variant="outline" size="sm" disabled={pending}>
          {pending ? "Сохраняем..." : "Сохранить"}
        </Button>
      </div>
    </form>
  );
}
