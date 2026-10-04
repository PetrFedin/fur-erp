import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { ACCESS, hasRole } from "@/lib/access";
import { cleanSearch, escapeLike } from "@/lib/input";
import { getYearFilter, yearRange } from "@/lib/year-filter";
import { YearNote } from "@/components/year-note";
import { formatQty } from "@/lib/utils";
import { modelCodeVariants, compareModelNames } from "@/lib/model-code";
import { actionDef, CALENDAR_ACTIONS, LAYER_STYLES } from "@/lib/calendar-actions";
import { addDays, dayLabel, fmtRu, monthGridDays, monthTitle, parseMonth, parseYmd, shiftMonth, startOfWeek, todayYmd, WEEKDAYS, ymd } from "@/lib/calendar-grid";
import { loadFactLayer, type FactItem } from "@/lib/calendar-layers";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { ProductionTabs } from "@/components/production-tabs";
import { InfoHint } from "@/components/info-hint";
import { EventForm, type EventInitial } from "./event-form";
import { toggleDone, deleteEvent } from "./actions";
import { ConfirmButton } from "../plan/confirm-button";

export const metadata = { title: "Производственный календарь" };

type Ev = {
  id: string;
  date: string;
  endDate: string | null;
  articleCode: string;
  quantity: number;
  action: string;
  done: boolean;
  overdue: boolean;
  seasonCode: string | null;
};

export default async function CalendarPage({ searchParams }: PageProps<"/calendar">) {
  const session = await requireSession();
  const orgId = session.user.organizationId;
  const canEdit = hasRole(session.user.role, ACCESS.planning);
  const year = await getYearFilter();
  const sp = await searchParams;
  const today = todayYmd();

  const view = ["month", "week", "list"].includes(cleanSearch(sp.view, 8)) ? cleanSearch(sp.view, 8) : "month";
  let month = parseMonth(cleanSearch(sp.m, 7)) ?? today.slice(0, 7);
  if (!parseMonth(cleanSearch(sp.m, 7)) && year !== "all" && month.slice(0, 4) !== year) month = `${year}-01`;
  const weekStartParam = /^\d{4}-\d{2}-\d{2}$/.test(cleanSearch(sp.w, 10)) ? cleanSearch(sp.w, 10) : "";
  const weekStart = startOfWeek(weekStartParam || (today.startsWith(month) ? today : `${month}-01`));
  const seasonF = cleanSearch(sp.season, 40);
  const actionF = cleanSearch(sp.action, 60);
  const articleF = cleanSearch(sp.article, 100);
  const layersOn = cleanSearch(sp.layers, 2) !== "0";
  const eventId = cleanSearch(sp.event, 40);
  const newDate = /^\d{4}-\d{2}-\d{2}$/.test(cleanSearch(sp.new, 10)) ? cleanSearch(sp.new, 10) : "";

  const days = view === "week" ? Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)) : monthGridDays(month);
  const from = days[0];
  const to = days[days.length - 1];

  const yr = yearRange(year);
  const [seasons, models, plans, orderOptions] = await Promise.all([
    prisma.season.findMany({ where: { organizationId: orgId }, orderBy: [{ startDate: "desc" }, { code: "asc" }] }),
    prisma.productModel.findMany({ where: { organizationId: orgId, isActive: true }, select: { id: true, name: true, category: true, salesCode: true, salesName: true, aliases: true } }),
    prisma.productionPlan.findMany({ where: { organizationId: orgId }, select: { id: true, seasonId: true, articleCode: true, articleName: true, modelId: true, color: true, season: { select: { code: true } } }, orderBy: { createdAt: "desc" }, take: 300 }),
    prisma.productionOrder.findMany({ where: { organizationId: orgId, status: { not: "CANCELLED" } }, select: { id: true, workOrderNumber: true, number: true, productModel: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 300 }),
  ]);
  models.sort((a, b) => compareModelNames(a.name, b.name));

  const events = await prisma.calendarEvent.findMany({
    where: {
      organizationId: orgId,
      AND: [
        { date: { lte: parseYmd(to) } },
        { OR: [{ endDate: { gte: parseYmd(from) } }, { endDate: null, date: { gte: parseYmd(from) } }] },
        ...(yr ? [{ date: yr }] : []),
      ],
      ...(seasonF === "none" ? { seasonId: null } : seasonF ? { seasonId: seasonF } : {}),
      ...(actionF ? { action: { equals: actionF, mode: "insensitive" as const } } : {}),
      ...(articleF ? { OR: modelCodeVariants(articleF).map((v) => ({ articleCode: { contains: escapeLike(v), mode: "insensitive" as const } })) } : {}),
    },
    include: { season: { select: { code: true } } },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
  });
  const evs: Ev[] = events.map((e) => ({
    id: e.id,
    date: ymd(e.date),
    endDate: e.endDate ? ymd(e.endDate) : null,
    articleCode: e.articleCode,
    quantity: e.quantity,
    action: e.action,
    done: !!e.doneAt,
    overdue: !e.doneAt && (e.endDate ? ymd(e.endDate) : ymd(e.date)) < today,
    seasonCode: e.season?.code ?? null,
  }));

  // Слой фактов — только когда нет фильтров по сезону/действию (у фактов их нет).
  const factsHidden = !layersOn || Boolean(seasonF || actionF);
  const layer = factsHidden
    ? { items: [] as FactItem[], monthLevel: [] }
    : await loadFactLayer(orgId, from, to, { article: articleF, month });
  const factsByDay = new Map<string, FactItem[]>();
  for (const f of layer.items) factsByDay.set(f.date, [...(factsByDay.get(f.date) ?? []), f]);

  const evByDay = new Map<string, Ev[]>();
  for (const e of evs) {
    const last = e.endDate && e.endDate > e.date ? e.endDate : e.date;
    for (let d = e.date < from ? from : e.date; d <= last && d <= to; d = addDays(d, 1)) evByDay.set(d, [...(evByDay.get(d) ?? []), e]);
  }
  const dayTotal = (d: string) => (evByDay.get(d) ?? []).filter((e) => e.date === d).reduce((s, e) => s + e.quantity, 0);

  // Итоги периода по действиям: учитываем событие один раз — в день начала.
  const inPeriod = (d: string) => (view === "week" ? d >= days[0] && d <= days[6] : d.startsWith(month));
  const byAction = new Map<string, number>();
  for (const e of evs) if (inPeriod(e.date)) byAction.set(e.action, (byAction.get(e.action) ?? 0) + e.quantity);
  const periodTotal = [...byAction.values()].reduce((a, b) => a + b, 0);
  const overdueCount = evs.filter((e) => e.overdue).length;

  // Выбранное событие / новая форма
  const selected = eventId ? await prisma.calendarEvent.findFirst({ where: { id: eventId, organizationId: orgId }, include: { season: { select: { code: true } }, plan: { select: { id: true, articleCode: true } } } }) : null;
  const editInitial: EventInitial | null = selected
    ? { id: selected.id, articleCode: selected.articleCode, modelId: models.find((m) => m.name === selected.articleCode)?.id ?? null, articleName: selected.articleName ?? "", quantity: String(selected.quantity), date: ymd(selected.date), endDate: selected.endDate ? ymd(selected.endDate) : "", action: selected.action, seasonId: selected.seasonId ?? "", planId: selected.planId ?? "", orderId: selected.orderId ?? "", notes: selected.notes ?? "", done: !!selected.doneAt }
    : null;
  const newInitial: EventInitial = { articleCode: "", modelId: null, articleName: "", quantity: "", date: newDate || (today.startsWith(month) ? today : `${month}-01`), endDate: "", action: CALENDAR_ACTIONS[0].label, seasonId: seasonF && seasonF !== "none" ? seasonF : "", planId: "", orderId: "", notes: "", done: false };

  const params = { view, m: month, w: view === "week" ? weekStart : "", season: seasonF, action: actionF, article: articleF, layers: layersOn ? "" : "0" };
  const href = (patch: Record<string, string>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...params, ...patch })) if (v) p.set(k, v);
    const s = p.toString();
    return `/calendar${s ? `?${s}` : ""}`;
  };
  const evHref = (id: string) => href({ event: id });
  const prev = view === "week" ? href({ w: addDays(weekStart, -7), m: addDays(weekStart, -7).slice(0, 7), event: "", new: "" }) : href({ m: shiftMonth(month, -1), event: "", new: "" });
  const next = view === "week" ? href({ w: addDays(weekStart, 7), m: addDays(weekStart, 7).slice(0, 7), event: "", new: "" }) : href({ m: shiftMonth(month, 1), event: "", new: "" });
  const title = view === "week" ? `${fmtRu(days[0])} — ${fmtRu(days[6])}` : monthTitle(month);
  const pill = (a: boolean) => "rounded-md border px-3 py-1 text-sm max-md:inline-flex max-md:min-h-8 max-md:items-center " + (a ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 text-neutral-700 hover:bg-neutral-100");

  const chip = (e: Ev, dayIso: string) => {
    const def = actionDef(e.action);
    const cont = e.date !== dayIso;
    return (
      <Link key={e.id + dayIso} href={evHref(e.id)} title={`${e.articleCode} × ${e.quantity} — ${e.action}${e.done ? " (выполнено)" : ""}`}
        className={`block truncate rounded border px-1.5 py-0.5 text-xs leading-tight ${def.chip} ${e.done ? "opacity-60 line-through" : ""} ${e.overdue ? "ring-1 ring-red-500" : ""} ${selected?.id === e.id ? "outline outline-2 outline-neutral-900" : ""}`}>
        {cont ? "↳ " : ""}{e.articleCode} ×{e.quantity} · {e.action}
      </Link>
    );
  };
  const factChip = (f: FactItem) => {
    const st = LAYER_STYLES[f.kind];
    return (
      <Link key={f.id} href={f.href} title={`${st.label}: ${f.title}${f.qty != null ? ` × ${f.qty}` : ""} — ${f.label}`} className={`block truncate rounded border px-1.5 py-0.5 text-xs leading-tight ${st.chip}`}>
        {f.title}{f.qty != null ? ` ×${f.qty}` : ""} · {f.label}
      </Link>
    );
  };
  const dayBlock = (d: string, compact: boolean) => {
    const list = evByDay.get(d) ?? [];
    const facts = factsByDay.get(d) ?? [];
    const lim = compact ? 3 : 99;
    const items = [...list.map((e) => ({ k: "e" as const, e })), ...facts.map((f) => ({ k: "f" as const, f }))];
    return (
      <>
        {items.slice(0, lim).map((it) => (it.k === "e" ? chip(it.e, d) : factChip(it.f)))}
        {items.length > lim && <Link href={href({ view: "list" })} className="block text-xs text-neutral-500 hover:underline">+ ещё {items.length - lim}</Link>}
      </>
    );
  };

  const inMonthDays = view === "month" || view === "list" ? days.filter((d) => d.startsWith(month)) : days;
  const listDays = (view === "list" ? inMonthDays.filter((d) => (evByDay.get(d)?.length ?? 0) + (factsByDay.get(d)?.length ?? 0) > 0) : days);
  const weeks: string[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));

  const hasFilters = Boolean(seasonF || actionF || articleF);
  const planLabel = (p: (typeof plans)[number]) => `${p.articleCode}${p.color ? ` · ${p.color}` : ""}${p.season ? ` · ${p.season.code}` : ""}`;

  return (
    <div className="flex flex-col gap-4">
      <ProductionTabs active="calendar" />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">
          Производственный календарь<YearNote year={year} />{" "}
          <InfoHint wide>
            Здесь ваши события: артикул × количество, дата и действие (раскрой, пошив, сдача скорняку…). Серые пунктирные ярлыки — факты из других разделов (план поставок, отгрузки, примерки, окончание ТЗ); они только для просмотра, клик ведёт в свою карточку.
            Красная рамка — дата прошла, а событие не отмечено выполненным. Итоги считаются по событиям один раз, в день начала. Общий год из шапки скрывает события других годов.
          </InfoHint>
        </h1>
        <div className="flex flex-wrap gap-2">
          <Link href="/plan" className={buttonVariants({ variant: "outline" })}>План заказа</Link>
          <Link href="/supply-plan" className={buttonVariants({ variant: "outline" })}>План поставок</Link>
        </div>
      </div>

      {canEdit && (
        <Card id="event">
          <details open={Boolean(newDate || selected)}>
            <summary className="cursor-pointer select-none p-4 text-sm font-semibold">{selected ? "Событие: правка" : "+ Новое событие"}</summary>
            <CardContent>
              {selected && editInitial ? (
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Badge className={actionDef(selected.action).chip}>{selected.action}</Badge>
                    {selected.doneAt ? <Badge variant="success">выполнено</Badge> : ymd(selected.endDate ?? selected.date) < today ? <Badge variant="danger">просрочено</Badge> : <Badge variant="info">в плане</Badge>}
                    {selected.season && <Badge>{selected.season.code}</Badge>}
                    {selected.orderId && <Link href={`/production/${selected.orderId}`} className="text-blue-600 hover:underline">ТЗ</Link>}
                    {selected.plan && <Link href={`/plan?season=${selected.seasonId ?? ""}`} className="text-blue-600 hover:underline">позиция плана {selected.plan.articleCode}</Link>}
                    <form action={toggleDone}><input type="hidden" name="id" value={selected.id} /><button type="submit" className={buttonVariants({ variant: "outline", size: "sm" })}>{selected.doneAt ? "Вернуть в план" : "Отметить выполненным"}</button></form>
                    <form action={deleteEvent}><input type="hidden" name="id" value={selected.id} /><ConfirmButton message="Удалить событие?" className={buttonVariants({ variant: "outline", size: "sm", className: "text-red-600" })}>Удалить</ConfirmButton></form>
                    <Link href={href({ event: "" })} className="text-neutral-500 hover:underline">Закрыть</Link>
                  </div>
                  <EventForm key={selected.id} initial={editInitial} models={models} seasons={seasons.map((s) => ({ id: s.id, code: s.code }))} plans={plans.map((p) => ({ id: p.id, label: planLabel(p), seasonId: p.seasonId, articleCode: p.articleCode, modelId: p.modelId, articleName: p.articleName ?? "" }))} orders={orderOptions.map((o) => ({ id: o.id, label: `${o.workOrderNumber ? `ТЗ №${o.workOrderNumber} (${o.number})` : o.number} · ${o.productModel.name}` }))} canCreateArticle={hasRole(session.user.role, ACCESS.models)} />
                </div>
              ) : (
                <EventForm key={`new-${newInitial.date}`} initial={newInitial} models={models} seasons={seasons.map((s) => ({ id: s.id, code: s.code }))} plans={plans.map((p) => ({ id: p.id, label: planLabel(p), seasonId: p.seasonId, articleCode: p.articleCode, modelId: p.modelId, articleName: p.articleName ?? "" }))} orders={orderOptions.map((o) => ({ id: o.id, label: `${o.workOrderNumber ? `ТЗ №${o.workOrderNumber} (${o.number})` : o.number} · ${o.productModel.name}` }))} canCreateArticle={hasRole(session.user.role, ACCESS.models)} />
              )}
            </CardContent>
          </details>
        </Card>
      )}
      {!canEdit && selected && (
        <Card>
          <CardHeader><CardTitle>{selected.articleCode} × {selected.quantity} — {selected.action}</CardTitle></CardHeader>
          <CardContent className="text-sm text-neutral-600">
            {fmtRu(ymd(selected.date))}{selected.endDate ? ` — ${fmtRu(ymd(selected.endDate))}` : ""} · {selected.doneAt ? "выполнено" : "в плане"}{selected.notes ? ` · ${selected.notes}` : ""}{" "}
            <Link href={href({ event: "" })} className="text-neutral-500 hover:underline">Закрыть</Link>
          </CardContent>
        </Card>
      )}

      {/* Навигация */}
      <div className="flex flex-wrap items-center gap-2">
        <Link href={prev} className={buttonVariants({ variant: "outline", size: "icon" })} aria-label="Назад">‹</Link>
        <h2 className="min-w-44 text-center text-lg font-semibold">{title}</h2>
        <Link href={next} className={buttonVariants({ variant: "outline", size: "icon" })} aria-label="Вперёд">›</Link>
        <Link href={href({ m: today.slice(0, 7), w: "", event: "", new: "" })} className={buttonVariants({ variant: "outline" })}>Сегодня</Link>
        <span className="ml-auto flex gap-1" role="group" aria-label="Вид">
          {([["month", "Месяц"], ["week", "Неделя"], ["list", "Список"]] as const).map(([v, t]) => (
            <Link key={v} href={href({ view: v, w: v === "week" ? weekStart : "" })} className={pill(view === v)} aria-current={view === v ? "page" : undefined}>{t}</Link>
          ))}
        </span>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="view" value={view} />
        <input type="hidden" name="m" value={month} />
        {view === "week" && <input type="hidden" name="w" value={weekStart} />}
        <Select name="season" defaultValue={seasonF} className="h-10 w-full sm:w-44" aria-label="Сезон">
          <option value="">Все сезоны</option>
          <option value="none">Без сезона</option>
          {seasons.map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}
        </Select>
        <Select name="action" defaultValue={actionF} className="h-10 w-full sm:w-52" aria-label="Действие">
          <option value="">Все действия</option>
          {CALENDAR_ACTIONS.map((a) => <option key={a.label} value={a.label}>{a.label}</option>)}
        </Select>
        <Input name="article" defaultValue={articleF} placeholder="Артикул" className="h-10 w-full sm:w-44" />
        <Select name="layers" defaultValue={layersOn ? "1" : "0"} className="h-10 w-full sm:w-72" aria-label="Факты">
          <option value="1">Показывать факты из ТЗ, отгрузок, примерок</option>
          <option value="0">Только мои события</option>
        </Select>
        <button type="submit" className={buttonVariants({ variant: "outline", className: "h-10" })}>Применить</button>
        {(hasFilters || !layersOn) && <Link href={href({ season: "", action: "", article: "", layers: "" })} className="text-sm text-neutral-500 hover:underline">Сбросить</Link>}
      </form>
      {layersOn && (seasonF || actionF) && <p className="text-xs text-neutral-500">Факты из других разделов скрыты: у них нет сезона и действия из этого списка.</p>}

      {/* Итоги */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-medium text-neutral-700">Итого за {view === "week" ? "неделю" : "месяц"}: {formatQty(periodTotal)} шт.</span>
        {[...byAction.entries()].map(([a, q]) => (
          <span key={a} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${actionDef(a).chip}`}>{a}: {formatQty(q)}</span>
        ))}
        {overdueCount > 0 && <Badge variant="danger">просрочено: {overdueCount}</Badge>}
        {periodTotal === 0 && <span className="text-neutral-500">Событий нет{year !== "all" ? ` (год ${year})` : ""}.</span>}
      </div>
      <div className="flex flex-wrap gap-2 text-xs text-neutral-500">
        {CALENDAR_ACTIONS.map((a) => <span key={a.label} className="inline-flex items-center gap-1"><i className={`size-2 rounded-full ${a.dot}`} />{a.label}</span>)}
        {layersOn && !factsHidden && <span className="inline-flex items-center gap-1"><i className="size-2 rounded-full border border-dashed border-neutral-500" />пунктир — факты (только чтение)</span>}
      </div>

      {/* Сетка (≥ md): месяц и неделя */}
      {view !== "list" && (
        <div className="hidden md:block">
          <div className="grid grid-cols-[repeat(7,minmax(0,1fr))_5rem] gap-px rounded-lg border border-neutral-200 bg-neutral-200 text-sm">
            {WEEKDAYS.map((w) => <div key={w} className="bg-neutral-50 px-2 py-1 text-xs font-medium text-neutral-500">{w}</div>)}
            <div className="bg-neutral-50 px-2 py-1 text-right text-xs font-medium text-neutral-500">Неделя</div>
            {weeks.map((wk) => (
              <WeekRow key={wk[0]} wk={wk} month={month} view={view} today={today} dayBlock={dayBlock} dayTotal={dayTotal} evByDay={evByDay} canEdit={canEdit} href={href} />
            ))}
          </div>
        </div>
      )}

      {/* Список по дням: телефон (всегда) и режим «Список» */}
      <div className={`${view === "list" ? "" : "md:hidden"} flex flex-col gap-2`}>
        {(view === "list" ? listDays : (view === "week" ? days : days.filter((d) => d.startsWith(month) && ((evByDay.get(d)?.length ?? 0) + (factsByDay.get(d)?.length ?? 0) > 0 || d === today)))).map((d) => (
          <div key={d} className={`rounded-lg border bg-white p-2 ${d === today ? "border-neutral-900" : "border-neutral-200"}`}>
            <div className="mb-1 flex items-center justify-between text-sm">
              <span className="font-medium">{dayLabel(d)}, {WEEKDAYS[(parseYmd(d).getUTCDay() + 6) % 7]}{d === today ? " · сегодня" : ""}</span>
              <span className="flex items-center gap-2 text-xs text-neutral-500">
                {dayTotal(d) > 0 && <span>Σ {formatQty(dayTotal(d))} шт.</span>}
                {canEdit && <Link href={href({ new: d, event: "" }) + "#event"} className="rounded border border-neutral-300 px-2 py-1 hover:bg-neutral-100" aria-label={`Добавить событие на ${dayLabel(d)}`}>+</Link>}
              </span>
            </div>
            <div className="flex flex-col gap-1">{dayBlock(d, false)}</div>
          </div>
        ))}
        {view !== "week" && listDays.length === 0 && <p className="rounded-lg border border-dashed border-neutral-300 p-4 text-center text-sm text-neutral-500">В этом месяце событий нет{canEdit ? " — добавьте первое формой выше" : ""}.</p>}
      </div>

      {layersOn && !factsHidden && layer.monthLevel.length > 0 && (
        <Card>
          <CardHeader><CardTitle>План поставок на {monthTitle(month)} (без точной даты) <InfoHint>Записи из раздела «План поставок», у которых указан только месяц. Только чтение.</InfoHint></CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-2 text-xs">
            {layer.monthLevel.map((m) => <Link key={m.id} href="/supply-plan" className={`rounded border px-1.5 py-0.5 ${LAYER_STYLES.supply.chip}`}>{m.title} ×{formatQty(m.qty)} · {m.label}</Link>)}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function WeekRow({ wk, month, view, today, dayBlock, dayTotal, evByDay, canEdit, href }: {
  wk: string[]; month: string; view: string; today: string;
  dayBlock: (d: string, compact: boolean) => React.ReactNode;
  dayTotal: (d: string) => number;
  evByDay: Map<string, { quantity: number; date: string; action: string }[]>;
  canEdit: boolean;
  href: (p: Record<string, string>) => string;
}) {
  const weekSum = wk.reduce((s, d) => s + dayTotal(d), 0);
  const brk = new Map<string, number>();
  for (const d of wk) for (const e of evByDay.get(d) ?? []) if (e.date === d) brk.set(e.action, (brk.get(e.action) ?? 0) + e.quantity);
  return (
    <>
      {wk.map((d) => {
        const outside = view === "month" && !d.startsWith(month);
        return (
          <div key={d} className={`${view === "week" ? "min-h-48" : "min-h-28"} flex flex-col gap-1 p-1 ${outside ? "bg-neutral-50 text-neutral-400" : "bg-white"} ${d === today ? "ring-2 ring-inset ring-neutral-900" : ""}`}>
            <div className="flex items-center justify-between text-xs">
              <span className={d === today ? "font-bold" : "font-medium"}>{Number(d.slice(8))}</span>
              <span className="flex items-center gap-1">
                {dayTotal(d) > 0 && <span className="rounded bg-neutral-100 px-1 text-[10px] text-neutral-700" title="Единиц за день">Σ {dayTotal(d)}</span>}
                {canEdit && <Link href={href({ new: d, event: "" }) + "#event"} className="rounded px-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-900" aria-label={`Добавить событие на ${d}`}>+</Link>}
              </span>
            </div>
            <div className="flex flex-col gap-0.5">{dayBlock(d, view !== "week")}</div>
          </div>
        );
      })}
      <div className="bg-neutral-50 p-1 text-right text-xs text-neutral-600" title={[...brk.entries()].map(([a, q]) => `${a}: ${q}`).join("\n")}>
        {weekSum > 0 ? <b>Σ {weekSum}</b> : ""}
      </div>
    </>
  );
}
