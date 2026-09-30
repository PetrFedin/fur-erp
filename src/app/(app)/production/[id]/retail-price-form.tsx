"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateRetailPrice } from "../actions";

export function RetailPriceForm({ orderId, retailPrice }: { orderId: string; retailPrice: string }) {
  const bound = updateRetailPrice.bind(null, orderId);

  return (
    <form action={bound} className="flex flex-wrap items-center gap-2">
      <label className="text-sm text-neutral-600" htmlFor="retailPrice">
        Розничная цена за ед., ₽
      </label>
      <Input id="retailPrice" name="retailPrice" type="number" step="0.01" min="0" defaultValue={retailPrice} className="w-36" />
      <Button type="submit" variant="outline" size="sm">
        Сохранить
      </Button>
    </form>
  );
}
