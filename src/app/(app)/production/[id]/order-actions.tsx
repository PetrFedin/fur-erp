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
        {pending ? "Списываем..." : "Списать по составу"}
      </Button>
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
    </div>
  );
}

export function CompleteOrderForm({
  orderId,
  plannedQuantity,
  warehouseName,
  hasUsages,
}: {
  orderId: string;
  plannedQuantity: string;
  warehouseName: string;
  /** No write-offs yet -> completion is refused (zero-cost finished goods). */
  hasUsages: boolean;
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
      onSubmit={(e) => {
        const qty = (e.currentTarget.elements.namedItem("producedQuantity") as HTMLInputElement | null)?.value ?? "";
        if (
          !confirm(
            `Завершить ТЗ? Готовая продукция (${qty} шт.) придёт на склад «${warehouseName}», себестоимость зафиксируется. Действие нельзя откатить.`
          )
        ) {
          e.preventDefault();
        }
      }}
      className="flex flex-wrap items-center gap-2"
      title={
        hasUsages
          ? `Себестоимость фиксируется, готовая продукция принимается на склад «${warehouseName}»`
          : "Сначала спишите сырьё: без списаний продукция встанет на склад с нулевой себестоимостью"
      }
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
      <Button
        type="submit"
        size="sm"
        disabled={pending || !hasUsages}
        title={hasUsages ? undefined : "Нельзя завершить ТЗ без списаний сырья — сначала спишите сырьё"}
      >
        {pending ? "Завершаем..." : "Завершить"}
      </Button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </form>
  );
}

export function CancelOrderButton({ orderId, blockedReason }: { orderId: string; blockedReason?: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-1">
      <Button
        variant="destructive"
        size="sm"
        disabled={pending || Boolean(blockedReason)}
        title={blockedReason}
        onClick={() => {
          if (confirm("Отменить ТЗ? Это действие нельзя отменить."))
            startTransition(async () => {
              const result = await cancelProductionOrder(orderId);
              setError(result.error ?? null);
            });
        }}
      >
        Отменить ТЗ
      </Button>
      {blockedReason && <p className="max-w-56 text-xs text-neutral-500">{blockedReason}</p>}
      {error && <p className="max-w-56 text-xs text-red-600">{error}</p>}
    </div>
  );
}
