"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/confirm-dialog";
import { applyBomToOrder, cancelProductionOrder } from "../actions";

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

export function CancelOrderButton({ orderId, blockedReason }: { orderId: string; blockedReason?: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const { ask, node } = useConfirm();
  return (
    <div className="flex flex-col gap-1">
      {node}
      <Button
        variant="destructive"
        size="sm"
        disabled={pending || Boolean(blockedReason)}
        title={blockedReason ?? "ТЗ не удаляется: отмена оставляет его в списке со статусом «Отменено»"}
        onClick={async () => {
          if (!(await ask("Отменить ТЗ? Само ТЗ удалить нельзя — оно останется в списке со статусом «Отменено» (так сохраняется история). Вернуть ТЗ в работу будет нельзя.", { ok: "Отменить ТЗ", danger: true, wide: true }))) return;
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
