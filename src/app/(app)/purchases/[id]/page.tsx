import { auctionSummariesView } from "@/lib/mart/auctions";
import { SortTh } from "@/components/sort-th";
import { readSort, sortRows } from "@/lib/table-sort";
import { ensureRowIds, type CalcPayload } from "@/lib/supplier-calc";
import { ChatLink } from "@/components/chat-link";

import { WidgetRow } from "@/components/widget-row";
import { IntegrityBanner } from "@/components/integrity-banner";
import Link from "next/link";

import { InfoHint } from "@/components/info-hint";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { formatDate, formatMoney, formatRate } from "@/lib/utils";
import { Decimal } from "@prisma/client/runtime/library";
import { getCommission4Mode } from "@/lib/commission4-mode";
import { LevelSummaryFromTotals } from "@/components/level-tiles";
import { loadLevelTotals } from "@/lib/mart/level-totals";

import { purchaseTotalInclVat, purchaseTotalExclVat, expenseInclVat } from "@/lib/purchase-totals";

import { ResponsiveRows } from "@/components/responsive-rows";
import { CreateDialog } from "@/components/create-dialog";
import { PurchaseItemForm } from "./item-form";
import { BulkItemForm } from "./bulk-item-form";

import { PaymentFormButton } from "@/components/payment-form";
import { PurchaseActions } from "./purchase-actions";
import { purchaseCancelBlocker } from "@/lib/purchase-cancel";
import { ExchangeRateForm } from "./exchange-rate-form";
import { PurchaseEditForm } from "./purchase-edit-form";
import { ItemRowShared } from "./item-row";
import { OpenOnHash } from "./open-on-hash";

import { getFurIndex } from "@/lib/fur-ref-server";

import { CUSTOM_FIELD_ENTITY } from "@/lib/custom-fields";
import { ACCESS, hasRole } from "@/lib/access";
import { findAuctionIn, auctionKeys } from "@/lib/auction-ref-core";
import { auctionKey } from "@/lib/auction-key";
import { getColorOptions } from "@/lib/colors";
import { purchasePaidShare } from "@/lib/auction-payments";
import { AuctionDocsPay } from "../../lots/auction-docs-pay";
import { SourceDocs } from "@/components/source-docs";
import { loadPurchaseSourceDocs } from "@/lib/source-docs-server";

import { rowVersion, PURCHASE_V, PAYMENT_EDIT_V } from "@/lib/concurrency";
import { PaymentEditButton } from "./edit-buttons";

import { PaymentDeleteButton } from "./payment-delete-button";
import { Breadcrumbs } from "@/components/breadcrumbs";

import { removePurchasePayment, updatePurchase, type OrderRef } from "../actions";

import { renderPurchaseItemRow, type ItemRowCtx } from "./item-row-render";
import { CostCompositionCard } from "./cost-composition";
import { PurchaseExpensesCard } from "./expenses-card";
import { PurchaseFallbackTiles } from "./fallback-tiles";

/** Cap for the always-expanded item list; bigger purchases start collapsed. */
const EXPANDED_ITEMS_LIMIT = 25;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const p = await prisma.purchase.findFirst({ where: { id, organizationId: session.user.organizationId }, select: { number: true } });
  return { title: p ? `Закупка ${p.number}` : "Закупка" };
}

export default async function PurchaseDetailPage({ params, searchParams }: PageProps<"/purchases/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const session = await requireSession();

  const purchase = await prisma.purchase.findFirst({
    where: { id, organizationId: session.user.organizationId },
    include: {
      supplier: true,
      warehouse: true,
      items: { include: { rawMaterial: true, lot: true }, orderBy: { id: "asc" } },
      expenses: { include: { category: true }, orderBy: { date: "asc" } },
      payments: { orderBy: { paidAt: "asc" } },
      documents: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!purchase) notFound();
  // сортировка позиций кликом по заголовку (?sort=…&dir=…)
  const itemSort = readSort(sp, ["material", "lot", "qty", "price", "total"]);
  purchase.items = sortRows(purchase.items, itemSort, {
    material: (i) => i.rawMaterial.name, lot: (i) => i.lotNumber, qty: (i) => Number(i.quantity), price: (i) => Number(i.unitPrice), total: (i) => Number(i.subtotal),
  });
  // принятый расчёт Веллмеха, из которого создана закупка: по нему «За что заплачено»
  const calcRow = await prisma.supplierInbox.findFirst({
    where: { organizationId: session.user.organizationId, kind: "AUCTION_CALC", status: "ACCEPTED", createdEntityType: "Purchase", createdEntityId: { contains: purchase.id } },
    orderBy: { decidedAt: "desc" },
    select: { id: true, title: true, payload: true },
  });
  const calcPayload = calcRow && (calcRow.payload as unknown as CalcPayload)?.v === 1 && Array.isArray((calcRow.payload as unknown as CalcPayload).rows) ? ensureRowIds(calcRow.payload as unknown as CalcPayload) : null;
  const furIdx = await getFurIndex(session.user.organizationId);

  // Документы партии (спецификация, расчётный лист, счёт на аванс) лежат на
  // аукционе целиком: показываем их на каждой закупке с тем же auctionSession.
  const batchName = purchase.auctionSession?.split(/\r?\n/)[0].trim() || null;
  const planItems = purchase.items.filter((i) => i.costPlan != null);

  const statusEditable = purchase.status !== "RECEIVED" && purchase.status !== "CANCELLED";
  // Роль из сессии: формы и кнопки правок видят только OWNER/ADMIN/PURCHASER (сервер всё равно отказывает остальным).
  const canEditRole = hasRole(session.user.role, ACCESS.purchases);
  const canReceive = ["OWNER", "ADMIN", "PURCHASER", "WAREHOUSE"].includes(session.user.role);
  const editable = statusEditable && canEditRole;
  // Принятая закупка: № счёта, УПД, дата и аукцион правятся (поставщик, склад, валюта — нет: лоты уже посчитаны).
  const headerEditable = canEditRole && purchase.status !== "CANCELLED";
  const receivedHeader = headerEditable && !statusEditable;
  const canEditPlan = editable;
  const colorOptions = canEditRole ? await getColorOptions(session.user.organizationId) : [];
  const canAddColor = hasRole(session.user.role, ACCESS.colors);

  const [materials, expenseCategories, suppliers, existingLots] = editable
    ? await Promise.all([
        prisma.rawMaterial.findMany({
          where: { organizationId: session.user.organizationId, isActive: true },
          select: { id: true, name: true, unit: true, defaultVatRate: true },
          orderBy: { name: "asc" },
        }),
        prisma.expenseCategory.findMany({
          where: { organizationId: session.user.organizationId, kind: "PURCHASE", isActive: true },
          orderBy: { name: "asc" },
        }),
        prisma.supplier.findMany({
          where: { organizationId: session.user.organizationId, isActive: true },
          orderBy: { name: "asc" },
        }),
        prisma.rawMaterialLot.findMany({
          where: { organizationId: session.user.organizationId, lotNumber: { not: null } },
          select: { lotNumber: true },
        }),
      ])
    : [[], [], [], []];

  // The current supplier/warehouse must always be selectable even if it was
  // since deactivated — otherwise the edit form's <select> would silently
  // fall back to whatever option happens to be first, changing the purchase's
  // supplier/warehouse without anyone asking for that.
  const supplierOptions = suppliers.some((s) => s.id === purchase.supplierId)
    ? suppliers
    : [purchase.supplier, ...suppliers];

  const auctionRefs = headerEditable
    ? await prisma.auction.findMany({
        where: { organizationId: session.user.organizationId, isService: false },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: { id: true, name: true, fullName: true, house: true, year: true, aliases: true, isService: true, confirmed: true },
      })
    : [];
  // Закупка без привязки, но с текстом из справочника, открывается уже с выбранным аукционом.
  // Привязка показывается, только если кэш-текст закупки совпадает с именем/написанием этого аукциона (заглушки «Нет информации» остаются старым текстом).
  const linked = purchase.auctionId ? auctionRefs.find((a) => a.id === purchase.auctionId) : undefined;
  const textKey = auctionKey(purchase.auctionSession);
  const auctionIdDefault = linked
    ? (!textKey || auctionKeys(linked).has(textKey) ? linked.id : null)
    : findAuctionIn(purchase.auctionSession, auctionRefs)?.id ?? null;

  // Другие закупки этого поставщика — куда можно перенести оплату при правке.
  const payTargets =
    canEditRole && purchase.payments.length > 0
      ? (
          await prisma.purchase.findMany({
            where: { organizationId: session.user.organizationId, supplierId: purchase.supplierId, id: { not: purchase.id }, status: { not: "CANCELLED" } },
            orderBy: { orderDate: "desc" },
            take: 60,
            select: { id: true, number: true, orderDate: true, auctionSession: true },
          })
        ).map((t) => ({ id: t.id, label: `${t.number} · ${formatDate(t.orderDate)}${t.auctionSession ? ` · ${t.auctionSession.split(/\r?\n/)[0].trim()}` : ""}` }))
      : [];
  const payEdit = (p: (typeof purchase.payments)[number]) =>
    canEditRole ? (
      <PaymentEditButton
        purchaseId={id}
        paymentId={p.id}
        version={rowVersion(p, PAYMENT_EDIT_V)}
        targets={payTargets}
        defaults={{ amount: p.amount.toString(), paidAt: p.paidAt.toISOString().slice(0, 10), method: p.method, status: p.status === "PENDING" ? "PENDING" : "COMPLETED", docRef: p.docRef ?? "", notes: p.notes ?? "" }}
      />
    ) : null;

  const isForeignCurrency = purchase.currency !== "RUB";
  const itemsTotal = purchase.items.reduce((s, i) => s.add(i.subtotal), new Decimal(0));
  // С расчётом из расчётного листа (costPlan) суммы берутся из него — см. purchase-totals.
  const itemsOnly = { exchangeRate: purchase.exchangeRate, items: purchase.items, expenses: [] };
  const itemsTotalExclVatRub = purchaseTotalExclVat(itemsOnly);
  const itemsTotalInclVatRub = purchaseTotalInclVat(itemsOnly);
  const expensesTotalExclVat = purchase.expenses.reduce((s, e) => s.add(e.amount), new Decimal(0));
  const expensesTotalInclVat = purchase.expenses.reduce(
    (s, e) => s.add(expenseInclVat(e)),
    new Decimal(0)
  );
  const grandTotalRub = itemsTotalInclVatRub.add(expensesTotalInclVat);
  const goodsExclVatRub = itemsTotal.mul(purchase.exchangeRate);
  // Расходы, заложенные в расчёт лотов (сборы аукциона, выделка, транспорт, брокер), — тоже «доп. расходы».
  // Копейки округления (|x| < 1 ₽) — это ноль, а не «−0,02».
  const near0 = (x: Decimal) => (x.abs().lessThan(1) ? new Decimal(0) : x);
  const extraExclVat = near0(itemsTotalExclVatRub.sub(goodsExclVatRub).add(expensesTotalExclVat));
  const vatTotal = near0(grandTotalRub.sub(itemsTotalExclVatRub).sub(expensesTotalExclVat));
  // В «Оплачено» — только факт (запланированные оплаты не в счёт).
  const paidTotal = purchase.payments.filter((p) => p.status === "COMPLETED").reduce((s, p) => s.add(p.amount), new Decimal(0));
  const auctionPay = batchName
    ? (await auctionSummariesView(session.user.organizationId, [batchName]))[0] ?? null
    : null;
  const balanceDue = grandTotalRub.sub(paidTotal);
  // Доля закупки в оплатах партии — то же правило, что в списке закупок (purchasePaidShare), чтобы остаток закупки везде был один.
  const shareDue = (() => { const paid = purchase.status === "CANCELLED" ? new Decimal(0) : purchasePaidShare(auctionPay ?? undefined, id, paidTotal); return { paid, rest: grandTotalRub.sub(paid) }; })();
  const vatRatesText = [...new Set(purchase.items.map((i) => i.vatRate.toString()))].join(" / ");

  const boundUpdatePurchase = updatePurchase.bind(null, id);
  // Item rows can be edited even after receipt (cosmetic fields always; qty/
  // price/VAT only while the resulting lot hasn't been consumed yet) — see
  // updatePurchaseItem. Only a cancelled purchase locks items down entirely.
  const itemsMutable = purchase.status !== "CANCELLED" && canEditRole;

  const allMaterials = materials.map((m) => ({ ...m, defaultVatRate: m.defaultVatRate?.toString() ?? null }));
  const showGradeColor = purchase.items.some((i) => i.grade || i.color);
  // Свои столбцы организации (общие с режимом «Аукцион»): здесь только показ значений.
  const customFields = await prisma.customField.findMany({
    where: { organizationId: session.user.organizationId, entity: CUSTOM_FIELD_ENTITY },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: { id: true, name: true, type: true, position: true },
  });
  const hasPlan = planItems.length > 0;
  const currencySym = purchase.currency === "USD" ? "$" : purchase.currency === "RUB" ? "₽" : purchase.currency;
  const itemColSpan = 6 + (hasPlan ? 1 : 0) + (showGradeColor ? 1 : 0) + (itemsMutable ? 1 : 0) + customFields.length;

  // Which production orders already drew from each consumed lot — so the
  // "locked" hint and the edit error can name them and link to them.
  const consumedLotIds = purchase.items
    .filter((i) => i.lot && !i.lot.quantityRemaining.equals(i.lot.quantityReceived))
    .map((i) => i.lot!.id);
  const usages = consumedLotIds.length
    ? await prisma.productionMaterialUsage.findMany({
        where: { lotId: { in: consumedLotIds } },
        include: { productionOrder: { select: { id: true, number: true } } },
      })
    : [];
  const ordersByLot = new Map<string, OrderRef[]>();
  for (const u of usages) {
    const list = ordersByLot.get(u.lotId) ?? [];
    const existing = list.find((o) => o.id === u.productionOrderId);
    if (existing) existing.quantity = new Decimal(existing.quantity).add(u.quantity).toString();
    else list.push({ id: u.productionOrder.id, number: u.productionOrder.number, quantity: u.quantity.toString() });
    ordersByLot.set(u.lotId, list);
  }

  const itemCtx: ItemRowCtx = { id, purchase, furIdx, canEditRole, editable, canEditPlan, itemsMutable, hasPlan, showGradeColor, isForeignCurrency, currencySym, itemColSpan, customFields, ordersByLot };
  const itemRow = (item: (typeof purchase.items)[number], variant: "row" | "card") => renderPurchaseItemRow(itemCtx, item, variant);

  // Использовано и остаток склада по лотам закупки (те же правила, что в итогах аукциона): режимы НДС и 4 % — как в шапке.
  const c4Mode = await getCommission4Mode();
  const martLvl = purchase.items.some((i) => i.lotId) ? await loadLevelTotals(session.user.organizationId, { purchaseId: id }) : null;

  return (
    <ItemRowShared value={{ colorOptions, canAddColor, materials: allMaterials, currency: purchase.currency }}>
    <div className="flex flex-col gap-4">
      <OpenOnHash />
      <IntegrityBanner kind="purchase" id={purchase.id} />
      <Breadcrumbs items={batchName ? [{ label: "Сырьё", href: "/lots" }, { label: batchName, href: `/lots?auction=${encodeURIComponent(batchName)}` }, { label: purchase.number }] : [{ label: "Сырьё", href: "/lots" }, { label: "Закупки", href: "/purchases" }, { label: purchase.number }]} />
      <div className="flex flex-col items-start justify-between gap-3 md:flex-row">
        <div className="min-w-0 max-md:w-full">
          {/* «i» — рядом с заголовком, а не внутри: иначе имя заголовка читается как «Закупка З-… О закупке». */}
          <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold">Закупка {purchase.number}</h1>
          <ChatLink type="Purchase" id={purchase.id} role={session.user.role} label={purchase.supplier?.name?.includes("Веллмех") ? "Запросить у Веллмеха" : undefined} />
          </div>
          <p className="flex flex-wrap items-center gap-x-1.5 text-sm text-neutral-500">
            <span>{formatDate(purchase.orderDate)}</span>
            <span aria-hidden>·</span>
            <span>
              поставщик{" "}
              <Link href={`/suppliers/${purchase.supplierId}`} className="text-blue-700 hover:underline" title="Карточка поставщика">{purchase.supplier.name}</Link>
            </span>
            {purchase.auctionSession ? (
              <>
                <span aria-hidden>·</span>
                <span>
                  партия{" "}
                  {batchName ? (
                    <Link href={`/lots?auction=${encodeURIComponent(batchName)}`} className="text-blue-700 hover:underline" title="Аукцион-партия: все закупки и лоты партии">{purchase.auctionSession}</Link>
                  ) : (
                    purchase.auctionSession
                  )}
                </span>
              </>
            ) : null}
            {[
              purchase.invoiceNumber ? `счёт № ${purchase.invoiceNumber}${purchase.invoiceDate ? ` от ${formatDate(purchase.invoiceDate)}` : ""}` : purchase.invoiceDate ? `счёт от ${formatDate(purchase.invoiceDate)}` : null,
              purchase.transferDocument ? `УПД ${purchase.transferDocument}` : null,
              isForeignCurrency ? `валюта позиций ${purchase.currency}, курс ${formatRate(Number(purchase.exchangeRate.toString()))}` : null,
              vatRatesText ? `НДС ${vatRatesText} %` : null,
            ].filter(Boolean).map((t) => (
              <span key={t} className="flex items-center gap-x-1.5"><span aria-hidden>·</span>{t}</span>
            ))}
          </p>
          {purchase.notes && (
            <details className="mt-1 max-w-3xl text-xs text-neutral-600">
              <summary className="cursor-pointer text-neutral-500 hover:text-neutral-800">Примечание: {purchase.notes.split("\n")[0].slice(0, 110)}{purchase.notes.length > 110 || purchase.notes.includes("\n") ? "…" : ""}</summary>
              <p className="mt-1 whitespace-pre-line">{purchase.notes}</p>
            </details>
          )}
          {headerEditable && (
            <div className="mt-2 max-w-md">
              <PurchaseEditForm
                receivedMode={receivedHeader}
                action={boundUpdatePurchase}
                currencyLocked={planItems.length > 0}
                auctions={auctionRefs}
                canCreateAuction={hasRole(session.user.role, ACCESS.auctions)}
                version={rowVersion(purchase, PURCHASE_V)}
                suppliers={supplierOptions}
                defaults={{
                  supplierId: purchase.supplierId,
                  warehouseId: purchase.warehouseId,
                  currency: purchase.currency,
                  orderDate: purchase.orderDate.toISOString().slice(0, 10),
                  auctionSession: purchase.auctionSession ?? "",
                  auctionId: auctionIdDefault,
                  invoiceNumber: purchase.invoiceNumber ?? "",
                  invoiceDate: purchase.invoiceDate ? purchase.invoiceDate.toISOString().slice(0, 10) : "",
                  transferDocument: purchase.transferDocument ?? "",
                  notes: purchase.notes ?? "",
                }}
              />
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-start justify-end gap-2 max-md:w-full max-md:justify-start">
        {canEditRole && purchase.status !== "CANCELLED" && <PaymentFormButton label="+ Оплата" preset={{ side: "supplier", purchaseId: id }} />}
        <PurchaseActions
          purchaseId={id}
          status={purchase.status}
          canReceive={canReceive}
          canCancel={canEditRole}
          hasCostPlan={planItems.length > 0}
          cancelBlocker={purchase.status === "RECEIVED" ? await purchaseCancelBlocker(prisma, session.user.organizationId, id) : null}
        />
        </div>
      </div>

      {isForeignCurrency && editable && planItems.length === 0 && (
        <Card>
          <CardContent className="flex items-center justify-between pt-4">
            <p
              className="text-xs text-neutral-500"
              title="Курс применяется при приёме на склад — обновите его перед приёмкой, если он изменился."
            >
              Позиции введены в {purchase.currency}
            </p>
            <ExchangeRateForm
              purchaseId={id}
              currency={purchase.currency}
              exchangeRate={purchase.exchangeRate.toString()}
              orderDate={purchase.orderDate.toISOString().slice(0, 10)}
            />
          </CardContent>
        </Card>
      )}

      <WidgetRow id="purchase" title="Закупка — итоги" headerEnd={<Link href={auctionPay ? `/payments?auction=${encodeURIComponent(auctionPay.name)}#auction-block` : "/payments"} className="text-xs text-blue-700 hover:underline print:hidden">→ Оплаты</Link>}>
      {/* Числа — из витрины (DmLot, DmPurchase): единый источник для всех уровней; витрина устарела — прежний расчёт ниже. */}
      {martLvl ? <LevelSummaryFromTotals t={martLvl} c4={c4Mode} payHref={auctionPay ? `/payments?auction=${encodeURIComponent(auctionPay.name)}#auction-block` : "/payments"} label="Итоги закупки" /> : (
      <PurchaseFallbackTiles organizationId={session.user.organizationId} lotIds={Array.from(new Set(purchase.items.map((i) => i.lotId).filter((x): x is string => !!x)))} c4Mode={c4Mode} currency={purchase.currency} isForeignCurrency={isForeignCurrency} grandTotalRub={grandTotalRub} itemsTotalExclVatRub={itemsTotalExclVatRub} expensesTotalExclVat={expensesTotalExclVat} goodsExclVatRub={goodsExclVatRub} extraExclVat={extraExclVat} vatTotal={vatTotal} itemsTotal={itemsTotal} auctionPay={auctionPay} shareDue={shareDue} balanceDue={balanceDue} />
      )}
      </WidgetRow>

      <Card id="items" className="scroll-mt-4">
        <CardHeader>
          <CardTitle>Позиции ({purchase.items.length})</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {editable && (
            <>
              <div className="flex flex-wrap gap-2">
                <CreateDialog label="+ Позиция" title="Новая позиция закупки" variant="outline" wide>
                  <PurchaseItemForm purchaseId={id} materials={allMaterials} currency={purchase.currency} colorOptions={colorOptions} canAddColor={canAddColor} purchaseDate={purchase.orderDate.toISOString().slice(0, 10)} />
                </CreateDialog>
                <CreateDialog label="Вставить из Excel" title="Вставить позиции из Excel" variant="outline" wide>
                  <BulkItemForm
                    purchaseId={id}
                    materialNames={allMaterials.map((m) => m.name)}
                    existingLotNumbers={existingLots.map((l) => l.lotNumber as string)}
                    currency={purchase.currency}
                    purchaseDate={purchase.orderDate.toISOString().slice(0, 10)}
                  />
                </CreateDialog>
              </div>
            </>
          )}
          <details open={purchase.items.length <= EXPANDED_ITEMS_LIMIT}>
            <summary className="mb-2 cursor-pointer text-sm text-neutral-600 max-md:py-2">
              Список позиций
            </summary>
            <ResponsiveRows
              table={
            <Table>
              <Thead>
                <Tr>
                  <SortTh path={`/purchases/${id}`} sp={sp} k="material" cur={itemSort} label="Материал" />
                  <SortTh path={`/purchases/${id}`} sp={sp} k="lot" cur={itemSort} label="Лот" />
                  {showGradeColor && <Th>Сорт / цвет</Th>}
                  <SortTh path={`/purchases/${id}`} sp={sp} k="qty" cur={itemSort} label="Кол-во" />
                  <SortTh path={`/purchases/${id}`} sp={sp} k="price" cur={itemSort} label={hasPlan ? `Цена лота, ${currencySym}` : "Цена без НДС"} />
                  <Th>НДС</Th>
                  {hasPlan ? (
                    <>
                      <Th>
                        Себестоимость единицы
                        <InfoHint label="Из чего складывается себестоимость единицы">
                          Из расчётного листа: цена, сборы, выделка, транспорт, брокерский %, НДС.
                        </InfoHint>
                      </Th>
                      <Th>Всего, ₽</Th>
                    </>
                  ) : (
                    <Th>Сумма{isForeignCurrency && " (RUB)"}</Th>
                  )}
                  {customFields.map((f) => (
                    <Th key={f.id}>
                      {f.name}
                      <InfoHint label="Свой столбец">Свой столбец организации — правится в режиме «Аукцион» (Сырьё → Лоты).</InfoHint>
                    </Th>
                  ))}
                  {itemsMutable && <Th></Th>}
                </Tr>
              </Thead>
              <Tbody>
                {purchase.items.map((item) => itemRow(item, "row"))}
                {purchase.items.length === 0 && (
                  <Tr>
                    <Td colSpan={itemColSpan} className="py-6 text-center text-neutral-500">
                      Позиций пока нет
                    </Td>
                  </Tr>
                )}
              </Tbody>
            </Table>
              }
            >
              {purchase.items.map((item) => itemRow(item, "card"))}
              {purchase.items.length === 0 && <p className="py-4 text-center text-sm text-neutral-500">Позиций пока нет</p>}
            </ResponsiveRows>
          </details>
        </CardContent>
      </Card>

      <CostCompositionCard id={id} purchase={purchase} calcRow={calcRow} calcPayload={calcPayload} statusEditable={statusEditable} canEditRole={canEditRole} canEditPlan={canEditPlan} editable={editable} batchName={batchName} />

      <PurchaseExpensesCard id={id} purchase={purchase} editable={editable} expenseCategories={expenseCategories} expensesTotalExclVat={expensesTotalExclVat} expensesTotalInclVat={expensesTotalInclVat} />

      <details className="rounded-lg border border-neutral-200 bg-white">
        <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-neutral-800">Документы</summary>
        <div className="flex flex-col gap-3 border-t border-neutral-100 p-3">
      <SourceDocs data={await loadPurchaseSourceDocs({ organizationId: session.user.organizationId, role: session.user.role }, id)} />
        <div>
          <AuctionDocsPay
            organizationId={session.user.organizationId}
            purchaseId={id}
            paymentActions={Object.fromEntries(
              purchase.payments.map((p) => [
                p.id,
                canEditRole ? (
                  <div key={p.id} className="flex flex-wrap gap-2">
                    {payEdit(p)}
                    <PaymentDeleteButton
                      amountLabel={formatMoney(p.amount.toString())}
                      action={async () => {
                        "use server";
                        await removePurchasePayment(id, p.id);
                      }}
                    />
                  </div>
                ) : null,
              ]),
            )}
          />
        </div>
        </div>
      </details>

    </div>
    </ItemRowShared>
  );
}

