import Link from "next/link";
import { requireSession } from "@/lib/session";
import { formatMoney } from "@/lib/utils";
import { InclVatOnlyLabel } from "@/components/vat-label";
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
import { TILE_BOX, TileCaption, TileHead, TileValue } from "./tile";
import { YearsTable, RawTable } from "./dynamics-tables";
import { PrintButton } from "./print-button";

export const metadata = { title: "Сводка" };

const PRINT_CSS = `
@media print {
  @page { size: A4 landscape; margin: 9mm; }
  html, body { background: #fff !important; }
  .h-screen { height: auto !important; }
  .overflow-hidden, main { overflow: visible !important; }
  aside, header, nav[aria-label="Контроль"] { display: none !important; }
  main { padding: 0 !important; }
  table { font-size: 9px !important; }
  .table-scroll { overflow: visible !important; }
  table { min-width: 0 !important; }
  section { break-inside: avoid-page; }
}`;

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
  const search: Record<string, string[]> = { auction: f.auction, fur: f.fur, color: f.color, batch: f.batch, status: f.status, vat: f.vat };
  const prodNums = (t: typeof d.prod.done) => ({ orders: t.orders, qty: t.qty, costIncl: t.costIncl, costExcl: t.costExcl, work: t.workSum });
  const clientTotal = d.clientDebts.reduce((s, c) => s + c.balance, 0);
  const clientBillable = d.clientDebts.reduce((s, c) => s + c.billable, 0);
  const clientPaid = d.clientDebts.reduce((s, c) => s + c.paid, 0);
  const pv = debt.paymentsVerification;
  const ctl = d.control;

  return (
    <div className="flex flex-col gap-5">
      <style>{PRINT_CSS}</style>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">
          Сводка<span className="ml-2 text-sm font-normal text-neutral-500">· {yl} · {c4Mode === "on" ? "с 4%" : "без 4%"}</span>
        </h1>
        <PrintButton />
      </div>
      {forbidden && (
        <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          Недостаточно прав для этого действия
        </div>
      )}

      <div className="print:hidden">
        <FilterBar
          title="Фильтры сводки"
          controls={[
            { type: "multi", name: "auction", label: "Партия закупки (аукцион)", aliases: ["auc"], options: d.options.auction, allLabel: "Все партии" },
            { type: "multi", name: "fur", label: "Вид меха", aliases: ["kind"], options: d.options.fur },
            { type: "multi", name: "color", label: "Цвет", options: d.options.color, allLabel: "Все цвета", noneLabel: d.noColorLots > 0 ? "Цвет не указан в документах" : undefined, hint: "Цвет лота по справочнику" },
            { type: "multi", name: "batch", label: "Партия производства", options: d.options.batch, noneLabel: "Без партии", allLabel: "Все партии" },
            { type: "multi", name: "status", label: "Статус ТЗ", options: Object.entries(ORDER_STATUS_LABELS).map(([value, label]) => ({ value, label })), allLabel: "Все статусы" },
            { type: "multi", name: "vat", label: "Ставка НДС", aliases: ["nds"], options: [{ value: "20", label: "20%" }, { value: "22", label: "22%" }], allLabel: "Любая", hint: "Ставка НДС лота" },
          ]}
          footer={
            <p className="mt-2 flex flex-wrap items-center gap-1 text-[11px] leading-4 text-neutral-500">
              Год — общий, из шапки ({year === "all" ? "все годы" : `${year} год`}); фильтры применяются сразу.
              {filtersOn
                ? " Сужают: блоки «Сырьё» и «Производство», обе таблицы динамики и «Долг заказчиков»; не зависят от них: долг и оплаты поставщику, задачи."
                : " Фильтры сужают блоки «Сырьё» и «Производство», таблицы динамики и «Долг заказчиков»."}
              <InfoHint label="Что фильтруется на Сводке" wide>
                <p>Партия закупки, вид меха, цвет и ставка НДС отбирают лоты (куплено, остаток, использовано) и ТЗ, в которых списан такой лот. Статус и партия производства отбирают ТЗ (и «использовано» — только по ним).</p>
                <p className="mt-1">Долг и оплаты поставщику (по закупкам и оплатам года) и «Задачи» (как в «Контроле») от фильтров не зависят.</p>
              </InfoHint>
            </p>
          }
        />
      </div>

      <RawBlock fur={d.raw.fur} lining={d.raw.lining} c4={c4Mode} lots={d.raw.lots} />

      <ProductionBlock done={prodNums(d.prod.done)} work={prodNums(d.prod.work)} c4={c4Mode} search={search} />

      <YearsTable rows={d.years} c4={c4Mode} />

      <RawTable rows={d.rawTable} total={d.rawTableTotal} c4={c4Mode} />

      {/* ───────── Оплаты, долги, задачи ───────── */}
      <section aria-labelledby="dash-pay" className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="dash-pay" className="text-base font-semibold">Оплаты, долги, задачи</h2>
          <span className="text-xs text-neutral-500">всегда с НДС · {yl}</span>
        </div>
        <div className="grid grid-cols-1 items-stretch gap-3 lg:grid-cols-3 print:grid-cols-3">
          <div className={TILE_BOX}>
            <TileHead><InclVatOnlyLabel base="Долг поставщику" /></TileHead>
            <div className="absolute right-3 top-3"><SupplierDebtHint debt={debt} year={year} align="right" /></div>
            <TileValue className={debt.debt.greaterThan(0) ? "text-amber-700" : ""}>{formatMoney(debt.debt.toFixed(2))}</TileValue>
            <TileCaption>всего к оплате по закупкам: части ниже в сумме дают этот долг</TileCaption>
            <dl className="mt-2 space-y-1 text-sm">
              <div className="flex justify-between gap-3"><dt className="text-neutral-600">К оплате по УПД и счетам</dt><dd className="font-medium tabular-nums">{formatMoney(debt.receivedNet.toFixed(2))}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-neutral-600">Счёт выставлен, не оплачен</dt><dd className="font-medium tabular-nums">{formatMoney(debt.invoiced.toFixed(2))}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-neutral-600">Ожидаемое (счёта ещё нет)</dt><dd className="font-medium tabular-nums">{formatMoney(debt.expected.toFixed(2))}</dd></div>
            </dl>
            {d.invoiceDeadlines.length > 0 ? (
              <div className="mt-2 border-t border-neutral-100 pt-2 text-xs text-neutral-600">
                <div className="font-medium text-neutral-700">Ближайшие сроки счетов</div>
                {d.invoiceDeadlines.map((x) => <div key={x.auction + x.date}>{x.date} · {x.auction} · <b className="tabular-nums">{formatMoney(x.amount.toFixed(0))}</b></div>)}
              </div>
            ) : null}
            <Link href="/payments" className="mt-2 inline-block text-xs text-blue-700 hover:underline print:hidden">→ Оплаты</Link>
          </div>

          <div className={TILE_BOX}>
            <TileHead>Оплачено поставщику</TileHead>
            <TileValue>{formatMoney(d.supplierCashPaid.toFixed(2))}</TileValue>
            <TileCaption>
              {pv ? (
                <>подтверждено <b className="tabular-nums">{formatMoney(pv.verified.toFixed(0))}</b> · <span className={pv.waiting.greaterThan(0) ? "text-amber-700" : undefined}>не подтверждено <b className="tabular-nums">{formatMoney(pv.waiting.toFixed(0))}</b></span></>
              ) : null}
            </TileCaption>
            <div className="mt-1 text-xs text-neutral-500">закупки {formatMoney(debt.total.toFixed(0))} · авансы без привязки {formatMoney(debt.unlinkedAdvances.toFixed(0))}</div>
            <div className="mt-4 border-t border-neutral-100 pt-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-500"><InclVatOnlyLabel base="Долг заказчиков" /></div>
              <div className={"mt-1 text-xl font-semibold tabular-nums " + (clientTotal > 0 ? "text-amber-700" : "")}>{formatMoney(clientTotal.toFixed(2))}</div>
              <div className="text-xs text-neutral-500">работы {formatMoney(clientBillable.toFixed(0))} · оплачено {formatMoney(clientPaid.toFixed(0))}</div>
            </div>
          </div>

          <div className={TILE_BOX}>
            <TileHead>
              Задачи
              <InfoHint label="Задачи и фильтры" align="right">Число задач — как в «Контроле»; от фильтров Сводки не зависит.</InfoHint>
            </TileHead>
            {ctl ? (
              <>
                <TileValue className={ctl.urgent > 0 ? "text-red-600" : ctl.tasks > 0 ? "text-amber-700" : ""}>{ctl.tasks}</TileValue>
                <TileCaption>ждёт подтверждения <b className="tabular-nums text-neutral-700">{ctl.waiting}</b> · не хватает документов <b className="tabular-nums text-neutral-700">{ctl.docGaps}</b></TileCaption>
                <ul className="mt-2 space-y-1 text-sm">
                  {(ctl.top ?? []).map((b) => (
                    <li key={b.id} className="flex justify-between gap-3">
                      <Link href="/attention" className="text-blue-700 hover:underline">{b.title}</Link>
                      <span className={"font-medium tabular-nums " + (b.priority === "red" ? "text-red-600" : "")}>{b.count}</span>
                    </li>
                  ))}
                  {(ctl.top ?? []).length === 0 ? <li className="text-neutral-500">Задач нет</li> : null}
                </ul>
                <div className="mt-2 flex gap-3 text-xs print:hidden">
                  <Link href="/attention" className="text-blue-700 hover:underline">→ Контроль: Задачи</Link>
                  <Link href="/verify" className="text-blue-700 hover:underline">→ Подтвердить</Link>
                </div>
              </>
            ) : <div className="mt-2 text-sm text-neutral-500">Нет данных</div>}
          </div>
        </div>

        {d.clientDebts.length > 0 ? (
          <details className="rounded-lg border border-neutral-200 bg-white" id="client-debt">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-2.5 text-sm font-medium hover:bg-neutral-50">
              <span><InclVatOnlyLabel base="Остаток к оплате по заказчикам" /></span>
              <span className="text-xs font-normal text-neutral-500">{d.clientDebts.length} заказчиков · развернуть</span>
            </summary>
            <div className="overflow-x-auto border-t border-neutral-100">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-neutral-500"><th className="px-3 py-1.5 font-medium">Заказчик</th><th className="px-3 py-1.5 text-right font-medium">ТЗ</th><th className="px-3 py-1.5 text-right font-medium">Остаток к оплате</th></tr></thead>
                <tbody>
                  {d.clientDebts.map((c) => (
                    <tr key={c.clientId} className="border-t border-neutral-100">
                      <td className="px-3 py-1.5">
                        <Link href={`/production?q=${encodeURIComponent(c.clientName)}`} className="hover:underline">{c.clientName}</Link>
                        {c.unpricedOrders > 0 ? <span className="ml-1 text-xs text-neutral-400">({c.unpricedOrders} ТЗ без цены работ — не учтены)</span> : null}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{c.orders}</td>
                      <td className={"px-3 py-1.5 text-right tabular-nums " + (c.balance > 0 ? "text-amber-700" : "")}>{formatMoney(c.balance.toFixed(2))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        ) : null}
      </section>
    </div>
  );
}
