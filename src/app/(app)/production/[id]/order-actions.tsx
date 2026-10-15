"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useConfirm } from "@/components/confirm-dialog";
import { formatMoney, formatQty } from "@/lib/utils";
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

export type CompleteCosts = {
  material: string;
  extra4: string;
  expenses: string;
  workPerUnit: string;
};

/** Оприходовать готовую продукцию: факт шт + приход на склад ГП + снимок себестоимости (скрытое действие в меню «⋯»). */
export function CompleteOrderForm({
  orderId,
  tzLabel,
  plannedQuantity,
  hasUsages,
  costs,
}: {
  orderId: string;
  tzLabel: string;
  plannedQuantity: string;
  hasUsages: boolean;
  costs: CompleteCosts;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const { ask, node } = useConfirm();
  const bound = completeProductionOrder.bind(null, orderId);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        const qty = Number(String(formData.get("producedQuantity") ?? "").replace(",", "."));
        const mat = Number(costs.material), ex4 = Number(costs.extra4), exp = Number(costs.expenses);
        const work = costs.workPerUnit ? Number(costs.workPerUnit) * qty : 0;
        const full = mat + ex4 + exp + work;
        const rub = (n: number) => formatMoney(Math.round(n));
        const ok = await ask(
          <div className="flex flex-col gap-2">
            <p className="font-medium">Оприходовать готовую продукцию по {tzLabel}?</p>
            {!hasUsages ? <p className="rounded-md bg-amber-50 px-2 py-1.5 text-amber-900">В ТЗ нет списаний сырья: продукция встанет на склад без стоимости сырья (только работа и расходы). Продолжайте, только если сырьё действительно не списывается (лоскут, давальческое).</p> : null}
            <ul className="list-disc pl-5 text-neutral-700">
              <li>Выпуск: <b>{qty} шт.</b> (план {formatQty(plannedQuantity)}); дата окончания: сегодня, {new Date().toLocaleDateString("ru-RU")}.</li>
              <li>
                Склад готовой продукции получит себестоимость <b>{rub(full)}</b>{qty > 0 ? <> (<b>{rub(full / qty)}</b> за шт.)</> : null}: сырьё и подкладка {rub(mat)} + 4 % {rub(ex4)} + расходы {rub(exp)} + работа {costs.workPerUnit ? rub(work) : "не указана"}.
              </li>
              <li>«В выпуске» и «На 1 изделие» на Главной, в партиях и «Изделиях» считаются как раньше — склад на них не влияет.</li>
              <li>Назад не вернуть, но списания, расходы, цену работы и факт править можно: склад готовой продукции пересчитается.</li>
            </ul>
          </div>,
          { ok: "Оприходовать", wide: true },
        );
        if (!ok) return;
        if (!hasUsages) formData.set("confirmNoUsages", "1");
        startTransition(async () => {
          const result = await bound(formData);
          setError(result.error ?? null);
        });
      }}
      className="flex flex-col gap-1.5"
      title="Факт, шт. и стоимость готовой продукции — в окне подтверждения"
    >
      <label className="px-2 text-xs text-neutral-500" htmlFor="completeQty">
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
        className="mx-2 h-8 w-24"
      />
      <Button type="submit" size="sm" variant="outline" disabled={pending} className="mx-2">
        {pending ? "Оприходуем..." : "Оприходовать готовую продукцию"}
      </Button>
      {error && <p className="px-2 text-sm text-red-600">{error}</p>}
      {node}
    </form>
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
