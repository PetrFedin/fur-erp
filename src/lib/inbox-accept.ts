import "server-only";
import { randomUUID } from "node:crypto";
import type { Prisma, SupplierInbox, SupplierInboxFile } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { revalidateAll } from "@/lib/revalidate-all";
import { invalidateControlCounts } from "@/lib/control-counts";
import { ACCESS, hasRole } from "@/lib/access";
import { removeStoredFiles, readStoredFile } from "@/lib/fitting-files";
import { readDocumentFiles, type ReadDoc } from "@/lib/purchase-files";
import { writeDriveFile, type StoredDriveFile } from "@/lib/drive-files";
import { resolveAuctionIn } from "@/lib/auction-ref-core";
import { createBatchCore, HookAbort, type BatchSession, type StoredDocs } from "@/lib/batch-create";
import type { DocKindKey, DocMeta } from "@/lib/batch-intake";
import { calcToBatchPayload } from "@/lib/inbox-calc";
import { compareCalcs } from "@/lib/calc-compare";
import type { CalcPayload } from "@/lib/supplier-calc";
import { loadArticleList } from "@/lib/article-ref";
import { resolveFromList } from "@/lib/article-key";
import { resolveColorInput } from "@/lib/colors";
import { nextDocumentNumber } from "@/lib/numbering";
import { getDefaultWarehouseId } from "@/lib/default-warehouse";
import { buildTzDocx } from "@/lib/tz-docx-vendor";
import { evalNum } from "@/lib/supplier-calc";
import { plainNum, ruDate, tzTotals, type TzPayload } from "@/lib/tz-vendor";
import { writeDocumentFiles } from "@/lib/purchase-files";
import { loadIntakeRefs, loadSupplierInvoices, planBatch } from "@/lib/batch-intake-server";
import { loadSupplierDebt } from "@/lib/supplier-debt";

export type AcceptResult =
  | { ok: true; already?: boolean; type: "Purchase" | "ProductionOrder"; ids: string[]; message: string }
  | { ok?: false; error: string };

type Row = SupplierInbox & { files: SupplierInboxFile[] };
type Sess = BatchSession & { user: { name?: string | null } };

const ALREADY = "Это входящее уже обработано (принято или отклонено) — обновите страницу.";

/** Файл из входящих → проверенный файл (тип по сигнатуре, не по имени). */
async function readInboxFile(f: SupplierInboxFile): Promise<{ error: string } | { doc: ReadDoc }> {
  const buf = await readStoredFile(f.storagePath);
  if (!buf || buf.length === 0) return { error: `Файл «${f.originalName}» не найден на диске — попросите поставщика загрузить его заново.` };
  const r = await readDocumentFiles([new File([new Uint8Array(buf)], f.originalName, { type: f.mimeType })]);
  if ("error" in r) return { error: r.error };
  return { doc: r.files[0] };
}

const PURCHASE_DOC_KIND: Record<string, DocKindKey> = {
  AUCTION_INVOICE: "AUCTION_INVOICE", PAYMENT_INVOICE: "ADVANCE_INVOICE", SPECIFICATION: "SPECIFICATION", UPD: "UPD", OTHER: "OTHER",
};
const DRIVE_DOC_KIND: Record<string, "AUCTION_INVOICE" | "PAYMENT_INVOICE" | "SPECIFICATION" | "UPD" | "OTHER"> = {
  AUCTION_INVOICE: "AUCTION_INVOICE", PAYMENT_INVOICE: "PAYMENT_INVOICE", SPECIFICATION: "SPECIFICATION", UPD: "UPD", OTHER: "OTHER",
};

/** Забрать входящее себе: SENT → ACCEPTED (внутри транзакции приёма; блокирует вторую параллельную попытку). */
async function claim(tx: Prisma.TransactionClient, row: Row, userId: string) {
  const c = await tx.supplierInbox.updateMany({
    where: { id: row.id, organizationId: row.organizationId, status: "SENT" },
    data: { status: "ACCEPTED", decidedAt: new Date(), decidedById: userId },
  });
  if (c.count !== 1) throw new HookAbort(ALREADY);
}

function finish(orgId: string) {
  revalidateAll(orgId);
  invalidateControlCounts(orgId);
}

// ============================================================================================ расчёт аукциона

const money2 = (n: number) => n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Окончательный расчёт при уже принятом предварительном: вторую закупку не создаём. Обновление принятой закупки по окончательному
 * расчёту автоматически не делается (цены лотов правятся в окне «Цена лота»), поэтому приём блокируется с понятным текстом и разницей в числах.
 * Обратный случай: предварительный нельзя принять, если уже принят окончательный (иначе закупка задвоится).
 */
async function stageConflict(orgId: string, row: Row, p: CalcPayload): Promise<{ text: string; link?: { href: string; label: string } } | null> {
  if (p.stage === "FINAL" && p.basedOnId) {
    const base = await prisma.supplierInbox.findFirst({ where: { id: p.basedOnId, organizationId: orgId, supplierId: row.supplierId, kind: "AUCTION_CALC" } });
    if (base && base.status === "ACCEPTED" && base.createdEntityType === "Purchase" && base.createdEntityId) {
      const pu = await prisma.purchase.findFirst({ where: { id: base.createdEntityId.split(",")[0], organizationId: orgId }, select: { id: true, number: true } });
      const c = compareCalcs(base.payload as unknown as CalcPayload, p);
      return {
        text: `Предварительный расчёт уже принят${pu ? ` в закупку ${pu.number}` : ""} — вторую закупку по окончательному расчёту не создаём. Окончательный расчёт отличается: итого ${money2(c.totalBefore)} → ${money2(c.totalAfter)} ₽ (разница ${c.diff > 0 ? "+" : ""}${money2(c.diff)} ₽). Автоматического обновления закупки пока нет: поправьте цены лотов в закупке (окно «Цена лота») по таблице сравнения ниже, а этот расчёт отклоните с комментарием «учтено вручную».`,
        link: pu ? { href: `/purchases/${pu.id}`, label: `Открыть закупку ${pu.number}` } : undefined,
      };
    }
  }
  if (p.stage !== "FINAL") {
    const all = await prisma.supplierInbox.findMany({ where: { organizationId: orgId, supplierId: row.supplierId, kind: "AUCTION_CALC", status: "ACCEPTED" }, select: { id: true, title: true, payload: true } });
    const fin = all.find((x) => (x.payload as { basedOnId?: string; stage?: string })?.basedOnId === row.id && (x.payload as { stage?: string }).stage === "FINAL");
    if (fin) return { text: `По этому предварительному расчёту уже принят окончательный («${fin.title}») — принимать предварительный не нужно, закупка бы задвоилась. Отклоните его.` };
  }
  return null;
}

async function acceptCalc(s: Sess, row: Row, orderDate?: string): Promise<AcceptResult> {
  const orgId = s.user.organizationId;
  const p = row.payload as unknown as CalcPayload;
  if (!p || p.v !== 1 || !Array.isArray(p.rows) || !p.header) return { error: "Не удалось прочитать данные расчёта" };
  const conflict = await stageConflict(orgId, row, p);
  if (conflict) return { error: conflict.text };
  const auction = await resolveAuctionIn(prisma, p.header.auction, orgId);
  const mapped = calcToBatchPayload(p, { inboxId: row.id, supplierId: row.supplierId, auctionId: auction && !auction.isService ? auction.id : null, title: row.title, today: new Date().toISOString().slice(0, 10) });
  if (!mapped.payload) return { error: `Расчёт принять нельзя: ${mapped.errors[0]}` };
  const payload = mapped.payload;
  if (orderDate) payload.header.orderDate = orderDate; // дата закупки, поправленная при приёме

  // вложения: как документы закупки (PurchaseDocument), копией в хранилище закупок
  // счета в расчёте с несколькими аукционными счетами: номер документа берём из имени файла («3017 ООО ВеллМех.pdf»), если он среди счетов расчёта
  const rowInvoices = [...new Set(payload.rows.map((x) => x.invoice).filter(Boolean))];
  const payNo = (name: string) => /№\s*(\d+)/.exec(name)?.[1] ?? "";
  const numberFor = (name: string, kind?: string) => (kind === "PAYMENT_INVOICE" ? payNo(name) : rowInvoices.length > 1 ? rowInvoices.find((n) => new RegExp(`(^|[^\\d])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\d]|$)`).test(name)) ?? "" : p.header.invoice.trim());
  const docs: DocMeta[] = row.files.map((f, idx) => ({
    idx, name: f.originalName, kind: PURCHASE_DOC_KIND[f.kind] ?? "OTHER",
    number: f.kind === "AUCTION_INVOICE" || f.kind === "PAYMENT_INVOICE" ? numberFor(f.originalName, f.kind) : "", date: "", amount: "",
  }));
  payload.docs = docs;
  // защита от дублей: закупка с этим номером счёта у поставщика уже есть (заведена вручную или раньше) — вторую не создаём
  const known = await loadSupplierInvoices(prisma, orgId, row.supplierId);
  const dups = planBatch(payload, await loadIntakeRefs(prisma, orgId), 0, known).preview.dupInvoices;
  if (dups.length) return { error: `Принять нельзя: закупки по этим счетам уже есть — ${dups.map((d) => `счёт ${d.invoice} → ${d.purchaseNumber}`).join("; ")}. Повторное принятие создало бы дубли. Отклоните расчёт с пометкой «уже заведено» или попросите Веллмеха исправить номер счёта.` };
  const loadStored = async (): Promise<{ error: string } | StoredDocs> => {
    const reads: ReadDoc[] = [];
    for (const f of row.files) {
      const r = await readInboxFile(f);
      if ("error" in r) return r;
      reads.push(r.doc);
    }
    return reads.length ? writeDocumentFiles(orgId, `inbox-${row.id}`, reads) : [];
  };

  const res = await createBatchCore(s, payload, {
    loadStored,
    before: (tx) => claim(tx, row, s.user.id),
    after: async (tx, created) => {
      await tx.supplierInbox.update({ where: { id: row.id }, data: { createdEntityType: "Purchase", createdEntityId: created.map((c) => c.id).join(",") } });
    },
    auditExtra: { inboxId: row.id, inboxTitle: row.title },
  });
  if ("error" in res) return res;
  finish(orgId);
  const pu = res.purchases[0];
  if (res.duplicate) return { ok: true, already: true, type: "Purchase", ids: pu ? [pu.id] : [], message: "Эта закупка уже была создана из этого расчёта — повторное нажатие дубль не создало." };
  return {
    ok: true, type: "Purchase", ids: res.purchases.map((x) => x.id),
    message: `Создана закупка ${pu.number} (черновик): лотов ${pu.lots}, шкур ${pu.qty}, ${pu.inclVat.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽ с НДС. На склад не принято.`,
  };
}

// ============================================================================================ ТЗ

const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/ооо|оао|зао|ао|ип|[«»"'\s.,-]/g, "");
const num = (s: string) => { const v = evalNum(s); return Number.isFinite(v) ? v : 0; };
const uniq = (a: string[]) => [...new Set(a.map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean))];
const isoDate = (s: string) => (/^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) ? new Date(s) : undefined);

type TzGroup = { modelId: string; color: string; rows: { it: TzPayload["items"][number]; i: number }[] };
type TzPlan = { items: { it: TzPayload["items"][number]; i: number }[]; client: { id: string; name: string }; groups: TzGroup[] };

/** Проверка ТЗ перед приёмом (ничего не пишет): артикулы по справочнику, заказчик, группы (артикул, цвет). */
async function planTz(orgId: string, p: TzPayload): Promise<{ error: string } | TzPlan> {
  if (!p || p.v !== 1 || !Array.isArray(p.items) || !Array.isArray(p.materials)) return { error: "Не удалось прочитать данные ТЗ" };
  const items = p.items.map((it, i) => ({ it, i })).filter(({ it }) => Object.values(it).some((v) => v.trim() !== "" && v !== "1"));
  if (items.length === 0) return { error: "В ТЗ нет ни одного изделия" };
  if (!p.number.trim()) return { error: "В ТЗ не указан номер" };

  // защита от дублей: ТЗ с таким номером у нас уже есть (заведено вручную или раньше принято)
  const have = await prisma.productionOrder.findMany({ where: { organizationId: orgId, workOrderNumber: p.number.trim() }, select: { number: true }, take: 6 });
  if (have.length) return { error: `ТЗ № ${p.number.trim()} уже есть у нас (${have.map((x) => x.number).join(", ")}). Принять нельзя — создались бы дубли. Отклоните входящее с пометкой «уже заведено» или попросите Веллмеха поменять номер.` };

  // артикулы из справочника — ничего не создаём сами
  const list = await loadArticleList(orgId);
  const missing: string[] = [];
  const modelOf = new Map<number, string>();
  items.forEach(({ it, i }, k) => {
    if (!it.model.trim()) { missing.push(`в строке ${k + 1} («${it.name || "без названия"}») не указан артикул`); return; }
    const hit = resolveFromList(list, it.model);
    if (!hit) missing.push(`артикул ${it.model.trim()} не найден в справочнике`);
    else modelOf.set(i, hit.id);
  });
  if (missing.length) return { error: `ТЗ принять нельзя: ${uniq(missing).join("; ")}. Добавьте артикул в справочник (Изделия) и повторите — ничего не записано.` };

  // заказчик
  const core = norm(p.customer);
  const clients = await prisma.client.findMany({ where: { organizationId: orgId }, select: { id: true, name: true } });
  const exact = clients.filter((c) => norm(c.name) === core);
  const part = clients.filter((c) => core && norm(c.name) && (norm(c.name).includes(core) || core.includes(norm(c.name))));
  const client = exact[0] ?? (part.length === 1 ? part[0] : null);
  if (!client) return { error: `Заказчик «${p.customer}» не найден в справочнике заказчиков (или найдено несколько) — добавьте его в «Настройки → Заказчики» и повторите. Ничего не записано.` };

  // группы: (артикул, цвет) → одно ТЗ на группу, общий номер ТЗ
  const groups = new Map<string, TzGroup>();
  for (const x of items) {
    const key = `${modelOf.get(x.i)}|${norm(x.it.color)}`;
    const g = groups.get(key) ?? { modelId: modelOf.get(x.i)!, color: x.it.color.trim(), rows: [] };
    g.rows.push(x);
    groups.set(key, g);
  }
  return { items, client, groups: [...groups.values()] };
}

const DOC_LABEL: Record<string, [string, string, string]> = {
  AUCTION_INVOICE: ["аукционный счёт", "аукционных счёта", "аукционных счетов"], PAYMENT_INVOICE: ["счёт Веллмеха на оплату", "счёта Веллмеха на оплату", "счетов Веллмеха на оплату"],
  SPECIFICATION: ["спецификация", "спецификации", "спецификаций"], UPD: ["УПД", "УПД", "УПД"], OTHER: ["другой файл", "других файла", "других файлов"],
};
const pl = (n: number, f: [string, string, string]) => { const a = n % 100, b = n % 10; return a >= 11 && a <= 19 ? f[2] : b === 1 ? f[0] : b >= 2 && b <= 4 ? f[1] : f[2]; };
/** Какие вложения придут и куда попадут: документы закупки (по номеру аукционного счёта) или документы аукциона целиком. */
function docLines(row: Row, invoices: string[]): string[] {
  if (row.files.length === 0) return ["Документов к расчёту не приложено — их можно добавить к закупкам позже"];
  const by = new Map<string, number>();
  for (const f of row.files) by.set(f.kind, (by.get(f.kind) ?? 0) + 1);
  const parts = [...by.entries()].map(([k, n]) => `${n} ${DOC_LABEL[k] ? pl(n, DOC_LABEL[k]) : k}`).join(", ");
  const many = new Set(invoices).size > 1;
  return [`Документы (${row.files.length}): ${parts} — попадут в раздел «Документы»: ${many ? "аукционные счета — к закупке с тем же номером счёта, остальные — к документам аукциона" : "к созданной закупке"}`];
}

/** Что будет создано / что мешает принять — для карточки во «Входящих» (ничего не пишет). */
export async function previewInbox(orgId: string, row: Row): Promise<{ problems: string[]; lines: string[]; links?: { href: string; label: string }[]; orderDate?: { value: string; source: string } }> {
  if (row.kind === "TZ") {
    const r = await planTz(orgId, row.payload as unknown as TzPayload);
    if ("error" in r) return { problems: [r.error], lines: [] };
    const q = r.groups.map((g) => g.rows.reduce((a, { it }) => a + num(it.qty), 0));
    return { problems: [], lines: [`Будет создано ТЗ: ${r.groups.length} (по одному на артикул и цвет), общий номер ТЗ ${(row.payload as unknown as TzPayload).number}`, `Заказчик: ${r.client.name}; изделий всего ${plainNum(q.reduce((a, b) => a + b, 0))} шт.`, "Статус «Запланировано», списаний сырья нет"] };
  }
  const p = row.payload as unknown as CalcPayload;
  const conflict = await stageConflict(orgId, row, p);
  if (conflict) return { problems: [conflict.text], lines: [], links: conflict.link ? [conflict.link] : undefined };
  const auction = await resolveAuctionIn(prisma, p.header?.auction, orgId);
  const m = calcToBatchPayload(p, { inboxId: row.id, supplierId: row.supplierId, auctionId: auction && !auction.isService ? auction.id : null, title: row.title, today: new Date().toISOString().slice(0, 10) });
  if (!m.payload) return { problems: m.errors, lines: [] };
  const [refs, debt, known] = await Promise.all([loadIntakeRefs(prisma, orgId), loadSupplierDebt(prisma, orgId), loadSupplierInvoices(prisma, orgId, row.supplierId)]);
  const plan = planBatch(m.payload, refs, Number(debt.debt.toFixed(2)), known);
  const t = plan.preview.totals;
  const lines = [
    `Будет создано закупок (черновиков): ${plan.purchases.length} — по одной на аукционный счёт (${plan.purchases.map((x) => x.invoice || "—").join(", ")}) · ${plan.auctionName}${m.payload.header.newAuction ? " — аукциона нет в справочнике, он будет создан" : ""}`,
    `Лотов ${t.lots}, шкур ${t.qty}, ${t.inclVat.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽ с НДС; на склад не принимается`,
    ...m.warnings,
    ...docLines(row, m.payload.rows.map((x) => x.invoice).filter(Boolean)),
  ];
  // «(шаг 2)» — подсказка мастера; здесь пишем сами ошибки строк.
  const rowErrs = plan.preview.validation.checks.flatMap((c, i) => c.errors.map((e) => `Лот ${p.rows[i] ? usedLot(m.payload!, c.n) : c.n}: ${e}`));
  const dupProblems = plan.preview.dupInvoices.length ? [`Закупки по этим счетам уже есть: ${plan.preview.dupInvoices.map((d) => `счёт ${d.invoice} → ${d.purchaseNumber}`).join("; ")}. Принимать не нужно — иначе будут дубли; отклоните расчёт («уже заведено») или попросите исправить номер счёта.`] : [];
  const problems = [...plan.preview.blocking.filter((b) => !/^В таблице лотов ошибок/.test(b)), ...rowErrs, ...dupProblems];
  const hasInvDate = /^\d{4}-\d{2}-\d{2}$/.test(p.header.invoiceDate ?? "");
  const today = new Date().toISOString().slice(0, 10);
  const od = m.payload.header.orderDate;
  const source = hasInvoiceDate(hasInvDate, od, today);
  return { problems, lines: [`Дата закупки: ${od.split("-").reverse().join(".")} (${source})`, ...lines], orderDate: { value: od, source } };
}
const hasInvoiceDate = (hasInv: boolean, od: string, today: string) => (hasInv ? "из даты счёта" : od === today ? "дата приёма" : "по году и месяцу из названия аукциона, число условное — поправьте");

const usedLot = (pl: { rows: { n: number; lot: string }[] }, n: number) => pl.rows.find((r) => r.n === n)?.lot || `строка ${n}`;

async function acceptTz(s: Sess, row: Row): Promise<AcceptResult> {
  const orgId = s.user.organizationId;
  const p = row.payload as unknown as TzPayload;
  const plan = await planTz(orgId, p);
  if ("error" in plan) return plan;
  const { client } = plan;
  const groups = plan.groups;
  const wh = await getDefaultWarehouseId(orgId);
  if (!wh) return { error: "Не удалось определить склад по умолчанию — обратитесь к администратору" };

  const models = await prisma.productModel.findMany({ where: { organizationId: orgId, id: { in: [...new Set(groups.map((g) => g.modelId))] } }, select: { id: true, sellingPrice: true } });

  // партия поставки — только если такая уже есть (новых не создаём)
  let batchId: string | null = null;
  const bn = /^\d{1,4}$/.test(p.batch.trim()) ? Number(p.batch.trim()) : 0;
  if (bn > 0) batchId = (await prisma.productionBatch.findFirst({ where: { organizationId: orgId, number: bn }, select: { id: true } }))?.id ?? null;

  // файлы: Word по данным ТЗ + вложения — на диск до транзакции
  const written: StoredDriveFile[] = [];
  const cleanup = () => removeStoredFiles(written.map((w) => w.storagePath)).catch(() => {});
  const docFiles: { docType: "TZ_APPENDIX" | "AUCTION_INVOICE" | "PAYMENT_INVOICE" | "SPECIFICATION" | "UPD" | "OTHER"; title: string; f: StoredDriveFile }[] = [];
  try {
    const docx = await buildTzDocx(p);
    const rd = await readDocumentFiles([new File([new Uint8Array(docx)], `ПРИЛОЖЕНИЕ ${p.number}.docx`, { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" })]);
    if ("error" in rd) return { error: `Не удалось подготовить Word: ${rd.error}` };
    const w = await writeDriveFile(orgId, rd.files[0]);
    written.push(w);
    docFiles.push({ docType: "TZ_APPENDIX", title: `ТЗ ${p.number}: приложение (Word, от поставщика)`, f: w });
    for (const f of row.files) {
      const r = await readInboxFile(f);
      if ("error" in r) { await cleanup(); return r; }
      const sf = await writeDriveFile(orgId, r.doc);
      written.push(sf);
      docFiles.push({ docType: DRIVE_DOC_KIND[f.kind] ?? "OTHER", title: `ТЗ ${p.number}: ${f.originalName}`.slice(0, 200), f: sf });
    }
  } catch (e) {
    await cleanup();
    console.error("[acceptTz files]", e);
    return { error: "Не удалось подготовить файлы ТЗ. Ничего не записано." };
  }

  const handed = p.materials.filter((m) => m.name.trim()).map((m) => `${m.name.trim()}${m.lot.trim() ? `, лот ${m.lot.trim()}` : ""}, ${m.qty.trim() || "?"} ${m.unit.trim()}`.trim());
  const notes = [
    `Принято из кабинета поставщика: ${row.title}.`,
    handed.length ? `ЗАКАЗЧИК ПЕРЕДАЛ: ${handed.join("; ")}.` : "ЗАКАЗЧИК ПЕРЕДАЛ: ничего.",
    p.terms.deadline ? `Срок завершения работ: ${ruDate(p.terms.deadline)}.` : "",
    p.batch.trim() && !batchId ? `Партия по ТЗ: ${p.batch.trim()}.` : "",
  ].filter(Boolean).join(" ").slice(0, 5000);

  let ids: string[];
  try {
    ids = await prisma.$transaction(
      async (tx) => {
        await claim(tx, row, s.user.id);
        const out: string[] = [];
        for (const g of groups) {
          const qty = g.rows.reduce((a, { it }) => a + num(it.qty), 0);
          const workSum = g.rows.reduce((a, { it }) => a + num(it.qty) * num(it.work), 0);
          const work = qty > 0 ? Math.round((workSum / qty) * 100) / 100 : 0;
          const colorRes = await resolveColorInput(tx, orgId, { color: g.color });
          const number = await nextDocumentNumber(tx, "productionOrder", orgId, "П");
          const order = await tx.productionOrder.create({
            data: {
              organizationId: orgId, number, productModelId: g.modelId, rawWarehouseId: wh, finishedWarehouseId: wh,
              plannedQuantity: qty, color: colorRes.color ?? undefined, colorRefId: colorRes.colorRefId ?? undefined,
              size: uniq(g.rows.map(({ it }) => it.size)).join("; ").slice(0, 200) || undefined,
              materialDescription: uniq(g.rows.map(({ it }) => it.material)).join("; ").slice(0, 2000) || undefined,
              lining: uniq(g.rows.map(({ it }) => it.lining)).join("; ").slice(0, 2000) || undefined,
              startDate: new Date(), notes, clientId: client.id, contractNumber: p.contract.trim() || undefined,
              workOrderNumber: p.number.trim(), workOrderDate: isoDate(p.date),
              clientWorkPricePerUnit: work > 0 ? work : undefined,
              retailPrice: models.find((m) => m.id === g.modelId)?.sellingPrice ?? undefined,
              batchId: batchId ?? undefined, createdById: s.user.id,
            },
            select: { id: true },
          });
          out.push(order.id);
          for (const d of docFiles) {
            await tx.driveDocument.create({
              data: {
                organizationId: orgId, driveFileId: `local-${randomUUID()}`, title: d.title, docType: d.docType, mimeType: d.f.storedMime, sizeBytes: d.f.storedSize,
                ...d.f, storedAt: new Date(), productionOrderId: order.id,
              },
            });
          }
        }
        await tx.supplierInbox.update({ where: { id: row.id }, data: { createdEntityType: "ProductionOrder", createdEntityId: out.join(",") } });
        return out;
      },
      { timeout: 60_000, maxWait: 15_000 },
    );
  } catch (e) {
    await cleanup();
    if (e instanceof HookAbort) return { error: e.message };
    console.error("[acceptTz]", e);
    return { error: "ТЗ не принято, в базе ничего не изменилось. Если повторяется — сообщите администратору." };
  }
  finish(orgId);
  const t = tzTotals(p);
  return { ok: true, type: "ProductionOrder", ids, message: `Создано ТЗ в статусе «Запланировано»: ${ids.length} (№ ${p.number}), изделий ${plainNum(t.qty)} шт. Списаний сырья нет — добавьте их в карточках.` };
}

// ============================================================================================ вход

export async function acceptInboxRow(s: Sess, id: string, opts: { orderDate?: string } = {}): Promise<AcceptResult> {
  if (!hasRole(s.user.role, ACCESS.inbox)) return { error: "Недостаточно прав" };
  const row = await prisma.supplierInbox.findFirst({ where: { id, organizationId: s.user.organizationId }, include: { files: { orderBy: { createdAt: "asc" } } } });
  if (!row) return { error: "Входящее не найдено" };
  if (row.status === "ACCEPTED") {
    const ids = (row.createdEntityId ?? "").split(",").filter(Boolean);
    return { ok: true, already: true, type: row.createdEntityType === "Purchase" ? "Purchase" : "ProductionOrder", ids, message: "Уже принято — повторное нажатие ничего не создало." };
  }
  if (row.status !== "SENT") return { error: row.status === "REJECTED" ? "Это входящее отклонено" : "Это черновик — поставщик ещё не отправил его" };
  return row.kind === "AUCTION_CALC" ? acceptCalc(s, row, opts.orderDate) : acceptTz(s, row);
}
