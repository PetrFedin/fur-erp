import Link from "next/link";
import { ChatLink } from "@/components/chat-link";
import { notFound } from "next/navigation";
import { Decimal } from "@prisma/client/runtime/library";
import { vatPeriodLabel, vatRateForDate } from "@/lib/vat-by-date";
import { WidgetRow } from "@/components/widget-row";
import { requireSession } from "@/lib/session";
import { getCommission4Mode } from "@/lib/commission4-mode";
import { InfoHint } from "@/components/info-hint";
import { Money } from "@/components/money";
import { Mode4Badge } from "@/components/c4-note";
import { formatCurrency, formatDate, formatMoney, formatQty, formatDec1 } from "@/lib/utils";
import { loadLotUsage, NO_AUCTION_KEY } from "@/lib/raw-analytics";
import { Breadcrumbs, type Crumb } from "@/components/breadcrumbs";
import { CostCell } from "../../cost-cell";
import { prisma } from "@/lib/prisma";
import { ACCESS, hasRole } from "@/lib/access";
import { getColorOptions } from "@/lib/colors";
import { TILE_BOX, TileHead, TileValue, TileList } from "../../../../dashboard/tile";
import { VatLine } from "../../../../dashboard/vat-line";
import { LotUsageViz, type UsageSeg } from "@/components/lot-usage-bar";
import { LotPriceComposition } from "@/components/price-composition";
import { COMP_CATS, emptyCats } from "@/lib/price-composition";
import { lotHammerListed, lotUsdListed } from "@/lib/lot-hammer";
import { shortMaterialName } from "@/lib/material-name";
import { purchaseTotalInclVat } from "@/lib/purchase-totals";
import { auctionName, loadAuctionSummaries, purchasePaidShare } from "@/lib/auction-payments";
import { DRIVE_DOC_TYPE_LABELS } from "@/lib/drive-docs";
import { DOC_KIND_LABELS } from "@/lib/purchase-files";
import { rawSheetItems, sheetRowsOf } from "@/lib/lot-sheet";
import { analyzeRows } from "@/lib/price-composition";
import { LotDocuments, type LotDocRow } from "@/components/lot-documents";
import { LotNumberField, LotRemainingField, LotDateField, LotChoiceField, LotPurchaseText } from "@/components/lot-edit-fields";
import { LotPassport, type PassportField, type PassportSection } from "@/components/lot-passport";
import { LotSheetTable } from "@/components/lot-sheet-table";
import { LotProducts, type ProdModel } from "@/components/lot-products";
import { CollapsibleBlock } from "@/components/collapsible-block";
import { PlanLotCard } from "./plan-lot-card";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const l = await prisma.rawMaterialLot.findFirst({ where: { id, organizationId: session.user.organizationId }, select: { lotNumber: true, rawMaterial: { select: { name: true } } } });
  return { title: l ? `Лот ${l.lotNumber ?? l.rawMaterial.name}` : "Карточка лота" };
}

const q2 = (d: Decimal) => d.toFixed(2);
const H2 = "text-base font-semibold";
const BLOCK = "flex flex-col gap-2 border-t border-neutral-200 pt-4";

export default async function LotCardPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  const orgId = session.user.organizationId;
  const c4 = await getCommission4Mode();
  const card = await loadLotUsage(id, orgId);
  if (!card) {
    const alt = await PlanLotCard({ id, orgId });
    if (alt) return alt;
    notFound();
  }
  const { lot: l, passport: p, orders } = card;
  const canEdit = hasRole(session.user.role, ["OWNER", "ADMIN", "PURCHASER", "WAREHOUSE"]);

  const row = await prisma.rawMaterialLot.findFirst({
    where: { id, organizationId: orgId },
    select: {
      lotNumber: true, grade: true, sizeGrade: true, color: true, colorRefId: true, notes: true, createdAt: true, costBreakdown: true, receivedDate: true,
      materialCostExclVat: true, expenseCostExclVat: true,
      rawMaterial: { select: { id: true, name: true, defaultVatRate: true, unit: true } },
      documents: { orderBy: { createdAt: "asc" }, select: { id: true, kind: true, title: true, originalName: true, mimeType: true, sizeBytes: true, createdAt: true } },
      attrs: { select: { attrId: true } },
      driveDocuments: { select: { id: true, title: true, docType: true, docNumber: true, storagePath: true } },
      purchase: {
        select: {
          id: true, auctionSession: true, transferDocument: true, notes: true, exchangeRate: true, supplierId: true, auctionId: true, orderDate: true, invoiceNumber: true,
          documents: { where: { lotId: null }, select: { id: true, title: true, kind: true } },
          driveDocuments: { select: { id: true, title: true, docType: true, docNumber: true, storagePath: true } },
          items: { select: { subtotal: true, vatRate: true, quantity: true, costPlan: true, unitPrice: true, lotId: true } },
          expenses: { select: { amount: true, vatRate: true } },
          payments: { select: { amount: true, status: true } },
        },
      },
    },
  });
  if (!row) notFound();
  const planRows = await prisma.purchaseItem.findMany({ where: { lotId: id }, select: { costPlan: true } });
  const plans = planRows.map((r) => r.costPlan);

  const lining = l.unit === "M";
  const unit = lining ? "м" : "шт.";
  const unitWord = lining ? "м" : "шт.";
  const qty = (d: Decimal) => `${formatDec1(d.toString())} ${unit}`;
  const vatRate = Number(p.vatRate);
  const vatKey = String(vatRate);
  const remIncl = l.rem.mul(l.unitIncl);
  const remExcl = l.rem.mul(l.unitExcl);
  const recvIncl = l.recv.mul(l.unitIncl);
  const recvExcl = l.recv.mul(l.unitExcl);
  const usedPctV = l.recv.greaterThan(0) ? l.used.div(l.recv).mul(100).toNumber() : null;
  const usedUnitIncl = l.used.greaterThan(0) ? l.usedIncl.div(l.used) : l.unitIncl;
  const usedUnitExcl = l.used.greaterThan(0) ? l.usedExcl.div(l.used) : l.unitExcl;

  // Молоток — только то, что прямо стоит в расчётном листе лота (или введено вручную в него); оценок и догадок нет.
  const hammerLot = lining ? null : lotHammerListed(row.costBreakdown, vatRate, plans);
  const usdListed = lining ? null : lotUsdListed(row.costBreakdown, plans);

  // Расчётный лист: собственный лота (правятся заметки) или расчёт позиции закупки (только чтение).
  const ownItems = rawSheetItems(row.costBreakdown);
  const planItems = ownItems.length ? [] : plans.map((pl) => rawSheetItems((pl as { costBreakdown?: unknown } | null)?.costBreakdown)).find((x) => x.length) ?? [];
  const sheetSrc = ownItems.length ? "расчёт лота" : "расчёт позиции закупки";
  const sheetItemsUsed = ownItems.length ? ownItems : planItems;
  const auto = analyzeRows(sheetItemsUsed.map((x) => ({ label: x.label, value: x.value, cat: x.cat ?? null })), { breakdown: null, plans: [], vatRate, qty: l.recv.toNumber(), totalIncl: recvIncl.toNumber(), purchaseNumber: l.purchaseNumber, lotNumber: l.lotNumber });
  const sheetRows = sheetRowsOf(sheetItemsUsed, { qty: l.recv.toNumber(), vatRate, defaultSrc: sheetSrc, auto });
  const hasHammerRow = sheetItemsUsed.some((x) => x.label === "Стоимость молоток ЛОТ без НДС");
  const hasUsdRow = sheetItemsUsed.some((x) => x.label === "Цена за ед. (ам. долл.)");
  const sheetTotalRow = sheetRows.find((r) => /^итого за готовое сырь/i.test(r.label));
  const showPrice = !lining || sheetRows.length > 0;

  // Платежи и документы закупки.
  const pu = row.purchase;
  const auctionHref = l.auction === NO_AUCTION_KEY ? undefined : l.auction.startsWith("Шкуры подрядчика") ? "/lots/contractor-hides" : lining ? `/lots/lining/${encodeURIComponent(l.auction)}` : `/lots?auction=${encodeURIComponent(l.auction)}`;
  // Оплаты закупки с аукционом ведутся по партии целиком — берём долю оплаты партии, как «Закупки» и «Сводка закупок».
  const puAuction = pu ? auctionName(pu.auctionSession) : null;
  const puAuctionPay = puAuction ? (await loadAuctionSummaries(prisma, orgId, [puAuction]))[0] : undefined;
  const paid = pu ? purchasePaidShare(puAuctionPay, pu.id, pu.payments.filter((x) => x.status === "COMPLETED").reduce((s, x) => s.add(x.amount), new Decimal(0))) : null;
  const purTotal = pu ? purchaseTotalInclVat({ exchangeRate: pu.exchangeRate, items: pu.items, expenses: pu.expenses }) : null;
  const docMap = new Map<string, { href: string | null; text: string }>();
  for (const d of [...(pu?.driveDocuments ?? []), ...row.driveDocuments]) docMap.set("d" + d.id, { href: d.storagePath ? `/api/drive-docs/${d.id}` : null, text: `${DRIVE_DOC_TYPE_LABELS[d.docType] ?? d.docType}${d.docNumber ? ` №${d.docNumber}` : ""} — ${d.title}` });
  for (const d of pu?.documents ?? []) docMap.set("p" + d.id, { href: `/api/purchase-docs/${d.id}`, text: `${DOC_KIND_LABELS[d.kind] ?? d.kind} — ${d.title}` });
  const inheritedDocs = Array.from(docMap.values());
  const lotDocs: LotDocRow[] = row.documents.map((d) => ({ ...d, createdAt: d.createdAt.toISOString() }));

  const colorOptions = canEdit ? await getColorOptions(orgId) : [];
  const attrRefs = canEdit && !lining ? await prisma.furAttrRef.findMany({ where: { organizationId: orgId }, select: { id: true, name: true, group: true }, orderBy: [{ group: "asc" }, { name: "asc" }] }) : [];
  const [supplierOpts, auctionOpts, materialOpts, purchaseOpts] = canEdit
    ? await Promise.all([
        prisma.supplier.findMany({ where: { organizationId: orgId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
        prisma.auction.findMany({ where: { organizationId: orgId, isService: false }, select: { id: true, name: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
        prisma.rawMaterial.findMany({ where: { organizationId: orgId, unit: row.rawMaterial.unit }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
        prisma.purchase.findMany({ where: { organizationId: orgId, status: "RECEIVED" }, select: { id: true, number: true }, orderBy: { number: "desc" } }),
      ])
    : [[], [], [], []];
  const attrNames = !lining && !canEdit && row.attrs.length ? await prisma.furAttrRef.findMany({ where: { id: { in: row.attrs.map((a) => a.attrId) } }, select: { name: true } }) : [];

  // Изделия: данные только из базы на каждый заход (loadLotUsage → ProductionMaterialUsage по lotId).
  const modelIds = Array.from(new Set(orders.map((o) => o.modelId)));
  const groups = modelIds.length ? await prisma.productModel.findMany({ where: { id: { in: modelIds } }, select: { id: true, categoryRef: { select: { group: true } } } }) : [];
  const groupOf = new Map(groups.map((g) => [g.id, g.categoryRef?.group ?? ""]));
  const prodMap = new Map<string, ProdModel>();
  for (const o of orders) {
    let m = prodMap.get(o.modelId);
    if (!m) prodMap.set(o.modelId, (m = { modelId: o.modelId, name: o.modelName, sku: o.sku, category: o.category, group: groupOf.get(o.modelId) ?? "", orders: [] }));
    m.orders.push({
      orderId: o.orderId, number: o.number, label: o.label, batchNumber: o.batchNumber, date: o.orderDate ? formatDate(o.orderDate) : null,
      qty: o.qty.toNumber(), produced: o.produced.toNumber(),
      incl: q2(o.incl), excl: q2(o.excl), incl4: q2(o.incl.add(o.extraIncl)), excl4: q2(o.excl.add(o.extraExcl)),
    });
  }
  const prodModels = Array.from(prodMap.values());

  const zeroD = new Decimal(0);
  const usageSegs: UsageSeg[] = [
    ...orders.map((o): UsageSeg => ({
      key: `tz-${o.orderId}`, kind: "order", label: o.label, sku: o.sku ?? o.modelName, href: `/production/${o.orderId}`,
      qty: o.qty.toNumber(), date: o.orderDate ? formatDate(o.orderDate) : null,
      cost: <CostCell incl={o.incl} excl={o.excl} extraIncl={o.extraIncl} extraExcl={o.extraExcl} c4={c4} />,
    })),
    ...(l.otherOut.greaterThan(0) && !lining
      ? [{ key: "other", kind: "other", label: "Прочее списание", qty: l.otherOut.toNumber(), cost: <Money incl={q2(l.otherOut.mul(l.unitIncl))} excl={q2(l.otherOut.mul(l.unitExcl))} /> } as UsageSeg]
      : []),
    { key: "rem", kind: "rem", label: "Остаток", qty: Decimal.max(l.rem, zeroD).toNumber(), cost: <Money incl={q2(remIncl)} excl={q2(remExcl)} /> },
  ];

  const purLink = l.purchaseId ? <Link href={`/purchases/${l.purchaseId}`} className="text-blue-700 hover:underline">закупка →</Link> : null;
  // ───────── Паспорт ─────────
  // Карточка лота — первоисточник: поля лота и его закупки-основания правятся здесь; закупка и таблицы показывают их и ведут сюда.
  const byDate = p.purchaseDate ?? p.receivedDate;
  const vatDefault = vatRateForDate(byDate);
  const vatTotalLot = recvIncl.sub(recvExcl);
  const sizeText = l.size === "Не указан" ? "" : l.size;
  const colorText = p.colorRef ? (p.color && p.color !== p.colorRef ? `${p.colorRef} (в закупке: ${p.color})` : p.colorRef) : (p.color ?? "");
  const isoDay = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "");
  const itemOfLot = pu?.items.find((i) => i.lotId === id) ?? null;
  const poolNote = (row.purchase?.items.filter((i) => i.lotId === id).length ?? 0) > 1 ? "лот собран из нескольких поступлений — цену и количество одного поступления выделить нельзя" : undefined;
  const mEd = (field: "qty" | "unitPrice" | "unitExcl" | "unitIncl" | "totalIncl" | "vatRate" | "hammerExcl" | "hammerUsd", value: string, label: string, suffix?: string) =>
    canEdit && !poolNote ? <LotNumberField key="e" lotId={id} field={field} value={value} label={label} suffix={suffix} /> : undefined;
  const purchaseWide = "действует на всю закупку";
  const sections: PassportSection[] = [
    {
      title: "Идентификация",
      fields: [
        { label: "№ лота", key: "lotNumber", value: row.lotNumber ?? "" },
        { label: lining ? "Ткань" : "Вид меха", node: lining ? <>{shortMaterialName(p.materialName)}<span className="block text-[11px] text-neutral-500">{p.materialName}</span></> : <Link href={`/lots/fur/${encodeURIComponent(l.kind)}`} className="text-blue-700 hover:underline" title="Вид меха: все лоты и аукционы">{p.materialName}</Link>, editor: canEdit ? <LotChoiceField key="e" lotId={id} kind="material" value={row.rawMaterial.id} options={materialOpts.map((m) => ({ value: m.id, label: m.name }))} label={lining ? "Ткань" : "Вид меха"} /> : undefined },
        { label: lining ? "Цвет / описание" : "Цвет", key: "color" as const, value: row.color ?? colorText, refId: row.colorRefId, node: colorText },
        ...(lining ? [] : [{ label: "Размер шкуры", key: "sizeGrade" as const, value: row.sizeGrade ?? "", node: sizeText }]),
        { label: lining ? "Описание" : "Сорт / описание", key: "grade", value: row.grade ?? "" },
        ...(lining ? [] : [{ label: "Признак меха", key: "attrs" as const, node: attrNames.map((a) => a.name).join(", ") || "—", note: canEdit ? <>новый признак — в <Link href="/settings/fur-attrs" className="text-blue-700 hover:underline">справочнике признаков</Link></> : undefined }]),
        { label: "Дата прихода", node: formatDate(p.receivedDate), editor: canEdit ? <LotDateField key="e" lotId={id} kind="received" value={isoDay(row.receivedDate)} label="Дата прихода" /> : undefined },
      ],
    },
    {
      title: "Закупка",
      fields: [
        { label: "Аукцион / закупка", node: auctionHref ? <Link href={auctionHref} className="text-blue-700 hover:underline" title="Партия закупки: все лоты и закупки партии">{l.auctionLabel}</Link> : l.auctionLabel, editor: canEdit && pu ? <LotChoiceField key="e" lotId={id} kind="auction" value={pu.auctionId ?? ""} options={auctionOpts.map((a) => ({ value: a.id, label: a.name }))} label="Аукцион" emptyLabel="без аукциона" note={purchaseWide} /> : undefined },
        { label: "Закупка №", node: l.purchaseId ? <Link href={`/purchases/${l.purchaseId}`} className="text-blue-700 hover:underline">{l.purchaseNumber}</Link> : "—", editor: canEdit && l.purchaseId ? <LotChoiceField key="e" lotId={id} kind="purchase" value={l.purchaseId} options={purchaseOpts.map((x) => ({ value: x.id, label: x.number }))} label="Закупка-основание" /> : undefined },
        { label: "Поставщик", node: pu && p.supplier ? <Link href={`/suppliers/${pu.supplierId}`} className="text-blue-700 hover:underline" title="Карточка поставщика">{p.supplier}</Link> : (p.supplier ?? "—"), editor: canEdit && pu ? <LotChoiceField key="e" lotId={id} kind="supplier" value={pu.supplierId} options={supplierOpts.map((x) => ({ value: x.id, label: x.name }))} label="Поставщик" note={purchaseWide} /> : undefined },
        { label: "Накладная / счёт №", node: p.invoiceNumber ?? "—", editor: canEdit && pu ? <LotPurchaseText key="e" lotId={id} kind="invoiceNumber" value={pu.invoiceNumber ?? ""} label="Накладная / счёт №" /> : undefined, note: canEdit && pu ? purchaseWide : undefined },
        { label: "УПД №", node: pu?.transferDocument ?? "—", editor: canEdit && pu ? <LotPurchaseText key="e" lotId={id} kind="transferDocument" value={pu.transferDocument ?? ""} label="УПД №" /> : undefined, note: canEdit && pu ? purchaseWide : undefined },
        { label: "Дата закупки", node: p.purchaseDate ? formatDate(p.purchaseDate) : "—", editor: canEdit && pu ? <LotDateField key="e" lotId={id} kind="order" value={isoDay(pu.orderDate)} label="Дата закупки" /> : undefined },
        ...(!lining || (p.currency && p.currency !== "RUB") ? [{ label: "Валюта · курс", node: p.currency ? `${p.currency}${p.exchangeRate ? ` · ${formatQty(p.exchangeRate.toString())}` : ""}` : "—", note: "общие для всей закупки — меняются в закупке" }] : []),
        ...(lining && paid && purTotal ? (paid.lte(purTotal.add(1)) ? [
          { label: "Оплачено по закупке", node: <Money incl={q2(paid)} /> },
          { label: "Долг по закупке", node: <Money incl={q2(Decimal.max(purTotal.sub(paid), zeroD))} />, note: <Link href="/payments" className="text-blue-700 hover:underline">→ Оплаты</Link> },
        ] : [{ label: "Оплаты", node: "ведутся по партии целиком", note: <Link href="/payments" className="text-blue-700 hover:underline">→ Оплаты</Link> }]) : []),
      ],
    },
    {
      title: "Количество",
      fields: [
        { label: "Получено", node: qty(l.recv), editor: mEd("qty", l.recv.toString(), "Получено", unit), note: poolNote ?? "остаток пересчитывается; не меньше списанного" },
        { label: "Остаток", node: qty(l.rem), editor: canEdit ? <LotRemainingField key="e" lotId={id} value={l.rem.toString()} /> : undefined, note: "ручная правка записывается движением «Корректировка»" },
        { label: "Единица", node: lining ? "метр" : "шкура (шт.)", note: "задаётся материалом" },
      ],
    },
    {
      title: "Цена",
      fields: [
        { label: `Цена за ${unitWord}, ₽ (с НДС)`, node: <Money incl={q2(l.unitIncl)} excl={q2(l.unitExcl)} />, editor: mEd("unitIncl", q2(l.unitIncl), `Цена за ${unitWord} с НДС`, "₽"), note: poolNote ?? <span className="text-[11px] text-neutral-500">без НДС {formatMoney(q2(l.unitExcl))} · сумма лота {formatMoney(q2(recvIncl))}; правка пересчитывает сумму, списания и состав цены</span> },
        { label: "НДС, %", node: `${formatQty(p.vatRate.toString())} %`, editor: mEd("vatRate", p.vatRate.toString(), "Ставка НДС лота", "%"), note: <>по дате документа {vatDefault} % ({vatPeriodLabel(byDate)}){vatRate !== vatDefault ? " — не совпадает" : ""} <InfoHint label="Ставка НДС в ТЗ" wide><p>В ТЗ берётся эта ставка лота; ставка строки списания может быть изменена в ТЗ. При смене ставки можно сохранить сумму с НДС (меняется выделение НДС) или цену без НДС (меняется сумма с НДС).</p></InfoHint></> },
        { label: "Сумма НДС, ₽", node: formatMoney(q2(vatTotalLot)), note: "считается из суммы лота и ставки" },
        ...(lining && row.rawMaterial.defaultVatRate != null ? [{ label: "Ставка по умолчанию материала", node: `${formatQty(row.rawMaterial.defaultVatRate.toString())} %`, note: <Link href={`/materials/${row.rawMaterial.id}`} className="text-blue-700 hover:underline">правится в карточке материала →</Link> }] : []),
        ...(itemOfLot ? [{ label: `Цена в закупке (без НДС)${p.currency && p.currency !== "RUB" ? `, ${p.currency}` : ", ₽"}`, node: p.currency && p.currency !== "RUB" ? `${formatCurrency(itemOfLot.unitPrice.toString(), p.currency)}${p.exchangeRate ? ` · курс ${formatQty(p.exchangeRate.toString())}` : ""}` : formatMoney(itemOfLot.unitPrice.toString()), editor: mEd("unitPrice", itemOfLot.unitPrice.toString(), "Цена в закупке без НДС") }] : []),
        ...(lining ? [] : [
          { label: "Молоток, ₽/шт.", node: hammerLot ? <Money incl={q2(new Decimal(hammerLot.incl))} excl={q2(new Decimal(hammerLot.excl))} /> : "—", note: hammerLot ? "строка расчётного листа" : "в расчётном листе лота не указан", editor: hammerLot && hasHammerRow ? mEd("hammerExcl", q2(new Decimal(hammerLot.excl)), "Молоток без НДС", "₽ без НДС") : undefined },
          { label: "Молоток, $/шт.", node: usdListed != null ? `$${usdListed.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—", note: usdListed != null ? "строка расчётного листа" : "в расчётном листе лота не указан", editor: usdListed != null && hasUsdRow ? mEd("hammerUsd", String(usdListed), "Молоток в долларах", "$") : undefined },
        ]),
      ],
    },
    { title: "Примечания", fields: [{ label: "Примечание", key: "notes", value: row.notes ?? "" }] },
  ];

  // Ключевые поля — наверху, всегда на виду; остальное («справочные») — ниже, свёрнуто. Те же поля, та же правка по месту, без дублей.
  const KEY_LABELS = [
    lining ? "Ткань" : "Вид меха", lining ? "Цвет / описание" : "Цвет", lining ? "Описание" : "Сорт / описание",
    "Получено", `Цена за ${unitWord}, ₽ (с НДС)`, "НДС, %", "Закупка №", "Аукцион / закупка",
  ];
  const allFields = sections.flatMap((sec) => sec.fields);
  const keySection: PassportSection = {
    title: "Главное",
    fields: KEY_LABELS.map((lb) => allFields.find((f) => f.label === lb)).filter((f): f is PassportField => !!f),
  };
  const keySet = new Set(keySection.fields.map((f) => f.label));
  const restSections: PassportSection[] = sections
    .map((sec) => ({ ...sec, fields: sec.fields.filter((f) => !keySet.has(f.label)) }))
    .filter((sec) => sec.fields.length > 0);
  // График состава цены — только по строкам листа с назначенной категорией; остальное — «не распределено».
  const chartIncl = emptyCats();
  let explicitRows = 0;
  for (const r of sheetRows) if (r.cat && r.perLot != null) { chartIncl[r.cat] += r.perLot; explicitRows++; }
  const kVat = 1 + (vatRate > 0 ? vatRate / 100 : 0);
  const naturalExcl = recvIncl.toNumber() / kVat;
  const fExcl = naturalExcl !== 0 ? recvExcl.toNumber() / naturalExcl : 1;
  const chartExcl = emptyCats();
  for (const c of COMP_CATS) chartExcl[c.key] = (chartIncl[c.key] / kVat) * fExcl;
  const chartUnalloc = recvExcl.toNumber() - Object.values(chartExcl).reduce((a, x) => a + x, 0);
  const chartVat = recvIncl.toNumber() - recvExcl.toNumber();
  const unitLbl = lining ? "за м" : "за шт.";

  // Путь по иерархии «Сырьё»: вид меха → аукцион (у подкладки — партия) → лот.
  const crumbs: Crumb[] = lining
    ? [{ label: "Сырьё", href: "/lots" }, { label: "Подкладка", href: "/lots?tab=lining" }, ...(l.auction !== NO_AUCTION_KEY ? [{ label: l.auctionLabel, href: auctionHref }] : []), { label: shortMaterialName(p.materialName) }]
    : [{ label: "Сырьё", href: "/lots" }, { label: "Мех", href: "/lots" }, { label: l.kind, href: `/lots/fur/${encodeURIComponent(l.kind)}` }, ...(l.auction !== NO_AUCTION_KEY ? [{ label: l.auctionLabel, href: auctionHref }] : []), { label: `Лот ${row.lotNumber ?? "—"}` }];

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={crumbs} />
      <div className="flex flex-wrap items-center gap-2">
        <Link href={lining ? "/lots?tab=lining" : "/lots"} aria-label="Назад к сырью" className="text-lg leading-none text-neutral-500 hover:text-neutral-900">←</Link>
        <h1 className="text-xl font-semibold">{lining ? `${shortMaterialName(p.materialName)} · ${l.auctionLabel}` : `Лот № ${row.lotNumber ?? "—"}`}</h1>
        <Mode4Badge mode={c4} />
        <ChatLink type="RawMaterialLot" id={id} role={session.user.role} />
        <InfoHint label="О карточке" wide>
          <p>Один купленный лот: сколько куплено, использовано и осталось, из чего состоит цена и в каких изделиях он участвует. Карточка не зависит от года в шапке. Деньги — «С НДС / Без НДС» из шапки; 4 % добавляется только к списаниям, где оно применяется.</p>
        </InfoHint>
      </div>

      {/* 1. Виджеты */}
      <WidgetRow id="lot" title="Лот" headerEnd={l.purchaseId ? <Link href={`/purchases/${l.purchaseId}`} className="text-xs text-blue-700 hover:underline print:hidden">→ Закупка</Link> : undefined}>
        <div className="grid grid-cols-1 items-stretch gap-3 md:grid-cols-2 lg:grid-cols-4">
          <div className={TILE_BOX}>
            <TileHead>Куплено</TileHead>
            <TileValue>{qty(l.recv)}</TileValue>
            <TileList items={[
              { k: "Сумма", v: <Money incl={q2(recvIncl)} excl={q2(recvExcl)} /> },
              { k: `Цена за ${unitWord}`, v: <Money incl={q2(l.unitIncl)} excl={q2(l.unitExcl)} /> },
            ]} />
            <VatLine v={{ [vatKey]: vatTotalLot.toNumber() }} minRem={1} />
          </div>
          <div className={TILE_BOX}>
            <TileHead>Использовано</TileHead>
            <TileValue>{qty(l.used)}</TileValue>
            <TileList items={[
              { k: "Сумма без 4 %", v: <Money incl={q2(l.usedIncl)} excl={q2(l.usedExcl)} />, share: usedPctV != null ? usedPctV / 100 : null },
              { k: "с 4 %", v: <Money incl={q2(l.usedIncl.add(l.usedExtraIncl))} excl={q2(l.usedExcl.add(l.usedExtraExcl))} />, sub: true },
              { k: `Цена за ${unitWord}`, v: <Money incl={q2(usedUnitIncl)} excl={q2(usedUnitExcl)} /> },
            ]} />
            <VatLine v={{ [vatKey]: l.usedIncl.sub(l.usedExcl).toNumber() }} minRem={1} />
          </div>
          <div className={TILE_BOX}>
            <TileHead>Остаток</TileHead>
            <TileValue>{qty(l.rem)}</TileValue>
            <TileList items={[
              { k: "Сумма", v: <Money incl={q2(remIncl)} excl={q2(remExcl)} />, share: l.recv.greaterThan(0) ? l.rem.div(l.recv).toNumber() : null },
            ]} />
            <VatLine v={{ [vatKey]: remIncl.sub(remExcl).toNumber() }} minRem={1} />
          </div>
          <div className={TILE_BOX}>
            <TileHead>{lining ? `Цена лота, ₽/${unitWord}` : "Итого цена лота, ₽/шт."}</TileHead>
            <TileValue><Money incl={q2(l.unitIncl)} excl={q2(l.unitExcl)} /></TileValue>
            {lining ? null : (
              <TileList items={[
                { k: "Молоток, ₽/шт.", v: hammerLot ? <Money incl={q2(new Decimal(hammerLot.incl))} excl={q2(new Decimal(hammerLot.excl))} /> : "—" },
                { k: "Молоток, $/шт.", v: usdListed != null ? `$${usdListed.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—" },
              ]} />
            )}
          </div>
        </div>
      </WidgetRow>

      {/* 2. Паспорт: ключевые поля сверху, остальные ниже (свёрнуты) */}
      <div className="flex flex-col gap-2">
        <h2 className="flex items-center gap-2 block-title">
          Паспорт лота
          <InfoHint label="Паспорт лота" wide>
            <p>Карточка лота — первоисточник: все поля правятся здесь по месту (Enter или уход из поля — сохранить, Esc — отмена). Цена и количество пересчитываются через окно «что изменится»: видно, как изменятся лот, ТЗ, где он списан, и состав цены; запись — только после подтверждения.</p>
          </InfoHint>
        </h2>
        <LotPassport
          lotId={id}
          sections={[keySection]}
          canEdit={canEdit}
          canAddColor={hasRole(session.user.role, ACCESS.colors)}
          colorOptions={colorOptions}
          attrOptions={attrRefs}
          attrIds={row.attrs.map((a) => a.attrId)}
        />
      </div>
      <CollapsibleBlock title="Остальные поля лота" summary="правка по месту">
        <LotPassport
          lotId={id}
          sections={restSections}
          canEdit={canEdit}
          canAddColor={hasRole(session.user.role, ACCESS.colors)}
          colorOptions={colorOptions}
          attrOptions={attrRefs}
          attrIds={row.attrs.map((a) => a.attrId)}
        />
      </CollapsibleBlock>

      {/* 3. Из чего состоит цена */}
      {showPrice && (
        <div className={BLOCK}>
          <h2 className={H2 + " flex items-center gap-2"}>
            Из чего состоит цена лота
            <InfoHint label="Из чего состоит цена лота" wide>
              <p>Цена лота по долям (график) и все строки расчётного листа (таблица). График строится только по строкам, которым в таблице назначена категория; всё остальное — «Не распределено». Суммы приведены к цене лота без НДС; НДС — отдельно. 4 % в цену лота не входит — оно начисляется при списании в ТЗ.</p>
            </InfoHint>
          </h2>
          {sheetRows.length > 0 && explicitRows > 0 ? (
            <div className="rounded-lg border border-neutral-200 bg-white p-3">
              <LotPriceComposition cats={chartExcl} unallocated={chartUnalloc} vat={chartVat} qty={l.recv.toNumber()} unitName={lining ? "метр" : "шкуру"} ariaLabel={`Состав цены лота ${l.lotNumber ?? ""}`} />
            </div>
          ) : sheetRows.length > 0 ? (
            <p className="rounded-lg border border-neutral-200 bg-white p-3 text-sm text-neutral-500">Категории строкам расчёта не назначены — вся цена лота не распределена. Назначьте категории в таблице ниже, и появится график.</p>
          ) : null}
          {sheetRows.length > 0 ? (
            <LotSheetTable
              lotId={id}
              rows={sheetRows}
              canEdit={canEdit && !poolNote}
              sheetTotal={sheetTotalRow ? sheetTotalRow.value : null}
              lotTotal={recvIncl.toNumber()}
              unitNode={<Money incl={q2(l.unitIncl)} excl={q2(l.unitExcl)} />}
              lotNode={<Money incl={q2(recvIncl)} excl={q2(recvExcl)} />}
              unitLabel={unitLbl}
              purchaseLink={purLink}
            />
          ) : (
            <p className="rounded-lg border border-neutral-200 bg-white p-3 text-center text-sm text-neutral-500">Нет расчётного листа: цена лота {formatMoney(q2(l.unitIncl))} за {unitWord} без разбивки.</p>
          )}
        </div>
      )}

      {/* 4. Изделия */}
      <div className={BLOCK}>
        <h2 className={H2 + " flex items-center gap-2"}>
          В каких изделиях участвует
          <InfoHint label="Изделия лота" wide>
            <p>Артикул › ТЗ, где списан этот лот. Данные берутся из базы при каждом открытии: новое ТЗ со списанием лота появляется здесь само. Доля лота = списано ÷ куплено. «На изделие» = списано ÷ произведено в ТЗ.</p>
          </InfoHint>
        </h2>
        <LotProducts models={prodModels} recv={l.recv.toNumber()} unit={unit} />
        {l.lotNumber && <p className="mt-2 text-sm"><Link href={`/production?q=${encodeURIComponent(l.lotNumber)}`} className="text-blue-700 hover:underline">→ все ТЗ с этим лотом</Link></p>}
      </div>

      {/* 5. Расход и остаток по времени — внизу, под изделиями */}
      <div className={BLOCK}>
        <h2 className={H2 + " flex items-center gap-2"}>
          Расход лота по ТЗ
          <InfoHint label="Расход лота по ТЗ" wide>
            <p>Полоса равна количеству лота при закупке ({qty(l.recv)}). Цветной сегмент — одно ТЗ, ширина пропорциональна списанному; сегмент с пунктиром — остаток.</p>
          </InfoHint>
        </h2>
        <LotUsageViz unit={unit} recv={l.recv.toNumber()} startDate={formatDate(l.date)} segs={usageSegs} totalCost={<Money incl={q2(recvIncl)} excl={q2(recvExcl)} />} />
      </div>

      {/* Документы лота — свёрнуты */}
      <CollapsibleBlock title="Документы" summary={`${lotDocs.length} шт.`}>
        <div className="mb-2 flex items-center gap-2 text-xs text-neutral-500">О документах <InfoHint label="Документы лота" wide>
            <p>УПД, счёт и спецификацию пока не нужно заполнять — просто прикрепите файлы: перетащите на слот или нажмите «Загрузить файл» (PDF, XLSX, DOCX, JPEG, PNG до 25 МБ). Номера и суммы не требуются. Документы лота видны и в закупке-основании.</p>
          </InfoHint></div>
        <LotDocuments lotId={id} docs={lotDocs} inherited={inheritedDocs} canEdit={canEdit} />
      </CollapsibleBlock>
    </div>
  );
}
