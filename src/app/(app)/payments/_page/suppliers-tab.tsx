import { storedFileExists } from "@/lib/stored-file-check";
import { readSort, thSort } from "@/lib/table-sort";
import { Decimal } from "@prisma/client/runtime/library";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatDate } from "@/lib/utils";
import { isServiceAuction, shortAuctionName } from "@/lib/auction-names";
import { auctionName, PAY_EPS, type AuctionPay } from "@/lib/auction-payments";
import { purchaseTotalInclVat } from "@/lib/purchase-totals";
import { inYear, type YearFilter } from "@/lib/year-filter";
import { FilterBar } from "@/components/filters/filter-bar";
import { NONE, filterHref, type FilterOption, type SearchParamsLike } from "@/lib/filters";
import { payNumbers } from "@/lib/pay-display";
import { alignYears } from "@/lib/raw-display";
import { dashboardCached } from "@/lib/mart/snapshots";
import { getCommission4Mode } from "@/lib/commission4-mode";
import { loadPaymentsOverview } from "@/lib/payments-overview";
import { type loadPaymentsSourceDocs } from "@/lib/source-docs-server";
import { PaymentLinesTable, PurchaseLinesTable, type PayLine, type PurchaseLine } from "../payment-lines";
import { FRESH_MS, PAY_FILTERS, payComment, payInvoice, type PayFilterValues } from "./helpers";
import { auctionsTable, type AuctionsTableCtx, type Extra } from "./auctions-table";
import { SupplierTiles } from "./supplier-tiles";
import { SelectedAuctionCard } from "./selected-auction-card";
import { loadClientDebtFor, loadPurchasesWithPayments, type AuctionPurchaseRow, type PaymentRow, type SupplierDebtData } from "./load";

/** Вкладка «За сырьё» (?tab=suppliers): партии закупки, плитки долга поставщику, закупки без аукциона и карточка выбранной партии. */
export async function SuppliersTab({
  sp,
  orgId,
  year,
  pf,
  canPay,
  payments,
  summariesAll,
  auctionPurchases,
  debt,
  srcDocs,
  payOpts,
  fAuction,
  listQ,
  period,
  listFiltered,
  auctionQ,
  showNoAuction,
}: {
  sp: SearchParamsLike;
  orgId: string;
  year: YearFilter;
  pf: PayFilterValues;
  canPay: boolean;
  payments: PaymentRow[];
  summariesAll: AuctionPay[];
  auctionPurchases: AuctionPurchaseRow[];
  debt: SupplierDebtData | null;
  srcDocs: Awaited<ReturnType<typeof loadPaymentsSourceDocs>>;
  payOpts: { auction: FilterOption[] };
  fAuction: string[];
  listQ: string;
  period: { gte?: Date; lte?: Date } | undefined;
  listFiltered: boolean;
  auctionQ: string;
  showNoAuction: boolean;
}) {
  // Общий фильтр года: аукцион — по дате его закупок, оплата вне аукционов — по дате оплаты.
  const summaries = summariesAll.filter((a) => year === "all" || (a.lastPurchaseAt !== null && inYear(a.lastPurchaseAt, year)));
  // По актуальности: 1) с остатком и свежей закупкой (≤ 12 мес.), 2) оплаченные/переплаченные,
  // 3) исторические с остатком (старые, оплаты не заведены). Внутри — свежая закупка выше, затем больший остаток.
  const nowMs = new Date().getTime();
  const rank = (a: AuctionPay) =>
    a.remaining.greaterThan(PAY_EPS)
      ? a.lastPurchaseAt && nowMs - a.lastPurchaseAt.getTime() <= FRESH_MS
        ? 0
        : 2
      : 1;
  const auctions = summaries
    .filter((x) => !(x.purchases === 0 && x.total.abs().lessThan(PAY_EPS) && x.paid.abs().lessThan(PAY_EPS) && x.planned.abs().lessThan(PAY_EPS)))
    .sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (b.lastPurchaseAt?.getTime() ?? 0) - (a.lastPurchaseAt?.getTime() ?? 0) ||
      b.remaining.comparedTo(a.remaining) ||
      a.name.localeCompare(b.name, "ru"),
  );
  const listQLower = listQ.toLowerCase();
  // Оплаты по партиям (название партии → оплаты): для фильтров «подтверждение» и «период оплат».
  const payAuction = (p: PaymentRow) => auctionName(p.auctionSession) ?? auctionName(p.purchase?.auctionSession);
  const paysByAuction = new Map<string, PaymentRow[]>();
  for (const p of payments) {
    const n = payAuction(p);
    if (n) paysByAuction.set(n, [...(paysByAuction.get(n) ?? []), p]);
  }
  const knownNames = new Set(auctions.map((a) => a.name));
  const looseAuction = fAuction.filter((v) => v !== NONE && !knownNames.has(v)).map((v) => v.toLowerCase());
  const matchesAuction = (a: AuctionPay) =>
    fAuction.length === 0 ||
    fAuction.includes(a.name) ||
    (fAuction.includes(NONE) && isServiceAuction(a.name)) ||
    looseAuction.some((v) => a.name.toLowerCase().includes(v));
  const visibleAuctions = auctions.filter((a) => {
    if (!matchesAuction(a)) return false;
    if (listQLower && !a.name.toLowerCase().includes(listQLower)) return false;
    const pays = paysByAuction.get(a.name) ?? [];
    if (period && !pays.some((p) => (!period.gte || p.paidAt >= period.gte) && (!period.lte || p.paidAt <= period.lte))) return false;
    return true;
  });
  // Служебные записи («Нет информации», «Не в реестре остатков…» и т.п.) — в конец, под группу «Прочее».
  const mainAuctions = visibleAuctions.filter((a) => !isServiceAuction(a.name));
  const serviceAuctions = visibleAuctions.filter((a) => isServiceAuction(a.name));
  // Ссылка на одну партию (остальные фильтры сохраняются).
  const auctionHref = (name: string) => filterHref(PAY_FILTERS, "/payments", pf, { auction: [name] });
  const selected = auctionQ ? auctions.find((a) => a.name === auctionQ) ?? null : null;
  const auctionPurchaseMap = new Map(auctionPurchases.map((p) => [p.id, p]));
  const sum = (f: (a: AuctionPay) => { toString(): string }) => auctions.reduce((acc, a) => acc + Number(f(a).toString()), 0);

  const today = new Date().toISOString().slice(0, 10);

  // Ближайшие сроки счетов (из документов Drive «срок дд.мм.гггг»), как на Главной.
  const deadlines = (debt?.byAuction ?? [])
    .filter((a) => a.dueInvoiced.greaterThan(0) && a.invoiceDocs)
    .map((a) => {
      const m = /срок\s+(\d{2})\.(\d{2})\.(\d{4})/i.exec(a.invoiceDocs ?? "");
      return m ? { auction: shortAuctionName(a.name), date: `${m[1]}.${m[2]}.${m[3]}`, amount: a.dueInvoiced.toNumber(), sort: `${m[3]}${m[2]}${m[1]}` } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x != null)
    .sort((a, b) => a.sort.localeCompare(b.sort));
  const anyPlanned = auctions.some((a) => a.planned.greaterThan(PAY_EPS));
  const ovRows = (await loadPaymentsOverview(orgId)).filter((r) => year === "all" || r.year === Number(year));
  const rawPaidAll = ovRows.reduce((a, r) => a + r.fur + r.lining + r.services, 0);
  // Мех / подкладка в плитках — те же числа, что на Главной (одна функция).
  const supDash = await dashboardCached(orgId, year, await getCommission4Mode());
  // Целые рубли, сходящиеся на экране (те же числа, что в плитках оплат на Главной): мех + подкладка без работы.
  const rawPay = supDash ? payNumbers(supDash, await getCommission4Mode(), "raw") : null;
  // Итоги лет в таблице партий = «Динамика по годам» на Главной (один и тот же год — одно и то же число на экране).
  const yearAnchors = supDash ? new Map(alignYears(supDash.years).filter((r) => /^\d{4}$/.test(r.key)).map((r) => [Number(r.key), { t: r.fur.incl.rv + r.lining.incl.rv, p: r.paid, r: r.debt }])) : null;
  // Сводная строка «Без аукциона»: все служебные группы + закупки без аукциона — чтобы Σ строк сходилась с «Остатком к оплате».
  const zeroD = new Decimal(0);
  const svcAll = auctions.filter((a) => isServiceAuction(a.name));
  const svcTotal = svcAll.reduce((acc, a) => acc.add(a.total), zeroD);
  const svcPaid = svcAll.reduce((acc, a) => acc.add(a.paid), zeroD);
  const svcRemaining = svcAll.reduce((acc, a) => acc.add(a.remaining), zeroD);
  const noAucTotal = debt ? debt.total.sub(auctions.reduce((acc, a) => acc.add(a.total), zeroD)) : zeroD;
  const noAucDebt = debt ? debt.nonAuctionDebt : zeroD;
  const noAucPaid = noAucTotal.sub(noAucDebt);
  const sumTotal = svcTotal.add(noAucTotal);
  const sumPaid = svcPaid.add(noAucPaid);
  const sumRemaining = svcRemaining.add(noAucDebt);
  // «Оплачено» в шапке — без переплат (они не гасят чужой долг), а в столбце таблицы переплата видна: подписываем разницу.
  const showServiceSum = !listFiltered && (svcAll.length > 0 || noAucTotal.abs().greaterThan(PAY_EPS));
  const svcPurchases = svcAll.reduce((n, a) => n + a.purchases, 0) + (debt ? debt.nonAuctionPurchases : 0);
  // «Закупки без аукциона» и «Шкуры подрядчика» — внутри года оплаты (так же, как раздел «Все»): Σ по годам = «Все» = «Главная».
  const extraByYear = new Map<number, Extra[]>();
  const addExtra = (y: number, e: Extra) => extraByYear.set(y, [...(extraByYear.get(y) ?? []), e]);
  if (showServiceSum) {
    const noAucRows = ovRows.filter((r) => r.kind === "raw" && /^З-\d{4}-\d+$/.test(r.label));
    const hidesRows = ovRows.filter((r) => r.hides > 0);
    const lastYear = Math.max(...ovRows.map((r) => r.year), 2026);
    const yearsHere = Array.from(new Set([...noAucRows.map((r) => r.year), ...hidesRows.map((r) => r.year), lastYear]));
    for (const y of yearsHere) {
      const paid = new Decimal(noAucRows.filter((r) => r.year === y).reduce((a, r) => a + r.amount, 0)).add(y === lastYear ? svcPaid : zeroD);
      const rem = y === lastYear ? noAucDebt.add(svcRemaining) : zeroD;
      if (paid.abs().greaterThan(PAY_EPS) || rem.abs().greaterThan(PAY_EPS)) {
        addExtra(y, { label: "Закупки без аукциона", href: "/payments?noauction=1#noauction-block", title: "Закупки вне аукционов", total: paid.add(rem), paid, rem });
      }
      const h = new Decimal(hidesRows.filter((r) => r.year === y).reduce((a, r) => a + r.hides, 0));
      if (h.greaterThan(PAY_EPS)) addExtra(y, { label: "Шкуры подрядчика", title: "Шкуры подрядчика, оплаченные в составе счетов за пошив (мех, в ТЗ не списаны)", total: h, paid: h, rem: zeroD });
    }
  }
  // Сортировка по клику на заголовок (?asort=…&adir=…): партии внутри каждого года; без выбора — хронологически.
  const aSort = readSort(sp, ["name", "total", "paid", "planned", "rem"], null, "a");
  const ath = (k: string) => thSort("/payments", sp, k, aSort, "a");
  const tableCtx: AuctionsTableCtx = { selected, auctionHref, anyPlanned, aSort, ath, extraByYear, showServiceSum, listFiltered, rawPay, yearAnchors, sumTotal, sumPaid, sumRemaining, svcPurchases };

  const hidesMemo = (await loadClientDebtFor(orgId, year)).hides;
  // «Закупки без аукциона»: что куплено, что и когда оплачено, чего нет — по каждой закупке (открывается по клику на строку таблицы).
  const noAuc = showNoAuction
    ? (await loadPurchasesWithPayments(orgId)).filter((p) => !p.auctionSession || isServiceAuction(p.auctionSession))
    : [];
  const noAucLines: PurchaseLine[] = noAuc.map((p) => {
    const total = purchaseTotalInclVat(p);
    const paid = p.payments.reduce((acc, x) => acc.add(x.amount), new Decimal(0));
    const note = p.listLabel ?? null;
    return { id: p.id, number: p.number, invoice: p.invoiceNumber ?? null, note, total: total.toString(), paid: paid.toString(), due: total.sub(paid).toString(), received: p.status === "RECEIVED" };
  });
  const noAucPayLines: PayLine[] = noAuc.flatMap((p) =>
    p.payments.map((x) => ({
      id: x.id,
      date: formatDate(x.paidAt),
      amount: x.amount.toString(),
      what: "Оплата закупки",
      invoice: payInvoice(x.docRef, p) ?? { text: p.number, href: `/purchases/${p.id}` },
      comment: payComment(x.docRef, formatDate(x.paidAt)) || undefined,
      ppNo: /п\/п\s*№?\s*(\d+)/.exec(x.docRef ?? "")?.[1] ?? null,
      confirmed: x.confirmedAt != null,
      status: "COMPLETED" as const,
      docCount: new Set(x.driveDocuments.filter((d) => storedFileExists(d.storagePath)).map((d) => d.driveFileId)).size + (x.document ? 1 : 0),
      sourceDocs: srcDocs[x.id],
    })),
  );

  return (
        <>
          {auctions.length > 0 && (
            <div className="print:hidden">
            <FilterBar
              title="Фильтры оплат"
              oneRow
              hideChips
              controls={[
                { type: "multi", name: "auction", label: "Аукцион", aliases: ["auc"], options: payOpts.auction, noneLabel: "Служебные записи", allLabel: "Все партии" },
                { type: "text", name: "q", label: "Название партии", aliases: ["dq"], placeholder: "часть названия" },
                { type: "date", name: "from", label: "Оплата с" },
                { type: "date", name: "to", label: "Оплата по" },
              ]}
            />
            </div>
          )}
          {debt && (
            <>
              {!selected && !showNoAuction && (
              <SupplierTiles debt={debt} supDash={supDash} rawPay={rawPay} hidesMemo={hidesMemo} rawPaidAll={rawPaidAll} auctions={auctions} anyPlanned={anyPlanned} sum={sum} deadlines={deadlines} year={year} />
              )}
            </>
          )}

          {(mainAuctions.length > 0 || showServiceSum) && <h2 className="text-base font-semibold">Оплаты по аукционам и закупкам</h2>}
          {(mainAuctions.length > 0 || showServiceSum) && auctionsTable(tableCtx, mainAuctions, showServiceSum)}
          {serviceAuctions.length > 0 && (
            <details className="rounded-md border border-neutral-200 bg-white" open={listFiltered || serviceAuctions.some((a) => a.name === selected?.name)}>
              <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-neutral-700">
                Прочее (служебные записи импорта): {serviceAuctions.length}
              </summary>
              <div className="border-t border-neutral-100 p-3">{auctionsTable(tableCtx, serviceAuctions)}</div>
            </details>
          )}
          {auctions.length === 0 && (
            <p className="rounded-md bg-neutral-50 px-3 py-6 text-center text-sm text-neutral-500">
              Аукционов и закупок пока нет: укажите «Аукцион / закупка» в карточке закупки.
            </p>
          )}
          {auctions.length > 0 && visibleAuctions.length === 0 && (
            <p className="rounded-md bg-neutral-50 px-3 py-6 text-center text-sm text-neutral-500">По этим фильтрам партий закупки нет.</p>
          )}

          <div id="noauction-block" className="scroll-mt-4" />
          {showNoAuction && (
            <Card>
              <CardHeader>
                <CardTitle>Закупки без аукциона</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-5">
                <section>
                  <h3 className="mb-2 block-title">За что платим ({noAucLines.length})</h3>
                  <PurchaseLinesTable lines={noAucLines} withPaid />
                </section>
                <section>
                  <h3 className="mb-2 block-title">Оплаты ({noAucPayLines.length})</h3>
                  <PaymentLinesTable lines={noAucPayLines} emptyText="Оплат по этим закупкам нет" />
                </section>
              </CardContent>
            </Card>
          )}
          <div id="auction-block" className="scroll-mt-4" />
          {auctionQ && !selected && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Аукцион / закупка «{auctionQ}» не найден{year === "all" ? "" : ` за ${year} год`}. Выберите её в фильтре «Аукцион / закупка».
            </p>
          )}
          {selected && <SelectedAuctionCard selected={selected} auctionPurchases={auctionPurchases} auctionPurchaseMap={auctionPurchaseMap} payments={payments} srcDocs={srcDocs} canPay={canPay} today={today} />}

        </>
  );
}
