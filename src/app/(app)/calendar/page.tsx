import { Breadcrumbs } from "@/components/breadcrumbs";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { ACCESS, hasRole } from "@/lib/access";
import { cleanSearch, escapeLike } from "@/lib/input";
import { getYearFilter, yearRange } from "@/lib/year-filter";
import { formatQty } from "@/lib/utils";
import { modelCodeVariants, compareModelNames } from "@/lib/model-code";
import { actionDef, CALENDAR_ACTIONS, LAYER_STYLES, STAGE_ORDER, STAGE_STYLES } from "@/lib/calendar-actions";
import { addDays, dayLabel, fmtRu, monthGridDays, monthTitle, parseMonth, parseYmd, shiftMonth, startOfWeek, todayYmd, WEEKDAYS, ymd } from "@/lib/calendar-grid";
import { loadFactLayer, type FactItem } from "@/lib/calendar-layers";
import { loadPipeline, pipeTitle, type PipeItem } from "@/lib/calendar-pipeline";
import { CATEGORY_GROUPS, NO_GROUP } from "@/lib/category-groups";
import { PipeCard, StageChip, StageLegend, StagesView } from "./pipe-views";
import { MonthsMode } from "./month-views";
import { YEARS } from "@/lib/year-filter";
import { WidgetRow } from "@/components/widget-row";
import { buildMonthGrid, buildMonthTable, inScope, unitsFor, type TableFilters } from "@/lib/calendar-table";
import type { Stage } from "@/lib/calendar-actions";
import { BTN, BTN_ICON, Segment, SummaryTiles } from "./ui";
import { Badge } from "@/components/ui/badge";
import { FilterBar } from "@/components/filters/filter-bar";
import { defineFilters, parseFilters, pick, stateParam } from "@/lib/filters";
import { InfoHint } from "@/components/info-hint";
import { EventForm, type EventInitial } from "./event-form";
import { DayEventActions, DayKeys } from "./day-panel";
import { articleLabel } from "@/lib/article-label";
import { HIDDEN_MODULES } from "@/lib/hidden-modules";

export const metadata = { title: "Производственный календарь" };

// Фильтры календаря: сезон (код; ?season=<id> читается тоже), действие, артикул (q; старое article), факты. view, m, w — вид и навигация.
const CAL_FILTERS = defineFilters({
  ...pick(["season", "q"], { q: { label: "Артикул", aliases: ["article"], maxLen: 100 } }),
  action: { kind: "multi", label: "Действие" },
  layers: { kind: "single", label: "Факты", role: "state", allowed: ["1"] },
  // Режимы «По месяцам» / «Стадии»: группа, вид меха, статус (стадия); cell — раскрытая ячейка, ord — открытая карточка ТЗ.
  grp: { kind: "multi", label: "Группа", maxLen: 40 },
  fur: { kind: "multi", label: "Вид меха", maxLen: 120 },
  stage: { kind: "multi", label: "Статус", allowed: STAGE_ORDER },
  cell: stateParam("Ячейка", { maxLen: 160 }),
  ord: stateParam("ТЗ", { maxLen: 40 }),
  // «По месяцам»: mv — таблица / график, my — год внутри режима (2025 | 2026 | all), gall — показать все ТЗ графика, gp — страница графика.
  mv: stateParam("Вид", { allowed: ["gantt"] }),
  my: stateParam("Год режима", { pattern: /^(all|\d{4})$/ }),
  gall: stateParam("Все ТЗ", { allowed: ["1"] }),
  gp: stateParam("Страница графика", { pattern: /^\d{1,4}$/ }),
});

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
  orderId: string | null;
};

export default async function CalendarPage({ searchParams }: PageProps<"/calendar">) {
  const session = await requireSession();
  const orgId = session.user.organizationId;
  const canEdit = hasRole(session.user.role, ACCESS.planning);
  const year = await getYearFilter();
  const sp = await searchParams;
  const today = todayYmd();

  // ?view=: month | week | list — «Детально» (сетка / неделя / список), months — «По месяцам», stages — «Стадии».
  const rawView = cleanSearch(sp.view, 8);
  const mode: "detail" | "months" | "stages" = rawView === "months" || rawView === "stages" ? rawView : "detail";
  const view = ["month", "week", "list"].includes(rawView) ? rawView : "month";
  let month = parseMonth(cleanSearch(sp.m, 7)) ?? today.slice(0, 7);
  if (!parseMonth(cleanSearch(sp.m, 7)) && year !== "all" && month.slice(0, 4) !== year) month = `${year}-01`;
  const weekStartParam = /^\d{4}-\d{2}-\d{2}$/.test(cleanSearch(sp.w, 10)) ? cleanSearch(sp.w, 10) : "";
  const weekStart = startOfWeek(weekStartParam || (today.startsWith(month) ? today : `${month}-01`));
  const cf = parseFilters(CAL_FILTERS, sp);
  const articleF = cf.q;
  const layersOn = cf.layers === "1";
  const eventId = cleanSearch(sp.event, 40);
  // ?day=ГГГГ-ММ-ДД — раскрытый день (старая ссылка ?new= открывает тот же день).
  const isYmd = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(parseYmd(v).getTime());
  const dayParam = [cleanSearch(sp.day, 10), cleanSearch(sp.new, 10)].find(isYmd) ?? "";

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
  const pickedIds = seasons.filter((x) => cf.season.includes(x.id) || cf.season.includes(x.code)).map((x) => x.id);
  const pickedNone = cf.season.includes("none");
  const seasonPicked = pickedIds.length > 0 || pickedNone;
  const actionVals = cf.action;
  const soleSeasonId = pickedIds.length === 1 && !pickedNone ? pickedIds[0] : "";

  const events = await prisma.calendarEvent.findMany({
    where: {
      organizationId: orgId,
      AND: [
        { date: { lte: parseYmd(to) } },
        { OR: [{ endDate: { gte: parseYmd(from) } }, { endDate: null, date: { gte: parseYmd(from) } }] },
        ...(yr ? [{ date: yr }] : []),
        ...(seasonPicked ? [{ OR: [...(pickedIds.length ? [{ seasonId: { in: pickedIds } }] : []), ...(pickedNone ? [{ seasonId: null }] : [])] }] : []),
        ...(actionVals.length ? [{ OR: actionVals.map((a) => ({ action: { equals: a, mode: "insensitive" as const } })) }] : []),
      ],
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
    orderId: e.orderId,
  }));

  // Слой фактов — только когда нет фильтров по сезону/действию (у фактов их нет).
  const factsHidden = mode !== "detail" || !layersOn || seasonPicked || actionVals.length > 0;
  const layer = factsHidden
    ? { items: [] as FactItem[], monthLevel: [] }
    : await loadFactLayer(orgId, from, to, { article: articleF, month });
  // «Конвейер» ТЗ: стадия, мех, ожидаемая дата — для подписей событий и фактов, карточек и режимов «По месяцам» / «Стадии».
  // «По месяцам» выбирает год сам (my), поэтому грузим все годы; остальные режимы — год шапки.
  const myEff = cf.my || (year === "all" ? "all" : year);
  const pipe = await loadPipeline(orgId, mode === "months" ? "all" : year, today);
  const pipeBy = new Map<string, PipeItem>(pipe.map((p) => [p.id, p]));
  const cardItem: PipeItem | null = cf.ord ? (pipeBy.get(cf.ord) ?? (await loadPipeline(orgId, "all", today)).find((p) => p.id === cf.ord) ?? null) : null;
  // Мех артикула, если он однозначен по ТЗ (для событий без привязки к ТЗ).
  const fursByArticle = new Map<string, Set<string>>();
  for (const p of pipe) fursByArticle.set(p.articleCode.toLowerCase(), (fursByArticle.get(p.articleCode.toLowerCase()) ?? new Set()).add(p.fur));
  const furOfArticle = (code: string) => { const f = fursByArticle.get(code.toLowerCase()); return f && f.size === 1 ? [...f][0] : null; };
  // Ожидаемые ТЗ без даты окончания: срок по лоту / закупке / плану поставок (событие календаря и так видно в сетке).
  const EXPECT_SRC = ["по поставке лота", "по сроку закупки", "по плану поставок"];
  const artRe = articleF ? modelCodeVariants(articleF).map((v) => v.toLowerCase()) : [];
  const expFacts: FactItem[] = factsHidden ? [] : pipe
    .filter((p) => p.status !== "COMPLETED" && p.stage !== "repair" && !p.endDate && p.expected && EXPECT_SRC.includes(p.expected.source) && p.expected.date >= from && p.expected.date <= to && (artRe.length === 0 || artRe.some((v) => p.articleCode.toLowerCase().includes(v))))
    .map((p) => ({ id: `ex-${p.id}`, kind: "order" as const, date: p.expected!.date, title: p.articleLabel, qty: p.qty, label: `Ожидаем ${pipeTitle(p)}`, href: `/production/${p.id}`, orderId: p.id }));
  const factsByDay = new Map<string, FactItem[]>();
  for (const f of [...layer.items, ...expFacts]) factsByDay.set(f.date, [...(factsByDay.get(f.date) ?? []), f]);

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
  const newInitial: EventInitial = { articleCode: "", modelId: null, articleName: "", quantity: "", date: dayParam || (today.startsWith(month) ? today : `${month}-01`), endDate: "", action: CALENDAR_ACTIONS[0].label, seasonId: soleSeasonId, planId: "", orderId: "", notes: "", done: false };

  const planLabel = (p: (typeof plans)[number]) => `${p.articleCode}${p.color ? ` · ${p.color}` : ""}${p.season ? ` · ${p.season.code}` : ""}`;
  // Раскрытый день: все события и факты этого дня (без фильтров сетки), ТЗ для привязки.
  const panelDay = mode === "detail" ? dayParam || (selected ? ymd(selected.date) : "") : "";
  const dayEvents = panelDay
    ? await prisma.calendarEvent.findMany({
        where: { organizationId: orgId, date: { lte: parseYmd(panelDay) }, OR: [{ endDate: { gte: parseYmd(panelDay) } }, { endDate: null, date: parseYmd(panelDay) }] },
        include: { season: { select: { code: true } } },
        orderBy: { createdAt: "asc" },
      })
    : [];
  const dayFacts: FactItem[] = panelDay
    ? [
        ...(await loadFactLayer(orgId, panelDay, panelDay, { month: panelDay.slice(0, 7) })).items,
        ...pipe
          .filter((p) => p.status !== "COMPLETED" && p.stage !== "repair" && !p.endDate && p.expected && EXPECT_SRC.includes(p.expected.source) && p.expected.date === panelDay)
          .map((p) => ({ id: `ex-${p.id}`, kind: "order" as const, date: panelDay, title: p.articleLabel, qty: p.qty, label: `Ожидаем ${pipeTitle(p)}`, href: `/production/${p.id}`, orderId: p.id })),
      ]
    : [];
  const formOrders = orderOptions.map((o) => {
    const pi = pipeBy.get(o.id);
    return { id: o.id, label: `${o.workOrderNumber ? `ТЗ №${o.workOrderNumber} (${o.number})` : o.number} · ${articleLabel(o.productModel)}${pi ? ` · ${pi.fur}` : ""}`, fur: pi?.fur ?? null, articleCode: o.productModel.name };
  });
  const formSeasons = seasons.map((x) => ({ id: x.id, code: x.code }));
  const formPlans = plans.map((p) => ({ id: p.id, label: planLabel(p), seasonId: p.seasonId, articleCode: p.articleCode, modelId: p.modelId, articleName: p.articleName ?? "" }));

  const params: Record<string, string | string[]> = { view: mode === "detail" ? view : mode, m: month, w: mode === "detail" && view === "week" ? weekStart : "", season: cf.season, action: actionVals, q: articleF, layers: layersOn ? "1" : "", grp: cf.grp, fur: cf.fur, stage: cf.stage, cell: cf.cell, mv: cf.mv, my: cf.my, gall: cf.gall, gp: cf.gp };
  const href = (patch: Record<string, string | string[]>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...params, ...patch })) {
      if (Array.isArray(v)) for (const x of v) p.append(k, x);
      else if (v) p.set(k, v);
    }
    const s = p.toString();
    return `/calendar${s ? `?${s}` : ""}`;
  };
  const evHref = (id: string) => href({ event: id });
  const prev = view === "week" ? href({ w: addDays(weekStart, -7), m: addDays(weekStart, -7).slice(0, 7), event: "", new: "" }) : href({ m: shiftMonth(month, -1), event: "", new: "" });
  const next = view === "week" ? href({ w: addDays(weekStart, 7), m: addDays(weekStart, 7).slice(0, 7), event: "", new: "" }) : href({ m: shiftMonth(month, 1), event: "", new: "" });
  const title = view === "week" ? `${fmtRu(days[0])} — ${fmtRu(days[6])}` : monthTitle(month);

  const chip = (e: Ev, dayIso: string) => {
    const def = actionDef(e.action);
    const cont = e.date !== dayIso;
    const p = e.orderId ? pipeBy.get(e.orderId) : undefined;
    const fur = p?.fur ?? furOfArticle(e.articleCode);
    return (
      <Link key={e.id + dayIso} href={href({ day: dayIso, event: e.id })} scroll={false} title={`${e.articleCode} × ${e.quantity} — ${e.action}${fur ? ` · ${fur}` : ""}${p ? ` · ${pipeTitle(p)}: ${p.stageWord}` : ""}${e.done ? " (выполнено)" : ""}`}
        className={`block rounded border px-1.5 py-0.5 text-xs leading-tight ${def.chip} ${e.done ? "opacity-60" : ""} ${e.overdue ? "ring-1 ring-red-500" : ""} ${selected?.id === e.id ? "outline outline-2 outline-neutral-900" : ""}`}>
        <span className={`block truncate ${e.done ? "line-through" : ""}`}>{cont ? "↳ " : ""}{e.articleCode} ×{e.quantity}{fur ? ` · ${fur}` : ""}</span>
        <span className="flex flex-wrap items-center gap-x-1 text-[11px] opacity-90">
          {e.action}
          {p && <StageChip stage={p.stage} word={p.stageWord} />}
          {e.endDate && e.endDate !== e.date ? <span className="tabular-nums">до {fmtRu(e.endDate).slice(0, 5)}</span> : null}
        </span>
      </Link>
    );
  };
  const factChip = (f: FactItem) => {
    const st = LAYER_STYLES[f.kind];
    const p = f.orderId ? pipeBy.get(f.orderId) : undefined;
    const fur = p?.fur;
    const href2 = f.orderId && f.kind === "order" ? href({ ord: f.orderId, event: "" }) + "#card" : f.href;
    return (
      <Link key={f.id} href={href2} title={`${st.label}: ${f.title}${f.qty != null ? ` × ${f.qty}` : ""}${fur ? ` · ${fur}` : ""} — ${f.label}${p?.expected ? ` · ${p.status === "COMPLETED" ? "дата" : "ждём"} ${fmtRu(p.expected.date)} (${p.expected.source})` : ""}`}
        className={`block rounded border px-1.5 py-0.5 text-xs leading-tight ${st.chip} ${p?.overdue && f.kind === "order" ? "ring-1 ring-red-500" : ""}`}>
        <span className="block truncate">{f.title}{f.qty != null ? ` ×${f.qty}` : ""}{fur ? ` · ${fur}` : ""}</span>
        <span className="flex flex-wrap items-center gap-x-1 text-[11px] opacity-90">
          {f.label}
          {p && f.kind === "order" && <StageChip stage={p.stage} word={p.stageWord} />}
          {p?.expected && f.kind === "order" && <span className="text-[10px] opacity-70">{p.expected.source}</span>}
        </span>
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
        {items.length > lim && <Link href={href({ day: d, event: "" })} scroll={false} className="block text-xs text-neutral-500 hover:underline">+ ещё {items.length - lim}</Link>}
      </>
    );
  };

  const inMonthDays = view === "month" || view === "list" ? days.filter((d) => d.startsWith(month)) : days;
  const listDays = (view === "list" ? inMonthDays.filter((d) => (evByDay.get(d)?.length ?? 0) + (factsByDay.get(d)?.length ?? 0) > 0) : days);
  const weeks: string[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));

  const furOptions = [...new Set(pipe.map((p) => p.fur))].sort((x, y) => x.localeCompare(y, "ru"));
  const tableFilters = { grp: cf.grp, fur: cf.fur, stage: cf.stage };

  // Плитки-итоги: числа из calendar-table (те же, что в таблицах ниже); в «Детально» таблиц нет — берём все ТЗ года шапки без фильтров.
  const sumFilters: TableFilters = mode === "detail" ? { grp: [], fur: [], stage: [] } : tableFilters;
  // «Детально» без включённых фактов: календарь пуст, пока не заведены события — плитки по ТЗ обнулены (ТЗ видны в режимах «По месяцам» и «Стадии»).
  const tilePipe = mode === "detail" && !layersOn ? [] : pipe;
  const sumGrand = mode === "months" ? buildMonthGrid(tilePipe, sumFilters, myEff).grand : buildMonthTable(tilePipe, sumFilters, true).grand;
  const sumScope = mode === "months" ? myEff : "all";
  const sumOverdue = tilePipe.filter((p) => p.overdue && inScope(p, sumScope) && Object.keys(unitsFor(p, sumFilters)).length > 0).length;
  const stageActive = mode === "detail" ? [] : cf.stage;
  const stageHref = (k: Stage) => mode === "detail"
    ? href({ view: "months", stage: [k], w: "", event: "", new: "", cell: "", ord: "" })
    : href({ stage: stageActive.length === 1 && stageActive[0] === k ? [] : [k], cell: "", ord: "", gp: "" });
  const periodEvents = evs.filter((e) => inPeriod(e.date)).length;
  const factsNote = layersOn && (seasonPicked || actionVals.length > 0) ? "Факты из других разделов скрыты: у них нет сезона и действия из этого списка." : "";

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: "Календарь", href: "/calendar" }, { label: mode === "months" ? "По месяцам" : mode === "stages" ? "Стадии" : `Детально · ${title}` }]} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center">
          <h1 className="text-xl font-semibold">Производственный календарь</h1>
          <span className="ml-2 inline-flex items-center gap-1 text-sm font-normal text-neutral-500">
            {year === "all" ? "· все годы" : `· ${year} год`}
            <InfoHint wide label="Как читать календарь">
              <p>Здесь ваши события: артикул × количество, дата и действие (раскрой, пошив, сдача скорняку…). Серые пунктирные ярлыки — факты из других разделов (план поставок, отгрузки, примерки, окончание ТЗ); они только для просмотра, клик ведёт в свою карточку.</p>
              <p className="mt-1">Красная рамка — дата прошла, а событие (или ТЗ) не выполнено. Итоги считаются по событиям один раз, в день начала. Общий год из шапки скрывает события других годов.</p>
              <p className="mt-1">Режимы: «Детально» — сетка с подписями (артикул, мех, количество, стадия, ожидаемая дата; клик по ТЗ открывает карточку), «По месяцам» — таблица видов меха по месяцам и стадиям, «Стадии» — путь изделия от плана до отгрузки со сроками.</p>
              {canEdit && <p className="mt-1">Добавить событие — кнопкой ниже или нажатием на любой день в календаре.</p>}
            </InfoHint>
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          {!HIDDEN_MODULES.orderPlan && <Link href="/plan" className={BTN}>План заказа</Link>}
          {!HIDDEN_MODULES.supplyPlan && <Link href="/supply-plan" className={BTN}>План поставок</Link>}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <Segment label="Режим календаря" items={([["detail", "Детально", view], ["months", "По месяцам", "months"], ["stages", "Стадии", "stages"]] as const).map(([m, t, v]) => ({ key: m, label: t, on: mode === m, href: href({ view: v, w: v === "week" ? weekStart : "", event: "", new: "", cell: "", ord: "" }) }))} />
        {mode === "detail" && canEdit && (
          <Link href={href({ day: today.startsWith(month) ? today : `${month}-01`, event: "" })} scroll={false} className="btn btn-accent ml-auto inline-flex h-8 items-center rounded-md border border-neutral-900 bg-neutral-900 px-3 text-xs font-medium text-white max-md:min-h-10">+ Добавить событие</Link>
        )}
      </div>

      {cardItem && (
        <div id="card"><PipeCard p={cardItem} closeHref={href({ ord: "" })} eventHref={canEdit ? evHref : undefined} /></div>
      )}

      <div className="print:hidden">
        <FilterBar
          title="Фильтры календаря"
          oneRow
          hideChips
          controls={mode !== "detail" ? [
            { type: "multi", name: "grp", label: "Группа", options: [...CATEGORY_GROUPS, NO_GROUP].map((g) => ({ value: g, label: g })), allLabel: "Все группы" },
            { type: "multi", name: "fur", label: "Вид меха", options: furOptions.map((f) => ({ value: f, label: f })), allLabel: "Все виды меха" },
            { type: "multi", name: "stage", label: "Статус", options: STAGE_ORDER.map((k) => ({ value: k, label: STAGE_STYLES[k].label })), allLabel: "Все статусы" },
          ] : [
            { type: "multi", name: "season", label: "Сезон", options: seasons.map((x) => ({ value: x.code, label: x.code })), noneLabel: "Без сезона", allLabel: "Все сезоны" },
            { type: "multi", name: "action", label: "Действие", options: CALENDAR_ACTIONS.map((a) => ({ value: a.label, label: a.label })), allLabel: "Все действия" },
            { type: "text", name: "q", label: "Артикул", aliases: ["article"], placeholder: "Артикул" },
            { type: "multi", name: "layers", label: "Факты", single: true, state: true, allLabel: "Только мои события", options: [{ value: "1", label: "Показывать факты" }], hint: "По умолчанию календарь пустой — только события, заведённые вручную. «Показывать факты» добавляет серым пунктиром даты из ТЗ, отгрузок и примерок (только чтение)" },
          ]}
          dropOnChange={["event", "new", "cell", "ord", "gp"]}
          footer={
            <p className="mt-2 flex items-center gap-1 text-[11px] leading-4 text-neutral-500">
              Фильтры применяются сразу
              <InfoHint label="Что фильтруется" wide>
                {mode === "detail"
                  ? <p>Сезон, действие и артикул отбирают события календаря. {factsNote || "Факты из других разделов показываются, пока не выбран сезон или действие: у них их нет."}</p>
                  : <p>Группа, вид меха и статус отбирают ТЗ в плитках и таблице. Источник данных: ТЗ без отменённых{mode === "months" ? (myEff === "all" ? ", все годы" : `, год ${myEff}`) : year !== "all" ? `, год ${year}` : ", все годы"}; сроки — плановая дата ТЗ, событие календаря, поставка лота, план поставок; «—» — даты нет.</p>}
              </InfoHint>
            </p>
          }
        />
      </div>

      <WidgetRow id="cal-summary" title="Календарь — сводка" headerEnd={<Link href="/production" className="text-xs text-blue-700 hover:underline print:hidden">→ ТЗ</Link>}>
        <SummaryTiles grand={sumGrand} overdue={sumOverdue} overdueEvents={mode === "detail" ? overdueCount : undefined} stageHref={stageHref} activeStage={stageActive}
          period={mode === "detail" ? { label: view === "week" ? "неделя" : "месяц", total: periodTotal, count: periodEvents } : undefined} />
      </WidgetRow>

      {mode !== "detail" && (
        mode === "months"
          ? <MonthsMode items={pipe} filters={tableFilters} my={myEff} years={[...YEARS]} mv={cf.mv === "gantt" ? "gantt" : "table"} href={href} cell={cf.cell} cardHref={(id) => href({ ord: id }) + "#card"} today={today} gall={cf.gall === "1"} gpage={Number(cf.gp) || 1} />
          : <StagesView items={pipe} filters={tableFilters} href={href} cell={cf.cell} cardHref={(id) => href({ ord: id }) + "#card"} />
      )}

      {/* Итоги и сетка */}
      {mode === "detail" && <>
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <Segment label="Вид" items={([["month", "Месяц"], ["week", "Неделя"], ["list", "Список"]] as const).map(([v, t]) => ({ key: v, label: t, on: view === v, href: href({ view: v, w: v === "week" ? weekStart : "" }) }))} />
        <Link href={prev} className={BTN_ICON} aria-label="Назад">‹</Link>
        <h2 className="min-w-44 text-center text-base font-semibold">{title}</h2>
        <Link href={next} className={BTN_ICON} aria-label="Вперёд">›</Link>
        <Link href={href({ m: today.slice(0, 7), w: "", event: "", new: "" })} className={BTN}>Сегодня</Link>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs">
        {[...byAction.entries()].map(([a, q]) => (
          <span key={a} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${actionDef(a).chip}`}>{a}: {formatQty(q)}</span>
        ))}
        {periodTotal === 0 && <span className="text-neutral-500">Событий нет{year !== "all" ? ` (год ${year})` : ""}.</span>}
      </div>
      <div className="flex flex-wrap gap-2 text-xs text-neutral-500">
        {CALENDAR_ACTIONS.map((a) => <span key={a.label} className="inline-flex items-center gap-1"><i className={`size-2 rounded-full ${a.dot}`} />{a.label}</span>)}
        {layersOn && !factsHidden && <span className="inline-flex items-center gap-1"><i className="size-2 rounded-full border border-dashed border-neutral-500" />пунктир — факты (только чтение)</span>}
        <span className="text-neutral-300">|</span>
        <StageLegend only={["plan", "raw", "work", "ready", "shipped"]} />
      </div>

      {/* Сетка (≥ md): месяц и неделя */}
      {mode === "detail" && view !== "list" && (
        <div className="hidden md:block">
          <div className="grid grid-cols-[repeat(7,minmax(0,1fr))_5rem] gap-px rounded-lg border border-neutral-200 bg-neutral-200 text-sm">
            {WEEKDAYS.map((w) => <div key={w} className="bg-white px-2 py-1 text-xs font-semibold text-neutral-600">{w}</div>)}
            <div className="bg-white px-2 py-1 text-right text-xs font-semibold text-neutral-600">Неделя</div>
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
              <Link href={href({ day: d, event: "" })} scroll={false} className="font-medium hover:underline">{dayLabel(d)}, {WEEKDAYS[(parseYmd(d).getUTCDay() + 6) % 7]}{d === today ? " · сегодня" : ""}</Link>
              <span className="flex items-center gap-2 text-xs text-neutral-500">
                {dayTotal(d) > 0 && <span>Σ {formatQty(dayTotal(d))} шт.</span>}
                <Link href={href({ day: d, event: "" })} scroll={false} className="rounded border border-neutral-300 px-2 py-1 hover:bg-neutral-100" aria-label={`${canEdit ? "Открыть день и добавить событие" : "Открыть день"}: ${dayLabel(d)}`}>{canEdit ? "+" : "›"}</Link>
              </span>
            </div>
            <div className="flex flex-col gap-1">{dayBlock(d, false)}</div>
          </div>
        ))}
        {view !== "week" && listDays.length === 0 && <p className="rounded-lg border border-dashed border-neutral-300 p-4 text-center text-sm text-neutral-500">В этом месяце событий нет{canEdit ? " — добавьте первое формой выше" : ""}.</p>}
      </div>

      {layersOn && !factsHidden && !HIDDEN_MODULES.supplyPlan && layer.monthLevel.length > 0 && (
        <section className="rounded-lg border border-neutral-200 bg-white p-3" aria-label="План поставок без точной даты">
          <h3 className="mb-2 text-sm font-semibold">План поставок на {monthTitle(month)} (без точной даты) <InfoHint>Записи из раздела «План поставок», у которых указан только месяц. Только чтение.</InfoHint></h3>
          <div className="flex flex-wrap gap-2 text-xs">
            {layer.monthLevel.map((m) => <Link key={m.id} href="/supply-plan" className={`rounded border px-1.5 py-0.5 ${LAYER_STYLES.supply.chip}`}>{m.title} ×{formatQty(m.qty)} · {m.label}</Link>)}
          </div>
        </section>
      )}
      </>}

      {/* Раскрытый день: события и факты, быстрая форма «Добавить в этот день» */}
      {panelDay && (() => {
        const closeHref = href({ event: "" });
        const dayHref = href({ day: panelDay, event: "" });
        const wd = WEEKDAYS[(parseYmd(panelDay).getUTCDay() + 6) % 7];
        const editing = canEdit && selected && editInitial ? selected : null;
        return (
          <>
            <Link href={closeHref} scroll={false} aria-label="Закрыть день" className="fixed inset-0 z-40 bg-black/30" />
            <DayKeys closeHref={closeHref} />
            <aside id="day-panel" role="dialog" aria-modal="true" aria-labelledby="day-panel-title" className="fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-white shadow-2xl md:w-[30rem]">
              <div className="flex items-center gap-2 border-b border-neutral-200 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <h2 id="day-panel-title" className="text-base font-semibold">{fmtRu(panelDay)}, {wd}{panelDay === today ? " · сегодня" : ""}</h2>
                  <p className="text-xs text-neutral-500">{dayEvents.length} {dayEvents.length === 1 ? "событие" : "событий"} · {dayFacts.length} {dayFacts.length === 1 ? "факт" : "фактов"}</p>
                </div>
                <Link href={href({ day: addDays(panelDay, -1), m: addDays(panelDay, -1).slice(0, 7), event: "" })} scroll={false} className={BTN_ICON} aria-label="Предыдущий день">‹</Link>
                <Link href={href({ day: addDays(panelDay, 1), m: addDays(panelDay, 1).slice(0, 7), event: "" })} scroll={false} className={BTN_ICON} aria-label="Следующий день">›</Link>
                <Link href={closeHref} scroll={false} data-autofocus className={BTN_ICON} aria-label="Закрыть">✕</Link>
              </div>
              <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-3 [&>section+section]:border-t [&>section+section]:border-neutral-200 [&>section+section]:pt-3">
                <section className="flex flex-col gap-2" aria-label="События дня">
                  <h3 className="text-sm font-semibold">События дня <InfoHint>События календаря на этот день (включая периоды, которые его захватывают). Серые пунктирные факты ниже — из ТЗ, поставок, отгрузок и примерок, они только для просмотра.</InfoHint></h3>
                  {dayEvents.length === 0 && <p className="rounded-md border border-dashed border-neutral-300 p-3 text-center text-sm text-neutral-500">В этот день событий нет{canEdit ? " — добавьте ниже" : ""}.</p>}
                  {dayEvents.map((e) => {
                    const def = actionDef(e.action);
                    const pi = e.orderId ? pipeBy.get(e.orderId) : undefined;
                    const fur = pi?.fur ?? furOfArticle(e.articleCode);
                    const done = !!e.doneAt;
                    const over = !done && ymd(e.endDate ?? e.date) < today;
                    return (
                      <div key={e.id} className={`flex flex-col gap-1.5 rounded-lg border p-2 text-sm ${selected?.id === e.id ? "border-neutral-900" : "border-neutral-200"} ${over ? "ring-1 ring-red-500" : ""}`}>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge className={def.chip}>{e.action}</Badge>
                          <b className={done ? "line-through opacity-60" : ""}>{e.articleCode}</b>
                          <span className="tabular-nums">×{formatQty(e.quantity)}</span>
                          {fur && <span className="text-neutral-500">{fur}</span>}
                          {pi && <StageChip stage={pi.stage} word={pi.stageWord} />}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-neutral-600">
                          {done ? <Badge variant="success">выполнено</Badge> : over ? <Badge variant="danger">просрочено</Badge> : <Badge variant="info">в плане</Badge>}
                          {e.endDate && ymd(e.endDate) !== ymd(e.date) && <span className="tabular-nums">{fmtRu(ymd(e.date))} — {fmtRu(ymd(e.endDate))}</span>}
                          {e.season && <span>сезон {e.season.code}</span>}
                          {e.orderId && <Link href={`/production/${e.orderId}`} className="text-blue-700 hover:underline">{pi ? pipeTitle(pi) : "карточка ТЗ"} →</Link>}
                          {pi?.expected && <span className="text-neutral-500">ждём {fmtRu(pi.expected.date)} ({pi.expected.source})</span>}
                        </div>
                        {e.notes && <p className="whitespace-pre-wrap break-words text-xs text-neutral-700">{e.notes}</p>}
                        {canEdit && <DayEventActions id={e.id} done={done} editHref={href({ day: panelDay, event: e.id })} label={`${e.articleCode} × ${e.quantity} — ${e.action}`} />}
                      </div>
                    );
                  })}
                </section>

                {canEdit && (
                  <section className="flex flex-col gap-2" aria-label={editing ? "Правка события" : "Добавить в этот день"} id="event">
                    <h3 className="flex items-center gap-2 text-sm font-semibold">
                      {editing ? `Правка: ${editing.articleCode} × ${editing.quantity}` : `Добавить в этот день · ${fmtRu(panelDay)}`}
                      {editing && <Link href={dayHref} scroll={false} className="ml-auto text-xs font-normal text-neutral-500 hover:underline">Отмена</Link>}
                    </h3>
                    <EventForm key={editing ? editing.id : `new-${panelDay}`} initial={editing && editInitial ? editInitial : { ...newInitial, date: panelDay }} models={models} seasons={formSeasons} plans={formPlans} orders={formOrders} canCreateArticle={hasRole(session.user.role, ACCESS.models)} stay doneHref={dayHref} />
                  </section>
                )}

                <section className="flex flex-col gap-2" aria-label="Факты дня">
                  <h3 className="text-sm font-semibold">Факты дня <InfoHint>Из других разделов: окончание ТЗ, поставки, отгрузки, примерки. Нажмите — откроется карточка.</InfoHint></h3>
                  {dayFacts.length === 0 && <p className="text-xs text-neutral-500">В этот день фактов нет.</p>}
                  {dayFacts.map((f) => {
                    const st = LAYER_STYLES[f.kind];
                    const pi = f.orderId ? pipeBy.get(f.orderId) : undefined;
                    return (
                      <Link key={f.id} href={f.href} className={`block rounded-lg border px-2 py-1.5 text-sm ${st.chip}`}>
                        <span className="block break-words font-medium">{f.title}{f.qty != null ? ` ×${formatQty(f.qty)}` : ""}{pi ? ` · ${pi.fur}` : ""}</span>
                        <span className="flex flex-wrap items-center gap-x-1.5 text-xs opacity-90">{st.label} · {f.label}{pi && f.kind === "order" && <StageChip stage={pi.stage} word={pi.stageWord} />}{pi?.expected && f.kind === "order" && <span className="opacity-70">{pi.expected.source}</span>}</span>
                      </Link>
                    );
                  })}
                </section>
              </div>
            </aside>
          </>
        );
      })()}
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
          <div key={d} className={`${view === "week" ? "min-h-48" : "min-h-28"} flex flex-col gap-1 p-1 ${outside ? "bg-neutral-50 text-neutral-500" : "bg-white"} ${d === today ? "ring-2 ring-inset ring-neutral-900" : ""}`}>
            <div className="flex items-center justify-between text-xs">
              <Link href={href({ day: d, event: "" })} scroll={false} title="Открыть день" className={`rounded px-1 hover:bg-neutral-100 ${d === today ? "font-bold" : "font-medium"}`}>{Number(d.slice(8))}</Link>
              <span className="flex items-center gap-1">
                {dayTotal(d) > 0 && <span className="rounded bg-neutral-100 px-1 text-[11px] text-neutral-700" title="Единиц за день">Σ {dayTotal(d)}</span>}
                {canEdit && <Link href={href({ day: d, event: "" })} scroll={false} className="rounded px-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900" title="Добавить в этот день" aria-label={`Добавить событие на ${d}`}>+</Link>}
              </span>
            </div>
            <div className="flex flex-col gap-0.5">{dayBlock(d, view !== "week")}</div>
            <Link href={href({ day: d, event: "" })} scroll={false} aria-label={`Открыть день ${d}`} title="Открыть день" className="min-h-3 flex-1 rounded hover:bg-neutral-100/70" />
          </div>
        );
      })}
      <div className="bg-neutral-50 p-1 text-right text-xs text-neutral-600" title={[...brk.entries()].map(([a, q]) => `${a}: ${q}`).join("\n")}>
        {weekSum > 0 ? <b>Σ {weekSum}</b> : ""}
      </div>
    </>
  );
}
