"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/confirm-dialog";

/** Кнопка «Удалить» оплаты закупки: спрашивает подтверждение окном приложения, потом вызывает server action. */
export function PaymentDeleteButton({ action, amountLabel }: { action: () => Promise<void>; amountLabel: string }) {
  const { ask, node } = useConfirm();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  return (
    <div>
      {node}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="max-md:h-10"
        disabled={pending}
        onClick={async () => {
          if (!(await ask(`Удалить оплату ${amountLabel}? Это изменит «Оплачено» и остаток закупки.`, { ok: "Удалить", danger: true }))) return;
          setError("");
          start(async () => {
            try {
              await action();
            } catch {
              setError("Не удалось удалить. Попробуйте ещё раз.");
            }
          });
        }}
      >
        Удалить
      </Button>
      {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
