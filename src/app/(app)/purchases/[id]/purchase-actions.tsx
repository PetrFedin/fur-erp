"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { setPurchaseStatus, receivePurchase } from "../actions";

export function PurchaseActions({ purchaseId, status }: { purchaseId: string; status: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (status === "RECEIVED" || status === "CANCELLED") return null;

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap gap-2">
        {status === "DRAFT" && (
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => startTransition(() => setPurchaseStatus(purchaseId, "ORDERED"))}
          >
            Отметить «Заказано»
          </Button>
        )}
        {(status === "DRAFT" || status === "ORDERED") && (
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => startTransition(() => setPurchaseStatus(purchaseId, "IN_TRANSIT"))}
          >
            Отметить «В пути»
          </Button>
        )}
        <Button
          variant="default"
          size="sm"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await receivePurchase(purchaseId);
              setError(result.error ?? null);
            })
          }
        >
          {pending ? "Оприходуем..." : "Оприходовать на склад"}
        </Button>
        <Button
          variant="destructive"
          size="sm"
          disabled={pending}
          onClick={() => startTransition(() => setPurchaseStatus(purchaseId, "CANCELLED"))}
        >
          Отменить
        </Button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
