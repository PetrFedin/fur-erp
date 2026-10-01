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
          const raw = String(formData.get("retailPrice") ?? "").replace(/[\s\u00a0]/g, "").replace(",", ".");
          const n = Number(raw);
          const msg = raw === "" ? "Введите цену" : !Number.isFinite(n) ? "Цена: укажите число" : n < 0 ? "Цена не может быть отрицательной" : n === 0 ? "Цена должна быть больше 0" : null;
          if (msg) {
            setError(msg);
            return;
          }
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
        type="text"
        inputMode="decimal"
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
