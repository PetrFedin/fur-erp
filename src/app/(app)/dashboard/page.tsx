import Link from "next/link";
import { IntegrityBanner } from "@/components/integrity-banner";
import { requireSession } from "@/lib/session";
import { formatMoney } from "@/lib/utils";
import { getCommission4Mode } from "@/lib/commission4-mode";
import { InfoHint } from "@/components/info-hint";
import { SupplierDebtHint } from "@/components/supplier-debt-hint";
import { getYearFilter, yearLabel } from "@/lib/year-filter";
import { FilterBar } from "@/components/filters/filter-bar";
import { parseFilters } from "@/lib/filters";
import { loadDashboard } from "@/lib/dashboard-data";
import { DASH_FILTERS, ORDER_STATUS_LABELS, lotFiltersOn, orderFiltersOn, type DashFilters } from "@/lib/dashboard-calc";
import { RawBlock } from "./raw-block";
import { ProductionBlock } from "./production-block";
import { TILE_BOX, TileHead, TileValue } from "./tile";
import { YearsTable, RawTable } from "./dynamics-tables";
import { PrintButton } from "./print-button";
import { PageModes, BridgeHint, type ModeInfo } from "./mode-line";
import { formatCompactMoney } from "./compact";

export const metadata = { title: "Главная" };

const PRINT_CSS = `
@media print {
  @page { size: A4 landscape; margin: 8mm; }
  html { font-size: 10px; }
  html, body { background: #fff !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .h-screen { height: auto !important; }
  .overflow-hidden, main { overflow: visible !important; }
  nav, aside, header, body > .fixed, body > div.fixed, button.fixed, [data-nextjs-dev-tools-button], nextjs-portal { display: none !important; }
  main { padding: 0 !important; }
  [class*="overflow-x-auto"], [class*="overflow-auto"], .table-scroll { overflow: visible !important; max-height: none !important; }
  table { font-size: 9px !important; min-width: 0 !important; width: 100% !important; }
  th, td { white-space: normal !important; }
  tr { break-inside: avoid; }
  section { break-inside: avoid-page; }
  [data-print-date] { display: block !important; }
}`;

/** Срок «дд.мм.гггг» уже прошёл (конец дня). */
function isPastRu(date: string): boolean {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(date);
  return m ? new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), 23, 59, 59).getTime() < Date.now() : false;
}

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const session = await requireSession();
  const c4Mode = await getCommission4Mode();
  const sp = await searchParams;
  const forbidden = sp.error === "forbidden";
  const organizationId = session.user.organizationId;
  const year = await getYearFilter();
  const f = parseFilters(DASH_FILTERS, sp) as unknown as DashFilters;
  const filtersOn = lotFiltersOn(f) || orderFiltersOn(f);

  const d = await loadDashboard(organizationId, year, f, c4Mode);
  const { debt } = d;
  const yl = yearLabel(year);
  const search: Record<string, string[]> = { auction: f.auction, fur: f.fur, color: f.color, attr: f.attr, batch: f.batch, status: f.status, vat: f.vat };
  const prodNums = (t: typeof d.prod.done) => ({ orders: t.orders, qty: t.qty, costIncl: t.costIncl, costExcl: t.costExcl, work: t.workSum, furIncl: t.furIncl, furExcl: t.furExcl, liningIncl: t.liningIncl, liningExcl: t.liningExcl, matIncl: t.furIncl + t.liningIncl, matExcl: t.furExcl + t.liningExcl, c4Incl: t.c4Incl, c4Excl: t.c4Excl });
  const FILTER_NAMES: [keyof DashFilters, string][] = [["auction", "партия закупки"], ["fur", "вид меха"], ["color", "цвет"], ["attr", "признак меха"], ["vat", "НДС"], ["status", "статус ТЗ"], ["batch", "партия пр-ва"]];
  const activeFilters = FILTER_NAMES.filter(([k]) => f[k].length > 0).map(([k, n]) => `${n} ×${f[k].length}`).join(", ");
  const info: ModeInfo = { year: yl, filters: activeFilters || null };
  const mln = (v: number) => formatCompactMoney(v);

  return (
    <div className="flex flex-col gap-5">
      <style>{PRINT_CSS}</style>
      <IntegrityBanner />
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* Режимы и «i» — рядом с заголовком, а не внутри: иначе имя заголовка читается как «Сводка · все годы · с НДС … i». */}
        <div className="flex flex-wrap items-center">
          <h1 className="text-xl font-semibold">Главная</h1>
          <PageModes info={info} c4={c4Mode} />
        </div>
        <PrintButton />
      </div>
      <p data-print-date className="hidden text-xs text-neutral-600">
        Напечатано: {new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow", dateStyle: "long", timeStyle: "short" })} (МСК) · {yl}{activeFilters ? ` · фильтры: ${activeFilters}` : ""}
      </p>
      {forbidden && (
        <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          Недостаточно прав для этого действия
        </div>
      )}

      <div className="print:hidden">
        <FilterBar
          title="Фильтры сводки"
          oneRow
          hideChips
          controls={[
            { type: "multi", name: "auction", label: "Партия закупки (аукцион)", aliases: ["auc"], options: d.options.auction, allLabel: "Все партии" },
            { type: "multi", name: "fur", label: "Вид меха", aliases: ["kind"], options: d.options.fur },
            { type: "multi", name: "color", label: "Цвет", options: d.options.color, allLabel: "Все цвета", noneLabel: d.noColorLots > 0 ? "Цвет не указан в документах" : undefined, hint: "Цвет лота по справочнику" },
            ...(d.options.attr.length > 0 ? [{ type: "multi" as const, name: "attr", label: "Признак меха", options: d.options.attr, allLabel: "Все признаки", noneLabel: "Без признака", hint: "Признаки лота по справочнику: седина, дикий / клеточный, тонированный…" }] : []),
            { type: "multi", name: "batch", label: "Партия производства", options: d.options.batch, noneLabel: "Без партии", allLabel: "Все партии" },
            { type: "multi", name: "status", label: "Статус ТЗ", options: Object.entries(ORDER_STATUS_LABELS).map(([value, label]) => ({ value, label })), allLabel: "Все статусы" },
            { type: "multi", name: "vat", label: "Ставка НДС", aliases: ["nds"], options: [{ value: "20", label: "20%" }, { value: "22", label: "22%" }], allLabel: "Любая", hint: "Ставка НДС лота" },
          ]}
          footer={
            <p className="mt-2 flex items-center gap-1 text-[11px] leading-4 text-neutral-500">
              Фильтры применяются сразу
              <InfoHint label="Что фильтруется на Главной" wide>
                <p>Год — общий, из шапки ({year === "all" ? "все годы" : `${year} год`}).</p>
                <p className="mt-1">Партия закупки, вид меха, цвет, признак меха и ставка НДС отбирают лоты (куплено, остаток, использовано) и ТЗ, в которых списан такой лот. Статус и партия производства отбирают ТЗ (и «использовано» — только по ним).</p>
                <p className="mt-1">Сужают блоки «Сырьё» и «Производство», обе таблицы динамики и «Долг заказчиков». Долг и оплаты поставщику (по закупкам и оплатам года) от фильтров не зависят{filtersOn ? " — сейчас фильтры включены" : ""}.</p>
              </InfoHint>
            </p>
          }
        />
      </div>

      <RawBlock rows={d.rawTable} fur={d.raw.fur} lining={d.raw.lining} c4={c4Mode} lots={d.raw.lots} info={info} orderFilters={orderFiltersOn(f)} />

      <YearsTable rows={d.years} c4={c4Mode} info={info} />

      <RawTable rows={d.rawTable} total={d.rawTableTotal} money={d.rawMoneyTotal} c4={c4Mode} info={info} orderFilters={orderFiltersOn(f)} />

      <ProductionBlock hides={d.hides} c4Parts={{ fur: { incl: Math.abs(d.raw.fur.incl.usedValue - d.raw.fur.incl.usedValueOther), excl: Math.abs(d.raw.fur.excl.usedValue - d.raw.fur.excl.usedValueOther) }, lining: { incl: Math.abs(d.raw.lining.incl.usedValue - d.raw.lining.incl.usedValueOther), excl: Math.abs(d.raw.lining.excl.usedValue - d.raw.lining.excl.usedValueOther) } }} years={d.years.filter((y) => y.key !== "all").map((y) => ({ label: y.label, qty: y.prod.qty }))} done={prodNums(d.prod.done)} work={prodNums(d.prod.work)} c4={c4Mode} search={search} info={info} bridge={{ usedBase: d.bridge.usedBase, comparable: d.bridge.usedComparable, lotFilters: lotFiltersOn(f), yearOnly: year !== "all" }} />

      {/* ───────── Оплаты, долги, задачи ───────── */}
      <section aria-labelledby="dash-pay" className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="dash-pay" className="text-base font-semibold">Оплаты</h2>
          <Link href="/payments" className="text-xs text-blue-700 hover:underline print:hidden">→ Оплаты</Link>
        </div>
        {(() => {
          const rawPaid = d.paidByItem.fur + d.paidByItem.lining;
          const prodPaid = d.paidByItem.work;
          const row = (k: string, v: number, sub?: boolean, tone?: string) => (
            <div className={"flex justify-between gap-3" + (sub ? " pl-3 text-xs" : "")}>
              <dt className={sub ? "text-neutral-500" : "font-medium text-neutral-700"}>{k}</dt>
              <dd className={"tabular-nums " + (sub ? "text-neutral-600 " : "font-medium ") + (tone ?? "")}>{formatMoney(v.toFixed(2))}</dd>
            </div>
          );
          // Детализация меха и подкладки: остаток на складе, использовано (без 4%) и надбавка 4% (оплачена в составе оплат ТЗ, доплаты нет).
          const detail = (x: typeof d.raw.fur.incl) => ({ stock: x.remValue, used: c4Mode === "on" ? x.usedValueOther : x.usedValue, c4: Math.abs(x.usedValue - x.usedValueOther) });
          const furD = detail(d.raw.fur.incl), linD = detail(d.raw.lining.incl);
          // Оплачено и к оплате делятся на «за использованное» и «за остаток (сток)» пропорционально их стоимости; 4% оплачены в составе оплат ТЗ (доплаты нет).
          const split = (D: ReturnType<typeof detail>, amount: number) => {
            const base = D.used + D.stock;
            const u = base > 0 ? D.used / base : 0;
            return { used: amount * u, stock: amount * (1 - u) };
          };
          const furPaidD = split(furD, d.paidByItem.fur), linPaidD = split(linD, d.paidByItem.lining);
          const furLeftD = split(furD, d.left.fur), linLeftD = split(linD, d.left.lining);
          return (
            <div className="grid grid-cols-1 items-stretch gap-3 lg:grid-cols-3 print:grid-cols-3">
              <div className={TILE_BOX}>
                <TileHead>Общая стоимость</TileHead>
                <div className="absolute right-3 top-3">
                  <InfoHint label="Что такое общая стоимость" align="right">
                    <p>Оплачено плюс осталось оплатить: сырьё (мех с шкурами подрядчика, подкладка) и работа по ТЗ. Всегда с НДС; 4% отдельно не добавляются.</p>
                  </InfoHint>
                </div>
                <TileValue>{formatMoney((rawPaid + prodPaid + d.left.raw + d.left.prod).toFixed(2))}</TileValue>
                <dl className="mt-3 space-y-1 text-sm">
                  {row("Мех", d.paidByItem.fur + d.left.fur)}
                  {row("остаток (сток)", furD.stock, true)}
                  {row("использовано", furD.used, true)}
                  {row("4%", furD.c4, true)}
                  {row("Подкладка", d.paidByItem.lining + d.left.lining)}
                  {row("остаток (сток)", linD.stock, true)}
                  {row("использовано", linD.used, true)}
                  {row("4%", linD.c4, true)}
                  {row("Работа", prodPaid + d.left.prod)}
                </dl>
              </div>

              <div className={TILE_BOX}>
                <TileHead>Оплачено</TileHead>
                <TileValue>{formatMoney((rawPaid + prodPaid).toFixed(2))}</TileValue>
                <dl className="mt-3 space-y-1 text-sm" data-testid="paid-by-item">
                  {row("Мех", d.paidByItem.fur)}
                  {row("остаток (сток)", furPaidD.stock, true)}
                  {row("использовано", furPaidD.used, true)}
                  {row("4%", furD.c4, true)}
                  {row("Подкладка", d.paidByItem.lining)}
                  {row("остаток (сток)", linPaidD.stock, true)}
                  {row("использовано", linPaidD.used, true)}
                  {row("4%", linD.c4, true)}
                  {row("Работа", prodPaid)}
                </dl>
              </div>

              <div className={TILE_BOX} data-testid="debt-bridge">
                <TileHead>К оплате</TileHead>
                <div className="absolute right-3 top-3 flex items-center gap-1">
                  <BridgeHint label="Как сходится долг поставщику">
                    <p>Закупки всего <b>{mln(debt.total.toNumber())}</b> = мех получен <b>{mln(d.bridge.purchases.received)}</b> + ещё не получен <b>{mln(d.bridge.purchases.draft)}</b>. Минус оплачено <b>{mln(d.supplierCashPaid)}</b> = долг <b>{mln(debt.debt.toNumber())}</b>.</p>
                    <p className="mt-1">Части (по УПД, счёт не оплачен, ожидаемое) в сумме дают этот долг. Всегда с НДС.</p>
                  </BridgeHint>
                  <SupplierDebtHint debt={debt} year={year} align="right" />
                </div>
                <TileValue className={d.left.raw + d.left.prod > 0 ? "text-amber-700" : ""}>{formatMoney((d.left.raw + d.left.prod).toFixed(2))}</TileValue>
                <dl className="mt-3 space-y-1 text-sm">
                  {row("Мех", d.left.fur, false, d.left.fur > 0 ? "text-amber-700" : "")}
                  {row("остаток (сток)", furLeftD.stock, true)}
                  {row("использовано", furLeftD.used, true)}
                  {row("4%", 0, true)}
                  {row("Подкладка", d.left.lining, false, d.left.lining > 0 ? "text-amber-700" : "")}
                  {row("остаток (сток)", linLeftD.stock, true)}
                  {row("использовано", linLeftD.used, true)}
                  {row("4%", 0, true)}
                  {row("Работа", d.left.prod, false, d.left.prod > 0 ? "text-amber-700" : "")}
                </dl>
                {d.invoiceDeadlines.length > 0 ? (
                  <div className="mt-2 border-t border-neutral-100 pt-2 text-xs text-neutral-600">
                    <div className="font-medium text-neutral-700">Ближайшие сроки счетов</div>
                    {d.invoiceDeadlines.map((x) => {
                      const late = isPastRu(x.date);
                      return <div key={x.auction + x.date} className={late ? "text-red-700" : undefined}>{x.date} · {x.auction} · <b className="tabular-nums">{formatMoney(x.amount.toFixed(0))}</b>{late ? " · просрочен" : ""}</div>;
                    })}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })()}
      </section>
    </div>
  );
}
