"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { PlanArticlePicker, type ArticleOption, type ArticleValue } from "@/components/plan-article-picker";
import { CALENDAR_ACTIONS } from "@/lib/calendar-actions";
import { createEvent, updateEvent, type EventFormState } from "./actions";
import { useKeepingForm } from "@/lib/use-keeping-form";

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
export type OrderOption = { id: string; label: string; fur: string | null; articleCode: string | null };
const KNOWN = CALENDAR_ACTIONS.map((a) => a.label);

export function EventForm({
  initial,
  models,
  seasons,
  plans,
  orders,
  canCreateArticle,
  stay = false,
  doneHref,
}: {
  initial: EventInitial;
  models: ArticleOption[];
  seasons: { id: string; code: string }[];
  plans: { id: string; label: string; seasonId: string | null; articleCode: string; modelId: string | null; articleName: string }[];
  orders: OrderOption[];
  canCreateArticle: boolean;
  /** Форма в раскрытом дне: после сохранения страница не уходит, а обновляется на месте. */
  stay?: boolean;
  /** Куда вернуться после сохранения правки (раскрытый день). */
  doneHref?: string;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(initial.id ? updateEvent : createEvent, init);
  const { setForm: keepRef, onSubmit: keepSubmit } = useKeepingForm(action, state, pending, stay && !initial.id);
  const [article, setArticle] = useState<ArticleValue>({ code: initial.articleCode, modelId: initial.modelId });
  const [articleName, setArticleName] = useState(initial.articleName);
  const [actionSel, setActionSel] = useState(KNOWN.includes(initial.action) || !initial.action ? initial.action || KNOWN[0] : "__custom");
  const [custom, setCustom] = useState(KNOWN.includes(initial.action) ? "" : initial.action);
  const [seasonId, setSeasonId] = useState(initial.seasonId);
  const [planId, setPlanId] = useState(initial.planId);
  const [date, setDate] = useState(initial.date);
  const [endDate, setEndDate] = useState(initial.endDate);
  const [period, setPeriod] = useState(Boolean(initial.endDate));
  const [orderId, setOrderId] = useState(initial.orderId);
  const [furSel, setFurSel] = useState(orders.find((o) => o.id === initial.orderId)?.fur ?? "");
  const furs = [...new Set(orders.map((o) => o.fur).filter((f): f is string => !!f))].sort((a, b) => a.localeCompare(b, "ru"));
  const shownOrders = furSel ? orders.filter((o) => o.fur === furSel || o.id === orderId) : orders;
  const onOrder = (id: string) => {
    setOrderId(id);
    const o = orders.find((x) => x.id === id);
    if (o) {
      if (o.fur) setFurSel(o.fur);
      const m = o.articleCode ? models.find((x) => x.name === o.articleCode) : undefined;
      if (o.articleCode && !article.code) setArticle({ code: o.articleCode, modelId: m?.id ?? null });
    }
  };
  // Успешно сохранено из раскрытого дня: правка возвращает к списку дня, добавление остаётся и очищает форму.
  useEffect(() => {
    if (state.ok && stay && initial.id && doneHref) router.push(doneHref);
  }, [state, stay, initial.id, doneHref, router]);

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

  const c2 = stay ? "" : "sm:col-span-2";
  const advanced = (
    <>
      <div>
        <Label htmlFor="ev-name">Название (необязательно)</Label>
        <Input id="ev-name" name="articleName" value={articleName} onChange={(e) => setArticleName(e.target.value)} maxLength={200} className="h-10" />
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
      <div className="flex items-end">
        <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" name="done" defaultChecked={initial.done} className="size-5" /> Выполнено</label>
      </div>
    </>
  );
  return (
    <form ref={keepRef} onSubmit={keepSubmit} className={stay ? "grid gap-3" : "grid gap-3 sm:grid-cols-2 lg:grid-cols-4"}>
      {stay && <input type="hidden" name="stay" value="1" />}
      {initial.id && <input type="hidden" name="id" value={initial.id} />}
      <input type="hidden" name="articleCode" value={article.code} />
      <input type="hidden" name="action" value={actionValue} />
      <div>
        <Label htmlFor="ev-action">Действие *</Label>
        <Select id="ev-action" value={actionSel} onChange={(e) => setActionSel(e.target.value)} className="h-10">
          {CALENDAR_ACTIONS.map((a) => <option key={a.label} value={a.label}>{a.label}</option>)}
          <option value="__custom">✎ Своё действие…</option>
        </Select>
        {actionSel === "__custom" && <Input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Впишите действие" maxLength={60} className="mt-2 h-10" aria-label="Своё действие" />}
      </div>
      <div className={stay ? "" : "sm:col-span-2 lg:col-span-1"}>
        <Label>Артикул *</Label>
        <PlanArticlePicker options={models} value={article} onChange={setArticle} canCreate={canCreateArticle} />
      </div>
      <div>
        <Label htmlFor="ev-qty">Количество, шт. *</Label>
        <Input id="ev-qty" name="quantity" type="number" inputMode="numeric" min={1} max={1000000} step={1} required defaultValue={initial.quantity} className="h-10" />
      </div>
      <div>
        <Label htmlFor="ev-date">Дата *</Label>
        <Input id="ev-date" name="date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} className="h-10" />
      </div>
      <div>
        <Label htmlFor="ev-fur">Мех (для выбора ТЗ)</Label>
        <Select id="ev-fur" value={furSel} onChange={(e) => { setFurSel(e.target.value); if (orderId && !orders.some((o) => o.id === orderId && (!e.target.value || o.fur === e.target.value))) setOrderId(""); }} className="h-10">
          <option value="">Любой мех</option>
          {furs.map((f) => <option key={f} value={f}>{f}</option>)}
        </Select>
      </div>
      <div>
        <Label htmlFor="ev-order">ТЗ (необязательно)</Label>
        <Select id="ev-order" name="orderId" value={orderId} onChange={(e) => onOrder(e.target.value)} className="h-10">
          <option value="">Не привязано</option>
          {shownOrders.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </Select>
      </div>
      <div className={c2}>
        <Label htmlFor="ev-notes">Заметка</Label>
        <Textarea id="ev-notes" name="notes" rows={2} maxLength={1000} defaultValue={initial.notes} />
      </div>
      {stay ? (
        <details className="rounded-md border border-neutral-200 p-2">
          <summary className="cursor-pointer select-none text-sm text-neutral-600">Дополнительно: название, период, сезон, позиция плана, выполнено</summary>
          <div className="mt-2 grid gap-3">{advanced}</div>
        </details>
      ) : advanced}
      {state.error && <p role="alert" className={`rounded-md bg-red-50 p-2 text-sm text-red-700 ${stay ? "" : "sm:col-span-2 lg:col-span-4"}`}>{state.error}</p>}
      {state.ok && stay && !initial.id && <p role="status" className="rounded-md bg-emerald-50 p-2 text-sm text-emerald-700">Событие добавлено.</p>}
      <div className={stay ? "" : "sm:col-span-2 lg:col-span-4"}>
        <Button type="submit" size="lg" disabled={pending} className={stay ? "w-full" : ""}>{pending ? "Сохраняем…" : initial.id ? "Сохранить" : stay ? "Сохранить" : "Добавить событие"}</Button>
      </div>
    </form>
  );
}
