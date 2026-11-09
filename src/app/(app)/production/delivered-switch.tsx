"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { markOrdersDelivered } from "./actions";

/**
 * Переключатель «Поставлен» в таблице ТЗ: серый — изделия ещё не пришли, оранжевый — пришла часть (у ТЗ с несколькими артикулами), зелёный — поставлен.
 * Включение оформляет приход готовой продукции по плановому количеству ещё не поставленных позиций (как «Завершить ТЗ»); поставленное выключить нельзя.
 * ids — только позиции, которые ещё не поставлены.
 */
export function DeliveredSwitch({ ids, state, canEdit, units, label, note }: { ids: string[]; state: "off" | "partial" | "on"; canEdit: boolean; units: number; label: string; note?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const locked = ids.length === 0 || !canEdit || pending;
  const word = state === "on" ? "Поставлен" : state === "partial" ? "Поставлен частично" : "Не поставлен";
  const title = note ?? (state === "on" ? "Поставлен: продукция оприходована на склад готовой" : canEdit && ids.length ? `${word}. Включите, когда изделия пришли: продукция встанет на склад готовой` : word);

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
        aria-checked={state === "on" ? true : state === "partial" ? "mixed" : false}
        aria-label={`${label}: ${word.toLowerCase()}`}
        title={title}
        disabled={locked}
        onClick={toggle}
        className={"inline-flex min-h-11 min-w-11 items-center justify-center rounded-full disabled:cursor-default " + (pending ? "opacity-60" : "")}
      >
        <span className={"relative inline-block h-6 w-10 rounded-full transition-colors " + (state === "on" ? "bg-green-700" : state === "partial" ? "bg-orange-500" : "bg-neutral-300")}>
          <span className={"absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all " + (state === "on" ? "left-[1.125rem]" : state === "partial" ? "left-[0.6875rem]" : "left-0.5")} />
        </span>
        <span className="sr-only">{word}</span>
      </button>
      {error && <span role="alert" className="max-w-[14rem] text-xs text-red-700">{error}</span>}
    </span>
  );
}
