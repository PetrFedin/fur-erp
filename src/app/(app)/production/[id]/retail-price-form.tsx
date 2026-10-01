"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateRetailPrice } from "../actions";

export function RetailPriceForm({ orderId, retailPrice }: { orderId: string; retailPrice: string }) {
  const bound = updateRetailPrice.bind(null, orderId);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      action={(formData) =>
        startTransition(async () => {
          const result = await bound(formData);
          setError(result.error ?? null);
        })
      }
      className="flex flex-wrap items-center gap-2"
    >
      <label className="text-sm text-neutral-600" htmlFor="retailPrice">
        Розничная цена за ед., ₽
      </label>
      <Input
        id="retailPrice"
        name="retailPrice"
        type="number"
        step="0.01"
        min="0.01"
        defaultValue={retailPrice}
        className="w-36"
      />
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? "Сохраняем..." : "Сохранить"}
      </Button>
      {error && <span className="text-sm text-red-600">{error}</span>}
    </form>
  );
}
