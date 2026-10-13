import "server-only";
import type { PrismaClient } from "@prisma/client";
import { DRIVE_DOC_TYPES, guessDocType, type DriveDocTypeKey } from "@/lib/drive-docs";
import { extractDocRefs, refFromField, typeGroup, type DocRef } from "@/lib/source-docs";
import { recognizeFromName, recognizeFromText, type DocKindKey } from "@/lib/batch-intake";

/**
 * Массовая загрузка документов: по имени файла и тексту (PDF/DOCX/XLSX) предлагаем тип, номер, дату и привязку.
 * Только то, что названо явно (extractDocRefs, номер закупки, № ТЗ, «партия N», «лот N»); нет однозначного
 * совпадения — привязку не угадываем (target = null, «выберите вручную»).
 */

export type BulkEntity = "purchase" | "lot" | "payment" | "productionPayment" | "order" | "batch";
export const BULK_ENTITY_LABEL: Record<BulkEntity, string> = {
  purchase: "Закупка",
  payment: "Оплата поставщику",
  productionPayment: "Оплата производства",
  order: "ТЗ",
  batch: "Партия",
  lot: "Лот",
};
export type BulkTarget = { entity: BulkEntity; id: string; label: string; why: string };
export type BulkSuggestion = {
  docType: DriveDocTypeKey;
  number: string;
  date: string;
  amount: number | null;
  textRead: boolean;
  candidates: BulkTarget[];
  target: BulkTarget | null;
  note: string | null;
  duplicate: boolean;
};

type Db = Pick<PrismaClient, "purchase" | "payment" | "productionPayment" | "productionOrder" | "productionBatch" | "rawMaterialLot" | "driveDocument">;

const KIND_TO_DRIVE: Record<DocKindKey, DriveDocTypeKey> = {
  AUCTION_INVOICE: "AUCTION_INVOICE",
  SPECIFICATION: "SPECIFICATION",
  ADVANCE_INVOICE: "PAYMENT_INVOICE",
  CALC_SHEET: "CALC_SHEET",
  UPD: "UPD",
  PAYMENT_PROOF: "PAYMENT_PROOF",
  OTHER: "OTHER",
};

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[\s№#]/g, "").replace(/^0+(?=\d)/, "");
const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "");
const ruD = (d: Date | null | undefined) => (d ? `${iso(d).slice(8, 10)}.${iso(d).slice(5, 7)}.${iso(d).slice(0, 4)}` : "");
const money = (n: { toString(): string }) => Number(n.toString());

export type MatchInput = { fileName: string; text: string };

/** Тип/номер/дата/сумма документа по имени и тексту. */
export function recognizeBulk(inp: MatchInput, ext: string): Pick<BulkSuggestion, "docType" | "number" | "date" | "amount" | "textRead"> {
  const fromName = recognizeFromName(inp.fileName);
  const textRead = inp.text.trim().length > 0;
  const fromText = textRead ? recognizeFromText(inp.text) : null;
  const kind: DocKindKey | null = (ext === "xlsx" ? (fromName.kind ?? fromText?.kind) : (fromText?.kind ?? fromName.kind)) ?? null;
  let docType: DriveDocTypeKey = kind ? KIND_TO_DRIVE[kind] : "OTHER";
  if (docType === "OTHER") {
    const g = guessDocType(inp.fileName);
    if (g && (DRIVE_DOC_TYPES as readonly string[]).includes(g)) docType = g;
  }
  return { docType, number: fromText?.number ?? fromName.number ?? "", date: fromText?.date ?? fromName.date ?? "", amount: fromText?.amount ?? null, textRead };
}

/** Упоминания документов в имени и начале текста: по ним ищем привязку. */
function refsOf(inp: MatchInput): DocRef[] {
  return extractDocRefs(`${inp.fileName.replace(/\.[A-Za-z0-9]{1,5}$/, "").replace(/[_]+/g, " ")} ${inp.text.slice(0, 4000)}`);
}

function numsOf(rec: { docType: DriveDocTypeKey; number: string }, refs: DocRef[], group: (t: string) => boolean): Set<string> {
  const out = new Set<string>();
  if (rec.number && group(rec.docType)) out.add(norm(rec.number));
  for (const r of refs) if (r.number && group(r.docType)) out.add(norm(r.number));
  out.delete("");
  return out;
}

const INVOICE_LIKE = (t: string) => ["AUCTION_INVOICE", "PAYMENT_INVOICE", "UPD", "CALC_SHEET", "SPECIFICATION", "OTHER"].includes(t) || typeGroup(t) === "INVOICE";

/** Кандидаты привязки для файла. */
export async function findTargets(db: Db, orgId: string, inp: MatchInput, rec: ReturnType<typeof recognizeBulk>): Promise<BulkTarget[]> {
  const refs = refsOf(inp);
  const out: BulkTarget[] = [];
  const add = (t: BulkTarget) => { if (!out.some((x) => x.entity === t.entity && x.id === t.id)) out.push(t); };
  const hay = `${inp.fileName} ${inp.text.slice(0, 4000)}`;

  // --- закупки: № счёта / УПД / номер закупки / упоминания в заметке
  if (INVOICE_LIKE(rec.docType)) {
    const wanted = numsOf(rec, refs, INVOICE_LIKE);
    const purchases = await db.purchase.findMany({
      where: { organizationId: orgId, status: { not: "CANCELLED" } },
      select: { id: true, number: true, invoiceNumber: true, transferDocument: true, notes: true, orderDate: true, supplier: { select: { name: true } } },
    });
    for (const p of purchases) {
      const label = `${p.number} · ${p.supplier.name} · ${ruD(p.orderDate)}`;
      const own: { n: string; why: string }[] = [];
      const inv = refFromField("AUCTION_INVOICE", p.invoiceNumber);
      if (inv?.number) own.push({ n: norm(inv.number), why: `№ счёта ${inv.number}` });
      const upd = refFromField("UPD", p.transferDocument);
      if (upd?.number) own.push({ n: norm(upd.number), why: `№ УПД ${upd.number}` });
      for (const r of extractDocRefs(p.notes)) if (r.number && INVOICE_LIKE(r.docType)) own.push({ n: norm(r.number), why: `${r.label} в заметке` });
      const hit = own.find((o) => o.n && wanted.has(o.n));
      if (hit) add({ entity: "purchase", id: p.id, label, why: `совпал ${hit.why}` });
      else if (new RegExp(`(^|[^\\p{L}\\d])${p.number.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}\\d])`, "iu").test(hay)) add({ entity: "purchase", id: p.id, label, why: `номер закупки ${p.number} в имени или тексте` });
    }
  }

  // --- оплаты: № п/п
  const ppNums = new Set<string>();
  if (rec.docType === "PAYMENT_PROOF" && rec.number) ppNums.add(norm(rec.number));
  for (const r of refs) if (r.docType === "PAYMENT_PROOF" && r.number) ppNums.add(norm(r.number));
  ppNums.delete("");
  if (ppNums.size > 0 || rec.docType === "PAYMENT_PROOF") {
    const [pays, prod] = await Promise.all([
      db.payment.findMany({ where: { organizationId: orgId, status: { not: "CANCELLED" }, docRef: { not: null } }, select: { id: true, docRef: true, amount: true, paidAt: true, supplier: { select: { name: true } } } }),
      db.productionPayment.findMany({ where: { organizationId: orgId, status: { not: "CANCELLED" }, docRef: { not: null } }, select: { id: true, docRef: true, amount: true, paidAt: true, client: { select: { name: true } } } }),
    ]);
    const fits = (docRef: string | null) => extractDocRefs(docRef).some((r) => r.docType === "PAYMENT_PROOF" && r.number && ppNums.has(norm(r.number)));
    const pm: BulkTarget[] = [];
    for (const p of pays) if (fits(p.docRef)) pm.push({ entity: "payment", id: p.id, label: `${p.supplier.name} · ${ruD(p.paidAt)} · ${money(p.amount).toLocaleString("ru-RU")} ₽`, why: `совпал № п/п (${p.docRef})` });
    for (const p of prod) if (fits(p.docRef)) pm.push({ entity: "productionPayment", id: p.id, label: `${p.client?.name ?? "оплата производства"} · ${ruD(p.paidAt)} · ${money(p.amount).toLocaleString("ru-RU")} ₽`, why: `совпал № п/п (${p.docRef})` });
    // несколько оплат с одним номером п/п: сужаем по сумме, названной в документе
    const byAmount = rec.amount != null ? pm.filter((t) => t.label.includes(`${rec.amount!.toLocaleString("ru-RU")} ₽`)) : [];
    for (const t of pm.length > 1 && byAmount.length > 0 ? byAmount : pm) add(t);
  }

  // --- ТЗ: «ТЗ 88», «приложение №88», № ТЗ по документу
  const tzNums = new Set<string>();
  const tzRx = /(?:^|[^\p{L}\d])тз\s*№?\s*(\d+)/giu;
  for (const m of hay.matchAll(tzRx)) tzNums.add(norm(m[1]));
  for (const r of refs) if ((r.docType === "TZ_APPENDIX") && r.number) tzNums.add(norm(r.number));
  if (rec.docType === "TZ_APPENDIX" && rec.number) tzNums.add(norm(rec.number));
  tzNums.delete("");
  if (tzNums.size > 0) {
    const orders = await db.productionOrder.findMany({ where: { organizationId: orgId, status: { not: "CANCELLED" } }, select: { id: true, number: true, workOrderNumber: true, client: { select: { name: true } } } });
    for (const o of orders) {
      const hit = [o.workOrderNumber, o.number].find((v) => v && tzNums.has(norm(v)));
      if (hit) add({ entity: "order", id: o.id, label: `ТЗ ${o.workOrderNumber ?? o.number}${o.client ? ` · ${o.client.name}` : ""}`, why: `совпал № ТЗ ${hit}` });
    }
  }

  // --- партия производства: «партия 12»
  const bm = /парти[яиюе]\s*(?:№|n)?\s*(\d{1,4})(?!\d)/iu.exec(hay);
  if (bm) {
    const b = await db.productionBatch.findFirst({ where: { organizationId: orgId, number: Number(bm[1]) }, select: { id: true, number: true, name: true } });
    if (b) add({ entity: "batch", id: b.id, label: `Партия ${b.number}${b.name ? ` · ${b.name}` : ""}`, why: `«партия ${bm[1]}» в имени или тексте` });
  }

  // --- лот: «лот 12345»
  const lm = /(?:^|[^\p{L}\d])лот\s*(?:№|n)?\s*([\p{L}\d][\p{L}\d\-/]{1,24})/iu.exec(inp.fileName);
  if (lm) {
    const lots = await db.rawMaterialLot.findMany({ where: { organizationId: orgId, lotNumber: { equals: lm[1], mode: "insensitive" } }, select: { id: true, lotNumber: true, purchase: { select: { number: true } } }, take: 6 });
    for (const l of lots) add({ entity: "lot", id: l.id, label: `Лот ${l.lotNumber}${l.purchase ? ` · закупка ${l.purchase.number}` : ""}`, why: `«лот ${lm[1]}» в имени файла` });
  }
  return out;
}

/** Уже есть такой же файл (имя и размер) у этого объекта. */
export async function isDuplicate(db: Db, orgId: string, t: BulkTarget, fileName: string, size: number): Promise<boolean> {
  const key: Record<BulkEntity, string> = { purchase: "purchaseId", lot: "lotId", payment: "paymentId", productionPayment: "productionPaymentId", order: "productionOrderId", batch: "productionBatchId" };
  const n = await db.driveDocument.count({ where: { organizationId: orgId, storedName: fileName, storedSize: size, [key[t.entity]]: t.id } });
  return n > 0;
}

export function decide(candidates: BulkTarget[]): { target: BulkTarget | null; note: string | null } {
  if (candidates.length === 1) return { target: candidates[0], note: null };
  if (candidates.length === 0) return { target: null, note: "Однозначного совпадения нет — выберите привязку вручную" };
  return { target: null, note: `Подходит несколько объектов (${candidates.length}) — выберите вручную` };
}
