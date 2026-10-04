"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { createSeason, updateSeasonDates, type PlanFormState } from "./actions";

const init: PlanFormState = {};
const iso = (d: Date | string | null) => (d ? new Date(d).toISOString().slice(0, 10) : "");

export function SeasonCreateForm({ hints }: { hints: { code: string; source: string }[] }) {
  const [state, action, pending] = useActionState(createSeason, init);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
      <div>
        <Label htmlFor="s-code">Код сезона</Label>
        <Input id="s-code" name="code" required maxLength={30} placeholder="FW26/27" list="season-hints" className="h-10" />
        <datalist id="season-hints">{hints.map((h) => <option key={h.code} value={h.code}>{h.source}</option>)}</datalist>
      </div>
      <div>
        <Label htmlFor="s-name">Название (необязательно)</Label>
        <Input id="s-name" name="name" maxLength={100} placeholder="Осень–зима 2026/27" className="h-10" />
      </div>
      <div>
        <Label htmlFor="s-start">С даты</Label>
        <Input id="s-start" name="startDate" type="date" className="h-10" />
      </div>
      <div>
        <Label htmlFor="s-end">По дату</Label>
        <Input id="s-end" name="endDate" type="date" className="h-10" />
      </div>
      <Button type="submit" disabled={pending} className="h-10">{pending ? "Создаём…" : "+ Создать сезон"}</Button>
      {state.error && <p role="alert" className="text-sm text-red-600 sm:col-span-2 lg:col-span-5">{state.error}</p>}
      {state.ok && <p className="text-sm text-emerald-700 sm:col-span-2 lg:col-span-5">{state.ok}</p>}
      {hints.length > 0 && (
        <p className="text-xs text-neutral-500 sm:col-span-2 lg:col-span-5">
          Подсказки по документам (сами не создаются): {hints.map((h) => `${h.code} — ${h.source}`).join("; ")}.
        </p>
      )}
    </form>
  );
}

export function SeasonEditForm({ season }: { season: { id: string; code: string; name: string | null; startDate: Date | string | null; endDate: Date | string | null } }) {
  const [state, action, pending] = useActionState(updateSeasonDates, init);
  return (
    <form action={action} className="grid grid-cols-2 items-end gap-2 sm:grid-cols-[8rem_1fr_9rem_9rem_auto]">
      <input type="hidden" name="id" value={season.id} />
      <div className="col-span-2 flex items-center sm:col-span-1"><span className="font-semibold">{season.code}</span></div>
      <Input name="name" defaultValue={season.name ?? ""} placeholder="Название" maxLength={100} aria-label="Название сезона" className="col-span-2 h-9 sm:col-span-1" />
      <Input name="startDate" type="date" defaultValue={iso(season.startDate)} aria-label="Начало сезона" className="h-9" />
      <Input name="endDate" type="date" defaultValue={iso(season.endDate)} aria-label="Конец сезона" className="h-9" />
      <Button type="submit" variant="outline" size="sm" disabled={pending} className="col-span-2 sm:col-span-1">{pending ? "…" : "Сохранить"}</Button>
      {state.error && <p role="alert" className="col-span-2 text-xs text-red-600 sm:col-span-5">{state.error}</p>}
      {state.ok && <p className="col-span-2 text-xs text-emerald-700 sm:col-span-5">{state.ok}</p>}
    </form>
  );
}
