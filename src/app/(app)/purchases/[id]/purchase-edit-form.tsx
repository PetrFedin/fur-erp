"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import type { FormState } from "../actions";
import type { Supplier } from "@prisma/client";
import { useKeepingForm } from "@/lib/use-keeping-form";
import { AuctionSelect, type AuctionSelectOption } from "@/components/auction-select";

const initialState: FormState = {};

export function PurchaseEditForm({
  action,
  suppliers,
  defaults,
  currencyLocked = false,
  version,
  auctions,
  canCreateAuction = false,
  receivedMode = false,
}: {
  /** Принятая закупка: поставщик и валюта не меняются (лоты уже посчитаны), правятся дата, аукцион, № счёта и УПД. */
  receivedMode?: boolean;
  auctions: AuctionSelectOption[];
  canCreateAuction?: boolean;
  currencyLocked?: boolean;
  /** Версия записи на момент открытия формы (защита от тихой перезаписи чужой правки). */
  version?: string;
  action: (formData: FormData) => Promise<FormState>;
  suppliers: Supplier[];
  defaults: {
    supplierId: string;
    warehouseId: string;
    currency: string;
    orderDate: string;
    auctionSession: string;
    auctionId: string | null;
    invoiceNumber: string;
    invoiceDate: string;
    transferDocument: string;
    notes: string;
  };
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [state, formAction, pending] = useActionState(async (_prev: FormState, fd: FormData) => {
    return (await action(fd)) ?? {};
  }, initialState);
  const { setForm: keepRef, onSubmit: keepSubmit } = useKeepingForm(formAction, state, pending);

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
      ref={keepRef}
      onSubmit={(e) => { setSubmitted(true); keepSubmit(e); }}
      className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-md border border-neutral-200 bg-neutral-50 p-3"
    >
      {version && <input type="hidden" name="_v" value={version} />}
      {receivedMode ? (
        <>
          <input type="hidden" name="supplierId" value={defaults.supplierId} />
          <input type="hidden" name="warehouseId" value={defaults.warehouseId} />
          <input type="hidden" name="currency" value={defaults.currency} />
        </>
      ) : suppliers.length > 1 ? (
        <div className="sm:col-span-2">
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
      {!receivedMode && (<div>
        <Label htmlFor="currency">Валюта позиций</Label>
        {currencyLocked && <input type="hidden" name="currency" value={defaults.currency} />}
        <Select id="currency" name={currencyLocked ? undefined : "currency"} defaultValue={defaults.currency} disabled={currencyLocked}>
          <option value="RUB">RUB — рубль</option>
          <option value="USD">USD — доллар</option>
          <option value="EUR">EUR — евро</option>
        </Select>
      </div>)}
      <div>
        <Label htmlFor="orderDate">Дата заказа</Label>
        <Input id="orderDate" name="orderDate" type="date" defaultValue={defaults.orderDate} required />
      </div>
      <div>
        <Label htmlFor="auctionSession">Аукцион / сессия</Label>
        <AuctionSelect id="auctionSession" refs={auctions} defaultId={defaults.auctionId} legacyText={defaults.auctionId ? "" : defaults.auctionSession.split(/\r?\n/)[0]} canCreate={canCreateAuction} />
      </div>
      <div>
        <Label htmlFor="invoiceNumber">№ счёта</Label>
        <Input id="invoiceNumber" name="invoiceNumber" defaultValue={defaults.invoiceNumber} placeholder="2004" />
      </div>
      <div>
        <Label htmlFor="invoiceDate">Дата счёта</Label>
        <Input id="invoiceDate" name="invoiceDate" type="date" defaultValue={defaults.invoiceDate} />
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor="transferDocument">УПД</Label>
        <Input
          id="transferDocument"
          name="transferDocument"
          defaultValue={defaults.transferDocument}
          placeholder="№ 143 от 22.09.2025 г."
        />
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor="notes">Примечание</Label>
        <p className="mb-1 text-xs text-neutral-500">Примечание не сбрасывает подтверждение</p>
        <Textarea id="notes" name="notes" rows={4} maxLength={4000} defaultValue={defaults.notes} />
      </div>
      <p className="sm:col-span-2 text-xs text-neutral-500">
        {receivedMode
          ? "Закупка принята на склад: поставщик, валюта и курс не меняются — лоты уже посчитаны. Правятся дата, аукцион, № счёта, дата счёта, УПД и примечание; подтверждение закупки сбросится (кроме правки одного примечания)."
          : currencyLocked
          ? "Валюта и курс не меняются: в закупке есть позиции с расчётом из расчётного листа."
          : "При смене валюты курс сбрасывается на 1 — обновите его ниже."}
      </p>
      {state.error && <p className="sm:col-span-2 text-sm text-red-600">{state.error}</p>}
      <div className="sm:col-span-2 flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => setIsEditing(false)}>
          Закрыть
        </Button>
        <Button type="submit" variant="outline" size="sm" disabled={pending}>
          {pending ? "Сохраняем..." : "Сохранить"}
        </Button>
      </div>
    </form>
  );
}
