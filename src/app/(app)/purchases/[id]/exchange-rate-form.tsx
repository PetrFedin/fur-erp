"use client";

import { useRef, useState, useTransition } from "react";
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
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      ref={formRef}
      onSubmit={(e) => {
        e.preventDefault();
        if (pending) return;
        const fd = new FormData(e.currentTarget);
        setError(null);
        startTransition(async () => {
          try {
            const res = await bound(fd);
            if (res?.error) setError(res.error);
          } catch {
            setError("Не удалось обновить курс: пропала связь или сервер отклонил запрос.");
          }
        });
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
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? "Обновляем..." : "Обновить курс"}
      </Button>
      <CbrRateButton currency={currency} defaultDate={orderDate} />
      {error && (
        <p role="alert" className="w-full rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
    </form>
  );
}
