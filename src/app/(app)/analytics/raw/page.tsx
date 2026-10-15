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
import { isServiceAuction, NO_AUCTION_LABEL } from "@/lib/auction-names";
import { auctionLabeler } from "@/lib/filter-options";
import {
  GROUPS, NO_AUCTION_KEY, SYNTHETIC_LABEL, aggOf, applyFilters, avgPrice, groupLots, groupUsage, isUsageBy, loadUsageRows, lotIssues, parseFilters, pctText, usedPct,
  type Agg, type Group, type GroupBy, type LotGroupBy, type RawFilters, type RawLot, type UsageGroup,
} from "@/lib/raw-analytics";
import { prisma } from "@/lib/prisma";
import { LazyDetails } from "../../lots/lazy-details";
import { loadGroupLots, loadUsageGroupLots } from "./lots-action";
import { LOT_COLS } from "./lot-rows";
import { USAGE_COLS, perUnit } from "./usage-rows";
import { CostCell } from "./cost-cell";
import { MonthlyChart, type MonthPoint } from "./monthly-chart";
import { COMMISSION_RATE } from "@/lib/commission4-const";
import { figures } from "@/lib/fur-table";
import { flowOfRawLots } from "@/lib/fur-table-server";
import { TILE_BOX, TileHead, TileValue } from "@/app/(app)/dashboard/tile";
import { TotalLabel } from "@/components/total-label";
import { loadRawWithDashboard } from "@/lib/raw-analytics-dash";

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
    loadRawWithDashboard(session.user.organizationId, year, c4),
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
  const fIncl = figures(flow, { vat: "incl", c4: "off" });
  const fExcl = figures(flow, { vat: "excl", c4: "off" });
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
  const k4 = new Decimal(1).add(COMMISSION_RATE);

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
  const byKind = groupLots(lots, "kind");
  const byAuction = groupLots(lots, "auction").sort((a, b) => b.agg.recv.comparedTo(a.agg.recv)).slice(0, 12);
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

  // ───── качество данных (по всем лотам выбранного года, без фильтров таблицы) ─────
  const all = aggOf(data.lots);
  const noGrade = data.lots.filter((l) => l.gradeEmpty);
  const noSize = data.lots.filter((l) => l.unit !== "M" && l.size === "Не указан");
  const noAuction = data.lots.filter((l) => l.auction === NO_AUCTION_KEY || isServiceAuction(l.auction));
  const otherOutLots = data.lots.filter((l) => !l.otherOut.isZero());
  const gapLots = data.lots.filter((l) => !l.movementGap.isZero());
  const reconLots = data.lots.filter((l) => lotIssues(l).length > 0);
  const purchasedDiff = all.recv.sub(data.purchasedByItems);
  const usageDiff = all.used.sub(data.usageTotal);
  const issues =
    noGrade.length + otherOutLots.length + gapLots.length + data.movementsWithoutLot.count + data.receivedItemsWithoutLot +
    (purchasedDiff.isZero() ? 0 : 1) + (usageDiff.isZero() ? 0 : 1);

  const lotLink = (l: RawLot) => (
    <Link href={`/analytics/raw/lot/${l.id}`} className="underline hover:text-neutral-900">
      {l.lotNumber}
    </Link>
  );
  const lotList = (arr: RawLot[], extra?: (l: RawLot) => string) => {
    const noNum = arr.filter((l) => l.lotNumber === "Без номера");
    const list = arr.filter((l) => l.lotNumber !== "Без номера");
    return (
      <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {list.slice(0, 40).map((l) => (
          <li key={l.id}>
            {lotLink(l)}
            {extra ? <span className="text-neutral-500"> ({extra(l)})</span> : null}
          </li>
        ))}
        {list.length > 40 && <li className="text-neutral-500">…и ещё {list.length - 40}</li>}
        {noNum.length > 0 && <li>Без номера — {noNum.length} {noNum.length % 10 === 1 && noNum.length % 100 !== 11 ? "лот" : noNum.length % 10 >= 2 && noNum.length % 10 <= 4 && (noNum.length % 100 < 12 || noNum.length % 100 > 14) ? "лота" : "лотов"}</li>}
      </ul>
    );
  };

  const pctAll = usedPct(total);
  const ex = (l: Decimal) => formatQty(l.toString());

  const checkEls = [
      <Check key="c1" ok={purchasedDiff.isZero()} text={`Куплено по лотам = количество в принятых закупках: ${ex(all.recv)} и ${ex(data.purchasedByItems)}${purchasedDiff.isZero() ? "" : ` (разница ${ex(purchasedDiff)})`}. Мех и подкладка вместе.`} />,
      <Check key="c2" ok={usageDiff.isZero()} text={`Использовано по лотам = Σ списаний в ТЗ: ${ex(all.used)} и ${ex(data.usageTotal)}${usageDiff.isZero() ? "" : ` (разница ${ex(usageDiff)})`}.`} />,
      <Check key="c3" ok={otherOutLots.length === 0} text={otherOutLots.length === 0 ? "Остаток лота = получено − списано в ТЗ: у всех лотов." : `У ${otherOutLots.length} лотов остаток ≠ получено − списано в ТЗ (ушло не через ТЗ):`}>
            {otherOutLots.length > 0 && lotList(otherOutLots, (l) => `${ex(l.otherOut)}`)}
          </Check>,
      <Check key="c4" ok={gapLots.length === 0} text={gapLots.length === 0 ? "Остаток по журналу = Σ лотов: журнал движений сходится с остатком у всех лотов." : `У ${gapLots.length} лотов остаток расходится с журналом движений:`}>
            {gapLots.length > 0 && lotList(gapLots, (l) => `журнал − остаток = ${ex(l.movementGap)}`)}
          </Check>,
      <Check key="c5" ok={data.movementsWithoutLot.count === 0} text={data.movementsWithoutLot.count === 0 ? "Списаний и приходов без лота нет." : `Движений без лота: ${data.movementsWithoutLot.count} (на ${ex(data.movementsWithoutLot.qty)}).`} />,
      <Check key="c6" ok={data.receivedItemsWithoutLot === 0} text={data.receivedItemsWithoutLot === 0 ? "У каждой позиции принятой закупки есть лот." : `Позиций принятых закупок без лота: ${data.receivedItemsWithoutLot}.`} />,
      <Check key="c7" ok={noGrade.length === 0} warn text={noGrade.length === 0 ? "У всех лотов указан сорт или цвет." : `Лотов без сорта и цвета: ${noGrade.length} из ${data.lots.length}:`}>
            {noGrade.length > 0 && lotList(noGrade)}
          </Check>,
      <Check key="c8" ok={noSize.length === 0} warn text={noSize.length === 0 ? "У всех лотов меха распознан размер." : `Лотов меха без размера: ${noSize.length} — в группе «Не указан».`} />,
      <Check key="c9" ok={noAuction.length === 0} warn text={noAuction.length === 0 ? "Все лоты привязаны к аукциону." : `Лотов без аукциона: ${noAuction.length}.`} />
  ];
  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[fromPurchases ? { label: "Закупки", href: "/purchases" } : { label: "Сырьё", href: "/lots" }, { label: "Аналитика" }]} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold">Аналитика сырья</h1><YearNote year={year} />
          <Mode4Badge mode={c4} />
          <InfoHint label="О странице" wide>
            <p>Куплено → использовано в ТЗ → остаток по аукционам, годам, видам меха, лотам, сортам и размерам. Источник — лоты склада: принятая закупка создаёт лот, списания в ТЗ ссылаются на лот.</p>
            <p className="mt-1">Год — из шапки, по дате заказа закупки: берутся лоты закупок этого года и всё, что из них списано в ТЗ.</p>
            <p className="mt-1">Деньги — по цене лота за единицу (курс, НДС, расходы закупки). Среднее везде средневзвешенное: Σ(цена × кол-во) ÷ Σ кол-во. 4% — справочная строка «с 4%», в цену лота не входит.</p>
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
          Показаны лоты, из которых сделано изделие «{modelName ?? "—"}».
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

      {/* Итоги */}
      <WidgetRow id="raw" title="Итоги" headerEnd={<Link href={fromPurchases ? "/purchases" : "/lots"} className="text-xs text-blue-700 hover:underline print:hidden">{fromPurchases ? "→ Закупки" : "→ Сырьё"}</Link>}>
      <div className="grid grid-cols-2 items-stretch gap-3 lg:grid-cols-5">
        <Tile unit={unit} c4={c4}
          title="Куплено"
          avg={{ incl: fIncl.recvAvg, excl: fExcl.recvAvg, what: "закупки" }}
          q={total.recv}
          incl={total.recvIncl}
          excl={total.recvExcl}
          hint={
            <>
              <p>Те же цифры, что «Куплено» на Главной: лоты склада + заказано, но ещё не получено (лотов пока нет) + шкуры подрядчика (только в рублях). Стоимость лота = кол-во × цена лота за единицу.</p>
              <p className="mt-1">Сейчас: {qty(total.recv, unit)} — {whLots.length} лотов склада{bridgeText}. В таблице ниже эти позиции отдельными строками «Заказано, не получено» и «Шкуры подрядчика». Сверка с закупками в статусе «Принята» — в блоке «Качество данных».</p>
            </>
          }
        />
        <Tile unit={unit} c4={c4}
          title="Использовано"
          avg={{ incl: fIncl.usedAvg, excl: fExcl.usedAvg, what: "использованного" }}
          q={total.used}
          incl={total.usedIncl}
          excl={total.usedExcl}
          extra={{ incl: total.usedExtraIncl, excl: total.usedExtraExcl }}
          hint={
            <>
              <p>Те же цифры, что «Использовано» на Главной: списания сырья в ТЗ по лотам (стоимость — по цене лота на момент списания) + шкуры подрядчика (оплачены в составе пошива, в ТЗ не списаны).</p>
              <p className="mt-1">Сейчас: {qty(total.used, unit)} = {pctText(pctAll)} от купленного.</p>
              <p className="mt-1">4% начисляется только на списания, где оно применяется (флаг строки), — строка «с 4%».</p>
            </>
          }
        />
        <Tile unit={unit} c4={c4}
          title="Списано иначе"
          q={otherQty}
          incl={otherIncl}
          excl={otherExcl}
          hint={
            <>
              <p>Получено − остаток − использовано в ТЗ. Это ручные корректировки остатка, потери и пр. — то, что ушло с лота не через ТЗ.</p>
              <p className="mt-1">Сейчас: {ex(total.recv)} − {ex(total.rem)} − {ex(total.used)} = <b>{ex(otherQty)}</b> {unit}. Должно быть 0, пока остаток меняется только ТЗ.</p>
            </>
          }
          sub={!otherQty.isZero() ? <div className="text-xs text-amber-700">есть расхождение — см. качество данных</div> : null}
        />
        <Tile unit={unit} c4={c4}
          title="Остаток"
          avg={{ incl: fIncl.remAvg, excl: fExcl.remAvg, what: "остатка" }}
          q={total.rem}
          incl={total.remIncl}
          excl={total.remExcl}
          extra={{ incl: total.remIncl.mul(k4.sub(1)), excl: total.remExcl.mul(k4.sub(1)) }}
          hint={
            <>
              <p>Те же цифры, что «Остаток» на Главной: остатки лотов склада + заказано, но не получено. Стоимость лота = остаток × цена лота за единицу — так же считает карточка «Итого стоимость остатков» на странице «Сырьё».</p>
              <p className="mt-1">Сейчас: {qty(total.rem, unit)} × средняя цена {avgPrice(total) ? rub(avgPrice(total)!.incl) : "—"} ≈ {rub(total.remIncl)} (средняя цена остатка может отличаться от средней закупки — остаток лежит в других лотах).</p>
            </>
          }
        />
        <div className="relative col-span-2 lg:col-span-1">
          <div className={TILE_BOX + " shadow-sm print:shadow-none"}>
            <TileHead>% использовано</TileHead>
            <TileValue>{pctText(pctAll)}</TileValue>
            <div className="mt-2 flex h-2 overflow-hidden rounded bg-neutral-100" role="img" aria-label={`Использовано ${pctText(pctAll)}`}>
              <div className="bg-neutral-500" style={{ width: `${Math.min(100, pctAll ?? 0)}%` }} />
            </div>
          </div>
          <div className="absolute right-3 top-3">
            <InfoHint label="% использовано" align="right">
              <p>Использовано ÷ куплено × 100.</p>
              <p className="mt-1">Сейчас: {ex(total.used)} ÷ {ex(total.recv)} = {pctText(pctAll)}.</p>
            </InfoHint>
          </div>
        </div>
      </div>
      </WidgetRow>

      {/* Сводная таблица */}
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            Сводная таблица
            <InfoHint label="О таблице" wide>
              <p>Группируйте по аукциону, году закупки, виду меха, лоту, сорту/цвету или размеру. Строку можно развернуть: внутри — лоты с остатком, ценой и ТЗ, где использован лот.</p>
              <p className="mt-1"><b>Изделие (артикул)</b> и <b>ТЗ</b> — другой разрез: что ушло на каждое изделие или ТЗ (шкур или метров, ₽, на 1 изделие); строка раскрывается в лоты. У каждого лота есть карточка «Где использован» — в какие изделия он ушёл, учёт и остаток.</p>
              <p className="mt-1">Сорт/цвет и размер берутся из поля «сорт» лота: размер берётся из документов (поле «размер» лота: XXL, XL, 30, 40/30…), сорт — остальной текст до размера. Размер не указан в документах — «Не указан».</p>
              <p className="mt-1"><b>Средняя цена</b> = Σ(кол-во × цена лота) ÷ Σ кол-во по лотам группы. <b>Стоимость остатка</b> = Σ(остаток × цена лота). Цены и остаток — без 4%: надбавка 4% начисляется только при списании в ТЗ (в плитках сверху — справочно, режим в шапке).</p>
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
              <div className={`hidden gap-2 border-b border-neutral-200 px-3 pb-2 text-xs font-medium text-neutral-500 md:grid ${LOT_COLS}`}>
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
                <GroupRow key={g.key} g={g} by={by} f={f} unit={unit} c4={c4} />
              ))}
              {groups.length > 0 && (
                <div className={`row-total grid grid-cols-2 gap-2 px-3 py-2 text-sm ${LOT_COLS}`}>
                  <span className="col-span-2 md:col-span-1"><TotalLabel extra={`${whLots.length} лотов`} /></span>
                  <Cells a={total} unit={unit} c4={c4} />
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Графики */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Остаток по видам меха
              <InfoHint label="Остаток по видам" wide>
                <p>Длина полосы — сколько куплено; тёмная часть — использовано, зелёная — остаток. Видно, какого меха осталось больше всего.</p>
                {byKind[0] && <p className="mt-1">Например, «{byKind[0].label}»: куплено {ex(byKind[0].agg.recv)}, использовано {ex(byKind[0].agg.used)}, остаток {ex(byKind[0].agg.rem)} {unit}.</p>}
              </InfoHint>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Legend />
            <div className="mt-2 flex flex-col gap-2">
              {byKind.map((g) => {
                const max = Math.max(...byKind.map((x) => x.agg.recv.toNumber()), 1);
                return <StackBar key={g.key} label={g.label} agg={g.agg} max={max} unit={unit} />;
              })}
              {byKind.length === 0 && <p className="text-sm text-neutral-500">Нет данных.</p>}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Использование по аукционам
              <InfoHint label="Использование по аукционам" wide>
                <p>Для каждого аукциона (до 12 крупнейших по объёму закупки) — доля купленного, уже ушедшая в ТЗ. Длина полосы — объём закупки.</p>
              </InfoHint>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Legend />
            <div className="mt-2 flex flex-col gap-2">
              {byAuction.map((g) => {
                const max = Math.max(...byAuction.map((x) => x.agg.recv.toNumber()), 1);
                return <StackBar key={g.key} label={g.label} title={g.title} agg={g.agg} max={max} unit={unit} showPct />;
              })}
              {byAuction.length === 0 && <p className="text-sm text-neutral-500">Нет данных.</p>}
            </div>
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Динамика закупок по месяцам
              <InfoHint label="Динамика закупок" wide>
                <p>Сколько принято в сырьё в каждом месяце (по дате заказа закупки): в {unit} или в ₽ (с учётом режима НДС из шапки). Переключатель — над графиком.</p>
                {byYear.length > 0 && (
                  <p className="mt-1">По годам: {byYear.map((y) => `${y.label} — ${ex(y.agg.recv)} ${unit} на ${rub(y.agg.recvIncl)}`).join("; ")}.</p>
                )}
              </InfoHint>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <MonthlyChart points={monthPoints} unit={unit} />
            {byYear.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
                {byYear.map((y) => (
                  <span key={y.key}>
                    <b>{y.label}:</b> {qty(y.agg.recv, unit)}, <Money incl={q2(y.agg.recvIncl)} excl={q2(y.agg.recvExcl)} />
                  </span>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Качество данных */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Качество данных
            <span className={"rounded-full px-2 py-0.5 text-xs font-medium " + (issues === 0 ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800")}>
              {issues === 0 ? "всё сходится" : `замечаний: ${issues}`}
            </span>
            <InfoHint label="О контроле" wide>
              <p>Проверки по всем лотам выбранного года (мех и подкладка вместе, без фильтров таблицы): сходятся ли «куплено» с закупками, «использовано» со списаниями, остаток с журналом движений.</p>
              {checkEls.filter((c) => c.props.ok).map((c) => <p key={c.key} className="mt-1 text-emerald-800">✓ {c.props.text}</p>)}
            </InfoHint>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          {checkEls.filter((c) => !c.props.ok)}
          {checkEls.every((c) => c.props.ok) ? <p className="text-neutral-600">Все проверки в порядке.</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}

function Tile({ title, hint, q, incl, excl, extra, sub, unit, c4, avg }: { unit: string; c4: "on" | "off"; title: string; hint: React.ReactNode; q: Decimal; incl: Decimal; excl: Decimal; extra?: { incl: Decimal; excl: Decimal } | null; sub?: React.ReactNode; avg?: { incl: number | null; excl: number | null; what: string } }) {
  return (
    <div className="relative">
      <div className={TILE_BOX + " shadow-sm print:shadow-none"}>
        <TileHead>{title}</TileHead>
        <TileValue>{qty(q, unit)}</TileValue>
        <div className="text-sm tabular-nums text-neutral-700">
          <Money incl={q2(incl)} excl={q2(excl)} />
        </div>
        {extra && c4 === "on" && (
          <div className="text-xs text-neutral-500">
            с 4%: <Money incl={q2(incl.add(extra.incl))} excl={q2(excl.add(extra.excl))} />
          </div>
        )}
        {avg && avg.incl != null && (
          <div className="text-xs text-neutral-500" title={`Средневзвешенная цена ${avg.what} = Σ ₽ ÷ Σ ${unit}`}>
            ср. цена: <Money incl={q2(new Decimal(avg.incl))} excl={avg.excl != null ? q2(new Decimal(avg.excl)) : null} />/{unit}
          </div>
        )}
        {sub}
      </div>
      <div className="absolute right-3 top-3">
        <InfoHint label={title} wide align="right">{hint}</InfoHint>
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div className="flex gap-4 text-xs text-neutral-600">
      <span className="inline-flex items-center gap-1"><i className="inline-block size-2.5 rounded-sm bg-neutral-500" /> использовано</span>
      <span className="inline-flex items-center gap-1"><i className="inline-block size-2.5 rounded-sm bg-teal-700" /> остаток</span>
    </div>
  );
}

function StackBar({ label, title, agg, max, unit, showPct }: { label: string; title?: string; agg: Agg; max: number; unit: string; showPct?: boolean }) {
  const recv = agg.recv.toNumber();
  const used = agg.used.toNumber();
  const rem = agg.rem.toNumber();
  const w = (recv / max) * 100;
  return (
    <div title={`${title ?? label}: куплено ${formatQty(recv)}, использовано ${formatQty(used)}, остаток ${formatQty(rem)} ${unit}`}>
      <div className="flex justify-between gap-2 text-xs">
        <span className="truncate font-medium text-neutral-800">{label}</span>
        <span className="shrink-0 tabular-nums text-neutral-600">
          {showPct ? `${pctText(usedPct(agg))} · ` : ""}ост. {formatQty(rem)} {unit}
        </span>
      </div>
      <div className="mt-0.5 flex h-3 gap-0.5" style={{ width: `${Math.max(w, 1)}%` }}>
        {used > 0 && <div className="rounded-sm bg-neutral-500" style={{ flexGrow: used }} />}
        {rem > 0 && <div className="rounded-sm bg-teal-700" style={{ flexGrow: rem }} />}
        {used <= 0 && rem <= 0 && <div className="flex-1 rounded-sm bg-neutral-200" />}
      </div>
    </div>
  );
}

function Check({ ok, warn, text, children }: { ok: boolean; warn?: boolean; text: string; children?: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className={"mt-0.5 shrink-0 text-xs font-bold " + (ok ? "text-emerald-700" : warn ? "text-amber-700" : "text-red-600")} aria-label={ok ? "в порядке" : "замечание"}>
        {ok ? "✓" : warn ? "!" : "✗"}
      </span>
      <div>
        <span className={ok ? "text-neutral-700" : "text-neutral-900"}>{text}</span>
        {children}
      </div>
    </div>
  );
}

function Cells({ a, unit, c4 }: { a: Agg; unit: string; c4: "on" | "off" }) {
  const p = avgPrice(a);
  const lab = "block text-xs font-normal text-neutral-500 md:hidden";
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
        {p ? <><Money incl={q2(p.incl)} excl={q2(p.excl)} /></> : a.recvIncl.greaterThan(0) ? <><Money incl={q2(a.recvIncl)} excl={q2(a.recvExcl)} /><div className="text-xs text-neutral-500">без количества</div></> : "—"}
      </span>
      <span className="tabular-nums">
        <span className={lab}>Стоимость остатка</span>
        <Money incl={q2(a.remIncl)} excl={q2(a.remExcl)} />
      </span>
    </>
  );
}

function GroupRow({ g, by, f, unit, c4 }: { g: Group; by: GroupBy; f: RawFilters; unit: string; c4: "on" | "off" }) {
  return (
    <LazyDetails
      className="group border-b border-neutral-100"
      load={loadGroupLots.bind(null, by, g.key, f)}
      summary={
        <summary
          className={`grid cursor-pointer list-none grid-cols-2 gap-2 px-3 py-2 hover:bg-neutral-50 ${LOT_COLS} [&::-webkit-details-marker]:hidden`}
          title={g.title}
        >
          <span className="col-span-2 font-medium md:col-span-1">
            <span className="mr-1 inline-block text-neutral-500 transition-transform group-open:rotate-90">›</span>
            {g.label}
            {g.label === SYNTHETIC_LABEL.ordered || g.label === SYNTHETIC_LABEL.hides ? null : <span className="ml-1 text-xs font-normal text-neutral-500">· {g.agg.lots} лот.</span>}
          </span>
          <Cells a={g.agg} unit={unit} c4={c4} />
        </summary>
      }
    />
  );
}

function UsageTable({ groups, by, f, unit, c4, lots, year }: { groups: UsageGroup[]; by: "article" | "order"; f: RawFilters; unit: string; c4: "on" | "off"; lots: number; year: string }) {
  const lab = "block text-xs font-normal text-neutral-500 md:hidden";
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
        <span className="tabular-nums"><span className={lab}>На 1 изделие</span>{pu ? `${formatQty(pu.toFixed(2))} ${unit}` : "—"}</span>
        <span className="tabular-nums"><span className={lab}>Стоимость списания</span><CostCell incl={g.incl} excl={g.excl} extraIncl={g.extraIncl} extraExcl={g.extraExcl} c4={c4} /></span>
        <span className="tabular-nums">
          <span className={lab}>Стоимость на 1 изделие</span>
          {g.produced.greaterThan(0) ? <Money incl={q2(g.incl.div(g.produced))} excl={q2(g.excl.div(g.produced))} /> : "—"}
        </span>
      </>
    );
  };
  return (
    <>
      <div className={`hidden gap-2 border-b border-neutral-200 px-3 pb-2 text-xs font-medium text-neutral-500 md:grid ${USAGE_COLS}`}>
        <span>{by === "article" ? "Изделие (артикул)" : "ТЗ"}</span>
        <span>{by === "article" ? "ТЗ / лотов" : "Лотов"}</span>
        <span>Готово</span>
        <span>Списано</span>
        <span className="inline-flex items-center gap-1">
          На 1 изделие
          <InfoHint label="На 1 изделие" wide>
            <p>«Готово» здесь — выпуск завершённых ТЗ (по статусу; у ТЗ в работе — 0, их план показан отдельно), а не «В выпуске» с Главной (там готово + в работе). Списано ÷ произведено — средневзвешенно: Σ списано ÷ Σ готово по всем ТЗ изделия, а не среднее из средних. Если в ТЗ идёт несколько лотов, цифра — общая по ним.</p>
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
              <span className="col-span-2 font-medium md:col-span-1">
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
          <span className="col-span-2 md:col-span-1"><TotalLabel extra={`${groups.length} · лотов в выборке: ${lots}`} /></span>
          <span />
          <span className="tabular-nums"><span className={lab}>Готово</span>{formatQty(tot.produced.toString())} шт.</span>
          <span className="tabular-nums"><span className={lab}>Списано</span>{qty(tot.qty, unit)}</span>
          <span className="tabular-nums"><span className={lab}>На 1 изделие</span>{tot.produced.greaterThan(0) ? `${formatQty(tot.qty.div(tot.produced).toFixed(2))} ${unit}` : "—"}</span>
          <span className="tabular-nums"><span className={lab}>Стоимость списания</span><CostCell incl={tot.incl} excl={tot.excl} extraIncl={tot.ei} extraExcl={tot.ee} c4={c4} /></span>
          <span />
        </div>
      )}
    </>
  );
}
