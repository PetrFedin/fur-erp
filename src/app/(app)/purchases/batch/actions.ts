"use server";

import { revalidateAll } from "@/lib/revalidate-all";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { ACCESS, hasRole } from "@/lib/access";
import { nextDocumentNumber } from "@/lib/numbering";
import { receivePurchaseInTx, AlreadyReceivedError } from "@/lib/purchase-receive";
import { createAuctionTx } from "@/lib/auction-ref-core";
import { loadSupplierDebt } from "@/lib/supplier-debt";
import { removeStoredFiles } from "@/lib/fitting-files";
import { readDocumentFiles, writeDocumentFiles } from "@/lib/purchase-files";
import { extractDocText } from "@/lib/doc-content-text";
import { parseTableFile } from "@/lib/table-file";
import { purchaseRules } from "@/lib/doc-coverage";
import { PROPOSED_MARK, capitalizeColor, colorKey } from "@/lib/color-ref";
import { furKey } from "@/lib/fur-ref";
import { formatMoney } from "@/lib/utils";
import { loadIntakeRefs, loadSupplierInvoices, planBatch } from "@/lib/batch-intake-server";
import { getDefaultWarehouseId } from "@/lib/default-warehouse";
import { syncPurchaseInvoice } from "@/lib/invoice-sync";
import {
  AMOUNT_KINDS,
  DOC_KINDS,
  DOC_KIND_LABEL,
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

async function stockOf(db: Prisma.TransactionClient | typeof prisma, orgId: string, materialIds: string[]): Promise<Map<string, number>> {
  const g = await db.rawMaterialLot.groupBy({ by: ["rawMaterialId"], where: { organizationId: orgId, rawMaterialId: { in: materialIds } }, _sum: { quantityRemaining: true } });
  return new Map(g.map((x) => [x.rawMaterialId, Number(x._sum.quantityRemaining ?? 0)]));
}

const dateRu = (iso: string) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : "");

/**
 * «Создать партию»: аукцион (если новый) + новые материалы/цвета + закупки + позиции + приёмка на склад + документы + запись
 * в журнал — ОДНА транзакция (любая ошибка откатывает всё). Защита от двойной отправки: ключ `key` (advisory-lock + запись
 * в журнале). Расчёт стоимости лотов — receivePurchaseInTx (тот же код, что у кнопки «Принять на склад»).
 */
export async function createBatch(formData: FormData): Promise<{ error: string } | BatchResult> {
  const session = await requireRole(...ACCESS.purchases);
  const orgId = session.user.organizationId;
  const role = session.user.role;

  let payload: BatchPayload | null = null;
  try {
    payload = coercePayload(JSON.parse(String(formData.get("payload") ?? "")));
  } catch {
    payload = null;
  }
  if (!payload || payload.key.length < 8) return { error: "Не удалось разобрать данные мастера. Обновите страницу и повторите." };

  // повторная отправка того же ключа — не создаём второй раз
  const prior = await prisma.auditLog.findFirst({ where: { organizationId: orgId, model: "BatchIntake", recordId: payload.key } });
  if (prior) return duplicateResult(orgId, prior.changes);

  const [refs, debtBefore] = await Promise.all([loadIntakeRefs(prisma, orgId), loadSupplierDebt(prisma, orgId)]);
  const plan = planBatch(payload, refs, Number(debtBefore.debt.toFixed(2)));
  const { preview } = plan;
  if (preview.blocking.length > 0) return { error: `Партию создать нельзя: ${preview.blocking[0]}` };
  if (preview.mismatchDocs > 0 && !payload.ackMismatch) return { error: "Сумма документа расходится с суммой лотов — подтвердите на шаге 3, что создать партию всё равно нужно." };

  // права на справочники
  if (payload.header.newAuction && !hasRole(role, ACCESS.auctions)) return { error: "Создавать новые аукционы может владелец, администратор или закупщик — выберите аукцион из справочника." };
  if (preview.newMaterials.length > 0 && !hasRole(role, ACCESS.materials)) return { error: "Добавлять новые материалы в справочник может владелец, администратор, закупщик или технолог." };
  if (preview.newColors.length > 0 && !hasRole(role, ACCESS.colors)) return { error: "Добавлять новые цвета в справочник может владелец, администратор, закупщик или технолог." };
  const bad = await Promise.all([
    prisma.supplier.count({ where: { id: payload.header.supplierId, organizationId: orgId } }),
    getDefaultWarehouseId(orgId),
  ]);
  if (bad[0] !== 1) return { error: "Поставщик не найден" };
  if (!bad[1]) return { error: "Не удалось определить место прихода — обратитесь к администратору" };
  const warehouseId = bad[1];

  // файлы документов — на диск ДО транзакции (при ошибке удаляются)
  const fileEntries = formData.getAll("files");
  let stored: Awaited<ReturnType<typeof writeDocumentFiles>> = [];
  if (payload.docs.length > 0) {
    const read = await readDocumentFiles(fileEntries);
    if ("error" in read) return { error: read.error };
    if (read.files.length !== payload.docs.length) return { error: "Число файлов не совпадает с описанием документов — загрузите документы заново (шаг 3)." };
    stored = await writeDocumentFiles(orgId, `intake-${payload.key.slice(0, 24)}`, read.files);
  }

  const h = payload.header;
  const materialIdsKnown = [...new Set(plan.purchases.flatMap((p) => p.items.map((i) => i.materialId).filter((x): x is string => !!x)))];
  const stockBefore = await stockOf(prisma, orgId, materialIdsKnown);

  type Created = { id: string; number: string; invoice: string; lots: number; qty: number; inclVat: number };
  let outcome: { duplicate: Prisma.JsonValue } | { auctionId: string | null; auctionCreated: boolean; created: Created[]; matIds: Map<string, string>; newMat: string[]; newCol: string[]; docsAttached: number };
  try {
    outcome = await prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${"batch-intake:" + orgId + ":" + payload.key}))) t`;
        const dup = await tx.auditLog.findFirst({ where: { organizationId: orgId, model: "BatchIntake", recordId: payload.key } });
        if (dup) return { duplicate: dup.changes };

        // аукцион
        let auctionId = plan.existingAuctionId;
        let auctionCreated = false;
        if (h.newAuction) {
          const when = h.newAuction.date && !Number.isNaN(Date.parse(h.newAuction.date)) ? new Date(h.newAuction.date) : null;
          const ref = when ?? new Date(h.orderDate);
          const a = await createAuctionTx(tx, orgId, {
            name: plan.auctionName, house: h.newAuction.house || null, currency: plan.currency, auctionDate: when,
            year: ref.getUTCFullYear(), month: ref.getUTCMonth() + 1,
          });
          auctionId = a.id;
          auctionCreated = true;
        } else if (auctionId) {
          const ok = await tx.auction.count({ where: { id: auctionId, organizationId: orgId } });
          if (ok !== 1) throw new Error("Аукцион не найден — обновите страницу");
        }

        // новые материалы
        const matIds = new Map<string, string>();
        const existingMats = await tx.rawMaterial.findMany({ where: { organizationId: orgId }, select: { id: true, name: true } });
        const newMat: string[] = [];
        for (const name of preview.newMaterials) {
          const found = existingMats.find((m) => furKey(m.name) === furKey(name));
          if (found) matIds.set(furKey(name), found.id);
          else {
            const m = await tx.rawMaterial.create({ data: { organizationId: orgId, name, unit: "PIECE" } });
            matIds.set(furKey(name), m.id);
            newMat.push(name);
          }
        }
        // новые цвета (на подтверждение владельцем)
        const colIds = new Map<string, string>();
        const existingCols = await tx.colorRef.findMany({ where: { organizationId: orgId }, select: { id: true, name: true, aliases: true } });
        const newCol: string[] = [];
        for (const raw of preview.newColors) {
          const k = colorKey(capitalizeColor(raw));
          const found = existingCols.find((c) => colorKey(c.name) === k || c.aliases.some((a) => colorKey(a) === k));
          if (found) colIds.set(colorKey(raw), found.id);
          else {
            const c = await tx.colorRef.create({ data: { organizationId: orgId, name: capitalizeColor(raw), aliases: [], note: `${PROPOSED_MARK} (добавлен мастером «Новая партия»)` } });
            colIds.set(colorKey(raw), c.id);
            newCol.push(c.name);
          }
        }

        const created: Created[] = [];
        const ordered = [...plan.purchases].sort((a, b) => a.invoice.localeCompare(b.invoice, "ru", { numeric: true }));
        const upd = payload.docs.find((d) => d.kind === "UPD" && d.number.trim());
        for (const p of ordered) {
          const number = await nextDocumentNumber(tx, "purchase", orgId, "З");
          const transfer = ordered.length === 1 && upd ? `№ ${upd.number.trim()}${upd.date ? ` от ${dateRu(upd.date)} г.` : ""}` : null;
          const row = await tx.purchase.create({
            data: {
              organizationId: orgId, number, supplierId: h.supplierId, warehouseId, currency: plan.currency,
              exchangeRate: plan.currency === "RUB" ? 1 : plan.rate, auctionSession: plan.auctionName, auctionId,
              invoiceNumber: p.invoice || null, invoiceDate: h.invoiceDate ? new Date(h.invoiceDate) : null, transferDocument: transfer, orderDate: new Date(h.orderDate),
              notes: h.notes.trim() || null, createdById: session.user.id,
            },
          });
          const invoiceId = await syncPurchaseInvoice(tx, row.id);
          // Сумма счёта по документу (шаг 1) — только когда счёт один на всю партию.
          const invSum = Number(String(h.invoiceAmount ?? "").replace(/\s/g, "").replace(",", "."));
          if (invoiceId && ordered.length === 1 && Number.isFinite(invSum) && invSum > 0) await tx.invoice.update({ where: { id: invoiceId }, data: { amountInclVat: invSum } });
          await tx.purchaseItem.createMany({
            data: p.items.map((i) => ({
              purchaseId: row.id,
              rawMaterialId: (i.materialId ?? (i.newMaterial ? matIds.get(furKey(i.newMaterial)) : null))!,
              quantity: i.quantity,
              unitPrice: i.unitPrice,
              subtotal: new Prisma.Decimal(i.quantity).mul(i.unitPrice),
              vatRate: i.vatRate,
              lotNumber: i.lot,
              grade: i.grade,
              color: i.colorText,
              colorRefId: i.colorRefId ?? (i.newColor ? (colIds.get(colorKey(i.newColor)) ?? null) : null),
              ...(i.costPlan ? { costPlan: i.costPlan as Prisma.InputJsonValue } : {}),
            })),
          });
          if (h.receiveNow) await receivePurchaseInTx(tx, row.id, orgId);
          created.push({ id: row.id, number, invoice: p.invoice, lots: p.items.length, qty: p.totals.qty, inclVat: p.totals.inclVat });
        }

        // документы
        let docsAttached = 0;
        for (const d of payload.docs) {
          const s = stored[d.idx];
          if (!s) continue;
          const idxInvoice = d.number.trim();
          const target =
            created.length === 1
              ? created[0]
              : (d.kind === "AUCTION_INVOICE" || d.kind === "ADVANCE_INVOICE") && idxInvoice
                ? created.find((c) => c.invoice && c.invoice.trim().toLowerCase().replace(/\s+/g, "") === idxInvoice.toLowerCase().replace(/\s+/g, ""))
                : undefined;
          const label = DOC_KIND_LABEL[d.kind];
          await tx.purchaseDocument.create({
            data: {
              organizationId: orgId,
              purchaseId: target?.id ?? null,
              batch: target ? null : plan.auctionName,
              kind: d.kind,
              title: `${label}${idxInvoice ? ` № ${idxInvoice}` : ""}`.slice(0, 200),
              ...s,
            },
          });
          docsAttached++;
        }

        await tx.auditLog.create({
          data: {
            organizationId: orgId, actorId: session.user.id, actorName: session.user.name ?? null, actorRole: role, source: "ui",
            model: "BatchIntake", recordId: payload.key, action: "create",
            label: `Новая партия закупки: ${plan.auctionName}, закупок ${created.length}, лотов ${preview.totals.lots}`,
            changes: {
              auction: plan.auctionName, auctionCreated, receiving: h.receiveNow, purchases: created, lots: preview.totals.lots,
              qty: preview.totals.qty, inclVat: preview.totals.inclVat, docs: docsAttached, newMaterials: newMat, newColors: newCol,
              debtBefore: Number(debtBefore.debt.toFixed(2)),
              expenses: payload.expenses ?? {},
            } as unknown as Prisma.InputJsonValue,
          },
        });
        return { auctionId, auctionCreated, created, matIds, newMat, newCol, docsAttached };
      },
      { timeout: 120_000, maxWait: 15_000 },
    );
  } catch (e) {
    await removeStoredFiles(stored.map((s) => s.storagePath)).catch(() => {});
    if (e instanceof AlreadyReceivedError) return { error: "Закупка уже принята — повторите создание партии." };
    console.error("[createBatch]", e);
    const msg = e instanceof Error ? e.message : "";
    return { error: `Партия не создана, в базе ничего не изменилось. ${msg && !/Prisma|invocation|\n/.test(msg) ? msg : "Проверьте числа и повторите; если повторяется — сообщите администратору."}` };
  }

  if ("duplicate" in outcome) {
    await removeStoredFiles(stored.map((s) => s.storagePath)).catch(() => {});
    return duplicateResult(orgId, outcome.duplicate);
  }

  revalidateAll(orgId);

  // что пересчиталось
  const debtAfter = await loadSupplierDebt(prisma, orgId);
  const allMatIds = [...new Set([...materialIdsKnown, ...outcome.matIds.values()])];
  const stockAfter = await stockOf(prisma, orgId, allMatIds);
  const mats = await prisma.rawMaterial.findMany({ where: { id: { in: allMatIds } }, select: { id: true, name: true } });
  const stock = mats
    .map((m) => ({ material: m.name, before: stockBefore.get(m.id) ?? 0, after: stockAfter.get(m.id) ?? 0 }))
    .filter((s) => h.receiveNow || s.before !== s.after)
    .sort((a, b) => b.after - b.before - (a.after - a.before));
  const tasks = await buildTasks(orgId, outcome.created, payload, plan.auctionName, h.receiveNow, preview, Number(debtAfter.debt) - Number(debtBefore.debt));

  return {
    ok: true,
    duplicate: false,
    receiving: h.receiveNow,
    auction: { id: outcome.auctionId, name: plan.auctionName, created: outcome.auctionCreated },
    purchases: outcome.created,
    totals: preview.totals,
    debt: { before: Number(debtBefore.debt.toFixed(2)), after: Number(debtAfter.debt.toFixed(2)) },
    purchased: { before: Number(debtBefore.total.toFixed(2)), after: Number(debtAfter.total.toFixed(2)) },
    stock,
    docsAttached: outcome.docsAttached,
    createdMaterials: outcome.newMat,
    createdColors: outcome.newCol,
    tasks,
  };
}

async function buildTasks(
  orgId: string,
  created: { id: string; number: string }[],
  payload: BatchPayload,
  auctionName: string,
  received: boolean,
  preview: BatchPreview,
  debtGrowth: number,
): Promise<BatchResult["tasks"]> {
  const tasks: BatchResult["tasks"] = [];
  const kindsByPurchase = new Map<string, Set<string>>();
  const docs = await prisma.purchaseDocument.findMany({
    where: { organizationId: orgId, OR: [{ purchaseId: { in: created.map((c) => c.id) } }, { batch: auctionName }] },
    select: { purchaseId: true, batch: true, kind: true },
  });
  const batchKinds = new Set(docs.filter((d) => !d.purchaseId).map((d) => d.kind as string));
  for (const c of created) {
    const set = new Set<string>(batchKinds);
    for (const d of docs) if (d.purchaseId === c.id) set.add(d.kind);
    kindsByPurchase.set(c.id, set);
  }
  const need: [string, string, string[]][] = [
    ["AUCTION_INVOICE", "счёт аукциона", ["AUCTION_INVOICE", "ADVANCE_INVOICE"]],
    ["UPD", "УПД", ["UPD"]],
    ["CALC_SHEET", "расчётный лист", ["CALC_SHEET"]],
    ["SPECIFICATION", "спецификацию", ["SPECIFICATION"]],
  ];
  for (const c of created) {
    const rules = purchaseRules({ status: received ? "RECEIVED" : "DRAFT", realAuction: true, hasPayments: false });
    const have = kindsByPurchase.get(c.id)!;
    const missing = need.filter(([col, , accepts]) => (rules as Record<string, { need?: string }>)[col]?.need === "required" && !accepts.some((a) => have.has(a)));
    if (missing.length > 0) tasks.push({ kind: "doc", text: `Закупка ${c.number}: загрузить ${missing.map((m) => m[1]).join(", ")}`, href: `/purchases/${c.id}` });
  }
  if (preview.mismatchDocs > 0) tasks.push({ kind: "check", text: `Сверить сумму документов с лотами: расхождений — ${preview.mismatchDocs} (подтверждено вами при создании)`, href: `/purchases/${created[0].id}` });
  if (!received) tasks.push({ kind: "receive", text: "Принять закупки на склад, когда мех придёт (кнопка «Принять на склад» в карточке закупки)", href: `/purchases/${created[0].id}` });
  if (debtGrowth > 0.5) tasks.push({ kind: "pay", text: `Внести оплату поставщику: долг вырос на ${formatMoney(debtGrowth)}`, href: "/payments" });
  if (preview.newColors.length > 0) tasks.push({ kind: "check", text: `Подтвердить новые цвета в справочнике: ${preview.newColors.join(", ")}`, href: "/settings/colors" });
  if (payload.header.newAuction) tasks.push({ kind: "check", text: `Проверить новый аукцион «${auctionName}» в справочнике`, href: "/settings/auctions" });
  return tasks;
}

async function duplicateResult(orgId: string, changes: Prisma.JsonValue): Promise<{ error: string } | BatchResult> {
  const c = (changes ?? {}) as { auction?: string; purchases?: BatchResult["purchases"]; receiving?: boolean; lots?: number; qty?: number; inclVat?: number; debtBefore?: number };
  const debt = await loadSupplierDebt(prisma, orgId);
  const purchases = c.purchases ?? [];
  const totals = { lots: c.lots ?? 0, qty: c.qty ?? 0, inclVat: c.inclVat ?? 0, exclVat: 0, avgInclPerUnit: c.qty ? (c.inclVat ?? 0) / c.qty : 0, avgExclPerUnit: 0, avgForeign: null, foreignExcl: 0 };
  return {
    ok: true,
    duplicate: true,
    receiving: !!c.receiving,
    auction: { id: null, name: c.auction ?? "", created: false },
    purchases,
    totals,
    debt: { before: c.debtBefore ?? null, after: Number(debt.debt.toFixed(2)) },
    purchased: { before: null, after: Number(debt.total.toFixed(2)) },
    stock: [],
    docsAttached: 0,
    createdMaterials: [],
    createdColors: [],
    tasks: purchases.length ? [{ kind: "check", text: "Эта партия уже была создана (повторное нажатие не создало дубль)", href: `/purchases/${purchases[0].id}` }] : [],
  };
}

export type { BatchResult, BatchPreview };
