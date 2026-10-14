import "server-only";
import { revalidateAll } from "@/lib/revalidate-all";
import { Prisma, type UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ACCESS, hasRole } from "@/lib/access";
import { nextDocumentNumber } from "@/lib/numbering";
import { receivePurchaseInTx, AlreadyReceivedError } from "@/lib/purchase-receive";
import { createAuctionTx } from "@/lib/auction-ref-core";
import { loadSupplierDebt } from "@/lib/supplier-debt";
import { removeStoredFiles } from "@/lib/fitting-files";
import { readDocumentFiles, writeDocumentFiles } from "@/lib/purchase-files";
import { purchaseRules } from "@/lib/doc-coverage";
import { PROPOSED_MARK, capitalizeColor, colorKey } from "@/lib/color-ref";
import { furKey } from "@/lib/fur-ref";
import { formatMoney } from "@/lib/utils";
import { loadIntakeRefs, planBatch } from "@/lib/batch-intake-server";
import { getDefaultWarehouseId } from "@/lib/default-warehouse";
import { syncPurchaseInvoice } from "@/lib/invoice-sync";
import { DOC_KIND_LABEL, type BatchPayload, type BatchPreview, type BatchResult } from "@/lib/batch-intake";

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
export class HookAbort extends Error {}
export type StoredDocs = Awaited<ReturnType<typeof writeDocumentFiles>>;
export type BatchSession = { user: { id: string; name?: string | null; role: string; organizationId: string } };
export type BatchCoreOpts = {
  /** Файлы документов из формы мастера (по одному на описание в payload.docs). */
  fileEntries?: FormDataEntryValue[];
  /** Либо свой способ получить уже записанные на диск файлы (приём из «Входящих»). Вызывается после проверок, до транзакции. */
  loadStored?: () => Promise<{ error: string } | StoredDocs>;
  /** В той же транзакции: до создания закупок (бросить HookAbort, чтобы остановить без записи) и после создания. */
  before?: (tx: Prisma.TransactionClient) => Promise<void>;
  after?: (tx: Prisma.TransactionClient, created: { id: string; number: string; invoice: string }[]) => Promise<void>;
  /** Что дописать в запись журнала. */
  auditExtra?: Record<string, unknown>;
};

/**
 * Ядро «Создать партию»: аукцион (если новый) + новые материалы/цвета + закупки + позиции (+ приёмка на склад, если receiveNow) + документы +
 * запись в журнал — ОДНА транзакция. Его вызывают мастер «Новая партия» (createBatch) и приём черновика от поставщика («Входящие»).
 * Права на справочники проверяются по роли `session`.
 */
export async function createBatchCore(session: BatchSession, payload: BatchPayload, opts: BatchCoreOpts = {}): Promise<{ error: string } | BatchResult> {
  const orgId = session.user.organizationId;
  const role = session.user.role as UserRole;

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
  let stored: StoredDocs = [];
  if (opts.loadStored) {
    const got = await opts.loadStored();
    if ("error" in got) return { error: got.error };
    stored = got;
  } else if (payload.docs.length > 0) {
    const read = await readDocumentFiles(opts.fileEntries ?? []);
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
        await opts.before?.(tx);

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

        await opts.after?.(tx, created);
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
              ...(opts.auditExtra ?? {}),
            } as unknown as Prisma.InputJsonValue,
          },
        });
        return { auctionId, auctionCreated, created, matIds, newMat, newCol, docsAttached };
      },
      { timeout: 120_000, maxWait: 15_000 },
    );
  } catch (e) {
    await removeStoredFiles(stored.map((s) => s.storagePath)).catch(() => {});
    if (e instanceof HookAbort) return { error: e.message };
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

