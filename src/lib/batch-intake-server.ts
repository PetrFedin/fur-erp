import "server-only";
import { Decimal } from "@prisma/client/runtime/library";
import type { Prisma, PrismaClient } from "@prisma/client";
import { purchaseTotalExclVat, purchaseTotalInclVat } from "@/lib/purchase-totals";
import { auctionKey } from "@/lib/auction-key";
import { buildFurIndex } from "@/lib/fur-ref";
import {
  AMOUNT_KINDS,
  itemsOf,
  num,
  parseMoney,
  reconcileAmount,
  serviceVatPctFor,
  validateRows,
  type BatchPayload,
  type BatchPreview,
  type DocRecon,
  type IntakeContext,
  type ItemDraft,
  type PurchaseTotals,
} from "@/lib/batch-intake";

type Db = PrismaClient | Prisma.TransactionClient;

/** Справочники организации, нужные мастеру (и странице, и серверным действиям). */
export async function loadIntakeRefs(db: Db, orgId: string) {
  const [materials, furRefs, colors, auctions, suppliers, warehouses, items] = await Promise.all([
    db.rawMaterial.findMany({ where: { organizationId: orgId }, select: { id: true, name: true, unit: true }, orderBy: { name: "asc" } }),
    db.furRef.findMany({ where: { organizationId: orgId }, select: { id: true, name: true, nameEn: true, aliases: true, note: true } }),
    db.colorRef.findMany({ where: { organizationId: orgId }, select: { id: true, name: true, aliases: true, note: true }, orderBy: { name: "asc" } }),
    db.auction.findMany({
      where: { organizationId: orgId, isService: false },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, fullName: true, house: true, year: true, currency: true, auctionDate: true, aliases: true },
    }),
    db.supplier.findMany({ where: { organizationId: orgId, isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.warehouse.findMany({ where: { organizationId: orgId }, select: { id: true, name: true, isDefault: true }, orderBy: { name: "asc" } }),
    db.purchaseItem.findMany({
      where: { purchase: { organizationId: orgId, auctionId: { not: null }, status: { not: "CANCELLED" } }, lotNumber: { not: null } },
      select: { lotNumber: true, purchase: { select: { number: true, auctionId: true } } },
    }),
  ]);
  const lotsByAuction: Record<string, [string, string][]> = {};
  for (const it of items) {
    const a = it.purchase.auctionId!;
    (lotsByAuction[a] ??= []).push([(it.lotNumber as string).trim().toLowerCase(), it.purchase.number]);
  }
  return { materials, furRefs, colors, auctions, suppliers, warehouses, lotsByAuction };
}

export type IntakeRefs = Awaited<ReturnType<typeof loadIntakeRefs>>;

const dec = (n: number) => new Decimal(String(n));

export type PlannedPurchase = { key: string; invoice: string; items: ItemDraft[]; totals: PurchaseTotals };

function totalsOf(key: string, invoice: string, items: ItemDraft[], rate: number, currency: string): PurchaseTotals {
  const synthetic = {
    exchangeRate: dec(rate),
    items: items.map((i) => ({
      subtotal: dec(i.quantity).mul(dec(i.unitPrice)),
      vatRate: dec(i.vatRate),
      quantity: dec(i.quantity),
      costPlan: i.costPlan,
    })),
    expenses: [],
  };
  const inclVat = Number(purchaseTotalInclVat(synthetic as never).toDecimalPlaces(2));
  const exclVat = Number(purchaseTotalExclVat(synthetic as never).toDecimalPlaces(2));
  const qty = items.reduce((s, i) => s + i.quantity, 0);
  const foreignExcl = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  const withPlan = items.every((i) => i.auctionUnit != null);
  return {
    key,
    invoice,
    lots: items.length,
    qty,
    inclVat,
    exclVat,
    avgInclPerUnit: qty > 0 ? inclVat / qty : 0,
    avgExclPerUnit: qty > 0 ? exclVat / qty : 0,
    avgForeign: currency !== "RUB" && qty > 0 ? foreignExcl / qty : null,
    foreignExcl: Math.round(foreignExcl * 100) / 100,
    auctionPart: withPlan && items.length > 0 ? Math.round(items.reduce((s, i) => s + i.quantity * (i.auctionUnit ?? 0), 0) * 100) / 100 : null,
    vatRates: [...new Set(items.map((i) => i.vatRate))],
  };
}

const sameNumber = (a: string, b: string) => a.trim().toLowerCase().replace(/\s+/g, "") === b.trim().toLowerCase().replace(/\s+/g, "");

/**
 * Единый расчёт мастера: проверка строк → позиции → закупки (по счетам) → суммы (purchase-totals) → сверка документов.
 * Вызывается и для предпросмотра, и перед созданием — одним и тем же кодом.
 */
export function planBatch(payload: BatchPayload, refs: IntakeRefs, debtNow: number) {
  const h = payload.header;
  const blocking: string[] = [];
  const currency = (h.currency || "RUB").toUpperCase();
  const rate = currency === "RUB" ? 1 : num(h.exchangeRate);
  if (currency !== "RUB" && !(rate > 0)) blocking.push(`Укажите курс ${currency} → RUB (шаг 1)`);
  const vatDefault = h.vatDefault.trim() === "" ? 22 : num(h.vatDefault);
  if (!(vatDefault >= 0 && vatDefault <= 100)) blocking.push("НДС по умолчанию должен быть от 0 до 100 (шаг 1)");
  if (!h.supplierId || !refs.suppliers.some((s) => s.id === h.supplierId)) blocking.push("Выберите поставщика / посредника (шаг 1)");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(h.orderDate) || Number.isNaN(Date.parse(h.orderDate))) blocking.push("Укажите дату закупки (шаг 1)");
  else if (h.receiveNow && h.orderDate > new Date().toISOString().slice(0, 10)) blocking.push("Дата закупки в будущем, а мех принимается на склад сразу: поправьте дату или снимите «Принять на склад сразу» (шаг 1)");

  if ((h.invoiceAmount ?? "").trim() && !(Number.isFinite(parseMoney(h.invoiceAmount!.trim()) ?? num(h.invoiceAmount!)) && (parseMoney(h.invoiceAmount!.trim()) ?? num(h.invoiceAmount!)) > 0))
    blocking.push("Сумма счёта аукциона (шаг 1, «Дополнительно») должна быть положительным числом — или очистите поле");

  if ((h.serviceVat ?? "").trim() !== "") {
    const sv = num(h.serviceVat!);
    if (!(Number.isFinite(sv) && sv >= 0 && sv <= 100)) blocking.push("НДС на сборы аукциона (шаг 1, «Дополнительно») должен быть от 0 до 100 — или очистите поле");
  }

  let auctionName = "";
  const existing = h.auctionId ? refs.auctions.find((a) => a.id === h.auctionId) : undefined;
  if (h.newAuction) {
    auctionName = h.newAuction.name.replace(/\s+/g, " ").trim();
    if (auctionName.length < 2) blocking.push("Укажите короткое имя нового аукциона (шаг 1)");
    else if (auctionName.length > 60) blocking.push("Имя аукциона слишком длинное — до 60 символов (шаг 1)");
    else {
      const k = auctionKey(auctionName);
      const clash = refs.auctions.find((a) => [a.name, ...a.aliases].some((v) => auctionKey(v) === k));
      if (clash) blocking.push(`Аукцион «${clash.name}» уже есть в справочнике — выберите его из списка (шаг 1)`);
    }
  } else if (existing) auctionName = existing.name;
  else blocking.push("Выберите аукцион из справочника или создайте новый (шаг 1)");

  const existingLots = new Map<string, string>(h.auctionId && !h.newAuction ? (refs.lotsByAuction[h.auctionId] ?? []) : []);
  const ctx: IntakeContext = {
    currency,
    vatDefault: vatDefault >= 0 ? vatDefault : 22,
    materials: refs.materials.map((m) => ({ id: m.id, name: m.name })),
    furIndex: refs.furRefs.length > 0 ? buildFurIndex(refs.furRefs) : undefined,
    colors: refs.colors,
    existingLots,
    rate: rate > 0 ? rate : 1,
    pctCols: payload.pct,
  };
  const validation = validateRows(payload.rows, ctx, payload.decisions);
  if (payload.rows.length === 0) blocking.push("Нет ни одной строки лота (шаг 2)");
  if (validation.errorCount > 0) blocking.push(`В таблице лотов ошибок: ${validation.errorCount} (шаг 2)`);

  const items = itemsOf(payload.rows, validation.checks, { vatDefault: ctx.vatDefault, rate: ctx.rate, currency, pctCols: payload.pct, serviceVatPct: serviceVatPctFor(h.orderDate, h.serviceVat) });

  // закупки по счетам аукциона
  const withInv = items.filter((i) => i.invoice).length;
  if (withInv > 0 && withInv < items.length) blocking.push("В части строк указан счёт аукциона, в части нет — заполните столбец «Счёт №» везде или нигде (шаг 2)");
  const groups = new Map<string, ItemDraft[]>();
  for (const i of items) {
    const k = withInv === items.length ? i.invoice : "";
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(i);
  }
  const purchases: PlannedPurchase[] = [...groups.entries()].map(([k, its]) => {
    const invoice = k || h.invoiceNumber.trim();
    const okItems = its.filter((i) => Number.isFinite(i.quantity) && Number.isFinite(i.unitPrice));
    return { key: k || "—", invoice, items: its, totals: totalsOf(k || "—", invoice, okItems, ctx.rate, currency) };
  });

  const sum = (f: (p: PurchaseTotals) => number) => purchases.reduce((s, p) => s + f(p.totals), 0);
  const qty = sum((p) => p.qty);
  const inclVat = Math.round(sum((p) => p.inclVat) * 100) / 100;
  const exclVat = Math.round(sum((p) => p.exclVat) * 100) / 100;
  const foreignExcl = Math.round(sum((p) => p.foreignExcl) * 100) / 100;
  const totals = {
    lots: sum((p) => p.lots),
    qty,
    inclVat,
    exclVat,
    avgInclPerUnit: qty > 0 ? inclVat / qty : 0,
    avgExclPerUnit: qty > 0 ? exclVat / qty : 0,
    avgForeign: currency !== "RUB" && qty > 0 ? foreignExcl / qty : null,
    foreignExcl,
  };
  const planDiffRows = items.filter((i) => i.planDiffUnit != null && Math.abs(i.planDiffUnit) > 1).length;

  // сверка документов
  const allParts = purchases.every((p) => p.totals.auctionPart != null) ? purchases.reduce((s, p) => s + (p.totals.auctionPart ?? 0), 0) : null;
  const wholeTotals = {
    inclVat, exclVat, currency, rate: ctx.rate, foreignExcl,
    vatRates: [...new Set(purchases.flatMap((p) => p.totals.vatRates))],
    auctionPart: allParts,
  };
  // Сумма счёта аукциона, введённая на шаге 1, сверяется как документ (файлы не прикладываются).
  const invAmount = (h.invoiceAmount ?? "").trim();
  const docInputs = invAmount
    ? [...payload.docs, { idx: 1000, name: "Счёт аукциона (сумма с шага 1)", kind: "AUCTION_INVOICE" as const, number: h.invoiceNumber, date: "", amount: invAmount }]
    : payload.docs;
  const docs: DocRecon[] = docInputs.map((d) => {
    const amount = d.amount.trim() ? parseMoney(d.amount.trim()) ?? num(d.amount) : NaN;
    const base: Pick<DocRecon, "idx" | "name" | "kind"> = { idx: d.idx, name: d.name, kind: d.kind };
    if (!AMOUNT_KINDS.includes(d.kind)) return { ...base, against: "", amount: null, recon: null, note: "Для этого типа документа сумма не сверяется" };
    if (!Number.isFinite(amount)) return { ...base, against: "", amount: null, recon: null, note: "Сумма документа не указана — сверка не выполнена. Введите сумму, если хотите проверить." };
    const match = d.number.trim() ? purchases.find((p) => p.invoice && sameNumber(p.invoice, d.number)) : undefined;
    if (match) {
      const t = match.totals;
      return { ...base, against: `закупка по счёту ${match.invoice}`, amount, recon: reconcileAmount(amount, { inclVat: t.inclVat, exclVat: t.exclVat, currency, rate: ctx.rate, foreignExcl: t.foreignExcl, vatRates: t.vatRates, auctionPart: t.auctionPart }, undefined, d.kind), note: null };
    }
    if (d.kind === "AUCTION_INVOICE" && purchases.length > 1 && purchases.every((p) => p.invoice)) {
      return { ...base, against: "", amount, recon: null, note: `Нет закупки со счётом аукциона № ${d.number || "?"}: в таблице счета ${purchases.map((p) => p.invoice).join(", ")}. Проверьте номер документа.` };
    }
    return { ...base, against: purchases.length > 1 ? "вся партия" : "закупка", amount, recon: reconcileAmount(amount, wholeTotals, undefined, d.kind), note: null };
  });
  const mismatchDocs = docs.filter((d) => d.recon && !d.recon.ok).length;

  const newMaterials = [...new Set(validation.checks.map((c) => c.newMaterial).filter((x): x is string => !!x))];
  const newColors = [...new Set(validation.checks.map((c) => c.newColor).filter((x): x is string => !!x))];

  const preview: BatchPreview = {
    validation, purchases: purchases.map((p) => p.totals), totals, docs, blocking, planDiffRows, debtNow,
    receiving: h.receiveNow, newMaterials, newColors, mismatchDocs,
  };
  return { preview, purchases, ctx, auctionName, existingAuctionId: existing?.id ?? null, rate: ctx.rate, currency };
}
