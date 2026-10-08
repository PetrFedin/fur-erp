import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { ACCESS, hasRole } from "@/lib/access";
import { cleanSearch, escapeLike } from "@/lib/input";
import { FilterBar } from "@/components/filters/filter-bar";
import { defineFilters, parseFilters, pick } from "@/lib/filters";
import { getColorOptions } from "@/lib/colors";
import { formatQty } from "@/lib/utils";
import { compareModelNames } from "@/lib/model-code";
import { classifyProduct } from "@/lib/product-category";
import { compareSizeLabels } from "@/lib/plan-sizes";
import { loadPlanFacts, loadOffPlan, resolveModelId, modelIndex, SET_BUCKET, type PlanFact } from "@/lib/plan-fact";
import { SEASON_HINTS } from "@/lib/plan-season-rule";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { ProductionTabs } from "@/components/production-tabs";
import { ResponsiveRows, RowCard } from "@/components/responsive-rows";
import { InfoHint } from "@/components/info-hint";
import { PlanForm, type PlanInitial } from "./plan-form";
import { SeasonCreateForm, SeasonEditForm } from "./season-forms";
import { ConfirmButton } from "./confirm-button";
import { copyPlan, deletePlan } from "./actions";
import { ArticleName } from "@/components/article-name";
import { articleLabel } from "@/lib/article-label";

export const metadata = { title: "План заказа" };

// Фильтры плана: сезон (код; старые ссылки с id сезона читаются тоже) и поиск по артикулу. edit — служебный параметр формы правки.
const PLAN_FILTERS = defineFilters({ ...pick(["season", "q"], { q: { label: "Поиск" } }) });

const ORDER_STATUS: Record<string, string> = { PLANNED: "запланирован", IN_PROGRESS: "в работе", COMPLETED: "завершён" };
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);

export default async function PlanPage({ searchParams }: PageProps<"/plan">) {
  const session = await requireSession();
  const orgId = session.user.organizationId;
  const canEdit = hasRole(session.user.role, ACCESS.planning);
  const sp = await searchParams;
  const pf = parseFilters(PLAN_FILTERS, sp);
  const editId = canEdit ? cleanSearch(sp.edit, 40) : "";

  const [seasons, models, colorRefs] = await Promise.all([
    prisma.season.findMany({ where: { organizationId: orgId }, orderBy: [{ startDate: "desc" }, { code: "asc" }] }),
    prisma.productModel.findMany({
      where: { organizationId: orgId, isActive: true },
      select: { id: true, name: true, sku: true, category: true, salesCode: true, salesName: true, aliases: true },
    }),
    getColorOptions(orgId),
  ]);
  models.sort((a, b) => compareModelNames(a.name, b.name));

  // Выбранные сезоны: код или id; none — позиции без сезона. Неизвестные значения отбрасываются (как «все»).
  const pickedIds = seasons.filter((s) => pf.season.includes(s.id) || pf.season.includes(s.code)).map((s) => s.id);
  const pickedNone = pf.season.includes("none");
  const pickedCount = pickedIds.length + (pickedNone ? 1 : 0);
  // seasonId — «один сезон» (id, none) или "" (все / несколько): от него зависят заголовки, колонка «Сезон» и форма добавления.
  const seasonId = pickedCount === 1 ? (pickedNone ? "none" : pickedIds[0]) : "";
  const seasonWhere = pickedCount === 0 ? {} : { OR: [...(pickedIds.length ? [{ seasonId: { in: pickedIds } }] : []), ...(pickedNone ? [{ seasonId: null }] : [])] };
  const textWhere = pf.q
    ? { OR: [
        { articleCode: { contains: escapeLike(pf.q), mode: "insensitive" as const } },
        { articleName: { contains: escapeLike(pf.q), mode: "insensitive" as const } },
        { color: { contains: escapeLike(pf.q), mode: "insensitive" as const } },
        { furType: { contains: escapeLike(pf.q), mode: "insensitive" as const } },
      ] }
    : {};
  const plans = await prisma.productionPlan.findMany({
    where: { organizationId: orgId, AND: [seasonWhere, textWhere] },
    include: { sizes: true, season: { select: { code: true } } },
    orderBy: [{ createdAt: "asc" }],
  });
  const facts = await loadPlanFacts(orgId, plans, models);
  const seasonCode = new Map(seasons.map((s) => [s.id, s.code]));
  const modelById = new Map(models.map((m) => [m.id, m]));
  const idx = modelIndex(models);

  // Сводка (по выбранному набору позиций)
  const sumPlan = (p: (typeof plans)[number]) => p.sizes.reduce((s, x) => s + x.quantity, 0);
  const totals = plans.reduce(
    (t, p) => {
      const f = facts.get(p.id)!;
      return { plan: t.plan + sumPlan(p), produced: t.produced + f.produced, inWork: t.inWork + f.inWork, notStarted: t.notStarted + f.notStarted };
    },
    { plan: 0, produced: 0, inWork: 0, notStarted: 0 },
  );
  const bySize = new Map<string, { plan: number; made: number }>();
  const byCat = new Map<string, { plan: number; made: number }>();
  const byArt = new Map<string, { plan: number; made: number }>();
  for (const p of plans) {
    const f = facts.get(p.id)!;
    for (const s of p.sizes) {
      const e = bySize.get(s.size) ?? { plan: 0, made: 0 };
      e.plan += s.quantity;
      bySize.set(s.size, e);
    }
    for (const [sz, n] of Object.entries(f.producedBySize)) {
      const e = bySize.get(sz) ?? { plan: 0, made: 0 };
      e.made += n;
      bySize.set(sz, e);
    }
    const m = f.modelId ? modelById.get(f.modelId) : null;
    const cat = classifyProduct({ modelCategory: m?.category, modelName: m?.name ?? p.articleCode, orderDescription: p.articleName }).category;
    const ec = byCat.get(cat) ?? { plan: 0, made: 0 };
    ec.plan += sumPlan(p);
    ec.made += f.produced;
    byCat.set(cat, ec);
    const ea = byArt.get(p.articleCode) ?? { plan: 0, made: 0 };
    ea.plan += sumPlan(p);
    ea.made += f.produced;
    byArt.set(p.articleCode, ea);
  }
  const sizeRows = [...bySize.entries()].sort(([a], [b]) => (a === SET_BUCKET ? 1 : b === SET_BUCKET ? -1 : compareSizeLabels(a, b)));
  let offPlan: Awaited<ReturnType<typeof loadOffPlan>> = [];
  if (seasonId && seasonId !== "none") {
    const mids = [...new Set(plans.map((p) => resolveModelId(p, idx)).filter((x): x is string => !!x))];
    offPlan = await loadOffPlan(orgId, seasonId, mids);
  }

  const unseasonedOrders = await prisma.productionOrder.count({ where: { organizationId: orgId, seasonId: null, status: { not: "CANCELLED" } } });

  // Правка
  let initial: PlanInitial | undefined;
  if (editId) {
    const p = await prisma.productionPlan.findFirst({ where: { id: editId, organizationId: orgId }, include: { sizes: true } });
    if (p) {
      initial = {
        editId: p.id,
        seasonId: p.seasonId,
        article: { code: p.articleCode, modelId: p.modelId },
        name: p.articleName ?? "",
        color: p.color ?? "",
        furType: p.furType ?? "",
        notes: p.notes ?? "",
        sizes: Object.fromEntries(p.sizes.map((s) => [s.size, s.quantity])),
      };
    }
  }

  // Ссылка «Править» сохраняет выбранные фильтры страницы.
  const backQs = new URLSearchParams([...pf.season.map((v) => ["season", v]), ...(pf.q ? [["q", pf.q]] : [])]).toString();

  const factCell = (f: PlanFact) => f.orders.length;
  const emptyPlan = plans.length === 0 && !initial && !pf.q && pf.season.length === 0;

  return (
    <div className="flex flex-col gap-4">
      <ProductionTabs active="plan" />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold">План заказа</h1><InfoHint wide>
            План — это сколько единиц какого артикула в каких размерах вы хотите произвести в сезоне. Рядом система показывает факт по ТЗ: сколько уже произведено, что в работе, что ещё не начато.
            Факт берётся из ТЗ этого же артикула и сезона (сезон у ТЗ присваивается на странице «Сезоны ТЗ»). Количество по размерам в ТЗ записано не всегда: если у ТЗ один размер — единицы идут в него, если «единый», «44, 46» или пусто — в «набор размеров».
          </InfoHint></div>
        <div className="flex flex-wrap gap-2">
          <Link href="/calendar" className={buttonVariants({ variant: "outline" })}>Календарь</Link>
          <Link href="/plan/seasons" className={buttonVariants({ variant: "outline" })}>
            Сезоны ТЗ{unseasonedOrders > 0 ? ` (${unseasonedOrders} без сезона)` : ""}
          </Link>
        </div>
      </div>

      {emptyPlan && (
        <Card>
          <CardContent className="flex flex-col gap-3 py-6">
            <p className="text-base font-medium">План заказа пока пуст</p>
            <p className="text-sm text-neutral-500">{canEdit ? "Добавьте первую позицию: артикул, цвет, вид меха и количество по размерам." : "Позиций плана пока нет."}</p>
            {canEdit && (
              <details>
                <summary className={buttonVariants({ variant: "default" }) + " inline-flex cursor-pointer list-none"}>+ Добавить позицию плана</summary>
                <div className="mt-4">
                  <PlanForm
                    key="new"
                    seasons={seasons.map((s) => ({ id: s.id, code: s.code }))}
                    models={models}
                    colorRefs={colorRefs}
                    canCreateArticle={hasRole(session.user.role, ACCESS.models)}
                    canCreateColor={hasRole(session.user.role, ACCESS.colors)}
                    defaultSeasonId=""
                    initial={undefined}
                  />
                </div>
              </details>
            )}
          </CardContent>
        </Card>
      )}

      {!emptyPlan && <FilterBar
        title="Фильтры плана"
        controls={[
          { type: "multi", name: "season", label: "Сезон", options: seasons.map((s) => ({ value: s.code, label: s.code })), noneLabel: "Без сезона", allLabel: "Все сезоны" },
          { type: "text", name: "q", label: "Поиск", placeholder: "Артикул, название, цвет, мех" },
        ]}
        resetExtra={["edit"]}
      />}

      {/* Сводка */}
      {!emptyPlan && <Card>
        <CardHeader>
          <CardTitle>
            Сводка {pickedCount === 0 ? "по всем сезонам" : pickedCount > 1 ? "по выбранным сезонам" : seasonId === "none" ? "по позициям без сезона" : `сезона ${seasonCode.get(seasonId)}`}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {plans.length === 0 ? (
            <p className="text-sm text-neutral-500">Позиций плана пока нет{canEdit ? " — добавьте их формой ниже" : ""}.</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                {[
                  ["План, шт.", totals.plan],
                  ["Произведено", totals.produced],
                  ["В работе", totals.inWork],
                  ["Не начато", totals.notStarted],
                  ["Осталось произвести", Math.max(totals.plan - totals.produced, 0)],
                ].map(([l, v]) => (
                  <div key={l as string} className="rounded-md border border-neutral-200 p-2">
                    <div className="text-xs text-neutral-500">{l}</div>
                    <div className="text-lg font-semibold tabular-nums">{formatQty(v as number)}</div>
                  </div>
                ))}
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-neutral-100" title={`${pct(totals.produced, totals.plan)}%`}>
                <div className="h-full bg-emerald-500" style={{ width: `${Math.min(100, pct(totals.produced, totals.plan))}%` }} />
              </div>
              <div className="grid gap-4 lg:grid-cols-3">
                <MiniTable title="План и факт по размерам" head="Размер" rows={sizeRows.map(([k, v]) => [k, v.plan, v.made])} />
                <MiniTable title="По артикулам" head="Артикул" rows={[...byArt.entries()].sort(([a], [b]) => compareModelNames(a, b)).map(([k, v]) => [k, v.plan, v.made])} />
                <MiniTable title="По категориям" head="Категория" rows={[...byCat.entries()].map(([k, v]) => [k, v.plan, v.made])} />
              </div>
              {offPlan.length > 0 && (
                <p className="text-xs text-neutral-600">
                  ТЗ сезона вне плана ({offPlan.length}):{" "}
                  {offPlan.slice(0, 8).map((o, i) => (
                    <span key={o.id}>{i > 0 && ", "}<Link className="text-blue-600 hover:underline" href={`/production/${o.id}`}>{o.label}</Link> ({o.model}, {formatQty(o.produced)}/{formatQty(o.planned)})</span>
                  ))}
                  {offPlan.length > 8 && " …"}
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>}

      {/* Таблица позиций */}
      {plans.length > 0 && (
        <ResponsiveRows
          table={
            <Table anchor="table:plan" label="Таблица плана">
              <Thead>
                <Tr>
                  <Th>Артикул</Th>
                  {seasonId === "" && <Th>Сезон</Th>}
                  <Th>План по размерам</Th>
                  <Th className="text-right">План</Th>
                  <Th className="text-right">Произведено</Th>
                  <Th className="text-right">В работе</Th>
                  <Th className="text-right">Не начато</Th>
                  <Th className="text-right">План − факт</Th>
                  <Th className="text-right">%</Th>
                  <Th>ТЗ</Th>
                  {canEdit && <Th>{""}</Th>}
                </Tr>
              </Thead>
              <Tbody>
                {plans.map((p) => {
                  const f = facts.get(p.id)!;
                  const plan = sumPlan(p);
                  return (
                    <Tr key={p.id}>
                      <Td className="font-medium">
                        {facts.get(p.id)?.modelId && modelById.get(facts.get(p.id)!.modelId!) ? <ArticleName model={modelById.get(facts.get(p.id)!.modelId!)!} /> : p.articleCode}
                        {p.articleName && <span className="block text-xs font-normal text-neutral-500">{p.articleName}</span>}
                        <span className="block text-xs font-normal text-neutral-500">{[p.color, p.furType].filter(Boolean).join(" · ")}</span>
                        {!f.modelId && <Badge variant="warning" className="mt-1">нет в справочнике</Badge>}
                      </Td>
                      {seasonId === "" && <Td>{p.season?.code ?? "—"}</Td>}
                      <Td className="text-xs tabular-nums">{sizesText(p.sizes)}</Td>
                      <Td className="text-right font-semibold tabular-nums">{formatQty(plan)}</Td>
                      <Td className="text-right tabular-nums">{formatQty(f.produced)}</Td>
                      <Td className="text-right tabular-nums">{formatQty(f.inWork)}</Td>
                      <Td className="text-right tabular-nums">{formatQty(f.notStarted)}</Td>
                      <Td className={`text-right tabular-nums ${plan - f.produced < 0 ? "text-amber-700" : ""}`}>{formatQty(plan - f.produced)}</Td>
                      <Td className="text-right tabular-nums">{pct(f.produced, plan)}%</Td>
                      <Td className="text-xs"><OrderLinks f={f} /></Td>
                      {canEdit && <Td><RowActions id={p.id} back={backQs} /></Td>}
                    </Tr>
                  );
                })}
              </Tbody>
            </Table>
          }
        >
          {plans.map((p) => {
            const f = facts.get(p.id)!;
            const plan = sumPlan(p);
            return (
              <RowCard
                key={p.id}
                title={facts.get(p.id)?.modelId && modelById.get(facts.get(p.id)!.modelId!) ? articleLabel(modelById.get(facts.get(p.id)!.modelId!)!) : p.articleCode}
                subtitle={[p.articleName, p.color, p.furType, seasonId === "" ? p.season?.code : null].filter(Boolean).join(" · ")}
                badge={<Badge variant={pct(f.produced, plan) >= 100 ? "success" : "info"}>{pct(f.produced, plan)}%</Badge>}
                fields={[
                  { label: "План", value: formatQty(plan), strong: true },
                  { label: "Произведено", value: formatQty(f.produced) },
                  { label: "В работе", value: formatQty(f.inWork) },
                  { label: "План − факт", value: formatQty(plan - f.produced) },
                ]}
                details={[
                  { label: "План по размерам", value: sizesText(p.sizes) },
                  { label: "Не начато", value: formatQty(f.notStarted) },
                  { label: "ТЗ", value: factCell(f) ? <OrderLinks f={f} /> : "" },
                ]}
                extra={canEdit ? <RowActions id={p.id} back={backQs} /> : undefined}
              />
            );
          })}
        </ResponsiveRows>
      )}
      {plans.some((p) => facts.get(p.id)!.unseasoned > 0 && p.seasonId) && (
        <p className="text-xs text-neutral-500">
          У некоторых артикулов есть ТЗ без сезона — они пока не входят в факт. Присвойте им сезон на странице <Link href="/plan/seasons" className="text-blue-600 hover:underline">«Сезоны ТЗ»</Link>.
        </p>
      )}

      {/* Форма */}
      {emptyPlan ? null : canEdit ? (
        <Card id="form">
          <CardHeader><CardTitle>{initial ? "Правка позиции плана" : "Новая позиция плана"}</CardTitle></CardHeader>
          <CardContent>
            <PlanForm
              key={initial?.editId ?? "new"}
              seasons={seasons.map((s) => ({ id: s.id, code: s.code }))}
              models={models}
              colorRefs={colorRefs}
              canCreateArticle={hasRole(session.user.role, ACCESS.models)}
              canCreateColor={hasRole(session.user.role, ACCESS.colors)}
              defaultSeasonId={seasonId && seasonId !== "none" ? seasonId : ""}
              initial={initial}
            />
          </CardContent>
        </Card>
      ) : (
        <p className="text-xs text-neutral-500">План редактируют владелец, администратор и технолог; остальные видят только таблицу.</p>
      )}

      {/* Сезоны */}
      <Card id="seasons">
        <CardHeader>
          <CardTitle>
            Сезоны{" "}
            <InfoHint wide>Сезон — это период (например FW26/27: осень–зима 2026/27). Даты сезона нужны только для правила «ТЗ по дате попадает в сезон» на странице «Сезоны ТЗ»; без дат сезон тоже работает — ТЗ тогда присваиваются вручную.</InfoHint>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {seasons.length === 0 && <p className="text-sm text-neutral-500">Сезонов пока нет — добавьте первый, чтобы разнести ТЗ по сезонам.</p>}
          {canEdit ? seasons.map((s) => <SeasonEditForm key={s.id} season={s} />) : seasons.map((s) => <div key={s.id} className="text-sm font-medium">{s.code}{s.name ? ` — ${s.name}` : ""}</div>)}
          {canEdit && (seasons.length === 0 ? (
            <details>
              <summary className="inline-flex cursor-pointer list-none rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100">+ Добавить сезон</summary>
              <div className="mt-3"><SeasonCreateForm hints={[...SEASON_HINTS]} /></div>
            </details>
          ) : <SeasonCreateForm hints={SEASON_HINTS.filter((h) => !seasons.some((s) => s.code.toLowerCase() === h.code.toLowerCase()))} />)}
        </CardContent>
      </Card>
    </div>
  );
}

function sizesText(sizes: { size: string; quantity: number }[]) {
  return [...sizes].sort((a, b) => compareSizeLabels(a.size, b.size)).map((s) => `${s.size}: ${s.quantity}`).join(" · ");
}

function OrderLinks({ f }: { f: PlanFact }) {
  if (f.orders.length === 0) return <span className="text-neutral-500">нет</span>;
  return (
    <span className="flex flex-col gap-0.5">
      {f.orders.slice(0, 5).map((o) => (
        <Link key={o.id} href={`/production/${o.id}`} className="text-blue-600 hover:underline">
          {o.label} · {ORDER_STATUS[o.status]} · {formatQty(o.produced)}/{formatQty(o.planned)}
        </Link>
      ))}
      {f.orders.length > 5 && <span className="text-neutral-500">…ещё {f.orders.length - 5}</span>}
    </span>
  );
}

function RowActions({ id, back }: { id: string; back: string }) {
  const btn = "inline-flex min-h-8 items-center rounded-md border border-neutral-300 px-2 text-xs hover:bg-neutral-100";
  return (
    <span className="flex flex-wrap gap-1">
      <Link href={`/plan?${back ? `${back}&` : ""}edit=${id}#form`} className={btn}>Править</Link>
      <form action={copyPlan}><input type="hidden" name="id" value={id} /><button type="submit" className={btn}>Копировать</button></form>
      <form action={deletePlan}><input type="hidden" name="id" value={id} /><ConfirmButton message="Удалить позицию плана? События календаря останутся." className={`${btn} text-red-600`}>Удалить</ConfirmButton></form>
    </span>
  );
}

function MiniTable({ title, head, rows }: { title: string; head: string; rows: [string, number, number][] }) {
  return (
    <div className="overflow-x-auto">
      <div className="mb-1 text-xs font-medium text-neutral-600">{title}</div>
      <table className="w-full text-xs">
        <thead><tr className="text-left text-neutral-500"><th className="py-1 pr-2 font-medium">{head}</th><th className="px-2 text-right font-medium">План</th><th className="px-2 text-right font-medium">Сделано</th><th className="pl-2 text-right font-medium">Осталось</th></tr></thead>
        <tbody>
          {rows.map(([k, plan, made]) => (
            <tr key={k} className="border-t border-neutral-100">
              <td className="py-1 pr-2">{k}</td>
              <td className="px-2 text-right tabular-nums">{formatQty(plan)}</td>
              <td className="px-2 text-right tabular-nums">{formatQty(made)}</td>
              <td className={`pl-2 text-right tabular-nums ${plan - made < 0 ? "text-amber-700" : ""}`}>{formatQty(plan - made)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
