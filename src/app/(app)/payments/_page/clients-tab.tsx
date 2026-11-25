import { isPositive } from "@/domain/money";
import { storedFileExists } from "@/lib/stored-file-check";
import { orderLabel, positionsOf } from "@/lib/order-label";
import { uniqueLabelCount } from "@/lib/tz-key";
import { formatDate } from "@/lib/utils";
import { tidyDocRef } from "@/lib/pay-ref";
import { cleanNote } from "@/lib/note-tags";
import { loadOrderRows } from "@/lib/analytics-orders";
import { type YearFilter } from "@/lib/year-filter";
import { VerifyControl } from "@/components/verify-control";
import { type loadPaymentVerify } from "../../verify/verify-block";
import { FilterBar } from "@/components/filters/filter-bar";
import { activeCount, type SearchParamsLike } from "@/lib/filters";
import { getFilterOptions } from "@/lib/filter-options";
import { ClientPaymentsTable, type ClientPayRow } from "../client-payments-table";
import { ClientDateDetail } from "../client-date-detail";
import { GoodsTiles, type BatchRow, type OwedOrder } from "../goods-tiles";
import { ClientDebtBlock } from "../client-debt-block";
import { type docCounts } from "@/lib/doc-links";
import { type loadPaymentsSourceDocs } from "@/lib/source-docs-server";
import { INVOICE_RX, PAY_FILTERS, PAYMENT_TYPE_LABELS, type PayFilterValues } from "./helpers";
import { loadCompletedAllocSums, loadGoodsDebt, loadPaymentInvoiceDocs, type ClientPaymentRow } from "./load";

/** Вкладка «За работу» (?tab=clients): оплаты производства по датам, долг по работе и разбивка по партиям. */
export async function ClientsTab({
  sp,
  orgId,
  year,
  pf,
  role,
  clientPayments,
  pv,
  ppDocCnt,
  srcDocs,
}: {
  sp: SearchParamsLike;
  orgId: string;
  year: YearFilter;
  pf: PayFilterValues;
  role: string;
  clientPayments: ClientPaymentRow[];
  pv: Awaited<ReturnType<typeof loadPaymentVerify>>;
  ppDocCnt: Awaited<ReturnType<typeof docCounts>>;
  srcDocs: Awaited<ReturnType<typeof loadPaymentsSourceDocs>>;
}) {
  const pdate = typeof sp.pdate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.pdate) ? sp.pdate : "";
  const orderInfo = new Map((await loadOrderRows(orgId, "all", "on")).map((o) => [o.id, o]));
  // Единая подпись ТЗ («ТЗ 182 · поз. 1/3»): позиции — по всем ТЗ организации.
  const tzPos = positionsOf(Array.from(orderInfo.values()));
  // Всего оплачено по каждому ТЗ (все платежи) — для расхождений внутри даты.
  const allocTotals = new Map<string, number>();
  {
    const sums = await loadCompletedAllocSums(orgId);
    for (const x of sums) allocTotals.set(x.productionOrderId, x._sum.amount?.toNumber() ?? 0);
  }
  const owedWorkTotal = Array.from(orderInfo.values()).filter((o) => o.clientName && isPositive(o.work - (allocTotals.get(o.id) ?? 0)) && (year === "all" || o.year === Number(year))).reduce((a, o) => a + (o.work - (allocTotals.get(o.id) ?? 0)), 0);
  const advancesTotal = clientPayments.filter((p) => p.allocations.length === 0 && /сч[её]т/i.test(p.docRef ?? "") && !p.amount.isZero()).reduce((a, p) => a + p.amount.toNumber(), 0);
  // Счета на оплату с прикреплённым файлом: у оплаты нет файлов напрямую, но счёт, названный в основании («Счёт №65»), прикреплён к системе — показываем ссылку на файл.
  const invoiceDocs = (await loadPaymentInvoiceDocs(orgId)).filter((d) => storedFileExists(d.storagePath));
  const invoiceLinkFor = (docRef: string | null, paidAt: Date) => {
    const m = INVOICE_RX.exec(docRef ?? "");
    if (!m) return [];
    const num = m[1].replace(/\D/g, "");
    if (!num) return [];
    const seen = new Set<string>();
    return invoiceDocs
      .filter((d) => new RegExp(`№\\s*${num}(?!\\d)`).test(d.title) && d.docDate && d.docDate <= paidAt)
      .filter((d) => (seen.has(d.id) ? false : (seen.add(d.id), true)))
      .slice(0, 2)
      .map((d) => ({ title: `счёт ${num}`, url: `/api/drive-docs/${d.id}` }));
  };
  const clientVerify: Record<string, React.ReactNode> = {};
  for (const p of clientPayments) if (pv.verify[p.id]) clientVerify[p.id] = <VerifyControl v={pv.verify[p.id]} canEdit={pv.canVerify} compact />;
  // Нулевые оплаты (сумма целиком вынесена в оплату закупки) в списке не нужны — деньги видны в «За сырьё».
  const clientRows: ClientPayRow[] = clientPayments.filter((p) => !p.amount.isZero()).map((p) => ({
    id: p.id,
    date: formatDate(p.paidAt),
    iso: p.paidAt.toISOString().slice(0, 10),
    year: p.paidAt.getUTCFullYear(),
    amount: Number(p.amount.toString()),
    type: PAYMENT_TYPE_LABELS[p.paymentType] ?? p.paymentType,
    client: p.client?.name ?? "–",
    // ТЗ оплаты: связанные с платежом и те, на которые есть разнесение (запись разнесения без связи — тоже ТЗ этой оплаты).
    goods: (() => {
      const byId = new Map<string, (typeof p.orders)[number]["productionOrder"]>();
      for (const o of p.orders) byId.set(o.productionOrderId, o.productionOrder);
      for (const x of p.allocations) if (!byId.has(x.productionOrderId)) byId.set(x.productionOrderId, x.productionOrder);
      return Array.from(byId, ([oid, po]) => ({
        id: oid,
        number: po.number,
        label: orderLabel({ workOrderNumber: po.workOrderNumber, number: po.number, ...tzPos.get(oid) }),
        model: po.productModel?.salesName || po.productModel?.name || "–",
        qty: Number(po.plannedQuantity.toString()),
        batch: po.batch?.number ?? null,
        article: orderInfo.get(oid)?.modelName ?? po.productModel?.name ?? null,
        fur: orderInfo.get(oid)?.fur ?? null,
        cost: orderInfo.get(oid)?.costIncl ?? null,
        work: orderInfo.get(oid)?.work ?? null,
        paidTotal: allocTotals.get(oid) ?? null,
        paid: p.allocations.find((x) => x.productionOrderId === oid)?.amount.toNumber() ?? null,
      })).sort((x, y) => (x.batch ?? 0) - (y.batch ?? 0) || x.number.localeCompare(y.number, "ru", { numeric: true }));
    })(),
    // К оплате по дате: работа каждого ТЗ делится между его платежами пропорционально разнесению (сумма по датам = работа ТЗ, без повторов);
    // шкуры подрядчика из остатка платежа — в «К оплате» и «Оплачено»; аванс без ТЗ — только «Оплачено» (оплачено вперёд).
    due: (() => {
      const amount = p.amount.toNumber();
      let d = 0;
      for (const x of p.allocations) {
        const w = orderInfo.get(x.productionOrderId)?.work ?? 0;
        const tot = allocTotals.get(x.productionOrderId) ?? 0;
        if (w > 0 && tot > 0) d += (w * x.amount.toNumber()) / tot;
      }
      // Аванс по выставленному счёту, ТЗ ещё не назначены: к оплате — сумма счёта (оплачен целиком).
      if (p.allocations.length === 0 && /сч[её]т/i.test(p.docRef ?? "") && advancesTotal > 0) {
        // Аванс без ТЗ: к оплате — неоплаченная работа ТЗ, под которую он внесён (доля аванса от всех таких авансов); сходится с виджетом «Остаток».
        d = owedWorkTotal * (amount / advancesTotal);
      }
      return Math.round(d * 100) / 100;
    })(),
    basis: tidyDocRef(p.docRef, formatDate(p.paidAt)),
    note: cleanNote(p.notes) ?? undefined,
    invoiceDocs: invoiceLinkFor(p.docRef, p.paidAt),
    paid: Math.round((p.amount.toNumber() - (/шкур/i.test(`${p.docRef ?? ""} ${p.notes ?? ""}`) ? Math.max(0, p.amount.toNumber() - p.allocations.reduce((a, x) => a + x.amount.toNumber(), 0)) : 0)) * 100) / 100,
    allocated: p.allocations.reduce((acc, x) => acc + x.amount.toNumber(), 0),
    hidesNote: /шкур/i.test(`${p.docRef ?? ""} ${p.notes ?? ""}`),
    movedTo: /закупки\s+(З-[\d-]+)/.exec(p.docRef ?? "")?.[1] ?? null,
    docCount: ppDocCnt.get(p.id)?.total ?? 0,
    sourceDocs: srcDocs[p.id],
    confirmed: p.confirmedAt != null,
    docTitle: `Оплата ${formatDate(p.paidAt)}`,
    verify: clientVerify[p.id],
  }));
  // ТЗ с неоплаченной работой (в том числе совсем без оплат) — расшифровка остатка в виджете.
  const owedOrders: OwedOrder[] = Array.from(orderInfo.values())
      .filter((o) => o.clientName && isPositive(o.work - (allocTotals.get(o.id) ?? 0)) && (year === "all" || o.year === Number(year)))
    .map((o) => ({ id: o.id, label: orderLabel({ workOrderNumber: o.workOrderNumber, number: o.number, ...tzPos.get(o.id) }), article: o.modelName, fur: o.fur, batch: o.batchNumber, year: o.year, qty: o.qty, work: o.work, paid: allocTotals.get(o.id) ?? 0 }));
  // «За работу»: общие виджеты — работа, оплачено, долг по работе подрядчику и разбивка по партиям.
  let goodsTotals: { work: number; hides: number; surcharge: number; total: number; paid: number; balance: number; unallocated: number; rows: BatchRow[] } | null = null;
  {
    const [cd, allAlloc] = await loadGoodsDebt(orgId, year);
    const allocBy = new Map(allAlloc.map((x) => [x.productionOrderId, x._sum.amount?.toNumber() ?? 0]));
    const byBatch = new Map<string, BatchRow>();
    for (const o of orderInfo.values()) {
      if (!o.clientName || (year !== "all" && o.year !== Number(year))) continue;
      const key = o.batchNumber != null ? String(o.batchNumber) : "–";
      const cur = byBatch.get(key) ?? { key, label: o.batchNumber != null ? `Партия ${o.batchNumber}` : "Вне партий", year: o.year, work: 0, paid: 0 };
      cur.work += o.work;
      cur.paid += allocBy.get(o.id) ?? 0;
      byBatch.set(key, cur);
    }
    goodsTotals = { work: cd.work, hides: cd.hides, surcharge: Math.round(Array.from(orderInfo.values()).filter((o) => o.clientName && (year === "all" || o.year === Number(year))).reduce((a, o) => a + o.c4PotIncl, 0) * 100) / 100, total: cd.billable, paid: cd.paid, balance: cd.balance, unallocated: cd.unallocated, rows: Array.from(byBatch.values()).filter((r) => r.work > 0 || r.paid > 0) };
  }
  const clientBatchOptions = (await getFilterOptions(orgId, year, ["batch"])).batch;

  return (
        <>
        {pdate ? (
          <ClientDateDetail
            date={formatDate(new Date(`${pdate}T00:00:00Z`))}
            back="/payments?tab=clients"
            rows={clientRows.filter((r) => r.iso === pdate).map((r) => ({ ...r, verifySlot: clientVerify[r.id] }))}
            owedGoods={owedOrders.map((o) => ({ id: o.id, number: o.label, label: o.label, model: o.article, qty: o.qty, batch: o.batch, article: o.article, fur: o.fur, work: o.work, paidTotal: owedWorkTotal > 0 ? (o.work * advancesTotal) / owedWorkTotal : 0, paid: null }))}
            owedNote={{ orders: uniqueLabelCount(owedOrders), batches: Array.from(new Set(owedOrders.map((o) => o.batch).filter((b): b is number => b != null))).sort((x, y) => x - y).join(", ") }}
          />
        ) : (
          <>
        <div className="print:hidden">
        <FilterBar
          title="Фильтры оплат"
          oneRow
          hideChips
          controls={[
            { type: "multi", name: "batch", label: "Партия", options: clientBatchOptions, allLabel: "Все партии" },
            { type: "multi", name: "ptype", label: "Тип оплаты", options: [{ value: "ADVANCE", label: "Аванс" }, { value: "PARTIAL", label: "Доплата" }, { value: "FINAL", label: "Окончательный расчёт" }], allLabel: "Любой" },
            { type: "date", name: "from", label: "Оплата с" },
            { type: "date", name: "to", label: "Оплата по" },
          ]}
        />
        </div>
        {goodsTotals && !pdate && <GoodsTiles {...goodsTotals} owed={owedOrders} />}
        {!pdate && <ClientDebtBlock orgId={orgId} year={year} role={role} />}
                <h2 className="mb-2 text-base font-semibold">Оплаты за работу по датам</h2>
                <ClientPaymentsTable
                  rows={clientRows}
                  rest={(() => {
                    // Итог таблицы должен сходиться с шапкой: работа, по которой ещё нет оплат по датам, — разность «шапка − таблица» (расчёты не меняются).
                    // Только без фильтров: при фильтре таблица показывает часть оплат, и разность была бы не «без оплат».
                    if (!goodsTotals || activeCount(PAY_FILTERS, { ...pf, tab: "" }) > 0) return undefined;
                    const tCost = clientRows.reduce((a, r) => a + r.due, 0);
                    const tPaid = clientRows.reduce((a, r) => a + r.paid, 0);
                    const cost = Math.round((goodsTotals.total - tCost) * 100) / 100;
                    const debt = Math.round((goodsTotals.balance - (tCost - tPaid)) * 100) / 100;
                    return isPositive(cost) ? { cost, debt, headCost: goodsTotals.total, headPaid: goodsTotals.paid, headDebt: goodsTotals.balance } : undefined;
                  })()}
                />
          </>
        )}
        </>
  );
}
