"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { PlanArticlePicker, type ArticleOption, type ArticleValue } from "@/components/plan-article-picker";
import { CALENDAR_ACTIONS } from "@/lib/calendar-actions";
import { createEvent, updateEvent, type EventFormState } from "./actions";

export type EventInitial = {
  id?: string;
  articleCode: string;
  modelId: string | null;
  articleName: string;
  quantity: string;
  date: string;
  endDate: string;
  action: string;
  seasonId: string;
  planId: string;
  orderId: string;
  notes: string;
  done: boolean;
};

const init: EventFormState = {};
const KNOWN = CALENDAR_ACTIONS.map((a) => a.label);

export function EventForm({
  initial,
  models,
  seasons,
  plans,
  orders,
  canCreateArticle,
}: {
  initial: EventInitial;
  models: ArticleOption[];
  seasons: { id: string; code: string }[];
  plans: { id: string; label: string; seasonId: string | null; articleCode: string; modelId: string | null; articleName: string }[];
  orders: { id: string; label: string }[];
  canCreateArticle: boolean;
}) {
  const [state, action, pending] = useActionState(initial.id ? updateEvent : createEvent, init);
  const [article, setArticle] = useState<ArticleValue>({ code: initial.articleCode, modelId: initial.modelId });
  const [articleName, setArticleName] = useState(initial.articleName);
  const [actionSel, setActionSel] = useState(KNOWN.includes(initial.action) || !initial.action ? initial.action || KNOWN[0] : "__custom");
  const [custom, setCustom] = useState(KNOWN.includes(initial.action) ? "" : initial.action);
  const [seasonId, setSeasonId] = useState(initial.seasonId);
  const [planId, setPlanId] = useState(initial.planId);
  const [date, setDate] = useState(initial.date);
  const [endDate, setEndDate] = useState(initial.endDate);
  const [period, setPeriod] = useState(Boolean(initial.endDate));

  const onPlan = (id: string) => {
    setPlanId(id);
    const p = plans.find((x) => x.id === id);
    if (p) {
      setArticle({ code: p.articleCode, modelId: p.modelId });
      if (p.articleName) setArticleName(p.articleName);
      if (p.seasonId) setSeasonId(p.seasonId);
    }
  };
  const actionValue = actionSel === "__custom" ? custom : actionSel;

  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {initial.id && <input type="hidden" name="id" value={initial.id} />}
      <input type="hidden" name="articleCode" value={article.code} />
      <input type="hidden" name="action" value={actionValue} />
      <div className="sm:col-span-2 lg:col-span-1">
        <Label>Артикул *</Label>
        <PlanArticlePicker options={models} value={article} onChange={setArticle} canCreate={canCreateArticle} />
      </div>
      <div>
        <Label htmlFor="ev-name">Название (необязательно)</Label>
        <Input id="ev-name" name="articleName" value={articleName} onChange={(e) => setArticleName(e.target.value)} maxLength={200} className="h-10" />
      </div>
      <div>
        <Label htmlFor="ev-qty">Количество, шт. *</Label>
        <Input id="ev-qty" name="quantity" type="number" inputMode="numeric" min={1} max={1000000} step={1} required defaultValue={initial.quantity} className="h-10" />
      </div>
      <div>
        <Label htmlFor="ev-action">Действие *</Label>
        <Select id="ev-action" value={actionSel} onChange={(e) => setActionSel(e.target.value)} className="h-10">
          {CALENDAR_ACTIONS.map((a) => <option key={a.label} value={a.label}>{a.label}</option>)}
          <option value="__custom">✎ Своё действие…</option>
        </Select>
        {actionSel === "__custom" && <Input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Впишите действие" maxLength={60} className="mt-2 h-10" aria-label="Своё действие" />}
      </div>
      <div>
        <Label htmlFor="ev-date">Дата *</Label>
        <Input id="ev-date" name="date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} className="h-10" />
      </div>
      <div>
        <Label className="flex items-center gap-2">
          <input type="checkbox" checked={period} onChange={(e) => { setPeriod(e.target.checked); if (!e.target.checked) setEndDate(""); }} className="size-4" /> Период (по дату)
        </Label>
        <Input name="endDate" type="date" value={endDate} min={date || undefined} onChange={(e) => setEndDate(e.target.value)} disabled={!period} className="h-10" aria-label="Дата по" />
      </div>
      <div>
        <Label htmlFor="ev-season">Сезон</Label>
        <Select id="ev-season" name="seasonId" value={seasonId} onChange={(e) => setSeasonId(e.target.value)} className="h-10">
          <option value="">Без сезона</option>
          {seasons.map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}
        </Select>
      </div>
      <div>
        <Label htmlFor="ev-plan">Позиция плана</Label>
        <Select id="ev-plan" name="planId" value={planId} onChange={(e) => onPlan(e.target.value)} className="h-10">
          <option value="">Не привязано</option>
          {plans.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </Select>
      </div>
      <div>
        <Label htmlFor="ev-order">ТЗ</Label>
        <Select id="ev-order" name="orderId" defaultValue={initial.orderId} className="h-10">
          <option value="">Не привязано</option>
          {orders.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </Select>
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor="ev-notes">Заметка</Label>
        <Textarea id="ev-notes" name="notes" rows={2} maxLength={1000} defaultValue={initial.notes} />
      </div>
      <div className="flex items-end">
        <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" name="done" defaultChecked={initial.done} className="size-5" /> Выполнено</label>
      </div>
      {state.error && <p role="alert" className="rounded-md bg-red-50 p-2 text-sm text-red-700 sm:col-span-2 lg:col-span-4">{state.error}</p>}
      <div className="sm:col-span-2 lg:col-span-4">
        <Button type="submit" size="lg" disabled={pending}>{pending ? "Сохраняем…" : initial.id ? "Сохранить" : "Добавить событие"}</Button>
      </div>
    </form>
  );
}
