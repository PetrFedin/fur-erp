"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { markOrdersDelivered } from "./actions";

/**
 * Переключатель «Поставлен» в таблице ТЗ. Выключен — изделия ещё не пришли (ТЗ в работе у подрядчика).
 * Включение оформляет приход готовой продукции по плановому количеству (как «Завершить ТЗ»); поставленное выключить нельзя.
 */
export function DeliveredSwitch({ ids, on, canEdit, units, label }: { ids: string[]; on: boolean; canEdit: boolean; units: number; label: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const locked = on || !canEdit || pending;
  const title = on ? "Поставлен: продукция оприходована на склад готовой" : canEdit ? "Ещё не поставлен. Включите, когда изделия пришли: продукция встанет на склад готовой" : "Ещё не поставлен";

  const toggle = () => {
    if (locked) return;
    if (!window.confirm(`${label}: оформить поставку? ${units} шт. встанут на склад готовой продукции, себестоимость зафиксируется. Отменить это переключателем нельзя.`)) return;
    setError(null);
    start(async () => {
      let r = await markOrdersDelivered(ids, false);
      if (r.error?.includes("нет списаний") && window.confirm("В ТЗ нет списаний сырья: продукция встанет без стоимости сырья. Всё равно оформить?")) r = await markOrdersDelivered(ids, true);
      if (r.error) setError(r.error);
      else router.refresh();
    });
  };

  return (
    <span className="inline-flex flex-col items-start px-3 py-1">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={`${label}: поставлен`}
        title={title}
        disabled={locked}
        aria-disabled={locked}
        onClick={toggle}
        className={"inline-flex min-h-11 min-w-11 items-center justify-center rounded-full disabled:cursor-default " + (pending ? "opacity-60" : "")}
      >
        <span className={"relative inline-block h-6 w-10 rounded-full transition-colors " + (on ? "bg-green-700" : "bg-neutral-300")}>
          <span className={"absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all " + (on ? "left-[1.125rem]" : "left-0.5")} />
        </span>
        <span className="sr-only">{on ? "Поставлен" : "Не поставлен"}</span>
      </button>
      {error && <span role="alert" className="max-w-[14rem] text-xs text-red-700">{error}</span>}
    </span>
  );
}
