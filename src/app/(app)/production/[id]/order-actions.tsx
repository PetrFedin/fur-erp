"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { applyBomToOrder, completeProductionOrder, cancelProductionOrder } from "../actions";

export function ApplyBomButton({ orderId }: { orderId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await applyBomToOrder(orderId);
            setError(result.error ?? null);
          })
        }
      >
        {pending ? "Списываем..." : "Списать по норме (BOM)"}
      </Button>
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
    </div>
  );
}

export function CompleteOrderForm({
  orderId,
  plannedQuantity,
  warehouseName,
}: {
  orderId: string;
  plannedQuantity: string;
  warehouseName: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const bound = completeProductionOrder.bind(null, orderId);

  return (
    <form
      action={(formData) =>
        startTransition(async () => {
          const result = await bound(formData);
          setError(result.error ?? null);
        })
      }
      className="flex flex-wrap items-center gap-2"
      title={`Себестоимость фиксируется, готовая продукция принимается на склад «${warehouseName}»`}
    >
      <label className="text-xs text-neutral-500" htmlFor="completeQty">
        Факт, шт.
      </label>
      <Input
        id="completeQty"
        name="producedQuantity"
        type="number"
        step="1"
        min="1"
        defaultValue={plannedQuantity}
        required
        className="w-20"
      />
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Завершаем..." : "Завершить"}
      </Button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </form>
  );
}

export function CancelOrderButton({ orderId }: { orderId: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="destructive"
      size="sm"
      disabled={pending}
      onClick={() => {
        if (confirm("Отменить заказ? Это действие нельзя отменить.")) startTransition(() => cancelProductionOrder(orderId));
      }}
    >
      Отменить заказ
    </Button>
  );
}
