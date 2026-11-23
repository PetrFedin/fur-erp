import { Breadcrumbs } from "@/components/breadcrumbs";
import Link from "next/link";
import { WidgetRow } from "@/components/widget-row";
import { Decimal } from "@prisma/client/runtime/library";
import { requireSession } from "@/lib/session";
import { getYearFilter } from "@/lib/year-filter";
import { getCommission4Mode } from "@/lib/commission4-mode";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { FilterBar } from "@/components/filters/filter-bar";
import { Money } from "@/components/money";
import { InfoHint } from "@/components/info-hint";
import { YearNote } from "@/components/year-note";
import { Mode4Badge } from "@/components/c4-note";
import { formatMoney, formatQty } from "@/lib/utils";
import { NO_AUCTION_LABEL } from "@/lib/auction-names";
import { auctionLabeler } from "@/lib/filter-options";
import {
  GROUPS, NO_AUCTION_KEY, SYNTHETIC_LABEL, aggOf, applyFilters, avgPrice, groupLots, groupUsage, isUsageBy, loadUsageRows, lotIssues, parseFilters, pctText, usedPct,
  type Agg, type Group, type GroupBy, type LotGroupBy, type RawFilters, type UsageGroup,
} from "@/lib/raw-analytics";
import { prisma } from "@/lib/prisma";
import { LazyDetails } from "../../lots/lazy-details";
import { loadGroupLots, loadUsageGroupLots } from "./lots-action";
import { LOT_COLS } from "./lot-rows";
import { USAGE_COLS, perUnit } from "./usage-rows";
import { CostCell } from "./cost-cell";
import { MonthlyChart, type MonthPoint } from "./monthly-chart";
import { figures } from "@/lib/fur-table";
import { flowOfRawLots } from "@/lib/fur-table-server";
import { TILE_BOX, TileHead, TileValue } from "@/app/(app)/dashboard/tile";
import { TotalLabel } from "@/components/total-label";
import { loadRawWithDashboard, loadRawFromMartOrNull } from "@/lib/raw-analytics-dash";
import { LevelSummaryFromFigures } from "@/components/level-tiles";

export const metadata = { title: "Аналитика сырья" };

const q2 = (d: Decimal) => d.toFixed(2);
const qty = (d: Decimal, unit: string) => `${formatQty(d.toString())} ${unit}`;
const rub = (d: Decimal) => formatMoney(q2(d));

export default async function RawAnalyticsPage({ searchParams }: PageProps<"/analytics/raw">) {
  const session = await requireSession();
  const sp = await searchParams;
  const fromPurchases = sp.from === "purchases";
  const year = await getYearFilter();
  const c4 = await getCommission4Mode();
  const { f, by } = parseFilters(sp);
  // Всё сырьё считается как на Главной: лоты склада + «Заказано, не получено» + «Шкуры подрядчика» (те же строки, что считает loadDashboard).
  const [{ data, all: allRaw }, usage] = await Promise.all([
    loadRawFromMartOrNull(session.user.organizationId, year).then((m) => m ?? loadRawWithDashboard(session.user.organizationId, year, c4)),
    isUsageBy(by) ? loadUsageRows(session.user.organizationId, year) : Promise.resolve([] as Awaited<ReturnType<typeof loadUsageRows>>),
  ]);
  const unit = f.scope === "lining" ? "м" : "шт.";
  const scoped = allRaw.filter((l) => (f.scope === "lining") === (l.unit === "M"));
  const lots = applyFilters(allRaw, f);
  /** Лоты склада в выборке (без строк «Заказано, не получено» и «Шкуры подрядчика»). */
  const whLots = lots.filter((l) => !l.synthetic);
  const synQty = lots.filter((l) => l.synthetic === "ordered").reduce((x, l) => x.add(l.recv), new Decimal(0));
  const bridgeText = synQty.greaterThan(0) ? ` и ${qty(synQty, unit)} заказано, но не получено` : "";
  const total = aggOf(lots);
  // Средневзвешенные цены (как основные цифры плиток — без 4%) — общий расчёт с таблицей «Мех / Подкладка» (src/lib/fur-table.ts): Σ ₽ ÷ Σ шт. (м).
  const flow = flowOfRawLots(lots);
  const fIncl = figures(flow, { vat: "incl", c4 });
  const fExcl = figures(flow, { vat: "excl", c4 });
  const groups = isUsageBy(by) ? [] : groupLots(lots, by as LotGroupBy);
  const usageGroups: UsageGroup[] = isUsageBy(by)
    ? (() => {
        const ids = new Set(lots.map((l) => l.id));
        return groupUsage(usage.filter((r) => ids.has(r.lotId)), by);
      })()
    : [];
  const modelName = f.model ? (await prisma.productModel.findFirst({ where: { id: f.model, organizationId: session.user.organizationId }, select: { name: true } }))?.name ?? null : null;
  const otherQty = lots.reduce((s, l) => s.add(l.otherOut), new Decimal(0));
  const otherIncl = lots.reduce((s, l) => s.add(l.otherOut.mul(l.unitIncl)), new Decimal(0));
  const otherExcl = lots.reduce((s, l) => s.add(l.otherOut.mul(l.unitExcl)), new Decimal(0));

  const aucOf = await auctionLabeler(session.user.organizationId);
  const auctionOpts = Array.from(new Map(scoped.map((l) => [l.auction, l.auctionLabel])).entries()).sort((a, b) =>
    a[1].localeCompare(b[1], "ru", { numeric: true }),
  );
  const kindOpts = Array.from(new Set(scoped.map((l) => l.kind))).sort((a, b) => a.localeCompare(b, "ru"));

  // Размер — по документам (sizeGrade): значения из данных, «не указан в документах» — последней строкой с числом лотов.
  const sizeCount = new Map<string, number>();
  let noSizeLots = 0;
  for (const l of scoped) {
    if (l.sizes.length === 0) noSizeLots++;
    for (const s of l.sizes) sizeCount.set(s, (sizeCount.get(s) ?? 0) + 1);
  }
  const sizeOpts = [
    ...Array.from(sizeCount, ([value, count]) => ({ value, label: value, count })).sort((a, b) => a.label.localeCompare(b.label, "ru", { numeric: true })),
    ...(noSizeLots > 0 ? [{ value: "Не указан", label: "Размер не указан в документах", count: noSizeLots }] : []),
  ];
  const attrCount = new Map<string, number>();
  let noAttrLots = 0;
  for (const l of scoped) {
    if (l.attrs.length === 0) noAttrLots++;
    for (const a of l.attrs) attrCount.set(a, (attrCount.get(a) ?? 0) + 1);
  }
  const attrOpts = [
    ...Array.from(attrCount, ([value, count]) => ({ value, label: value, count })).sort((a, b) => a.label.localeCompare(b.label, "ru", { numeric: true })),
    ...(attrCount.size > 0 && noAttrLots > 0 ? [{ value: "none", label: "Без признака", count: noAttrLots }] : []),
  ];
  const pyearOpts = Array.from(new Set(scoped.map((l) => String(l.year)))).sort((a, b) => Number(b) - Number(a));

  // Ссылки страницы (вкладки, группировка, выгрузка CSV) — те же канонические параметры, что читает parseFilters:
  // g, scope, auction, fur, pyear, rest, q, model (старые auc, kind, py, m читаются как псевдонимы).
  const entries: Array<[string, string]> = [["g", by]];
  if (f.scope === "lining") entries.push(["scope", "lining"]);
  for (const v of f.auction) entries.push(["auction", v]);
  for (const v of f.kind) entries.push(["fur", v]);
  for (const v of f.pyear) entries.push(["pyear", v]);
  for (const v of f.size) entries.push(["size", v]);
  for (const v of f.attr) entries.push(["attr", v]);
  if (f.onlyRem) entries.push(["rest", "1"]);
  if (f.q) entries.push(["q", f.q]);
  if (f.model) entries.push(["model", f.model]);
  /** over: null — убрать параметр целиком, строка — заменить значением. */
  const href = (over: Record<string, string | null>) => {
    const p = new URLSearchParams();
    for (const [k, v] of entries) if (!(k in over)) p.append(k, v);
    for (const [k, v] of Object.entries(over)) if (v != null) p.set(k, v);
    return `/analytics/raw?${p.toString()}`;
  };
  const exportQs = new URLSearchParams(entries).toString();

  // ───── графики ─────
  const months = new Map<string, MonthPoint>();
  for (const l of whLots) {
    const m = months.get(l.month) ?? { month: l.month, qty: 0, incl: 0, excl: 0 };
    m.qty += l.recv.toNumber();
    m.incl += l.recv.mul(l.unitIncl).toNumber();
    m.excl += l.recv.mul(l.unitExcl).toNumber();
    months.set(l.month, m);
  }
  const monthPoints = Array.from(months.values()).sort((a, b) => a.month.localeCompare(b.month));
  const byYear = groupLots(lots, "year");

  // Сверка лотов (кнопка вверху): число лотов с замечаниями.
  const reconLots = data.lots.filter((l) => lotIssues(l).length > 0);

  const pctAll = usedPct(total);
  const ex = (l: Decimal) => formatQty(l.toString());

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[fromPurchases ? { label: "Закупки", href: "/purchases" } : { label: "Сырьё", href: "/lots" }, { label: "Аналитика" }]} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold">Аналитика сырья</h1><YearNote year={year} />
          <Mode4Badge mode={c4} />
          <InfoHint label="О странице" wide>
            <p>Куплено → использовано в ТЗ → остаток по аукционам, годам, видам меха, лотам, сортам и размерам. Источник — лоты склада: принятая закупка создаёт лот, списания в ТЗ ссылаются на лот.</p>
            <p className="mt-1">Год — из шапки, по дате заказа закупки: берутся лоты закупок этого года и всё, что из них списано в ТЗ.</p>
            <p className="mt-1">Деньги — по цене лота за единицу (курс, НДС, расходы закупки). Среднее везде средневзвешенное: Σ(цена × кол-во) ÷ Σ кол-во. 4 % — справочная строка «с 4 %», в цену лота не входит.</p>
            <p className="mt-1">Мех (шт.) и подкладка (м) считаются отдельно.</p>
            <p className="mt-1">Сырьё считается как на Главной: лоты склада + «Заказано, не получено» + «Шкуры подрядчика» отдельными строками, поэтому итоги сходятся.</p>
          </InfoHint></div>
        <div className="flex flex-wrap gap-2">
          <Link href="/analytics/raw/recon" className={buttonVariants({ variant: "outline", size: "sm" })}>
            Сверка лотов{reconLots.length > 0 ? ` (${reconLots.length})` : ""}
          </Link>
          <a href={`/analytics/raw/export?${exportQs}&part=groups`} className={buttonVariants({ variant: "outline", size: "sm" })}>
            CSV: таблица
          </a>
          <a href={`/analytics/raw/export?${exportQs}&part=lots`} className={buttonVariants({ variant: "outline", size: "sm" })}>
            CSV: по лотам
          </a>
        </div>
      </div>

      {/* Мех / подкладка */}
      <div className="flex gap-1">
        {(["fur", "lining"] as const).map((s) => (
          <Link
            key={s}
            href={href({ scope: s === "fur" ? null : "lining", auction: null, fur: null })}
            className={"rounded-md px-3 py-1.5 text-sm max-md:inline-flex max-md:min-h-9 max-md:items-center " + (f.scope === s ? "bg-neutral-900 text-white" : "text-neutral-700 hover:bg-neutral-100")}
          >
            {s === "fur" ? "Мех (шт.)" : "Подкладка (м)"}
          </Link>
        ))}
      </div>

      {f.model && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Показаны лоты, из которых сделано изделие «{modelName ?? "–"}».
          <Link href={href({ model: null })} className="underline">Показать все</Link>
        </div>
      )}

      {/* Фильтры (над виджетами, как на Главной) */}
      <div className="print:hidden">
        <FilterBar
          title="Фильтры сырья"
          oneRow
          hideChips
          controls={[
            { type: "multi", name: "auction", label: "Аукцион / закупка", aliases: ["auc"], allLabel: "Все партии", options: auctionOpts.map(([key, lab]) => ({ value: key, label: lab === NO_AUCTION_LABEL ? lab : key === NO_AUCTION_KEY ? lab : aucOf(key).label, title: key === NO_AUCTION_KEY ? undefined : aucOf(key).title })) },
            { type: "multi", name: "fur", label: "Вид меха", aliases: ["kind"], options: kindOpts.map((k) => ({ value: k, label: k })) },
            { type: "multi", name: "pyear", label: "Год закупки", aliases: ["py"], options: pyearOpts.map((y) => ({ value: y, label: y })) },
            ...(sizeOpts.length > 1 ? [{ type: "multi" as const, name: "size", label: "Размер шкуры / сорт", more: true, options: sizeOpts, hint: "По документам (размер лота); без размера — отдельной строкой в конце" }] : []),
            ...(attrOpts.length > 1 ? [{ type: "multi" as const, name: "attr", label: "Признак меха", more: true, options: attrOpts, hint: "Седина (SIL), дикий / клеточный, тонированный… — справочник «Признаки меха» в Настройках" }] : []),
            { type: "text", name: "q", label: "Поиск по лоту / сорту", placeholder: "напр. 15016" },
            { type: "multi", name: "rest", label: "Остаток", single: true, allLabel: "Любой", options: [{ value: "1", label: "Только с остатком" }] },
          ]}
          resetExtra={["model", "m"]}
        />
      </div>

      {/* Итоги — та же полоса, что на всех страницах «Сырья» (оплаты и долг здесь не нужны: это разрез по лотам). */}
      <LevelSummaryFromFigures incl={fIncl} excl={fExcl} c4={c4} unit={unit === "м" ? "м" : "шт."} label="Итоги" />
      {!otherQty.isZero() ? (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Списано иначе: {ex(otherQty)} {unit} (получено − остаток − использовано в ТЗ). Должно быть 0 — смотрите <Link href="/analytics/raw/recon" className="underline">«Сверку лотов»</Link>.
        </p>
      ) : null}

      {/* Сводная таблица */}
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            Сводная таблица
            <InfoHint label="О таблице" wide>
              <p>Группируйте по аукциону, году закупки, виду меха, лоту, сорту/цвету или размеру. Строку можно развернуть: внутри — лоты с остатком, ценой и ТЗ, где использован лот.</p>
              <p className="mt-1"><b>Изделие (артикул)</b> и <b>ТЗ</b> — другой разрез: что ушло на каждое изделие или ТЗ (шкур или метров, ₽, на 1 изделие); строка раскрывается в лоты. У каждого лота есть карточка «Где использован» — в какие изделия он ушёл, учёт и остаток.</p>
              <p className="mt-1">Сорт/цвет и размер берутся из поля «сорт» лота: размер берётся из документов (поле «размер» лота: XXL, XL, 30, 40/30…), сорт — остальной текст до размера. Размер не указан в документах — «Не указан».</p>
              <p className="mt-1"><b>Средняя цена</b> = Σ(кол-во × цена лота) ÷ Σ кол-во по лотам группы. <b>Стоимость остатка</b> = Σ(остаток × цена лота). Цены и остаток — без 4 %: надбавка 4 % начисляется только при списании в ТЗ (в плитках сверху — справочно, режим в шапке).</p>
              {groups[0] && avgPrice(groups[0].agg) && (
                <p className="mt-1">Пример — «{groups[0].label}»: куплено {qty(groups[0].agg.recv, unit)} на {rub(groups[0].agg.recvIncl)} → {rub(groups[0].agg.recvIncl)} ÷ {ex(groups[0].agg.recv)} = {rub(avgPrice(groups[0].agg)!.incl)} за единицу.</p>
              )}
            </InfoHint>
          </CardTitle>
          <div className="flex flex-wrap items-center gap-1 text-xs">
            <span className="text-neutral-500">группировать по:</span>
            {GROUPS.map((g) => (
              <Link
                key={g.key}
                href={href({ g: g.key })}
                className={"rounded-full border px-3 py-1 max-md:min-h-8 max-md:inline-flex max-md:items-center " + (by === g.key ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 text-neutral-700 hover:bg-neutral-100")}
              >
                {g.label}
              </Link>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {isUsageBy(by) ? (
            <UsageTable groups={usageGroups} by={by} f={f} unit={unit} c4={c4} lots={lots.length} year={year} />
          ) : (
            <>
              <div className={`hidden gap-2 border-b border-neutral-200 px-3 pb-2 text-xs font-medium text-neutral-500 lg:grid ${LOT_COLS}`}>
                <span>{GROUPS.find((g) => g.key === by)!.label}</span>
                <span>Куплено</span>
                <span>Использовано</span>
                <span className="inline-flex items-center gap-1">
                  В учёте
                  <InfoHint label="В учёте" wide>
                    <p>Остаток по журналу движений: приход − списания в ТЗ − прочие списания. Должен совпадать с колонкой «Остаток» (остаток самого лота); если совпадает, показан значок ✓. Расхождение подсвечивается красным, подробности — в карточке лота и в «Сверке лотов».</p>
                  </InfoHint>
                </span>
                <span>Остаток</span>
                <span>% исп.</span>
                <span>Ср. цена закупки</span>
                <span>Стоимость остатка</span>
              </div>
              {groups.length === 0 && <p className="py-6 text-center text-sm text-neutral-500">{year === "all" ? "Нет лотов по выбранным фильтрам" : `За ${year} год лотов по выбранным фильтрам нет`}</p>}
              {groups.map((g) => (
                <GroupRow key={g.key} g={g} by={by} f={f} unit={unit} />
              ))}
              {groups.length > 0 && (
                <div className={`row-total grid grid-cols-2 gap-2 px-3 py-2 text-sm ${LOT_COLS}`}>
                  <span className="col-span-2 md:col-span-4 lg:col-span-1"><TotalLabel extra={`${whLots.length} лотов`} /></span>
                  <Cells a={total} unit={unit} />
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

    </div>
  );
}

function Cells({ a, unit }: { a: Agg; unit: string }) {
  const p = avgPrice(a);
  const lab = "block text-xs font-normal text-neutral-500 lg:hidden";
  return (
    <>
      <span className="tabular-nums"><span className={lab}>Куплено</span>{qty(a.recv, unit)}</span>
      <span className="tabular-nums"><span className={lab}>Использовано</span>{qty(a.used, unit)}{a.used.isZero() && a.usedIncl.greaterThan(0) && <div className="text-xs text-neutral-500"><Money incl={q2(a.usedIncl)} excl={q2(a.usedExcl)} /></div>}</span>
      <span className={"tabular-nums " + (a.jrem.equals(a.rem) ? "text-neutral-600" : "font-medium text-red-700")} title={a.jrem.equals(a.rem) ? undefined : "Остаток по журналу движений не равен остатку лотов"}>
        <span className={lab}>В учёте</span>{a.jrem.equals(a.rem) ? <span aria-label="совпадает с остатком">✓</span> : qty(a.jrem, unit)}
      </span>
      <span className="font-medium tabular-nums"><span className={lab}>Остаток</span>{qty(a.rem, unit)}</span>
      <span className="tabular-nums"><span className={lab}>% исп.</span>{pctText(usedPct(a))}</span>
      <span className="tabular-nums">
        <span className={lab}>Ср. цена закупки</span>
        {p ? <><Money incl={q2(p.incl)} excl={q2(p.excl)} /></> : a.recvIncl.greaterThan(0) ? <><Money incl={q2(a.recvIncl)} excl={q2(a.recvExcl)} /><div className="text-xs text-neutral-500">без количества</div></> : "–"}
      </span>
      <span className="tabular-nums">
        <span className={lab}>Стоимость остатка</span>
        <Money incl={q2(a.remIncl)} excl={q2(a.remExcl)} />
      </span>
    </>
  );
}

function GroupRow({ g, by, f, unit }: { g: Group; by: GroupBy; f: RawFilters; unit: string }) {
  return (
    <LazyDetails
      className="group border-b border-neutral-100"
      load={loadGroupLots.bind(null, by, g.key, f)}
      summary={
        <summary
          className={`grid cursor-pointer list-none grid-cols-2 gap-2 px-3 py-2 hover:bg-neutral-50 ${LOT_COLS} [&::-webkit-details-marker]:hidden`}
          title={g.title}
        >
          <span className="col-span-2 font-medium md:col-span-4 lg:col-span-1">
            <span className="mr-1 inline-block text-neutral-500 transition-transform group-open:rotate-90">›</span>
            {g.label}
            {g.label === SYNTHETIC_LABEL.ordered || g.label === SYNTHETIC_LABEL.hides ? null : <span className="ml-1 text-xs font-normal text-neutral-500">· {g.agg.lots} лот.</span>}
          </span>
          <Cells a={g.agg} unit={unit} />
        </summary>
      }
    />
  );
}

function UsageTable({ groups, by, f, unit, c4, lots, year }: { groups: UsageGroup[]; by: "article" | "order"; f: RawFilters; unit: string; c4: "on" | "off"; lots: number; year: string }) {
  const lab = "block text-xs font-normal text-neutral-500 lg:hidden";
  const tot = groups.reduce(
    (a, g) => ({ qty: a.qty.add(g.qty), incl: a.incl.add(g.incl), excl: a.excl.add(g.excl), ei: a.ei.add(g.extraIncl), ee: a.ee.add(g.extraExcl), produced: a.produced.add(g.produced) }),
    { qty: new Decimal(0), incl: new Decimal(0), excl: new Decimal(0), ei: new Decimal(0), ee: new Decimal(0), produced: new Decimal(0) },
  );
  const cells = (g: { orders: number; lots: number; produced: Decimal; qty: Decimal; incl: Decimal; excl: Decimal; extraIncl: Decimal; extraExcl: Decimal }, single: boolean) => {
    const pu = perUnit(g.qty, g.produced);
    return (
      <>
        <span className="tabular-nums"><span className={lab}>{single ? "Лотов" : "ТЗ / лотов"}</span>{single ? g.lots : `${g.orders} / ${g.lots}`}</span>
        <span className="tabular-nums"><span className={lab}>Готово</span>{formatQty(g.produced.toString())} шт.</span>
        <span className="font-medium tabular-nums"><span className={lab}>Списано</span>{qty(g.qty, unit)}</span>
        <span className="tabular-nums"><span className={lab}>На 1 изделие</span>{pu ? `${formatQty(pu.toFixed(2))} ${unit}` : "–"}</span>
        <span className="tabular-nums"><span className={lab}>Стоимость списания</span><CostCell incl={g.incl} excl={g.excl} extraIncl={g.extraIncl} extraExcl={g.extraExcl} c4={c4} /></span>
        <span className="tabular-nums">
          <span className={lab}>Стоимость на 1 изделие</span>
          {g.produced.greaterThan(0) ? <Money incl={q2(g.incl.div(g.produced))} excl={q2(g.excl.div(g.produced))} /> : "–"}
        </span>
      </>
    );
  };
  return (
    <>
      <div className={`hidden gap-2 border-b border-neutral-200 px-3 pb-2 text-xs font-medium text-neutral-500 lg:grid ${USAGE_COLS}`}>
        <span>{by === "article" ? "Изделие (артикул)" : "ТЗ"}</span>
        <span>{by === "article" ? "ТЗ / лотов" : "Лотов"}</span>
        <span>Готово</span>
        <span>Списано</span>
        <span className="inline-flex items-center gap-1">
          На 1 изделие
          <InfoHint label="На 1 изделие" wide>
            <p>«Готово» здесь — выпуск завершённых ТЗ (по статусу; у ТЗ в работе — 0, их план показан отдельно), а не «Заведено в ТЗ» (там готово + в работе). Списано ÷ произведено — средневзвешенно: Σ списано ÷ Σ готово по всем ТЗ изделия, а не среднее из средних. Если в ТЗ идёт несколько лотов, цифра — общая по ним.</p>
          </InfoHint>
        </span>
        <span>Стоимость списания</span>
        <span>Стоимость на 1 изделие</span>
      </div>
      {groups.length === 0 && <p className="py-6 text-center text-sm text-neutral-500">{year === "all" ? "Нет списаний по выбранным фильтрам" : `За ${year} год списаний по выбранным фильтрам нет`}</p>}
      {groups.map((g) => (
        <LazyDetails
          key={g.key}
          className="group border-b border-neutral-100"
          load={loadUsageGroupLots.bind(null, by, g.key, f)}
          summary={
            <summary className={`grid cursor-pointer list-none grid-cols-2 gap-2 px-3 py-2 hover:bg-neutral-50 ${USAGE_COLS} [&::-webkit-details-marker]:hidden`}>
              <span className="col-span-2 font-medium lg:col-span-1">
                <span className="mr-1 inline-block text-neutral-500 transition-transform group-open:rotate-90">›</span>
                {g.label}
                <span className="block pl-3 text-xs font-normal text-neutral-500">{g.sub}</span>
              </span>
              {cells(g, by === "order")}
            </summary>
          }
        />
      ))}
      {groups.length > 0 && (
        <div className={`row-total grid grid-cols-2 gap-2 px-3 py-2 text-sm ${USAGE_COLS}`}>
          <span className="col-span-2 lg:col-span-1"><TotalLabel extra={`${groups.length} · лотов в выборке: ${lots}`} /></span>
          <span />
          <span className="tabular-nums"><span className={lab}>Готово</span>{formatQty(tot.produced.toString())} шт.</span>
          <span className="tabular-nums"><span className={lab}>Списано</span>{qty(tot.qty, unit)}</span>
          <span className="tabular-nums"><span className={lab}>На 1 изделие</span>{tot.produced.greaterThan(0) ? `${formatQty(tot.qty.div(tot.produced).toFixed(2))} ${unit}` : "–"}</span>
          <span className="tabular-nums"><span className={lab}>Стоимость списания</span><CostCell incl={tot.incl} excl={tot.excl} extraIncl={tot.ei} extraExcl={tot.ee} c4={c4} /></span>
          <span />
        </div>
      )}
    </>
  );
}
