"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { Decimal } from "@prisma/client/runtime/library";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { PRODUCTION_EDIT_ROLES } from "@/lib/production-access";
import { nextDocumentNumber } from "@/lib/numbering";
import { consumeFromLot } from "@/lib/stock";
import { capitalizeColor, PROPOSED_MARK } from "@/lib/color-ref";
import { formatOrderColors } from "@/lib/order-colors";
import { invalidateFilterOptions } from "@/lib/filter-options";
import { resetVerification } from "@/lib/verification";
import { isPickedFile, readDocumentFiles } from "@/lib/purchase-files";
import { writeDriveFile } from "@/lib/drive-files";
import { removeStoredFiles } from "@/lib/fitting-files";
import { batchOrderInclude, batchTotals, orderStat } from "@/lib/batch-stats";
import { loadOrderPanel } from "@/lib/production-doc-checklist";
import { lockAuction } from "@/lib/auction-payments";
import { draftsFromText, parseColors, type TzDraft } from "@/lib/tz-import-core";
import { draftsFromFile } from "@/lib/tz-import-files";
import { analyzeDrafts, type TzAnalysis, type TzOptions } from "@/lib/tz-import-server";

/**
 * Мастер «Загрузить ТЗ» (кнопка на /production): файлы (xlsx/csv/docx/pdf с текстом), вставка таблицы или текста, ручной ввод ->
 * черновики -> проверка -> создание ТЗ со списаниями одной транзакцией. Формулы не дублируются: списание — consumeFromLot,
 * себестоимость/работа/партия — orderStat и batchTotals, 4% — defaultCommission4/lineCostWith4. Журнал изменений пишет расширение prisma.
 */

export type ParseState = { error?: string; drafts?: TzDraft[]; notes?: string[] };

/** Шаг 1: файлы и/или вставленный текст -> черновики (ничего не пишет). */
export async function parseTzInput(formData: FormData): Promise<ParseState> {
  await requireRole(...PRODUCTION_EDIT_ROLES);
  const files = formData.getAll("files").filter(isPickedFile);
  const pasted = String(formData.get("text") ?? "");
  if (files.length === 0 && !pasted.trim()) return { error: "Загрузите файл, вставьте таблицу или добавьте ТЗ вручную" };
  if (files.length > 20) return { error: "Не больше 20 файлов за раз" };
  const drafts: TzDraft[] = [];
  const notes: string[] = [];
  for (const f of files) {
    if (f.size === 0) {
      notes.push(`«${f.name}»: файл пустой`);
      continue;
    }
    if (f.size > 25 * 1024 * 1024) {
      notes.push(`«${f.name}»: больше 25 МБ`);
      continue;
    }
    const r = await draftsFromFile(f.name, Buffer.from(await f.arrayBuffer()));
    if (r.error) notes.push(`«${f.name}»: ${r.error}`);
    else notes.push(`«${f.name}»: найдено ТЗ — ${r.drafts.length}`);
    drafts.push(...r.drafts);
  }
  if (pasted.trim()) {
    const d = draftsFromText(pasted, "вставка");
    notes.push(`вставка: найдено ТЗ — ${d.length}`);
    drafts.push(...d);
  }
  if (drafts.length === 0) return { error: notes.join("; ") || "ТЗ не найдены", notes };
  if (drafts.length > 200) return { error: "В одной загрузке не больше 200 ТЗ", notes };
  return { drafts, notes };
}

export type CheckState = { error?: string; analysis?: TzAnalysis[] };

/** Шаг 2: проверка (подсветка проблем). Только чтение. */
export async function checkTzDrafts(drafts: TzDraft[], options: TzOptions): Promise<CheckState> {
  const session = await requireRole(...PRODUCTION_EDIT_ROLES);
  if (!Array.isArray(drafts) || drafts.length === 0) return { error: "Нет ТЗ для проверки" };
  if (drafts.length > 200) return { error: "В одной загрузке не больше 200 ТЗ" };
  return { analysis: await analyzeDrafts(prisma, session.user.organizationId, sanitize(drafts), { createRefs: !!options?.createRefs }) };
}

const S = (v: unknown, n = 2000) => String(v ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ").slice(0, n);
function sanitize(drafts: TzDraft[]): TzDraft[] {
  return drafts.map((d, i) => ({
    key: S(d.key, 40) || `k${i}`,
    source: S(d.source, 200),
    number: S(d.number, 100).trim(),
    article: S(d.article, 200).trim(),
    colors: S(d.colors, 500),
    sizes: S(d.sizes, 200),
    qty: S(d.qty, 20),
    batch: S(d.batch, 20),
    client: S(d.client, 200),
    price: S(d.price, 30),
    calcTotal: S(d.calcTotal, 30),
    materials: S(d.materials, 5000),
  }));
}

export type LotChange = { lotNumber: string; material: string; before: number; after: number };
export type OrderResult = { id: string; number: string; workOrderNumber: string; qty: number; cost: number; costWith4: number; work: number; usages: number; missingDocs: string[] };
export type BatchChange = { number: number; ordersBefore: number; ordersAfter: number; costBefore: number; costAfter: number; workBefore: number; workAfter: number; remainingAfter: number };
export type ImportResult = {
  error?: string;
  /** Ошибки проверки: ничего не создано. */
  analysis?: TzAnalysis[];
  ok?: boolean;
  orders?: OrderResult[];
  lots?: LotChange[];
  batches?: BatchChange[];
  totals?: { ordersBefore: number; ordersAfter: number; rawSpent: number; created: { articles: number; colors: number; clients: number } };
};

const num = (d: Decimal) => Number(d.toFixed(2));

/** Шаг 3: создать ТЗ + списания в одной транзакции (всё или ничего) и вернуть «что пересчиталось». */
export async function createTzBatch(formData: FormData): Promise<ImportResult> {
  const session = await requireRole(...PRODUCTION_EDIT_ROLES);
  const orgId = session.user.organizationId;
  let drafts: TzDraft[];
  try {
    drafts = sanitize(JSON.parse(String(formData.get("drafts") ?? "[]")));
  } catch {
    return { error: "Не удалось прочитать список ТЗ" };
  }
  if (drafts.length === 0) return { error: "Нет ТЗ для создания" };
  if (drafts.length > 200) return { error: "В одной загрузке не больше 200 ТЗ" };
  const createRefs = formData.get("createRefs") === "1";

  // исходные файлы (тот же набор, что был загружен) -> прикрепим к ТЗ как «Приложение к ТЗ»
  const readFiles = new Map<string, Awaited<ReturnType<typeof readDocumentFiles>>>();
  for (const f of formData.getAll("files").filter(isPickedFile)) {
    if (f.size > 0 && drafts.some((d) => d.source === f.name)) readFiles.set(f.name, await readDocumentFiles([f]));
  }
  const stored = new Map<string, Awaited<ReturnType<typeof writeDriveFile>>>();

  let result: ImportResult;
  try {
    result = await prisma.$transaction(
      async (tx): Promise<ImportResult> => {
        await lockAuction(tx, orgId, "tz-import");
        const analysis = await analyzeDrafts(tx, orgId, drafts, { createRefs });
        if (analysis.some((a) => a.blocking)) return { error: "В ТЗ есть ошибки — ничего не создано. Исправьте подсвеченное и повторите.", analysis };

        const ws = await tx.warehouse.findMany({ where: { organizationId: orgId }, orderBy: { name: "asc" } });
        const wid = ws.find((w) => w.isDefault)?.id ?? ws[0]?.id;
        if (!wid) return { error: "Нет склада — создайте склад в справочниках" };

        const beforeOrders = await tx.productionOrder.count({ where: { organizationId: orgId } });
        const lotIds = [...new Set(analysis.flatMap((a) => a.lots.map((l) => l.lotId)))];
        const lotsBefore = await tx.rawMaterialLot.findMany({ where: { id: { in: lotIds } }, select: { id: true, lotNumber: true, quantityRemaining: true, rawMaterial: { select: { name: true } } } });
        const batchIds = [...new Set(analysis.map((a) => a.batchId).filter((x): x is string => !!x))];
        const loadBatch = async (id: string) => {
          const b = await tx.productionBatch.findFirstOrThrow({ where: { id }, select: { number: true } });
          const os = await tx.productionOrder.findMany({ where: { batchId: id, organizationId: orgId }, include: batchOrderInclude });
          return { number: b.number, t: batchTotals(os) };
        };
        const batchBefore = new Map<string, Awaited<ReturnType<typeof loadBatch>>>();
        for (const id of batchIds) batchBefore.set(id, await loadBatch(id));

        const created = { articles: 0, colors: 0, clients: 0 };
        const articleCache = new Map<string, string>();
        const colorCache = new Map<string, string>();
        const clientCache = new Map<string, string>();
        const orderIds: string[] = [];
        const touchedLots: string[] = [];

        for (let i = 0; i < drafts.length; i++) {
          const d = drafts[i];
          const a = analysis[i];
          let articleId = a.articleId;
          if (!articleId) {
            const k = d.article.toLowerCase();
            if (!articleCache.has(k)) {
              const m = await tx.productModel.create({ data: { organizationId: orgId, name: d.article.trim() }, select: { id: true } });
              articleCache.set(k, m.id);
              created.articles++;
            }
            articleId = articleCache.get(k)!;
          }
          const cols = parseColors(d.colors);
          const colorIds: string[] = [];
          for (let c = 0; c < cols.length; c++) {
            let id = a.colorRefIds[c];
            if (!id) {
              const k = cols[c].name.toLowerCase();
              if (!colorCache.has(k)) {
                const ex = await tx.colorRef.findFirst({ where: { organizationId: orgId, name: capitalizeColor(cols[c].name) } });
                if (ex) colorCache.set(k, ex.id);
                else {
                  const n = await tx.colorRef.create({ data: { organizationId: orgId, name: capitalizeColor(cols[c].name), aliases: [], note: PROPOSED_MARK } });
                  colorCache.set(k, n.id);
                  created.colors++;
                }
              }
              id = colorCache.get(k)!;
            }
            colorIds.push(id);
          }
          let clientId = a.clientId;
          if (!clientId && d.client.trim()) {
            const k = d.client.trim().toLowerCase();
            if (!clientCache.has(k)) {
              const c = await tx.client.create({ data: { organizationId: orgId, name: d.client.trim() }, select: { id: true } });
              clientCache.set(k, c.id);
              created.clients++;
            }
            clientId = clientCache.get(k)!;
          }
          const model = await tx.productModel.findFirstOrThrow({ where: { id: articleId, organizationId: orgId }, select: { sellingPrice: true } });
          const compound = cols.length > 1 || cols.some((c) => c.qty != null || c.sizes);
          const number = await nextDocumentNumber(tx, "productionOrder", orgId, "П");
          const price = d.price.trim() ? new Decimal(d.price.replace(/[\s ]/g, "").replace(",", ".")) : undefined;
          const order = await tx.productionOrder.create({
            data: {
              organizationId: orgId,
              number,
              productModelId: articleId,
              rawWarehouseId: wid,
              finishedWarehouseId: wid,
              plannedQuantity: a.qty ?? 0,
              color: cols.length ? (compound ? formatOrderColors(cols.map((c) => ({ color: null, name: c.name, ...(c.qty != null ? { quantity: c.qty } : {}), ...(c.sizes ? { sizes: c.sizes } : {}) }))) : cols[0].name) : undefined,
              colorRefId: cols.length === 1 ? colorIds[0] : undefined,
              size: d.sizes.trim() || undefined,
              startDate: new Date(),
              notes: `Загружено мастером «Загрузить ТЗ»${d.source ? ` из «${d.source}»` : ""}`,
              clientId: clientId ?? undefined,
              workOrderNumber: d.number.trim(),
              clientWorkPricePerUnit: price,
              retailPrice: model.sellingPrice ?? undefined,
              batchId: a.batchId ?? undefined,
              createdById: session.user.id,
            },
          });
          if (compound) {
            await tx.productionOrderColor.createMany({ data: cols.map((c, n) => ({ orderId: order.id, colorRefId: colorIds[n], quantity: c.qty, sizes: c.sizes })) });
          }
          for (const u of a.lots) {
            const r = await consumeFromLot(tx, { organizationId: orgId, lotId: u.lotId, quantity: u.qty, productionOrderId: order.id });
            await tx.productionMaterialUsage.create({
              data: { productionOrderId: order.id, rawMaterialId: r.rawMaterialId, lotId: u.lotId, quantity: u.qty, unitCost: r.unitCost, totalCost: r.totalCost, commission4: u.c4 },
            });
            touchedLots.push(u.lotId);
          }
          if (a.lots.length) await tx.productionOrder.update({ where: { id: order.id }, data: { status: "IN_PROGRESS" } });

          // исходный файл — «Приложение к ТЗ» (один файл на диске, по строке на каждое ТЗ)
          const rf = readFiles.get(d.source);
          if (rf && "files" in rf) {
            let sf = stored.get(d.source);
            if (!sf) {
              sf = await writeDriveFile(orgId, rf.files[0]);
              stored.set(d.source, sf);
            }
            await tx.driveDocument.create({
              data: { organizationId: orgId, driveFileId: `local-${randomUUID()}`, title: `ТЗ ${d.number}: ${d.source}`.slice(0, 200), docType: "TZ_APPENDIX", mimeType: sf.storedMime, sizeBytes: sf.storedSize, ...sf, storedAt: new Date(), productionOrderId: order.id },
            });
          }
          orderIds.push(order.id);
        }

        // ----- «что пересчиталось» -----
        const orders: OrderResult[] = [];
        let rawSpent = 0;
        for (let i = 0; i < orderIds.length; i++) {
          const o = await tx.productionOrder.findFirstOrThrow({ where: { id: orderIds[i] }, include: batchOrderInclude });
          const base = orderStat(o, "off");
          const with4 = orderStat(o, "on");
          rawSpent += num(base.cost);
          let missing: string[] = [];
          try {
            const p = await loadOrderPanel(tx as never, orgId, o.id, { c4Mode: "on", canUpload: true, canMark: true });
            missing = (p?.panel.items ?? []).filter((x) => x.need === "required" && !x.ok).map((x) => x.label);
          } catch {
            missing = [];
          }
          orders.push({ id: o.id, number: o.number, workOrderNumber: o.workOrderNumber ?? "", qty: Number(base.qty), cost: num(base.cost), costWith4: num(with4.cost), work: num(base.work), usages: o.materialUsages.length, missingDocs: missing });
        }
        const lotsAfter = await tx.rawMaterialLot.findMany({ where: { id: { in: lotIds } }, select: { id: true, quantityRemaining: true } });
        const lots: LotChange[] = lotsBefore.map((l) => ({ lotNumber: l.lotNumber ?? l.id, material: l.rawMaterial.name, before: Number(l.quantityRemaining), after: Number(lotsAfter.find((x) => x.id === l.id)?.quantityRemaining ?? 0) }));
        const batches: BatchChange[] = [];
        for (const id of batchIds) {
          const b = batchBefore.get(id)!;
          const af = await loadBatch(id);
          batches.push({ number: b.number, ordersBefore: b.t.orders, ordersAfter: af.t.orders, costBefore: num(b.t.cost), costAfter: num(af.t.cost), workBefore: num(b.t.work), workAfter: num(af.t.work), remainingAfter: num(af.t.remaining) });
        }
        const afterOrders = await tx.productionOrder.count({ where: { organizationId: orgId } });
        await resetVerification(tx, orgId, { orderIds, batchIds });
        return { ok: true, orders, lots, batches, totals: { ordersBefore: beforeOrders, ordersAfter: afterOrders, rawSpent: Math.round(rawSpent * 100) / 100, created } };
      },
      { timeout: 60000, maxWait: 15000 },
    );
  } catch (e) {
    await removeStoredFiles([...stored.values()].map((s) => s.storagePath));
    return { error: e instanceof Error ? e.message : "Не удалось создать ТЗ" };
  }
  if (!result.ok) {
    await removeStoredFiles([...stored.values()].map((s) => s.storagePath));
    return result;
  }
  invalidateFilterOptions(orgId);
  for (const p of ["/production", "/production/batches", "/lots", "/dashboard", "/verify", "/documents", "/attention", "/analytics/products"]) revalidatePath(p);
  return result;
}
