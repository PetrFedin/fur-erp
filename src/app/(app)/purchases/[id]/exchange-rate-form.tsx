"use client";

import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updatePurchaseExchangeRate } from "../actions";
import { CbrRateButton } from "../cbr-rate-button";

export function ExchangeRateForm({
  purchaseId,
  currency,
  exchangeRate,
  orderDate,
}: {
  purchaseId: string;
  currency: string;
  exchangeRate: string;
  /** Дата закупки «ГГГГ-ММ-ДД» — дата курса ЦБ по умолчанию. */
  orderDate?: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const bound = updatePurchaseExchangeRate.bind(null, purchaseId);

  return (
    <form
      ref={formRef}
      action={async (formData) => {
        const res = await bound(formData);
        if (res?.error) window.alert(res.error);
      }}
      className="flex flex-wrap items-end gap-2"
    >
      <div>
        <label className="mb-1 block text-xs text-neutral-500">Курс {currency} → RUB</label>
        <Input
          name="exchangeRate"
          type="number"
          step="0.0001"
          min="0"
          defaultValue={exchangeRate}
          className="w-32"
        />
      </div>
      <Button type="submit" variant="outline" size="sm">
        Обновить курс
      </Button>
      <CbrRateButton currency={currency} defaultDate={orderDate} />
    </form>
  );
}
