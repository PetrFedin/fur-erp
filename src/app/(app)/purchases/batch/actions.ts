"use server";

import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { ACCESS } from "@/lib/access";
import { readDocumentFiles } from "@/lib/purchase-files";
import { extractDocText } from "@/lib/doc-content-text";
import { parseTableFile } from "@/lib/table-file";
import { loadIntakeRefs, loadSupplierInvoices, planBatch } from "@/lib/batch-intake-server";
import { loadSupplierDebt } from "@/lib/supplier-debt";
import { createBatchCore } from "@/lib/batch-create";
import {
  AMOUNT_KINDS,
  DOC_KINDS,
  applyMapping,
  detectColumns,
  parseMoney,
  recognizeFromName,
  recognizeFromText,
  type BatchPayload,
  type BatchPreview,
  type BatchResult,
  type DocKindKey,
  type DocMeta,
  type IntakeRow,
} from "@/lib/batch-intake";

const MAX_TABLE_BYTES = 10 * 1024 * 1024;
const MAX_ROWS = 3000;
const KIND_KEYS = DOC_KINDS.map((k) => k.key) as string[];

export type ParsedTable = { table: string[][]; fileName: string; truncated: boolean };

/** Файл расчёта лотов или каталога → таблица ячеек (CSV/TXT/TSV и XLSX, первый лист). Ничего не сохраняет. */
export async function parseIntakeFile(formData: FormData): Promise<{ error: string } | ({ ok: true } & ParsedTable)> {
  await requireRole(...ACCESS.purchases);
  const f = formData.get("file");
  if (!f || typeof f === "string" || f.size === 0) return { error: "Выберите файл" };
  if (f.size > MAX_TABLE_BYTES) return { error: "Файл больше 10 МБ — разбейте его на части" };
  const name = (f.name || "файл").replace(/[\u0000-\u001f]/g, "");
  if (!/\.(xlsx|csv|txt|tsv)$/i.test(name)) {
    if (/\.xls$/i.test(name)) return { error: "Формат .xls не читается — откройте файл в Excel и сохраните как .xlsx или .csv" };
    return { error: "Подходят файлы Excel (.xlsx) и CSV/TXT. Либо вставьте строки из таблицы на этом шаге." };
  }
  const buf = Buffer.from(await f.arrayBuffer());
  if (/\.xlsx$/i.test(name) && !(buf[0] === 0x50 && buf[1] === 0x4b)) return { error: "Файл не похож на настоящий .xlsx — пересохраните его в Excel" };
  try {
    const t = await parseTableFile(buf, name);
    if (t.length === 0) return { error: "В файле нет данных" };
    const truncated = t.length > MAX_ROWS;
    return { ok: true, table: t.slice(0, MAX_ROWS).map((r) => r.slice(0, 60)), fileName: name, truncated };
  } catch {
    return { error: "Не удалось прочитать файл. Сохраните его как .xlsx или .csv заново." };
  }
}

export type RecognizedDoc = {
  name: string;
  size: number;
  kind: DocKindKey;
  number: string;
  date: string;
  amount: string;
  textRead: boolean;
  notes: string[];
};

/** Пачка документов → для каждого файла тип, номер, дата, сумма (по имени и по тексту). Ничего не сохраняет. */
export async function recognizeDocuments(formData: FormData): Promise<{ error: string } | { ok: true; docs: RecognizedDoc[] }> {
  await requireRole(...ACCESS.purchases);
  const read = await readDocumentFiles(formData.getAll("files"));
  if ("error" in read) return { error: read.error };
  const docs: RecognizedDoc[] = [];
  for (const f of read.files) {
    const fromName = recognizeFromName(f.originalName);
    const ext = f.kind.ext;
    const text = await extractDocText(f.buf, ext);
    const textRead = text.trim().length > 0;
    const fromText = textRead ? recognizeFromText(text) : null;
    const notes: string[] = [];
    // PDF/DOCX: тип по тексту надёжнее имени; таблицы Excel — по имени («расчёт закупки…xlsx»)
    let kind: DocKindKey = (ext === "xlsx" ? (fromName.kind ?? fromText?.kind) : (fromText?.kind ?? fromName.kind)) ?? "OTHER";
    let amount = fromText?.amount ?? null;
    let amountNote = fromText?.amountNote ?? null;
    if (ext === "xlsx" && textRead) {
      // расчётный лист: сумма = Σ столбца «Себестоимость общая»
      const t = await parseTableFile(f.buf, f.originalName).catch(() => [] as string[][]);
      const det = detectColumns(t);
      if (det.mapping.fileTotal !== undefined && det.headerIdx >= 0) {
        const rows = applyMapping(t, det.headerIdx, det.mapping);
        const sum = rows.reduce((s, r) => s + (parseMoney(r.fileTotal) ?? Number(r.fileTotal) ?? 0), 0);
        if (sum > 0) {
          amount = Math.round(sum * 100) / 100;
          amountNote = "Σ «Себестоимость общая»";
          if (kind === "AUCTION_INVOICE" || kind === "OTHER") kind = "CALC_SHEET";
        }
      }
    }
    const number = fromText?.number ?? fromName.number ?? "";
    const date = fromText?.date ?? fromName.date ?? "";
    if (!textRead) notes.push(ext === "jpg" || ext === "png" ? "Это картинка: номер и сумму нужно ввести вручную" : "Текст файла не прочитан (скан или нестандартный PDF): проверьте тип, номер и сумму вручную");
    else {
      if (!number) notes.push("Номер документа не найден — введите вручную");
      if (AMOUNT_KINDS.includes(kind) && amount === null) notes.push("Сумма в тексте не найдена — введите вручную, если хотите сверить");
    }
    if (kind === "OTHER") notes.push("Тип не определён — выберите вручную");
    docs.push({
      name: f.originalName,
      size: f.buf.length,
      kind,
      number,
      date,
      amount: amount !== null ? String(amount).replace(".", ",") : "",
      textRead,
      notes: amountNote ? [`Сумма взята из строки ${amountNote}`, ...notes] : notes,
    });
  }
  return { ok: true, docs };
}

// ---------------------------------------------------------------- payload

const str = (v: unknown, max = 500) => (typeof v === "string" ? v.slice(0, max) : "");
const bool = (v: unknown) => v === true;

function coercePayload(raw: unknown): BatchPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const h = (r.header ?? {}) as Record<string, unknown>;
  const rows = Array.isArray(r.rows) ? r.rows.slice(0, MAX_ROWS) : [];
  const na = h.newAuction as Record<string, unknown> | null | undefined;
  const dec = (r.decisions ?? {}) as Record<string, unknown>;
  const cleanDec = (o: unknown, modes: string[]) => {
    const out: Record<string, never> = {};
    if (o && typeof o === "object") {
      for (const [k, v] of Object.entries(o as Record<string, unknown>).slice(0, 500)) {
        const d = v as { mode?: unknown; id?: unknown };
        if (typeof d?.mode === "string" && modes.includes(d.mode)) (out as Record<string, unknown>)[k.slice(0, 200)] = d.mode === "ref" ? { mode: "ref", id: str(d.id, 60) } : { mode: d.mode };
      }
    }
    return out;
  };
  const rowOf = (x: unknown, i: number): IntakeRow => {
    const o = (x ?? {}) as Record<string, unknown>;
    const g = (k: string) => str(o[k], 200);
    return {
      n: i + 1, lot: g("lot"), material: g("material"), color: g("color"), grade: g("grade"), qty: g("qty"), price: g("price"), vat: g("vat"),
      currency: g("currency"), invoice: g("invoice"), rate: g("rate"), fee: g("fee"), dressing: g("dressing"), transport: g("transport"),
      broker: g("broker"), transit: g("transit"), fileUnit: g("fileUnit"), fileTotal: g("fileTotal"),
      customs: g("customs"), packing: g("packing"),
    };
  };
  const docs: DocMeta[] = (Array.isArray(r.docs) ? r.docs : []).slice(0, 10).map((x, i) => {
    const o = (x ?? {}) as Record<string, unknown>;
    const kind = KIND_KEYS.includes(str(o.kind, 40)) ? (str(o.kind, 40) as DocKindKey) : "OTHER";
    return { idx: i, name: str(o.name, 200), kind, number: str(o.number, 60), date: str(o.date, 10), amount: str(o.amount, 40) };
  });
  const pct = (r.pct ?? {}) as Record<string, unknown>;
  return {
    key: str(r.key, 64).replace(/[^A-Za-z0-9-]/g, ""),
    header: {
      auctionId: str(h.auctionId, 60), newAuction: na ? { name: str(na.name, 120), date: str(na.date, 10), house: str(na.house, 80) } : null,
      supplierId: str(h.supplierId, 60), warehouseId: str(h.warehouseId, 60), orderDate: str(h.orderDate, 10), currency: str(h.currency, 3).toUpperCase(),
      exchangeRate: str(h.exchangeRate, 30), vatDefault: str(h.vatDefault, 10), invoiceNumber: str(h.invoiceNumber, 100), invoiceDate: /^\d{4}-\d{2}-\d{2}$/.test(str(h.invoiceDate, 10)) ? str(h.invoiceDate, 10) : "", receiveNow: bool(h.receiveNow),
      notes: str(h.notes, 1000), invoiceAmount: str(h.invoiceAmount, 40), serviceVat: str(h.serviceVat, 10),
    },
    rows: rows.map(rowOf),
    decisions: { fur: cleanDec(dec.fur, ["ref", "add"]), color: cleanDec(dec.color, ["ref", "add", "keep"]) },
    pct: { fee: bool(pct.fee), broker: bool(pct.broker) },
    expenses: Object.fromEntries(
      Object.entries((r.expenses ?? {}) as Record<string, unknown>).filter(([, v]) => typeof v === "string" && v.trim() !== "").slice(0, 12).map(([k, v]) => [k.slice(0, 20), str(v, 40)]),
    ),
    docs,
    ackMismatch: bool(r.ackMismatch),
  };
}

/** Проверка и итоги по текущему состоянию мастера (для шагов 3–4). Ничего не пишет. */
export async function previewBatch(payloadJson: string): Promise<{ error: string } | { ok: true; preview: BatchPreview }> {
  const session = await requireRole(...ACCESS.purchases);
  let payload: BatchPayload | null = null;
  try {
    payload = coercePayload(JSON.parse(payloadJson));
  } catch {
    payload = null;
  }
  if (!payload) return { error: "Не удалось разобрать данные мастера" };
  const orgId = session.user.organizationId;
  const [refs, debt, known] = await Promise.all([loadIntakeRefs(prisma, orgId), loadSupplierDebt(prisma, orgId), loadSupplierInvoices(prisma, orgId, payload.header.supplierId)]);
  const { preview } = planBatch(payload, refs, Number(debt.debt.toFixed(2)), known);
  return { ok: true, preview };
}

// ---------------------------------------------------------------- создание

/**
 * «Создать партию» из мастера: проверка прав и разбор данных, дальше всё делает ядро createBatchCore (одна транзакция,
 * защита от двойной отправки по ключу).
 */
export async function createBatch(formData: FormData): Promise<{ error: string } | BatchResult> {
  const session = await requireRole(...ACCESS.purchases);
  let payload: BatchPayload | null = null;
  try {
    payload = coercePayload(JSON.parse(String(formData.get("payload") ?? "")));
  } catch {
    payload = null;
  }
  if (!payload || payload.key.length < 8) return { error: "Не удалось разобрать данные мастера. Обновите страницу и повторите." };
  return createBatchCore(session, payload, { fileEntries: formData.getAll("files") });
}


export type { BatchResult, BatchPreview };
