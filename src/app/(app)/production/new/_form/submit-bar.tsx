"use client";
import { Button } from "@/components/ui/button";
import type { draftTotals } from "@/lib/tz-calc";
import { M } from "./parts";

/** Нижняя закреплённая панель: полная себестоимость и кнопки сохранения. */
export function SubmitBar({ multi, positions, T, pending }: { multi: boolean; positions: number; T: ReturnType<typeof draftTotals>; pending: boolean }) {
  return (
    <div className="sticky bottom-0 z-20 -mx-1 flex flex-wrap items-center gap-2 border-t border-neutral-200 bg-white px-1 py-2 max-md:mx-0 max-md:flex-col max-md:items-stretch">
      <div className="min-w-0 text-sm">
        {multi ? <span className="text-neutral-500">Позиций в ТЗ: {positions}</span> : <><span className="text-neutral-500">Полная себестоимость: </span>
        <b className="tabular-nums">{T.grandIncl4 > 0 ? <M incl={T.grandIncl4} excl={T.grandExcl4} /> : "–"}</b>
        {T.perUnitIncl4 != null && T.grandIncl4 > 0 && <span className="text-neutral-500"> · на 1 изд. <span className="tabular-nums"><M incl={T.perUnitIncl4} excl={T.perUnitExcl4 ?? 0} /></span></span>}</>}
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-2 max-md:ml-0 max-md:[&>button]:flex-1">
        <Button type="submit" name="intent" value="again" variant="outline" size="sm" disabled={pending}>Сохранить и добавить ещё</Button>
        <Button type="submit" name="intent" value="open" disabled={pending}>{pending ? "Сохраняем…" : "Сохранить ТЗ"}</Button>
      </div>
    </div>
  );
}
