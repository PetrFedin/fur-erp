import Link from "next/link";
import { IntegrityBanner } from "@/components/integrity-banner";
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
import { PageModes, BridgeHint, type ModeInfo } from "./mode-line";
import { formatCompactMoney } from "./compact";

export const metadata = { title: "Сводка" };

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
  const prodNums = (t: typeof d.prod.done) => ({ orders: t.orders, qty: t.qty, costIncl: t.costIncl, costExcl: t.costExcl, work: t.workSum, matIncl: t.furIncl + t.liningIncl, matExcl: t.furExcl + t.liningExcl, c4Incl: t.c4Incl, c4Excl: t.c4Excl });
  const FILTER_NAMES: [keyof DashFilters, string][] = [["auction", "партия закупки"], ["fur", "вид меха"], ["color", "цвет"], ["attr", "признак меха"], ["vat", "НДС"], ["status", "статус ТЗ"], ["batch", "партия пр-ва"]];
  const activeFilters = FILTER_NAMES.filter(([k]) => f[k].length > 0).map(([k, n]) => `${n} ×${f[k].length}`).join(", ");
  const info: ModeInfo = { year: yl, filters: activeFilters || null };
  const mln = (v: number) => formatCompactMoney(v);
  const clientTotal = d.clientDebts.reduce((s, c) => s + c.balance, 0);
  const clientBillable = d.clientDebts.reduce((s, c) => s + c.billable, 0);
  const clientPaid = d.clientDebts.reduce((s, c) => s + c.paid, 0);
  const pv = debt.paymentsVerification;
  const ctl = d.control;

  return (
    <div className="flex flex-col gap-5">
      <style>{PRINT_CSS}</style>
      <IntegrityBanner />
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* Режимы и «i» — рядом с заголовком, а не внутри: иначе имя заголовка читается как «Сводка · все годы · с НДС … i». */}
        <div className="flex flex-wrap items-center">
          <h1 className="text-xl font-semibold">Сводка</h1>
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
              <InfoHint label="Что фильтруется на Сводке" wide>
                <p>Год — общий, из шапки ({year === "all" ? "все годы" : `${year} год`}).</p>
                <p className="mt-1">Партия закупки, вид меха, цвет, признак меха и ставка НДС отбирают лоты (куплено, остаток, использовано) и ТЗ, в которых списан такой лот. Статус и партия производства отбирают ТЗ (и «использовано» — только по ним).</p>
                <p className="mt-1">Сужают блоки «Сырьё» и «Производство», обе таблицы динамики и «Долг заказчиков». Долг и оплаты поставщику (по закупкам и оплатам года) и «Задачи» (как в «Контроле») от фильтров не зависят{filtersOn ? " — сейчас фильтры включены" : ""}.</p>
              </InfoHint>
            </p>
          }
        />
      </div>

      <RawBlock fur={d.raw.fur} lining={d.raw.lining} c4={c4Mode} lots={d.raw.lots} info={info} orderFilters={orderFiltersOn(f)} />

      <ProductionBlock done={prodNums(d.prod.done)} work={prodNums(d.prod.work)} c4={c4Mode} search={search} info={info} bridge={{ usedBase: d.bridge.usedBase, comparable: d.bridge.usedComparable, lotFilters: lotFiltersOn(f), yearOnly: year !== "all" }} />

      <YearsTable rows={d.years} c4={c4Mode} info={info} />

      <RawTable rows={d.rawTable} total={d.rawTableTotal} c4={c4Mode} info={info} orderFilters={orderFiltersOn(f)} />

      {/* ───────── Оплаты, долги, задачи ───────── */}
      <section aria-labelledby="dash-pay" className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="dash-pay" className="text-base font-semibold">Оплаты, долги, задачи</h2>
        </div>
        <div className="grid grid-cols-1 items-stretch gap-3 lg:grid-cols-3 print:grid-cols-3">
          <div className={TILE_BOX}>
            <TileHead><InclVatOnlyLabel base="Долг поставщику" /></TileHead>
            <div className="absolute right-3 top-3 flex items-center gap-1" data-testid="debt-bridge">
              <BridgeHint label="Как сходится долг">
                <p>Закупки всего <b>{mln(debt.total.toNumber())}</b> = мех получен <b>{mln(d.bridge.purchases.received)}</b> (это «Куплено» в «Сырьё») + ещё не получен <b>{mln(d.bridge.purchases.draft)}</b>. Минус оплачено <b>{mln(d.supplierCashPaid)}</b> = долг <b>{mln(debt.debt.toNumber())}</b>.</p>
                <p className="mt-1">Части в плитке (по УПД, счёт не оплачен, ожидаемое) в сумме дают этот долг. Всегда с НДС.</p>
              </BridgeHint>
              <SupplierDebtHint debt={debt} year={year} align="right" />
            </div>
            <TileValue className={debt.debt.greaterThan(0) ? "text-amber-700" : ""}>{formatMoney(debt.debt.toFixed(2))}</TileValue>
            <TileCaption>всего к оплате</TileCaption>
            <dl className="mt-2 space-y-1 text-sm">
              <div className="flex justify-between gap-3"><dt className="text-neutral-600">К оплате по УПД и счетам</dt><dd className="font-medium tabular-nums">{formatMoney(debt.receivedNet.toFixed(2))}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-neutral-600">Счёт выставлен, не оплачен</dt><dd className="font-medium tabular-nums">{formatMoney(debt.invoiced.toFixed(2))}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-neutral-600">Ожидаемое (счёта ещё нет)</dt><dd className="font-medium tabular-nums">{formatMoney(debt.expected.toFixed(2))}</dd></div>
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
            <div className="absolute right-3 top-3">
              <InfoHint label="Из чего состоит оплачено" align="right">
                <p>По закупкам и аукционам {formatMoney(debt.paid.toFixed(0))} + авансы без привязки к закупке {formatMoney(debt.unlinkedAdvances.toFixed(0))}. Всегда с НДС; от фильтров и 4% не зависит.</p>
              </InfoHint>
            </div>
            <div className="mt-4 border-t border-neutral-100 pt-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-500"><InclVatOnlyLabel base="Долг заказчиков" />
                <InfoHint label="Что в долге заказчиков" align="right" wide>
                  <p>Из оплаченного: разнесено по ТЗ {formatMoney(d.clientDebtInfo.allocated.toFixed(0))}
                    {d.clientDebtInfo.unallocatedApplied ? <> · <Link href="/payments?tab=clients#unallocated" className="text-blue-700 hover:underline">неразнесённые авансы</Link> {formatMoney(d.clientDebtInfo.unallocated.toFixed(0))}</> : d.clientDebtInfo.unallocatedAll > 0.005 ? <> · <Link href="/payments?tab=clients#unallocated" className="text-blue-700 hover:underline">неразнесённые авансы</Link> {formatMoney(d.clientDebtInfo.unallocatedAll.toFixed(0))} в остаток при фильтре по ТЗ не входят</> : null}.</p>
                  <p className="mt-1">Меньше «Работы» в «Производстве» ({mln(d.prod.done.workSum + d.prod.work.workSum)}) на {mln(d.bridge.clientWork.noClient)}: ТЗ без заказчика сюда не входят. Работы заказчика = завершённые {mln(d.bridge.clientWork.done)} + в работе по плану {mln(d.bridge.clientWork.work)}. Зависит от года и фильтров.</p>
                </InfoHint>
</div>
              <div className={"mt-1 text-xl font-semibold tabular-nums " + (clientTotal > 0 ? "text-amber-700" : "")}>{formatMoney(clientTotal.toFixed(2))}</div>
              <div className="text-xs text-neutral-500">работы {formatMoney(clientBillable.toFixed(0))} · оплачено {formatMoney(clientPaid.toFixed(0))}</div>
            </div>
          </div>

          <div className={TILE_BOX}>
            <TileHead>
              Задачи
              <span className="absolute right-3 top-3"><InfoHint label="Задачи и фильтры" align="right">Число задач — как в «Контроле»; от фильтров Сводки не зависит.</InfoHint></span>
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
              <span className="text-xs font-normal text-neutral-500">{d.clientDebts.length} · развернуть</span>
            </summary>
            <div className="overflow-x-auto border-t border-neutral-100">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-neutral-500"><th className="px-3 py-1.5 font-medium">Заказчик</th><th className="px-3 py-1.5 text-right font-medium">ТЗ</th><th className="px-3 py-1.5 text-right font-medium">Остаток к оплате</th></tr></thead>
                <tbody>
                  {d.clientDebts.map((c) => (
                    <tr key={c.clientId} className="border-t border-neutral-100">
                      <td className="px-3 py-1.5">
                        <Link href={`/production?q=${encodeURIComponent(c.clientName)}`} className="hover:underline">{c.clientName}</Link>
                        {c.unpricedOrders > 0 ? <span className="ml-1 text-xs text-neutral-500">({c.unpricedOrders} ТЗ без цены работ — не учтены)</span> : null}
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
