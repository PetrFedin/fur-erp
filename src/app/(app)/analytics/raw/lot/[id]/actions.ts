"use server";

// Карточка лота — ПЕРВОИСТОЧНИК данных лота: здесь правятся все поля паспорта (описание, цена, количество, НДС, даты, закупка-основание,
// поставщик/счёт/УПД, остаток), строки расчётного листа и документы. Закупка, таблицы и Главная только показывают эти данные и ведут сюда.
// Деньги и количество идут через lot-reprice: предпросмотр «что изменится» (previewLotChange) → запись в транзакции с отпечатком плана (applyLotChange);
// каждая запись попадает в журнал изменений (расширение клиента БД) и сбрасывает кэш всех страниц (revalidateAll).
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { revalidateAll } from "@/lib/revalidate-all";
import { rowVersion, LOT_V, VERSION_FIELD } from "@/lib/concurrency";
import { updateLotMeta } from "@/app/(app)/purchases/actions";
import { isCompCat } from "@/lib/lot-sheet";
import { Decimal } from "@prisma/client/runtime/library";
import { buildLotPlan, applyLotWrites, type LotChange, type LotPlan } from "@/lib/lot-reprice";
import { resetByPurchase, resetByPurchaseDoc } from "@/lib/verification";
import { readDocumentFiles, writeDocumentFiles } from "@/lib/purchase-files";
import { removeStoredFiles } from "@/lib/fitting-files";
import { parseDateInput } from "@/lib/input";
import { auctionName } from "@/lib/auction-payments";
import { replaceFirstLine } from "@/lib/auction-key";

const ROLES = ["OWNER", "ADMIN", "PURCHASER", "WAREHOUSE"] as const;
type Res = { error?: string };

export type LotPatch = {
  lotNumber?: string;
  grade?: string;
  sizeGrade?: string;
  notes?: string;
  color?: { text: string; refId: string };
};

/** Меняет одно или несколько описательных полей лота; остальные берутся из базы как есть. */
export async function saveLotFields(lotId: string, patch: LotPatch): Promise<Res> {
  const session = await requireRole(...ROLES);
  const lot = await prisma.rawMaterialLot.findFirst({
    where: { id: lotId, organizationId: session.user.organizationId },
    select: { lotNumber: true, grade: true, sizeGrade: true, color: true, colorRefId: true, notes: true },
  });
  if (!lot) return { error: "Лот не найден" };
  const fd = new FormData();
  fd.set("lotNumber", patch.lotNumber ?? lot.lotNumber ?? "");
  fd.set("grade", patch.grade ?? lot.grade ?? "");
  fd.set("sizeGrade", patch.sizeGrade ?? lot.sizeGrade ?? "");
  fd.set("notes", patch.notes ?? lot.notes ?? "");
  fd.set("color", patch.color ? patch.color.text : lot.color ?? "");
  fd.set("colorRefId", patch.color ? patch.color.refId : lot.colorRefId ?? "");
  fd.set(VERSION_FIELD, rowVersion(lot, LOT_V));
  const r = await updateLotMeta(lotId, fd);
  return r.error ? { error: r.error } : {};
}

const idsSchema = z.array(z.string().min(1).max(40)).max(30);

/** Признаки меха лота (седина, происхождение…): заменяет набор ссылок на справочник «Признаки меха». */
export async function saveLotAttrs(lotId: string, attrIds: string[]): Promise<Res> {
  const session = await requireRole(...ROLES);
  const orgId = session.user.organizationId;
  const p = idsSchema.safeParse(attrIds);
  if (!p.success) return { error: "Некорректный список признаков" };
  const ids = Array.from(new Set(p.data));
  const lot = await prisma.rawMaterialLot.findFirst({ where: { id: lotId, organizationId: orgId }, select: { id: true } });
  if (!lot) return { error: "Лот не найден" };
  const refs = await prisma.furAttrRef.findMany({ where: { organizationId: orgId, id: { in: ids } }, select: { id: true } });
  if (refs.length !== ids.length) return { error: "Признак не найден в справочнике" };
  const cur = await prisma.rawMaterialLotAttr.findMany({ where: { lotId }, select: { attrId: true } });
  const have = new Set(cur.map((c) => c.attrId));
  const add = ids.filter((i) => !have.has(i));
  const del = cur.map((c) => c.attrId).filter((i) => !ids.includes(i));
  await prisma.$transaction([
    ...(del.length ? [prisma.rawMaterialLotAttr.deleteMany({ where: { lotId, attrId: { in: del } } })] : []),
    ...(add.length ? [prisma.rawMaterialLotAttr.createMany({ data: add.map((attrId) => ({ lotId, attrId, source: "manual" })) })] : []),
  ]);
  revalidateAll(orgId);
  return {};
}

const noteSchema = z.object({
  idx: z.number().int().min(0).max(500),
  title: z.string().trim().max(200),
  cat: z.string().max(20),
  src: z.string().trim().max(200),
});

/**
 * Заметки к строкам расчётного листа лота без изменения сумм: название для показа, категория сектора, источник.
 * Подпись (label) строки не меняется — по ней распознаётся статья; значения правятся через applyLotChange.
 */
export async function saveLotSheetNotes(lotId: string, notes: { idx: number; title: string; cat: string; src: string }[]): Promise<Res> {
  const session = await requireRole(...ROLES);
  const orgId = session.user.organizationId;
  const p = z.array(noteSchema).max(500).safeParse(notes);
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Проверьте поля расчёта" };
  const lot = await prisma.rawMaterialLot.findFirst({ where: { id: lotId, organizationId: orgId }, select: { costBreakdown: true, purchaseItems: { select: { costPlan: true } } } });
  if (!lot) return { error: "Лот не найден" };
  // Нет собственного листа — берём копию листа позиции закупки (дальше лот живёт со своим расчётом).
  const planBd = lot.purchaseItems.map((i) => (i.costPlan as { costBreakdown?: { items?: unknown[] } } | null)?.costBreakdown).find((b) => Array.isArray(b?.items));
  const bd = (lot.costBreakdown as { items?: Record<string, unknown>[] } | null)?.items ? (lot.costBreakdown as { items?: Record<string, unknown>[] }) : (planBd as { items?: Record<string, unknown>[] } | undefined) ?? null;
  if (!bd || !Array.isArray(bd.items)) return { error: "У лота нет расчётного листа" };
  const items = bd.items.map((x) => ({ ...x }));
  for (const n of p.data) {
    const it = items[n.idx];
    if (!it) return { error: "Строка расчёта не найдена — обновите страницу" };
    if (n.cat !== "" && !isCompCat(n.cat)) return { error: "Неизвестная категория сектора" };
    for (const k of ["title", "cat", "src"] as const) {
      const v = n[k];
      if (v === "" || (k === "title" && v === String(it.label ?? "").trim())) delete it[k];
      else it[k] = v;
    }
  }
  await prisma.rawMaterialLot.update({ where: { id: lotId }, data: { costBreakdown: { ...bd, items } as never } });
  revalidateAll(orgId);
  return {};
}

// ───────────── Пересчёт цены, количества, НДС и строк расчёта ─────────────

const changeSchema = z.object({
  qty: z.string().max(30).optional(), unitPrice: z.string().max(30).optional(), unitExcl: z.string().max(30).optional(), unitIncl: z.string().max(30).optional(),
  totalIncl: z.string().max(30).optional(), vatRate: z.string().max(10).optional(), vatKeep: z.enum(["incl", "excl"]).optional(),
  hammerExcl: z.string().max(30).optional(), hammerUsd: z.string().max(30).optional(),
  sheet: z.array(z.object({ idx: z.number().int().min(0).max(500), value: z.number().finite().optional(), title: z.string().trim().max(200).optional(), cat: z.string().max(20).optional(), src: z.string().trim().max(200).optional() })).max(500).optional(),
});

/** Предпросмотр: что изменится в лоте, закупке, списаниях ТЗ и себестоимости (ничего не записывает). */
export async function previewLotChange(lotId: string, change: LotChange): Promise<{ error: string } | { plan: LotPlan }> {
  const session = await requireRole(...ROLES);
  const p = changeSchema.safeParse(change);
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Проверьте значения" };
  const r = await buildLotPlan(prisma, session.user.organizationId, lotId, p.data as LotChange);
  return "error" in r ? { error: r.error } : { plan: r.plan };
}

/** Запись: план строится заново внутри транзакции под блокировкой лота; если он отличается от показанного — отказ. */
export async function applyLotChange(lotId: string, change: LotChange, hash: string): Promise<Res> {
  const session = await requireRole(...ROLES);
  const orgId = session.user.organizationId;
  const p = changeSchema.safeParse(change);
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Проверьте значения" };
  let purchaseId: string | null = null;
  try {
    const res = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "RawMaterialLot" WHERE "id" = ${lotId} AND "organizationId" = ${orgId} FOR UPDATE`;
      const r = await buildLotPlan(tx, orgId, lotId, p.data as LotChange);
      if ("error" in r) return { error: r.error };
      if (r.plan.hash !== hash) return { error: "Данные лота изменились, пока открыто окно подтверждения, — повторите правку" };
      await applyLotWrites(tx, orgId, r.writes);
      purchaseId = r.writes.purchaseId;
      return {};
    }, { maxWait: 10_000, timeout: 60_000 });
    if (res.error) return res;
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Не удалось пересчитать лот" };
  }
  await resetByPurchase(purchaseId);
  revalidateAll(orgId);
  return {};
}

// ───────────── Остаток, материал, даты, закупка ─────────────

/** Ручная корректировка остатка лота: разница записывается движением склада «Корректировка» (остаток = получено − списано − прочее). */
export async function setLotRemaining(lotId: string, remaining: string): Promise<Res> {
  const session = await requireRole(...ROLES);
  const orgId = session.user.organizationId;
  const t = String(remaining).replace(/[\s\u00a0]/g, "").replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(t)) return { error: "Остаток: укажите число" };
  const r = new Decimal(t).toDecimalPlaces(3);
  const lot = await prisma.rawMaterialLot.findFirst({ where: { id: lotId, organizationId: orgId }, include: { usages: { select: { quantity: true } } } });
  if (!lot) return { error: "Лот не найден" };
  const used = lot.usages.reduce((s, u) => s.add(u.quantity), new Decimal(0));
  const max = lot.quantityReceived.sub(used);
  if (r.gt(max)) return { error: `Остаток не может быть больше ${max.toString()}: получено ${lot.quantityReceived.toString()}, списано в ТЗ ${used.toString()}` };
  const diff = r.sub(lot.quantityRemaining);
  if (diff.isZero()) return {};
  await prisma.$transaction(async (tx) => {
    await tx.rawMaterialLot.update({ where: { id: lotId }, data: { quantityRemaining: r } });
    await tx.stockMovement.create({
      data: {
        organizationId: orgId, warehouseId: lot.warehouseId, rawMaterialId: lot.rawMaterialId, lotId, purchaseId: lot.purchaseId,
        type: diff.gt(0) ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT", quantity: diff.abs(), unitCost: lot.unitCost, totalCost: diff.abs().mul(lot.unitCost).toDecimalPlaces(2),
        notes: "Корректировка остатка из карточки лота",
      },
    });
  });
  revalidateAll(orgId);
  return {};
}

/** Дата прихода лота (и дата движения «приход» по нему). */
export async function saveLotReceivedDate(lotId: string, iso: string): Promise<Res> {
  const session = await requireRole(...ROLES);
  const orgId = session.user.organizationId;
  const d = parseDateInput(iso);
  if (!d) return { error: "Укажите корректную дату" };
  const lot = await prisma.rawMaterialLot.findFirst({ where: { id: lotId, organizationId: orgId }, select: { id: true, purchaseId: true } });
  if (!lot) return { error: "Лот не найден" };
  await prisma.$transaction([
    prisma.rawMaterialLot.update({ where: { id: lotId }, data: { receivedDate: d } }),
    prisma.stockMovement.updateMany({ where: { lotId, type: "PURCHASE_IN" }, data: { date: d } }),
  ]);
  revalidateAll(orgId);
  return {};
}

/** Вид меха / ткань лота: только материал той же единицы измерения. Лот, его движения, списания и позиция закупки переносятся вместе. */
export async function changeLotMaterial(lotId: string, rawMaterialId: string): Promise<Res> {
  const session = await requireRole(...ROLES);
  const orgId = session.user.organizationId;
  const lot = await prisma.rawMaterialLot.findFirst({ where: { id: lotId, organizationId: orgId }, include: { rawMaterial: { select: { unit: true } }, purchaseItems: { select: { id: true } } } });
  if (!lot) return { error: "Лот не найден" };
  if (lot.rawMaterialId === rawMaterialId) return {};
  const m = await prisma.rawMaterial.findFirst({ where: { id: rawMaterialId, organizationId: orgId }, select: { id: true, unit: true } });
  if (!m) return { error: "Материал не найден" };
  if (m.unit !== lot.rawMaterial.unit) return { error: "Материал должен измеряться в тех же единицах (шкуры — в штуках, ткань — в метрах)" };
  if (lot.purchaseItems.length > 1) return { error: "Лот собран из нескольких поступлений (общий остаток ткани) — материал менять нельзя" };
  await prisma.$transaction([
    prisma.rawMaterialLot.update({ where: { id: lotId }, data: { rawMaterialId } }),
    prisma.stockMovement.updateMany({ where: { lotId }, data: { rawMaterialId } }),
    prisma.productionMaterialUsage.updateMany({ where: { lotId }, data: { rawMaterialId } }),
    prisma.purchaseItem.updateMany({ where: { lotId }, data: { rawMaterialId } }),
  ]);
  if (lot.purchaseId) await resetByPurchase(lot.purchaseId);
  revalidateAll(orgId);
  return {};
}

export type PurchasePatch = { supplierId?: string; invoiceNumber?: string; transferDocument?: string; orderDate?: string; auctionId?: string };

/** Поля закупки-основания, показанные в паспорте лота (поставщик, счёт, УПД, дата закупки, аукцион): правятся здесь и действуют на всю закупку. */
export async function saveLotPurchaseFields(lotId: string, patch: PurchasePatch): Promise<Res> {
  const session = await requireRole(...ROLES);
  const orgId = session.user.organizationId;
  const lot = await prisma.rawMaterialLot.findFirst({ where: { id: lotId, organizationId: orgId }, select: { purchase: true } });
  const pu = lot?.purchase;
  if (!pu) return { error: "У лота нет закупки-основания" };
  const data: Record<string, unknown> = {};
  let lumpCheck: string | null = null, newAuction: string | null | undefined;
  if (patch.supplierId !== undefined) {
    if (patch.supplierId !== pu.supplierId) {
      const sup = await prisma.supplier.findFirst({ where: { id: patch.supplierId, organizationId: orgId }, select: { id: true } });
      if (!sup) return { error: "Поставщик не найден" };
      const other = await prisma.payment.count({ where: { organizationId: orgId, purchaseId: pu.id, supplierId: { not: patch.supplierId } } });
      if (other > 0) return { error: `По закупке есть оплаты другому поставщику (${other} шт.) — сначала исправьте их на странице «Оплаты»` };
      data.supplierId = patch.supplierId;
    }
  }
  if (patch.invoiceNumber !== undefined) data.invoiceNumber = patch.invoiceNumber.trim().slice(0, 200) || null;
  if (patch.transferDocument !== undefined) data.transferDocument = patch.transferDocument.trim().slice(0, 200) || null;
  if (patch.orderDate !== undefined) {
    const d = parseDateInput(patch.orderDate);
    if (!d) return { error: "Укажите корректную дату закупки" };
    data.orderDate = d;
  }
  if (patch.auctionId !== undefined) {
    if (patch.auctionId === "") { data.auctionId = null; data.auctionSession = null; newAuction = null; }
    else {
      const a = await prisma.auction.findFirst({ where: { id: patch.auctionId, organizationId: orgId }, select: { id: true, name: true } });
      if (!a) return { error: "Аукцион не найден в справочнике" };
      data.auctionId = a.id;
      data.auctionSession = pu.auctionSession && /\r?\n/.test(pu.auctionSession) ? replaceFirstLine(pu.auctionSession, a.name) : a.name;
      newAuction = a.name;
    }
    const oldName = auctionName(pu.auctionSession);
    if (oldName && oldName !== (newAuction ?? null)) lumpCheck = oldName;
  }
  if (lumpCheck) {
    const lump = await prisma.payment.count({ where: { organizationId: orgId, purchaseId: null, auctionSession: lumpCheck } });
    if (lump > 0) return { error: `Аукцион менять нельзя: по аукциону «${lumpCheck}» есть оплаты «целиком» (${lump} шт.) — они остались бы за прежним аукционом. Сначала перенесите их на странице «Оплаты».` };
  }
  if (Object.keys(data).length === 0) return {};
  await prisma.purchase.update({ where: { id: pu.id }, data });
  await resetByPurchase(pu.id);
  revalidateAll(orgId);
  return {};
}

/** Закупка-основание лота: перенос лота (и его позиции) в другую принятую закупку с тем же курсом. */
export async function relinkLotPurchase(lotId: string, purchaseId: string): Promise<Res> {
  const session = await requireRole(...ROLES);
  const orgId = session.user.organizationId;
  const lot = await prisma.rawMaterialLot.findFirst({ where: { id: lotId, organizationId: orgId }, include: { purchase: { select: { id: true, exchangeRate: true, currency: true } }, purchaseItems: { select: { id: true } } } });
  if (!lot) return { error: "Лот не найден" };
  if (lot.purchaseId === purchaseId) return {};
  if (lot.purchaseItems.length !== 1) return { error: "Лот собран из нескольких поступлений — закупку менять нельзя" };
  const target = await prisma.purchase.findFirst({ where: { id: purchaseId, organizationId: orgId, status: "RECEIVED" }, select: { id: true, exchangeRate: true, currency: true } });
  if (!target) return { error: "Закупка не найдена или ещё не принята" };
  if (lot.purchase && (!target.exchangeRate.eq(lot.purchase.exchangeRate) || target.currency !== lot.purchase.currency)) return { error: "У выбранной закупки другая валюта или курс — цены лота пересчитались бы; сначала выровняйте курс" };
  const old = lot.purchaseId;
  await prisma.$transaction([
    prisma.rawMaterialLot.update({ where: { id: lotId }, data: { purchaseId } }),
    prisma.purchaseItem.update({ where: { id: lot.purchaseItems[0].id }, data: { purchaseId } }),
    prisma.stockMovement.updateMany({ where: { lotId, purchaseId: old }, data: { purchaseId } }),
    prisma.purchaseDocument.updateMany({ where: { lotId }, data: { purchaseId } }),
  ]);
  await resetByPurchase(old);
  await resetByPurchase(purchaseId);
  revalidateAll(orgId);
  return {};
}

// ───────────── Документы лота ─────────────

const DOC_KINDS = ["UPD", "AUCTION_INVOICE", "SPECIFICATION", "OTHER"] as const;
export type LotDocState = { error?: string; ok?: boolean };

async function lotForDocs(lotId: string, orgId: string) {
  return prisma.rawMaterialLot.findFirst({ where: { id: lotId, organizationId: orgId }, select: { id: true, purchaseId: true } });
}

/** Загрузка документов в слот лота (УПД / счёт / спецификация / другое). Номера и суммы документов не требуются. */
export async function uploadLotDocuments(lotId: string, formData: FormData): Promise<LotDocState> {
  const session = await requireRole(...ROLES);
  const orgId = session.user.organizationId;
  const lot = await lotForDocs(lotId, orgId);
  if (!lot) return { error: "Лот не найден" };
  const kindRaw = String(formData.get("kind") ?? "OTHER");
  const kind = (DOC_KINDS as readonly string[]).includes(kindRaw) ? (kindRaw as (typeof DOC_KINDS)[number]) : "OTHER";
  const title = String(formData.get("title") ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 200);
  const read = await readDocumentFiles(formData.getAll("files"));
  if ("error" in read) return { error: read.error };
  const stored = await writeDocumentFiles(orgId, `lot-${lotId}`, read.files);
  try {
    await prisma.purchaseDocument.createMany({ data: stored.map((s) => ({ organizationId: orgId, purchaseId: lot.purchaseId, lotId, kind, title: title || s.originalName, ...s })) });
  } catch (e) {
    await removeStoredFiles(stored.map((s) => s.storagePath));
    throw e;
  }
  await resetByPurchaseDoc(orgId, { purchaseId: lot.purchaseId });
  revalidateAll(orgId);
  return { ok: true };
}

/** Замена файла документа лота: новый файл проверяется и пишется, строка обновляется, старый файл убирается последним. */
export async function replaceLotDocument(lotId: string, documentId: string, formData: FormData): Promise<LotDocState> {
  const session = await requireRole(...ROLES);
  const orgId = session.user.organizationId;
  const doc = await prisma.purchaseDocument.findFirst({ where: { id: documentId, lotId, organizationId: orgId } });
  if (!doc) return { error: "Документ не найден" };
  const read = await readDocumentFiles(formData.getAll("file"));
  if ("error" in read) return { error: read.error };
  if (read.files.length > 1) return { error: "Выберите один файл" };
  const [stored] = await writeDocumentFiles(orgId, `lot-${lotId}`, read.files);
  try {
    await prisma.purchaseDocument.update({ where: { id: doc.id }, data: { storagePath: stored.storagePath, originalName: stored.originalName, mimeType: stored.mimeType, sizeBytes: stored.sizeBytes } });
  } catch (e) {
    await removeStoredFiles([stored.storagePath]);
    throw e;
  }
  if ((await prisma.purchaseDocument.count({ where: { storagePath: doc.storagePath } })) === 0) await removeStoredFiles([doc.storagePath]);
  await resetByPurchaseDoc(orgId, { purchaseId: doc.purchaseId });
  revalidateAll(orgId);
  return { ok: true };
}

/** Удаление документа лота — только по явному клику (подтверждение в интерфейсе). Файл с диска убирается, если на него больше никто не ссылается. */
export async function deleteLotDocument(lotId: string, documentId: string): Promise<LotDocState> {
  const session = await requireRole(...ROLES);
  const orgId = session.user.organizationId;
  const doc = await prisma.purchaseDocument.findFirst({ where: { id: documentId, lotId, organizationId: orgId } });
  if (!doc) return { error: "Документ не найден" };
  await prisma.purchaseDocument.delete({ where: { id: doc.id } });
  if ((await prisma.purchaseDocument.count({ where: { storagePath: doc.storagePath } })) === 0) await removeStoredFiles([doc.storagePath]);
  await resetByPurchaseDoc(orgId, { purchaseId: doc.purchaseId });
  revalidateAll(orgId);
  return { ok: true };
}
