import "server-only";
import { createHash } from "node:crypto";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { JSON_REGISTRY, makeRegistry, type Group, type Invoice, type Pay, type Recheck, type Registry } from "@/app/(app)/reconciliation/model";

/**
 * Реестр сверки в базе (таблицы Reconciliation*). Раньше — src/data/reconciliation.json.
 *  • loadRegistry(orgId) — реестр для страницы «Сверка», моста, подтверждений, проверок и /api/ready. Пока таблицы пусты, отдаёт JSON (запасной путь).
 *  • groupToRow / invoiceToRows — как строка JSON превращается в строки таблиц (общий код переноса, форм и тестов).
 *  • registryFromRows — обратное превращение: из таблиц в ту же структуру, которую читает вся сверка.
 */

const num = (d: { toString(): string } | null | undefined): number | null => (d == null ? null : Number(d.toString()));
const ymd = (d: Date | null | undefined): string | null => (d ? d.toISOString().slice(0, 10) : null);
const toDate = (s: string | null | undefined): Date | null => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00.000Z`) : null);
const money2 = (v: number | null | undefined): string | null => (v == null || !Number.isFinite(v) ? null : v.toFixed(2));

// ----------------------------------------------------------------------------------------- JSON → строки таблиц

type GroupDetails = Pick<Group, "doc" | "db" | "checks" | "diffs" | "agreements" | "files" | "notes" | "manualReview">;

export function groupToRow(g: Group, sortOrder: number) {
  const details: Record<string, unknown> = { doc: g.doc, db: g.db, checks: g.checks, diffs: g.diffs, files: g.files, notes: g.notes };
  if (g.agreements !== undefined) details.agreements = g.agreements;
  if (g.manualReview !== undefined) details.manualReview = g.manualReview;
  return {
    key: g.id,
    section: g.section,
    title: g.title,
    counterparty: g.house || null,
    year: g.year ?? null,
    status: g.status,
    sortOrder,
    dbPurchases: g.dbLink?.purchases ?? [],
    dbBatch: g.dbLink?.batch ?? null,
    advanceRub: money2(g.advanceRub ?? null),
    details: details as object,
  };
}

export function invoiceToRow(i: Invoice, sortOrder: number) {
  return {
    key: i.id,
    section: i.section,
    no: i.no ?? null,
    date: toDate(i.date),
    year: i.year ?? null,
    amountRub: money2(i.amountRub) ?? "0.00",
    vatRate: i.vatRate != null ? String(i.vatRate) : null,
    vatRub: money2(i.vatRub ?? null),
    currency: i.currency ?? "RUB",
    purpose: i.purpose ?? "",
    fileId: i.fileId ?? null,
    fileTitle: i.fileTitle ?? null,
    updNo: i.updNo ?? null,
    updDate: toDate(i.updDate ?? null),
    refPurchase: i.refPurchase ?? null,
    refBatch: i.refBatch ?? null,
    refTz: i.refTz ?? null,
    refDocumentId: i.refDocumentId ?? null,
    noInvoice: !!i.noInvoice,
    superseded: !!i.superseded,
    sortOrder,
    approvals: (i.approvals ?? []) as object,
    notes: (i.notes ?? []) as object,
    note: i.note ?? null,
  };
}

export function payToRow(p: Pay, sortOrder: number) {
  return {
    sortOrder,
    paidAt: toDate(p.date),
    dateApprox: !!p.dateApprox,
    amountRub: money2(p.amountRub) ?? "0.00",
    ppNo: p.ppNo ?? null,
    basis: p.basis ?? null,
    evidence: p.evidence ?? "fact",
    source: p.source ?? "",
    fileId: p.fileId ?? null,
    note: p.note ?? null,
  };
}

// ----------------------------------------------------------------------------------------- строки таблиц → структура сверки

type GroupRow = {
  id: string; key: string; section: string; title: string; counterparty: string | null; contract: string | null; year: number | null; period: string | null;
  status: string; note: string | null; dbPurchases: string[]; dbBatch: number | null; advanceRub: { toString(): string } | null; details: unknown; source: string;
  invoices: { posInGroup: number; invoice: { key: string; deletedAt: Date | null } }[];
};
type InvoiceRow = {
  id: string; key: string; section: string; no: string | null; date: Date | null; year: number | null; amountRub: { toString(): string };
  vatRate: { toString(): string } | null; vatRub: { toString(): string } | null; currency: string; purpose: string; fileId: string | null; fileTitle: string | null;
  updNo: string | null; updDate: Date | null; refPurchase: string | null; refBatch: number | null; refTz: string | null; refDocumentId: string | null;
  noInvoice: boolean; superseded: boolean; approvals: unknown; notes: unknown; note: string | null; source: string;
  groups: { posInInvoice: number; shareRub: { toString(): string } | null; group: { key: string; deletedAt: Date | null } }[];
  payments: { id: string; sortOrder: number; paidAt: Date | null; dateApprox: boolean; amountRub: { toString(): string }; ppNo: string | null; basis: string | null; evidence: string; source: string; fileId: string | null; note: string | null }[];
};
type CheckRow = { checkedDate: Date; checkedAt: Date; kind: string; details: unknown };

export function registryFromRows(groupRows: GroupRow[], invoiceRows: InvoiceRow[], checks: CheckRow[]): Registry {
  const liveInv = new Set(invoiceRows.map((i) => i.key));
  const groups: Group[] = groupRows.map((r) => {
    const d = (r.details ?? {}) as Partial<GroupDetails>;
    const invoiceIds = [...r.invoices].sort((a, b) => a.posInGroup - b.posInGroup).map((l) => l.invoice.key).filter((k) => liveInv.has(k));
    const g: Record<string, unknown> = {
      id: r.key,
      section: r.section,
      title: r.title,
      house: r.counterparty ?? "",
      status: r.status,
      year: r.year,
      doc: d.doc ?? { costRub: null, invoicesRub: null, paidRub: null },
      db: d.db ?? { costRub: null, paidRub: null, remainingRub: null, refs: "" },
      checks: d.checks ?? [],
      diffs: d.diffs ?? [],
      notes: d.notes ?? [],
      files: d.files ?? [],
      invoiceIds,
      dbLink: { ...(r.dbPurchases.length ? { purchases: r.dbPurchases } : {}), ...(r.dbBatch != null ? { batch: r.dbBatch } : {}) },
      dbId: r.id,
      period: r.period,
      contract: r.contract,
      note: r.note,
      source: r.source,
    };
    if (d.agreements !== undefined) g.agreements = d.agreements;
    if (d.manualReview !== undefined) g.manualReview = d.manualReview;
    if (r.advanceRub != null) g.advanceRub = num(r.advanceRub);
    return g as unknown as Group;
  });
  const invoices: Invoice[] = invoiceRows.map((r) => {
    const links = [...r.groups].filter((l) => !l.group.deletedAt).sort((a, b) => a.posInInvoice - b.posInInvoice);
    const shares: Record<string, number> = {};
    for (const l of links) if (l.shareRub != null) shares[l.group.key] = num(l.shareRub)!;
    const i: Record<string, unknown> = {
      id: r.key,
      section: r.section,
      no: r.no,
      date: ymd(r.date),
      year: r.year,
      amountRub: num(r.amountRub)!,
      purpose: r.purpose,
      fileId: r.fileId,
      fileTitle: r.fileTitle,
      groupIds: links.map((l) => l.group.key),
      shares,
      paid: [...r.payments].sort((a, b) => a.sortOrder - b.sortOrder).map((p) => {
        const o: Record<string, unknown> = { id: p.id, date: ymd(p.paidAt), amountRub: num(p.amountRub)!, ppNo: p.ppNo, basis: p.basis, evidence: p.evidence, source: p.source };
        if (p.dateApprox) o.dateApprox = true;
        if (p.fileId) o.fileId = p.fileId;
        if (p.note) o.note = p.note;
        return o;
      }),
      approvals: (r.approvals ?? []) as unknown[],
      notes: (r.notes ?? []) as unknown[],
      dbId: r.id,
      source: r.source,
    };
    if (r.noInvoice) i.noInvoice = true;
    if (r.superseded) i.superseded = true;
    if (r.vatRate != null) i.vatRate = num(r.vatRate);
    if (r.vatRub != null) i.vatRub = num(r.vatRub);
    if (r.currency && r.currency !== "RUB") i.currency = r.currency;
    if (r.updNo) i.updNo = r.updNo;
    if (r.updDate) i.updDate = ymd(r.updDate);
    if (r.refPurchase) i.refPurchase = r.refPurchase;
    if (r.refBatch != null) i.refBatch = r.refBatch;
    if (r.refTz) i.refTz = r.refTz;
    if (r.refDocumentId) i.refDocumentId = r.refDocumentId;
    if (r.note) i.note = r.note;
    return i as unknown as Invoice;
  });
  const last = checks[0];
  const withBlock = checks.find((c) => (c.details as { recheck?: unknown } | null)?.recheck);
  const blockDetails = (withBlock?.details ?? {}) as { recheck?: Recheck | null; note?: string };
  const anyNote = checks.map((c) => (c.details as { note?: string } | null)?.note).find((n) => typeof n === "string") ?? "";
  return makeRegistry(
    { groups, invoices, recheck: blockDetails.recheck ?? null, checkedAt: ymd(last?.checkedDate) ?? JSON_REGISTRY.checkedAt, note: blockDetails.note ?? anyNote },
    "db",
  );
}

type Db = Pick<typeof prisma, "reconciliationGroup" | "reconciliationInvoice" | "reconciliationCheck" | "auditLog">;

/** Реестр организации на заданном клиенте: из таблиц; пока в них нет ни одной группы (или таблиц ещё нет — миграция не применена) — прежний JSON. */
export async function loadRegistryWith(db: Db, orgId: string): Promise<Registry> {
  let groups, invoices, checks;
  try {
    [groups, invoices, checks] = await Promise.all([
      db.reconciliationGroup.findMany({
        where: { organizationId: orgId, deletedAt: null },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        include: { invoices: { include: { invoice: { select: { key: true, deletedAt: true } } } } },
      }),
      db.reconciliationInvoice.findMany({
        where: { organizationId: orgId, deletedAt: null },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        include: { groups: { include: { group: { select: { key: true, deletedAt: true } } } }, payments: true },
      }),
      db.reconciliationCheck.findMany({ where: { organizationId: orgId }, orderBy: [{ checkedDate: "desc" }, { checkedAt: "desc" }], take: 200 }),
    ]);
  } catch (e) {
    // Таблиц ещё нет (миграция не применена): работаем по прежнему JSON, страница не падает.
    if (/does not exist|P2021|P2022|relation .* does not exist/i.test(e instanceof Error ? e.message : String(e))) return JSON_REGISTRY;
    throw e;
  }
  if (groups.length === 0) {
    const d = ymd(checks[0]?.checkedDate);
    return d && d > JSON_REGISTRY.checkedAt ? { ...JSON_REGISTRY, checkedAt: d } : JSON_REGISTRY;
  }
  const last = await db.auditLog.findFirst({ where: { organizationId: orgId, model: { startsWith: "Reconciliation" } }, orderBy: { at: "desc" }, select: { id: true } });
  return { ...registryFromRows(groups as unknown as GroupRow[], invoices as unknown as InvoiceRow[], checks), rev: last?.id ?? "0" };
}

/** Реестр для приложения: один запрос к базе на рендер (React cache). */
export const loadRegistry = cache((orgId: string): Promise<Registry> => loadRegistryWith(prisma, orgId));

/** Дата последней отметки «сверка выполнена» (для /api/ready); null — отметок нет. */
export async function lastCheckInfo(orgId: string): Promise<{ date: string; byName: string | null; kind: string } | null> {
  const c = await prisma.reconciliationCheck.findFirst({ where: { organizationId: orgId }, orderBy: [{ checkedDate: "desc" }, { checkedAt: "desc" }] });
  return c ? { date: ymd(c.checkedDate)!, byName: c.byName, kind: c.kind } : null;
}

// ----------------------------------------------------------------------------------------- каноническая форма (проверка переноса без потерь)

const OPTIONAL_DROP = new Set(["dateApprox", "fileId", "note", "noInvoice", "superseded", "advanceRub"]);
function canonValue(v: unknown, key?: string): unknown {
  if (Array.isArray(v)) return v.map((x) => canonValue(x));
  if (v && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(v as object).sort()) {
      const x = (v as Record<string, unknown>)[k];
      if (x === undefined) continue;
      if ((x === null || x === false) && OPTIONAL_DROP.has(k)) continue;
      o[k] = canonValue(x, k);
    }
    return o;
  }
  void key;
  return v;
}

const GROUP_FIELDS = ["id", "section", "title", "house", "status", "year", "doc", "db", "checks", "diffs", "notes", "files", "invoiceIds", "dbLink", "agreements", "manualReview", "advanceRub"] as const;
const INVOICE_FIELDS = ["id", "section", "no", "date", "year", "amountRub", "purpose", "fileId", "fileTitle", "groupIds", "shares", "paid", "approvals", "notes", "noInvoice", "superseded"] as const;
const PAY_FIELDS = ["date", "amountRub", "ppNo", "basis", "evidence", "source", "dateApprox", "fileId", "note"] as const;

/** Содержимое реестра без служебных полей базы (id строк, источник): по нему сравнивают JSON и таблицы. */
export function canonRegistry(reg: Registry): unknown {
  const pick = (o: object, fields: readonly string[]) => Object.fromEntries(fields.map((f) => [f, (o as Record<string, unknown>)[f]]));
  const all = [...reg.invoices, ...reg.superseded];
  const sortedInv = [...all].sort((a, b) => a.id.localeCompare(b.id));
  return canonValue({
    checkedAt: reg.checkedAt,
    recheck: reg.recheck,
    groups: reg.groups.map((g) => pick(g, GROUP_FIELDS)).sort((a, b) => String(a.id).localeCompare(String(b.id))),
    invoices: sortedInv.map((i) => ({ ...pick(i, INVOICE_FIELDS), paid: i.paid.map((p) => pick(p, PAY_FIELDS)) })),
  });
}

export function registryHash(reg: Registry): string {
  return createHash("sha256").update(JSON.stringify(canonRegistry(reg))).digest("hex");
}
