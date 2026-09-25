"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateSellingPrice } from "../models/actions";

export function ArticlePriceForm({ modelId, sellingPrice }: { modelId: string; sellingPrice: string }) {
  const bound = updateSellingPrice.bind(null, modelId);

  return (
    <form action={bound} className="flex items-center gap-1">
      <Input
        name="sellingPrice"
        type="number"
        step="0.01"
        min="0"
        defaultValue={sellingPrice}
        className="h-8 w-28"
      />
      <Button type="submit" variant="outline" size="sm">
        OK
      </Button>
    </form>
  );
}
