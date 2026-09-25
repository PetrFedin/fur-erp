"use client";

import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updatePurchaseExchangeRate } from "../actions";

export function ExchangeRateForm({
  purchaseId,
  currency,
  exchangeRate,
}: {
  purchaseId: string;
  currency: string;
  exchangeRate: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const bound = updatePurchaseExchangeRate.bind(null, purchaseId);

  return (
    <form ref={formRef} action={bound} className="flex items-end gap-2">
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
    </form>
  );
}
