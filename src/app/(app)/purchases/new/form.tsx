"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import type { FormState } from "../actions";
import type { Supplier, Warehouse } from "@prisma/client";

const initialState: FormState = {};

export function PurchaseCreateForm({
  action,
  suppliers,
  warehouses,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  suppliers: Supplier[];
  warehouses: Warehouse[];
}) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const [currency, setCurrency] = useState("RUB");
  const today = new Date().toISOString().slice(0, 10);

  return (
    <form action={formAction} className="grid grid-cols-2 gap-4">
      <div className="col-span-2">
        <Label htmlFor="supplierId">Поставщик</Label>
        <Select id="supplierId" name="supplierId" required defaultValue="">
          <option value="" disabled>
            Выберите поставщика
          </option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="warehouseId">Склад поступления</Label>
        <Select id="warehouseId" name="warehouseId" required defaultValue={warehouses.find((w) => w.isDefault)?.id ?? ""}>
          <option value="" disabled>
            Выберите склад
          </option>
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="currency">Валюта позиций</Label>
        <Select
          id="currency"
          name="currency"
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
        >
          <option value="RUB">RUB — рубль</option>
          <option value="USD">USD — доллар</option>
          <option value="EUR">EUR — евро</option>
        </Select>
      </div>
      {currency !== "RUB" && (
        <div>
          <Label htmlFor="exchangeRate">Курс {currency} → RUB на дату сделки</Label>
          <Input
            id="exchangeRate"
            name="exchangeRate"
            type="number"
            step="0.0001"
            min="0"
            required
            placeholder="например, 79.75"
          />
        </div>
      )}
      <div>
        <Label htmlFor="orderDate">Дата заказа</Label>
        <Input id="orderDate" name="orderDate" type="date" defaultValue={today} required />
      </div>
      <div>
        <Label htmlFor="expectedDate">Ожидаемая дата поставки</Label>
        <Input id="expectedDate" name="expectedDate" type="date" />
      </div>

      <div className="col-span-2 mt-2 border-t border-neutral-200 pt-4">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-400">
          Аукцион / счёт / УПД (если закупка с пушного аукциона)
        </p>
      </div>
      <div>
        <Label htmlFor="auctionSession">Аукцион / сессия</Label>
        <Input id="auctionSession" name="auctionSession" placeholder="СП 05.25" />
      </div>
      <div>
        <Label htmlFor="invoiceNumber">№ счёта</Label>
        <Input id="invoiceNumber" name="invoiceNumber" placeholder="2004" />
      </div>
      <div className="col-span-2">
        <Label htmlFor="transferDocument">УПД</Label>
        <Input id="transferDocument" name="transferDocument" placeholder="№ 143 от 22.09.2025 г." />
      </div>

      <div className="col-span-2">
        <Label htmlFor="notes">Заметки</Label>
        <Textarea id="notes" name="notes" rows={2} />
      </div>
      {state.error && (
        <p className="col-span-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      )}
      <div className="col-span-2 flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Создаём..." : "Создать и перейти к позициям"}
        </Button>
      </div>
    </form>
  );
}
