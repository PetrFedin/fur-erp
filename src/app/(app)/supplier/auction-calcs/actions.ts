"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSupplierSession, inboxScope, INBOX_FILE_KINDS } from "@/lib/supplier-inbox";
import { calcAll, ensureRowIds, payloadFromTable, sendProblems, type CalcPayload, FORMAT_LABEL } from "@/lib/supplier-calc";
import { parseTableFile } from "@/lib/table-file";
import { readDocumentFiles, writeDocumentFiles } from "@/lib/purchase-files";
import { removeStoredFiles } from "@/lib/fitting-files";

type R = { error?: string; ok?: boolean; id?: string; warnings?: string[]; payload?: CalcPayload };

function parsePayload(json: string): CalcPayload | string {
  if (json.length > 2_000_000) return "Слишком большой расчёт";
  try {
    const p = JSON.parse(json) as CalcPayload;
    if (p?.v !== 1 || !(p.format in FORMAT_LABEL) || !Array.isArray(p.rows) || !p.header) return "Некорректные данные расчёта";
    if (p.rows.length > 500) return "Не больше 500 строк в одном расчёте";
    return ensureRowIds(p);
  } catch {
    return "Некорректные данные расчёта";
  }
}

const titleOf = (p: CalcPayload) => [p.header.auction.trim() || "Расчёт аукциона", p.header.invoice.trim() ? `счёт ${p.header.invoice.trim()}` : ""].filter(Boolean).join(" · ").slice(0, 160);

/** Сохранить черновик (создать или обновить). После отправки править нельзя. Пишет только в SupplierInbox. */
export async function saveCalcDraft(id: string | null, json: string): Promise<R> {
  const s = await requireSupplierSession();
  const p = parsePayload(json);
  if (typeof p === "string") return { error: p };
  const totals = calcAll(p);
  const data = { title: titleOf(p), payload: { ...p, totals: { qty: totals.qty, totalRub: Math.round(totals.totalRub * 100) / 100 } } as object };
  if (id) {
    const cur = await prisma.supplierInbox.findFirst({ where: { id, kind: "AUCTION_CALC", ...inboxScope(s) }, select: { status: true } });
    if (!cur) return { error: "Расчёт не найден" };
    if (cur.status !== "DRAFT") return { error: "Отправленный расчёт править нельзя" };
    await prisma.supplierInbox.update({ where: { id }, data });
    revalidatePath("/supplier/auction-calcs");
    return { ok: true, id };
  }
  const row = await prisma.supplierInbox.create({
    data: { ...data, organizationId: s.user.organizationId, supplierId: s.user.supplierId, createdById: s.user.id, kind: "AUCTION_CALC", status: "DRAFT" },
    select: { id: true },
  });
  revalidatePath("/supplier/auction-calcs");
  return { ok: true, id: row.id };
}

/** «Отправить нам»: DRAFT → SENT. Сначала сохраняет присланные данные. */
export async function sendCalc(id: string, json: string): Promise<R> {
  const s = await requireSupplierSession();
  const p = parsePayload(json);
  if (typeof p === "string") return { error: p };
  const problems = sendProblems(p);
  if (problems.length) return { error: problems.slice(0, 4).join("; ") };
  const saved = await saveCalcDraft(id, json);
  if (saved.error) return saved;
  const r = await prisma.supplierInbox.updateMany({ where: { id, kind: "AUCTION_CALC", status: "DRAFT", ...inboxScope(s) }, data: { status: "SENT", sentAt: new Date() } });
  if (r.count !== 1) return { error: "Не удалось отправить: расчёт уже отправлен или не найден" };
  revalidatePath("/supplier/auction-calcs");
  return { ok: true, id };
}

export async function deleteCalcDraft(id: string): Promise<R> {
  const s = await requireSupplierSession();
  const row = await prisma.supplierInbox.findFirst({ where: { id, kind: "AUCTION_CALC", status: "DRAFT", ...inboxScope(s) }, include: { files: true } });
  if (!row) return { error: "Черновик не найден" };
  await prisma.supplierInbox.delete({ where: { id } });
  await removeStoredFiles(row.files.map((f) => f.storagePath));
  revalidatePath("/supplier/auction-calcs");
  return { ok: true };
}

/** Разбор файла Excel/CSV в черновик на экране. Ничего не сохраняет. */
export async function parseCalcFile(formData: FormData): Promise<R> {
  await requireSupplierSession();
  const f = formData.get("file");
  if (!f || typeof f === "string" || f.size === 0) return { error: "Выберите файл" };
  if (f.size > 10 * 1024 * 1024) return { error: "Файл больше 10 МБ" };
  const name = (f.name || "файл").replace(/[\u0000-\u001f]/g, "");
  if (!/\.(xlsx|csv|txt|tsv)$/i.test(name)) return { error: /\.xls$/i.test(name) ? "Формат .xls не читается — сохраните файл в Excel как .xlsx" : "Подходят файлы Excel (.xlsx) и CSV" };
  try {
    const t = await parseTableFile(Buffer.from(await f.arrayBuffer()), name);
    const r = payloadFromTable(t);
    if ("error" in r) return { error: r.error };
    return { ok: true, payload: r.payload, warnings: r.warnings };
  } catch {
    return { error: "Не удалось прочитать файл. Сохраните его как .xlsx заново." };
  }
}

export async function attachInboxFile(id: string, kind: string, formData: FormData): Promise<R> {
  const s = await requireSupplierSession();
  if (!INBOX_FILE_KINDS.some((k) => k.key === kind)) return { error: "Неизвестный тип файла" };
  const row = await prisma.supplierInbox.findFirst({ where: { id, ...inboxScope(s) }, select: { status: true, _count: { select: { files: true } } } });
  if (!row) return { error: "Расчёт не найден" };
  if (row.status !== "DRAFT") return { error: "К отправленному расчёту файлы не добавляются" };
  if (row._count.files >= 20) return { error: "Не больше 20 файлов" };
  const read = await readDocumentFiles(formData.getAll("files"));
  if ("error" in read) return { error: read.error };
  const stored = await writeDocumentFiles(s.user.organizationId, `supplier-inbox/${id}`, read.files);
  await prisma.supplierInboxFile.createMany({ data: stored.map((d) => ({ inboxId: id, storagePath: d.storagePath, originalName: d.originalName, mimeType: d.mimeType, sizeBytes: d.sizeBytes, kind: kind as never })) });
  revalidatePath(`/supplier/auction-calcs/${id}`);
  return { ok: true };
}

export async function removeInboxFile(fileId: string): Promise<R> {
  const s = await requireSupplierSession();
  const f = await prisma.supplierInboxFile.findFirst({ where: { id: fileId, inbox: { status: "DRAFT", ...inboxScope(s) } } });
  if (!f) return { error: "Файл не найден" };
  await prisma.supplierInboxFile.delete({ where: { id: fileId } });
  await removeStoredFiles([f.storagePath]);
  revalidatePath(`/supplier/auction-calcs/${f.inboxId}`);
  return { ok: true };
}
