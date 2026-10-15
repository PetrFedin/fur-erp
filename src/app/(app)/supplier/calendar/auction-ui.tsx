"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { auctionStatus, type AuctionMark } from "@/lib/auction-calendar";
import { deleteAuction, saveAuction, type AuctionState } from "./auction-actions";

const INPUT = "min-h-11 rounded-md border border-neutral-300 px-2 text-sm";

/** Форма отметки аукциона: дом (из справочника или свой), название, дата, место, комментарий, «планируем участвовать». */
export function AuctionForm({ houses, initial, onDone }: { houses: string[]; initial?: AuctionMark; onDone?: () => void }) {
  const router = useRouter();
  const ref = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState<AuctionState, FormData>(async (p, fd) => {
    const r = await saveAuction(p, fd);
    if (r.ok) { if (!initial) ref.current?.reset(); router.refresh(); onDone?.(); }
    return r;
  }, {});
  return (
    <form ref={ref} action={action} className="grid grid-cols-1 gap-3 rounded-md border border-neutral-300 bg-white p-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
      {initial && <input type="hidden" name="id" value={initial.id} />}
      <label className="flex flex-col gap-1">Аукционный дом
        <input name="house" list="auction-houses" maxLength={100} defaultValue={initial?.house} placeholder="Выберите или впишите свой" className={INPUT} autoComplete="off" />
      </label>
      <label className="flex flex-col gap-1">Название
        <input name="name" required maxLength={100} defaultValue={initial?.name} placeholder="Например, СП 12-26" className={INPUT} />
      </label>
      <label className="flex flex-col gap-1">Дата
        <input name="date" type="date" required defaultValue={initial?.date} className={INPUT} />
      </label>
      <label className="flex flex-col gap-1">Место
        <input name="place" maxLength={100} defaultValue={initial?.place} placeholder="Например, Санкт-Петербург" className={INPUT} />
      </label>
      <label className="flex flex-col gap-1 sm:col-span-2 lg:col-span-4">Комментарий
        <input name="notes" maxLength={1000} defaultValue={initial?.notes} className={INPUT} />
      </label>
      <label className="flex min-h-11 items-center gap-2 sm:col-span-2 lg:col-span-4">
        <input name="participate" type="checkbox" defaultChecked={initial?.participate} className="size-5" /> Планируем участвовать
      </label>
      <datalist id="auction-houses">{houses.map((h) => <option key={h} value={h} />)}</datalist>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-4">
        <Button type="submit" size="sm" disabled={pending}>{pending ? "Сохраняю…" : initial ? "Сохранить" : "Добавить аукцион"}</Button>
        {state.error && <span role="alert" className="text-red-700">{state.error}</span>}
        {state.ok && !initial && <span role="status" className="text-green-800">Добавлено, у нас видно в календаре</span>}
      </div>
    </form>
  );
}

/** Одна отметка в списке: статус, правка, удаление. */
export function AuctionRow({ mark, houses, today }: { mark: AuctionMark; houses: string[]; today: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [edit, setEdit] = useState(false);
  const [err, setErr] = useState("");
  const st = auctionStatus(mark.date, today);
  const remove = () => start(async () => { setErr(""); const r = await deleteAuction(mark.id); if (r.error) setErr(r.error); else router.refresh(); });
  return (
    <li className="flex flex-col gap-2 rounded-md border border-neutral-200 bg-white p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <b className="tabular-nums">{mark.date.split("-").reverse().join(".")}</b>
        <span>{[mark.name, mark.house, mark.place].filter(Boolean).join(" · ")}</span>
        <span className={`rounded-full border px-2 py-0.5 text-xs ${st === "прошёл" ? "border-neutral-300 bg-neutral-100 text-neutral-700" : "border-violet-300 bg-violet-50 text-violet-900"}`}>{st}{mark.participate && st === "запланирован" ? " · участвуем" : ""}</span>
        <span className="ml-auto flex gap-1">
          <Button type="button" size="sm" variant="outline" className="min-h-11" onClick={() => setEdit((x) => !x)}>{edit ? "Закрыть" : "Изменить"}</Button>
          <Button type="button" size="sm" variant="outline" className="min-h-11" disabled={pending} onClick={() => { if (window.confirm(`Удалить отметку «${mark.name}» от ${mark.date.split("-").reverse().join(".")}?`)) remove(); }}>Удалить</Button>
        </span>
      </div>
      {mark.notes && <p className="break-words text-xs text-neutral-700">{mark.notes}</p>}
      {err && <span role="alert" className="text-xs text-red-700">{err}</span>}
      {edit && <AuctionForm houses={houses} initial={mark} onDone={() => setEdit(false)} />}
    </li>
  );
}
