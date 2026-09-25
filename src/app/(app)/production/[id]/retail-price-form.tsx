"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateRetailPrice } from "../actions";

export function RetailPriceForm({ orderId, retailPrice }: { orderId: string; retailPrice: string }) {
  const bound = updateRetailPrice.bind(null, orderId);

  return (
    <form action={bound} className="flex items-end gap-2">
      <div>
        <label className="mb-1 block text-xs text-neutral-500">Розничная цена за ед., ₽</label>
        <Input name="retailPrice" type="number" step="0.01" min="0" defaultValue={retailPrice} className="w-40" />
      </div>
      <Button type="submit" variant="outline" size="sm">
        Сохранить
      </Button>
    </form>
  );
}
