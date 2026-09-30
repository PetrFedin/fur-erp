"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { setPurchaseStatus, receivePurchase } from "../actions";

// Two states in the UI: draft -> accepted to stock. (ORDERED / IN_TRANSIT rows
// in the DB behave exactly like a draft here.) Accepting is irreversible, so
// it asks first; cancelling lives in the "⋯" menu.
export function PurchaseActions({ purchaseId, status }: { purchaseId: string; status: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (status === "RECEIVED" || status === "CANCELLED") return null;

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        <Button
          variant="default"
          size="sm"
          disabled={pending}
          title="Создаст лоты на складе; цену и количество потом менять нельзя"
          onClick={() => {
            if (
              !window.confirm(
                "Цену и количество потом менять нельзя. Принять?"
              )
            )
              return;
            startTransition(async () => {
              const result = await receivePurchase(purchaseId);
              setError(result.error ?? null);
            });
          }}
        >
          {pending ? "Принимаем..." : "Принять на склад"}
        </Button>
        <details className="relative">
          <summary className="cursor-pointer list-none rounded-md px-2 py-1 text-neutral-500 hover:bg-neutral-100">
            ⋯
          </summary>
          <div className="absolute right-0 z-10 mt-1 rounded-md border border-neutral-200 bg-white p-2 shadow-md">
            <Button
              variant="destructive"
              size="sm"
              disabled={pending}
              onClick={() => {
                if (!window.confirm("Отменить закупку? Позиции останутся, но принять её на склад будет нельзя.")) return;
                startTransition(() => setPurchaseStatus(purchaseId, "CANCELLED"));
              }}
            >
              Отменить закупку
            </Button>
          </div>
        </details>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
