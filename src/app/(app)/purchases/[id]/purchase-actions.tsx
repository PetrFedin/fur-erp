"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/confirm-dialog";
import { setPurchaseStatus, receivePurchase, cancelReceivedPurchase } from "../actions";

// Two states in the UI: draft -> accepted to stock. (ORDERED / IN_TRANSIT rows
// in the DB behave exactly like a draft here.) Accepting is irreversible, so
// it asks first; cancelling lives in the "⋯" menu.
export function PurchaseActions({
  purchaseId,
  status,
  canReceive = true,
  canCancel = true,
  hasCostPlan = false,
  cancelBlocker = null,
}: {
  purchaseId: string;
  status: string;
  canReceive?: boolean;
  canCancel?: boolean;
  /** В закупке есть позиции с расчётом: после приёмки расчёт заблокируется. */
  hasCostPlan?: boolean;
  /** Для принятой закупки: почему её нельзя отменить (null — можно). */
  cancelBlocker?: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const { ask, node } = useConfirm();

  if (status === "RECEIVED" && canCancel) {
    return (
      <div className="flex flex-col items-end gap-1">
        <Button
          variant="outline"
          size="sm"
          disabled={pending || !!cancelBlocker}
          title={cancelBlocker ?? "Ошибочно принятая закупка: лоты и приход на склад будут убраны, остатки и итоги пересчитаются"}
          onClick={async () => {
            if (!(await ask("Отменить принятую закупку? Её лоты и приход на склад будут удалены, остатки и итоги пересчитаются. Позиции закупки останутся, статус станет «Отменена». Действие нельзя быстро вернуть.", { ok: "Отменить закупку", danger: true, wide: true }))) return;
            startTransition(async () => {
              const result = await cancelReceivedPurchase(purchaseId);
              setError(result.error ?? null);
            });
          }}
        >
          {pending ? "Отменяем..." : "Отменить закупку"}
        </Button>
        {cancelBlocker && <p className="max-w-xs text-right text-xs text-neutral-500">Нельзя отменить: {cancelBlocker.charAt(0).toLowerCase() + cancelBlocker.slice(1).replace(/ — отмена невозможна$/, "")}</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}
        {node}
      </div>
    );
  }
  if (status === "RECEIVED" || status === "CANCELLED" || (!canReceive && !canCancel)) return null;

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        {canReceive && (
        <Button
          variant="default"
          size="sm"
          disabled={pending}
          title="Создаст лоты на складе; цену и количество можно менять, пока лот не использован"
          onClick={() => {
            if (
              !window.confirm(
                "Принять закупку на склад? Это создаст лоты. После приёмки цену и количество у позиции нельзя будет менять, если лот уже использован в ТЗ (лот, сорт и цвет остаются доступны)." +
                  (hasCostPlan
                    ? "\n\nВ закупке есть расчёт себестоимости: после приёмки расчёт лотов («Править расчёт», курс закупки) будет заблокирован."
                    : "")
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
        )}
        {canCancel && (
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
        )}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
