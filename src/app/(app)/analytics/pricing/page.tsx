import Link from "next/link";
import { requireSession } from "@/lib/session";
import { ACCESS, hasRole } from "@/lib/access";
import { getYearFilter } from "@/lib/year-filter";
import { getCommission4Mode } from "@/lib/commission4-mode";
import { c4Suffix } from "@/lib/commission4";
import { COMMISSION_RATE } from "@/lib/commission4-const";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { Money } from "@/components/money";
import { InfoHint } from "@/components/info-hint";
import { YearNote } from "@/components/year-note";
import { Mode4Badge } from "@/components/c4-note";
import { ResponsiveRows, RowCard } from "@/components/responsive-rows";
import { formatMoney, formatQty } from "@/lib/utils";
import { loadOrderRows } from "@/lib/analytics-orders";
import {
  aggregatePricing,
  calcPrice,
  defaultMarkupPct,
  loadModelPrices,
  parsePricingParams,
  parseTargetMarkup,
  pricingQuery,
  recommend,
  type PriceAgg,
} from "@/lib/analytics-pricing";
import { weightedPercent } from "@/lib/weighted";
import { UNDEFINED_CATEGORY } from "@/lib/product-category";
import { AcceptPriceButton } from "./accept-price-button";

export const metadata = { title: "Себестоимость и цены" };

const rub = (x: number) => formatMoney(x.toFixed(2));
const pct1 = (x: number) => `${x.toFixed(1).replace(".", ",")}%`;
const orderLabel = (r: { workOrderNumber: string | null; number: string }) => r.number;

type Seg = { key: string; label: string; value: number; cls: string };

function segments(a: PriceAgg): Seg[] {
  const matExcl = (x: number) => x;
  return [
    { key: "fur", label: "Мех", value: matExcl(a.furExcl), cls: "bg-emerald-600" },
    { key: "lin", label: "Подкладка", value: matExcl(a.liningExcl), cls: "bg-sky-500" },
    { key: "c4", label: "4%", value: a.c4Excl, cls: "bg-amber-500" },
    { key: "vat", label: "НДС в материалах", value: a.vat, cls: "bg-neutral-400" },
    { key: "exp", label: "Расходы ТЗ", value: a.expenses, cls: "bg-violet-500" },
    { key: "work", label: "Работа", value: a.work, cls: "bg-rose-500" },
  ].filter((s) => s.value > 0.005);
}

function Bar({ a }: { a: PriceAgg }) {
  const segs = segments(a);
  const total = segs.reduce((s, x) => s + x.value, 0);
  if (total <= 0) return <span className="text-neutral-400">—</span>;
  return (
    <div className="min-w-32">
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-neutral-100" role="img" aria-label={segs.map((s) => `${s.label} ${((s.value / total) * 100).toFixed(0)}%`).join(", ")}>
        {segs.map((s) => (
          <span key={s.key} className={s.cls} style={{ width: `${(s.value / total) * 100}%` }} title={`${s.label}: ${((s.value / total) * 100).toFixed(1)}%`} />
        ))}
      </div>
      <div className="mt-0.5 text-[11px] leading-tight text-neutral-500">
        {segs.map((s) => `${s.label} ${((s.value / total) * 100).toFixed(0)}%`).join(" · ")}
      </div>
    </div>
  );
}

export default async function PricingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  const year = await getYearFilter();
  const c4Mode = await getCommission4Mode();
  const c4 = c4Suffix(c4Mode);
  const p = parsePricingParams(await searchParams);
  const canEditPrice = hasRole(session.user.role, ACCESS.models);
  const orgId = session.user.organizationId;

  const [all, prices] = await Promise.all([loadOrderRows(orgId, year, c4Mode), loadModelPrices(orgId)]);
  const models = aggregatePricing(all, "model", prices);
  const def = defaultMarkupPct(models, p.base);
  const defRounded = def.pct != null ? Math.round(def.pct) : null;
  const typed = parseTargetMarkup(p.m);
  const target = typed ?? defRounded;
  const badInput = p.m !== "" && typed == null;

  const list = p.view === "model" ? models : aggregatePricing(all, "category", prices);
  const qq = p.q.toLowerCase();
  const calcOf = (a: PriceAgg) => calcPrice(a, p.base, a.price);
  const issuesOf = (a: PriceAgg) => {
    const c = calcOf(a);
    const out: string[] = [];
    if (a.modelId && !a.price) out.push("завести цену");
    if (c.belowCost) out.push("цена ниже себестоимости");
    if (a.noUsages.length) out.push(`ТЗ без состава: ${a.noUsages.length}`);
    if (a.zeroCost.length) out.push(`себестоимость 0: ${a.zeroCost.length}`);
    if (a.noWork.length) out.push(`ТЗ без цены работы: ${a.noWork.length}`);
    if (a.label === UNDEFINED_CATEGORY) out.push("категория не определена");
    return out;
  };
  const shown = list
    .filter((a) => !qq || `${a.label} ${a.category}`.toLowerCase().includes(qq))
    .filter((a) => (p.only === "noprice" ? a.modelId && !a.price : p.only === "issues" ? issuesOf(a).length > 0 : true));

  // Средняя наценка категории — по её ценообразованным моделям (вес — себестоимость партии).
  const catMarkup = new Map<string, { pct: number | null; priced: number; total: number }>();
  for (const a of models) {
    const cur = catMarkup.get(a.category) ?? { pct: null, priced: 0, total: 0 };
    cur.total += 1;
    if (a.price) cur.priced += 1;
    catMarkup.set(a.category, cur);
  }
  for (const [cat, v] of catMarkup) {
    const items = models
      .filter((a) => a.category === cat && a.price)
      .map((a) => {
        const c = calcOf(a);
        return c.markupPct != null && c.baseIncl ? { percent: c.markupPct, base: c.baseIncl * a.unitsCosted } : null;
      })
      .filter((x): x is { percent: number; base: number } => x !== null);
    v.pct = weightedPercent(items);
  }

  const modelsNoPrice = models.filter((a) => !a.price);
  const modelsBelow = models.filter((a) => calcOf(a).belowCost);
  const modelsNoUsages = models.filter((a) => a.noUsages.length > 0);
  const modelsZero = models.filter((a) => a.zeroCost.length > 0);
  const noWorkOrders = models.flatMap((a) => a.noWork);
  const inWorkNoCost = all.filter((r) => r.group === "work" && !(r.costIncl > 0));
  const pricedCount = models.filter((a) => a.price).length;
  const exampleModel = models.find((a) => a.price && calcOf(a).markupX && a.unitsCosted >= 3) ?? models.find((a) => a.price && calcOf(a).markupX);
  const exCalc = exampleModel ? calcOf(exampleModel) : null;

  const baseLabel = p.base === "full" ? "материалы + работа" : "материалы + расходы (как в «Изделиях»)";
  const basis = `наценка ${target ?? "—"}%, база — ${baseLabel}, ${c4Mode === "on" ? "с 4%" : "без 4%"}`;
  const qs = pricingQuery(p).replace(/^\?/, "");
  const here = (over: Partial<typeof p> = {}) => `/analytics/pricing${pricingQuery(p, over)}`;

  const perUnit = (a: PriceAgg, x: number) => (a.unitsCosted > 0 ? x / a.unitsCosted : 0);

  // Состав себестоимости единицы: «что входит».
  const composition = (a: PriceAgg) => {
    const u = (x: number) => perUnit(a, x);
    const full = a.costIncl + a.work;
    const share = (x: number) => (full > 0 ? pct1((x / full) * 100) : "—");
    const row = (label: React.ReactNode, incl: number, excl: number, shareBase: number, opts: { strong?: boolean; dim?: boolean } = {}) => (
      <Tr key={String(label)} className={opts.strong ? "bg-neutral-50 font-semibold" : opts.dim ? "text-neutral-400" : ""}>
        <Td>{label}</Td>
        <Td className="text-right tabular-nums"><Money incl={u(incl)} excl={u(excl)} /></Td>
        <Td className="text-right tabular-nums"><Money incl={incl} excl={excl} /></Td>
        <Td className="text-right tabular-nums">{share(shareBase)}</Td>
      </Tr>
    );
    const c4Excluded = a.c4PotIncl;
    return (
      <Table>
        <Thead>
          <Tr>
            <Th>Что входит</Th>
            <Th className="text-right">На единицу</Th>
            <Th className="text-right">Σ по ТЗ</Th>
            <Th className="text-right">Доля</Th>
          </Tr>
        </Thead>
        <Tbody>
          {row("Мех (по лотам, см. ниже)", a.furIncl, a.furExcl, a.furIncl)}
          {row("Подкладка", a.liningIncl, a.liningExcl, a.liningIncl)}
          {c4Mode === "on" ? (
            row(`4% на сырьё и подкладку`, a.c4Incl, a.c4Excl, a.c4Incl)
          ) : (
            <Tr className="text-neutral-400">
              <Td>4% — не включено (режим «Без 4%»)</Td>
              <Td className="text-right tabular-nums">+{rub(u(c4Excluded))}</Td>
              <Td className="text-right tabular-nums">+{rub(c4Excluded)}</Td>
              <Td className="text-right">—</Td>
            </Tr>
          )}
          {row("Расходы ТЗ", a.expenses, a.expenses, a.expenses)}
          {row(`Себестоимость системы${c4}`, a.costIncl, a.costExcl, a.costIncl, { strong: true })}
          {row("Работа (цена работы × кол-во)", a.work, a.work, a.work)}
          {row(`Полная себестоимость с работой${c4}`, a.costIncl + a.work, a.costExcl + a.work, full, { strong: true })}
        </Tbody>
      </Table>
    );
  };

  const lotsTable = (a: PriceAgg) =>
    a.lots.length === 0 ? (
      <p className="text-xs text-neutral-500">Нет списаний сырья — лоты неизвестны.</p>
    ) : (
      <Table>
        <Thead>
          <Tr>
            <Th>Лот</Th>
            <Th>Материал</Th>
            <Th className="text-right">Кол-во</Th>
            <Th className="text-right">Цена за ед.</Th>
            <Th className="text-right">Сумма</Th>
            <Th className="text-right">ТЗ</Th>
          </Tr>
        </Thead>
        <Tbody>
          {a.lots.map((l, i) => (
            <Tr key={i}>
              <Td>
                {l.lotNumber ?? "—"}
                {(l.grade || l.color) && <span className="ml-1 text-xs text-neutral-500">{[l.grade, l.color].filter(Boolean).join(", ")}</span>}
              </Td>
              <Td>{l.rawName}</Td>
              <Td className="text-right tabular-nums">{formatQty(l.qty)} {l.isLining ? "м" : "шк."}</Td>
              <Td className="text-right tabular-nums"><Money incl={l.qty > 0 ? l.incl / l.qty : 0} excl={l.qty > 0 ? l.excl / l.qty : 0} /></Td>
              <Td className="text-right tabular-nums"><Money incl={l.incl} excl={l.excl} /></Td>
              <Td className="text-right tabular-nums">{l.orders}</Td>
            </Tr>
          ))}
        </Tbody>
      </Table>
    );

  const ordersList = (a: PriceAgg) => (
    <div className="flex flex-col gap-1 text-xs text-neutral-600">
      {[...a.rows]
        .sort((x, y) => x.number.localeCompare(y.number, "ru", { numeric: true }))
        .map((r) => (
          <div key={r.id} className="flex flex-wrap gap-x-2">
            <Link href={`/production/${r.id}`} className="font-medium text-neutral-800 underline underline-offset-2">ТЗ {orderLabel(r)}</Link>
            {p.view === "category" && <span>{r.modelName}</span>}
            <span>{formatQty(r.qty)} ед.</span>
            <span>{r.costIncl > 0 ? <><Money incl={r.costIncl / Math.max(r.qty, 1)} excl={r.costExcl / Math.max(r.qty, 1)} /> за ед.</> : "себестоимость 0"}</span>
            {r.usageCount === 0 && <span className="text-amber-700">без состава</span>}
            {!(r.work > 0) && <span className="text-amber-700">без цены работы</span>}
          </div>
        ))}
    </div>
  );

  const details = (a: PriceAgg) => (
    <div className="mt-2 flex flex-col gap-3 font-normal">
      {composition(a)}
      <div>
        <div className="mb-1 text-xs font-medium text-neutral-700">Из каких лотов (мех и подкладка)</div>
        {lotsTable(a)}
      </div>
      <div>
        <div className="mb-1 text-xs font-medium text-neutral-700">Завершённые ТЗ ({a.rows.length})</div>
        {ordersList(a)}
      </div>
    </div>
  );

  const rangeCell = (a: PriceAgg) =>
    a.minUnitIncl != null && a.maxUnitIncl != null && a.costedOrders > 1 ? (
      <div className="text-[11px] leading-tight text-neutral-500">
        от <Money incl={a.minUnitIncl} excl={a.minUnitExcl} /> до <Money incl={a.maxUnitIncl} excl={a.maxUnitExcl} />
        <br />
        по ТЗ ({a.costedOrders})
      </div>
    ) : null;

  const costCell = (a: PriceAgg) => {
    const c = calcOf(a);
    return c.baseIncl == null ? "—" : (
      <div>
        <Money incl={c.baseIncl} excl={c.baseExcl} />
        {rangeCell(a)}
      </div>
    );
  };

  const priceCell = (a: PriceAgg) => {
    if (a.modelId) return a.price ? formatMoney(a.price.toFixed(2)) : <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">завести цену</span>;
    const m = catMarkup.get(a.label);
    return m && m.total > 0 ? <span className="text-xs text-neutral-500">цена у {m.priced} из {m.total} моделей</span> : "—";
  };

  const markupCell = (a: PriceAgg) => {
    if (a.modelId) {
      const c = calcOf(a);
      if (c.markupX == null) return "—";
      return (
        <div className={c.belowCost ? "text-red-700" : ""}>
          <span className="font-semibold">×{c.markupX.toFixed(2).replace(".", ",")}</span> <span className="text-xs">(+{Math.round(c.markupPct ?? 0)}%)</span>
          <div className="text-[11px] text-neutral-500">маржа {pct1(c.marginPct ?? 0)}{c.belowCost ? " — ниже себестоимости" : ""}</div>
        </div>
      );
    }
    const m = catMarkup.get(a.label);
    return m?.pct != null ? <div>средняя +{Math.round(m.pct)}%<div className="text-[11px] text-neutral-500">×{(1 + m.pct / 100).toFixed(2).replace(".", ",")} по моделям с ценой</div></div> : "—";
  };

  const recOf = (a: PriceAgg) => recommend(a, p.base, target);
  const recCell = (a: PriceAgg) => {
    const r = recOf(a);
    if (!r) return <span className="text-neutral-400">нужна целевая наценка</span>;
    const canAccept = canEditPrice && !!a.modelId && (!a.price || calcOf(a).belowCost);
    const cur = a.price ? formatMoney(a.price.toFixed(2)) : null;
    return (
      <div className="flex flex-col gap-1">
        <div>
          <span className="font-semibold"><Money incl={r.incl} excl={r.excl} /></span>
          <div className="text-[11px] text-neutral-500">рекомендация, не факт · округлено до 100 ₽</div>
        </div>
        {canAccept && a.modelId && (
          <AcceptPriceButton modelId={a.modelId} modelName={a.label} price={String(r.incl)} priceText={formatMoney(r.incl.toFixed(2))} currentText={cur} basis={`${basis}; цена с НДС`} />
        )}
        {!canEditPrice && a.modelId && !a.price && <span className="text-[11px] text-neutral-400">нет прав менять цену</span>}
      </div>
    );
  };

  const noteCell = (a: PriceAgg) => {
    const is = issuesOf(a).filter((x) => x !== "завести цену");
    return is.length ? (
      <ul className="text-[11px] text-amber-700">
        {is.map((x) => (
          <li key={x}>{x}</li>
        ))}
      </ul>
    ) : null;
  };

  const linkList = (rs: { id: string; workOrderNumber: string | null; number: string }[], limit = 40) => (
    <span className="flex flex-wrap gap-x-2 gap-y-1">
      {rs.slice(0, limit).map((r) => (
        <Link key={r.id} href={`/production/${r.id}`} className="underline underline-offset-2">{orderLabel(r)}</Link>
      ))}
      {rs.length > limit && <span className="text-neutral-500">…и ещё {rs.length - limit}</span>}
    </span>
  );
  const modelLinks = (ms: PriceAgg[]) => (
    <span className="flex flex-wrap gap-x-2 gap-y-1">
      {ms.map((m) => (
        <Link key={m.key} href={`/models/${m.key}`} className="underline underline-offset-2">{m.label}</Link>
      ))}
    </span>
  );

  const tabBtn = (active: boolean) => (active ? "rounded-md bg-neutral-900 px-3 py-1 text-white" : "rounded-md px-3 py-1 hover:bg-neutral-100");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">
          Себестоимость и цены
          <YearNote year={year} />
          <Mode4Badge mode={c4Mode} />
          <InfoHint label="О странице" wide>
            <p>Из чего складывается себестоимость единицы по моделям (артикулам) и категориям, сколько в ней мех, подкладка, 4%, расходы и работа, и какую цену заводить, чтобы получить нужную наценку. Считается по <b>завершённым</b> ТЗ выбранного года.</p>
            <p className="mt-1">
              <b>Себестоимость единицы</b> = (мех + подкладка + 4% + расходы ТЗ) ÷ выпущено единиц — средневзвешенная: Σ сумм ÷ Σ единиц. Мех и подкладка — по лотам, из которых списано в ТЗ. 4% ({COMMISSION_RATE * 100}% — доп. комиссия посредника) добавляется к сырью и подкладке в режиме «С 4%»; работа им не облагается. НДС входит в цены лотов; «Без НДС» переключается в шапке.
            </p>
            <p className="mt-1">
              <b>Работа</b> (цена работы по ТЗ × кол-во) в себестоимость системы не входит. Переключатель «База наценки» решает, считать ли наценку к материалам (как на странице «Изделия») или к материалам вместе с работой.
            </p>
            <p className="mt-1">
              <b>Наценка (маркап)</b> = цена ÷ себестоимость − 1; «×2,50» значит цена в 2,5 раза выше себестоимости. <b>Маржа</b> = (цена − себестоимость) ÷ цена. Цена — розничная цена модели (поле на странице «Изделия»); наценка считается к себестоимости с НДС, как там.
            </p>
            {exampleModel && exCalc && exCalc.baseIncl && exampleModel.price && (
              <p className="mt-1">
                Пример — модель {exampleModel.label}: цена {formatMoney(exampleModel.price.toFixed(2))} ÷ себестоимость {formatMoney(exCalc.baseIncl.toFixed(2))} = ×{exCalc.markupX!.toFixed(2).replace(".", ",")}, наценка +{Math.round(exCalc.markupPct!)}%, маржа {pct1(exCalc.marginPct!)}. При целевой наценке {target ?? "—"}% рекомендуемая цена = себестоимость × {(1 + (target ?? 0) / 100).toFixed(2).replace(".", ",")}, округлённая до 100 ₽.
              </p>
            )}
            <p className="mt-1">Целевая наценка по умолчанию — средневзвешенная по моделям, у которых цена уже есть (вес — себестоимость партии). <b>Рекомендация — расчёт, а не факт</b>: рынок и скидки в нём не учтены.</p>
          </InfoHint>
        </h1>
        <a href={`/analytics/pricing/export?${qs}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
          CSV: таблица
        </a>
      </div>

      {/* Сводка */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <div className="rounded-lg border border-neutral-200 bg-white p-3">
          <div className="text-xs text-neutral-500">Моделей с завершёнными ТЗ</div>
          <div className="text-lg font-semibold">{models.length}</div>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-white p-3">
          <div className="text-xs text-neutral-500">С ценой / без цены</div>
          <div className="text-lg font-semibold">{pricedCount} / <span className={models.length - pricedCount > 0 ? "text-amber-700" : ""}>{models.length - pricedCount}</span></div>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-white p-3">
          <div className="text-xs text-neutral-500">
            Средняя наценка по ценам
            <InfoHint label="Как посчитана" wide>Средневзвешенная по {def.count} моделям с ценой: Σ(наценка × себестоимость партии) ÷ Σ себестоимость партии. База — {baseLabel}{c4Mode === "on" ? ", с 4%" : ", без 4%"}.</InfoHint>
          </div>
          <div className="text-lg font-semibold">{def.pct != null ? `+${Math.round(def.pct)}%` : "—"}</div>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-white p-3">
          <div className="text-xs text-neutral-500">Целевая наценка (для рекомендаций)</div>
          <div className="text-lg font-semibold">{target != null ? `+${target}%` : "не задана"}</div>
          <div className="text-[11px] text-neutral-500">{typed != null ? "введена вручную" : defRounded != null ? "по умолчанию из данных" : "нет цен — введите вручную"}</div>
        </div>
      </div>

      {/* Параметры */}
      <form method="get" className="flex flex-wrap items-end gap-2 rounded-lg border border-neutral-200 bg-white p-3">
        <label className="flex flex-col gap-1 text-xs text-neutral-500">
          Целевой маркап, %
          <Input name="m" defaultValue={p.m} placeholder={defRounded != null ? String(defRounded) : "например 300"} inputMode="decimal" className="h-9 w-32" aria-invalid={badInput || undefined} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-neutral-500">
          База наценки
          <Select name="base" defaultValue={p.base} className="h-9 w-64">
            <option value="mat">Материалы + расходы (как в «Изделиях»)</option>
            <option value="full">Материалы + расходы + работа</option>
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-neutral-500">
          Показывать
          <Select name="only" defaultValue={p.only} className="h-9 w-44">
            <option value="all">Все</option>
            <option value="noprice">Только без цены</option>
            <option value="issues">Только с замечаниями</option>
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-neutral-500">
          Поиск
          <Input name="q" defaultValue={p.q} placeholder="Модель, категория" className="h-9 w-44" />
        </label>
        <input type="hidden" name="view" value={p.view} />
        <Button type="submit" size="sm" className="h-9">Пересчитать</Button>
        {(p.m || p.q || p.only !== "all" || p.base !== "mat") && (
          <Link href={here({ m: "", q: "", only: "all", base: "mat" })} className="pb-2 text-sm text-neutral-500 underline underline-offset-2">Сбросить</Link>
        )}
        {badInput && <span className="pb-2 text-xs text-red-600">Маркап: введите число, например 350 — взято значение по умолчанию.</span>}
      </form>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1 text-sm">
          <Link href={here({ view: "model" })} className={tabBtn(p.view === "model")}>По моделям (артикулам)</Link>
          <Link href={here({ view: "category" })} className={tabBtn(p.view === "category")}>По категориям</Link>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-neutral-600" aria-label="Обозначения диаграммы">
          {[
            ["bg-emerald-600", "Мех"],
            ["bg-sky-500", "Подкладка"],
            ["bg-amber-500", "4%"],
            ["bg-neutral-400", "НДС в материалах"],
            ["bg-violet-500", "Расходы ТЗ"],
            ["bg-rose-500", "Работа"],
          ].map(([c, l]) => (
            <span key={l} className="inline-flex items-center gap-1">
              <span className={`inline-block size-2.5 rounded-sm ${c}`} />
              {l}
            </span>
          ))}
          <InfoHint label="О диаграмме" align="right">Структура полной стоимости единицы (материалы без НДС, НДС отдельно, 4%, расходы, работа) — сравнение «работа vs расходы vs материалы». Диаграмма всегда считается с НДС.</InfoHint>
        </div>
      </div>

      <ResponsiveRows
        table={
          <Table>
            <Thead>
              <Tr>
                <Th>{p.view === "model" ? "Модель" : "Категория"}</Th>
                <Th className="text-right">Ед.</Th>
                <Th className="text-right">
                  Себестоимость за ед.{c4}
                  <InfoHint label="Что в цифре" align="right">Σ(себестоимость ТЗ) ÷ Σ единиц{p.base === "full" ? " + работа" : ""} по завершённым ТЗ с известной себестоимостью; ниже — разброс себестоимости единицы между ТЗ (мин–макс).</InfoHint>
                </Th>
                <Th>Структура</Th>
                <Th className="text-right">Цена</Th>
                <Th className="text-right">Наценка</Th>
                <Th className="text-right">Рекомендуемая цена</Th>
              </Tr>
            </Thead>
            <Tbody>
              {shown.map((a) => (
                <Tr key={a.key} className={a.modelId && !a.price ? "bg-amber-50/60" : ""}>
                  <Td className="font-medium">
                    <details>
                      <summary className="cursor-pointer hover:underline">{a.label}</summary>
                      {details(a)}
                    </details>
                    <div className="text-[11px] font-normal text-neutral-500">
                      {a.modelId ? a.category : `${a.modelCount} моделей`}
                      {a.modelId && (
                        <>
                          {" · "}
                          <Link href={`/models/${a.modelId}`} className="underline underline-offset-2">карточка модели</Link>
                        </>
                      )}
                    </div>
                    {noteCell(a)}
                  </Td>
                  <Td className="text-right tabular-nums">
                    {formatQty(a.units)}
                    <div className="text-[11px] text-neutral-500">ТЗ {a.orders}{a.inWorkOrders ? ` (+${a.inWorkOrders} в работе)` : ""}</div>
                  </Td>
                  <Td className="text-right tabular-nums">{costCell(a)}</Td>
                  <Td className="min-w-40">
                    <Bar a={a} />
                  </Td>
                  <Td className="text-right tabular-nums">{priceCell(a)}</Td>
                  <Td className="text-right tabular-nums">{markupCell(a)}</Td>
                  <Td className="text-right tabular-nums">{recCell(a)}</Td>
                </Tr>
              ))}
              {shown.length === 0 && (
                <Tr>
                  <Td colSpan={7} className="py-8 text-center text-neutral-400">
                    {year !== "all" ? `За ${year} год завершённых ТЗ по этим условиям нет` : "Нет данных по этим условиям"}
                  </Td>
                </Tr>
              )}
            </Tbody>
          </Table>
        }
      >
        {shown.map((a) => {
          const r = recOf(a);
          return (
            <RowCard
              key={a.key}
              className={a.modelId && !a.price ? "bg-amber-50/60" : ""}
              title={a.label}
              href={a.modelId ? `/models/${a.modelId}` : undefined}
              subtitle={a.modelId ? a.category : `${a.modelCount} моделей`}
              fields={[
                { label: "Единиц", value: `${formatQty(a.units)} (ТЗ ${a.orders})`, strong: true },
                { label: `Себестоимость за ед.${c4}`, value: costCell(a) },
                { label: "Цена", value: priceCell(a) },
                { label: "Наценка", value: markupCell(a) },
              ]}
              extra={
                <div className="flex flex-col gap-2">
                  <Bar a={a} />
                  {r && (
                    <div className="text-sm">
                      Рекомендуемая цена: <b><Money incl={r.incl} excl={r.excl} /></b>
                      <span className="text-[11px] text-neutral-500"> — рекомендация, не факт</span>
                    </div>
                  )}
                  {recCell(a)}
                  {noteCell(a)}
                </div>
              }
              details={[{ label: "Что входит", value: details(a) }]}
            />
          );
        })}
        {shown.length === 0 && <p className="py-8 text-center text-neutral-400">Нет данных по этим условиям</p>}
      </ResponsiveRows>

      {/* Качество данных */}
      <section className="rounded-lg border border-neutral-200 bg-white p-4 text-sm">
        <h2 className="mb-2 text-base font-semibold">
          Качество данных
          <InfoHint label="О проверках">Проверки по моделям и ТЗ выбранного года. Данные не правятся — только показано, что мешает посчитать цену.</InfoHint>
        </h2>
        <ul className="flex flex-col gap-2">
          <li>
            Моделей без цены (с завершёнными ТЗ): <b>{modelsNoPrice.length}</b>
            {modelsNoPrice.length > 0 && (
              <div className="mt-1 text-xs">
                {modelLinks(modelsNoPrice)}{" "}
                <Link href={here({ only: "noprice", view: "model" })} className="ml-2 text-neutral-600 underline underline-offset-2">показать в таблице</Link>
              </div>
            )}
          </li>
          <li>
            Цена ниже себестоимости: <b>{modelsBelow.length}</b>
            {modelsBelow.length > 0 && <div className="mt-1 text-xs">{modelLinks(modelsBelow)}</div>}
          </li>
          <li>
            Модели, у которых есть завершённые ТЗ без состава материалов: <b>{modelsNoUsages.length}</b>
            {modelsNoUsages.length > 0 && <div className="mt-1 text-xs">{linkList(modelsNoUsages.flatMap((m) => m.noUsages))}</div>}
          </li>
          <li>
            Завершённые ТЗ с себестоимостью 0: <b>{modelsZero.reduce((s, m) => s + m.zeroCost.length, 0)}</b>
            {modelsZero.length > 0 && <div className="mt-1 text-xs">{linkList(modelsZero.flatMap((m) => m.zeroCost))}</div>}
            {inWorkNoCost.length > 0 && (
              <details className="mt-1">
                <summary className="cursor-pointer text-neutral-600">ТЗ «в работе» с себестоимостью 0: {inWorkNoCost.length} (партии без списаний, в расчёт не входят)</summary>
                <div className="mt-1 text-xs">{linkList(inWorkNoCost)}</div>
              </details>
            )}
          </li>
          <li>
            Завершённые ТЗ без цены работы: <b>{noWorkOrders.length}</b>
            {noWorkOrders.length > 0 && <div className="mt-1 text-xs">{linkList(noWorkOrders)}</div>}
          </li>
          <li className="text-xs text-neutral-500">
            Отдельной оптовой цены в базе нет — используется розничная цена модели. Фурнитура и прочие материалы в ТЗ не списываются: в составе только мех и подкладка.
          </li>
        </ul>
        <div className="mt-3 text-xs text-neutral-500">
          Что произведено — на вкладке{" "}
          <Link href="/analytics/products" className="underline underline-offset-2">«Изделия»</Link>; цены правятся на странице{" "}
          <Link href="/articles" className="underline underline-offset-2">«Изделия» (меню)</Link>.
        </div>
      </section>
    </div>
  );
}
