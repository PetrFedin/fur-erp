import "server-only";
import { prisma } from "@/lib/prisma";
import { loadPaymentsOverview, type OverviewRow } from "@/lib/payments-overview";
import { loadVerifyRows, ppNoOf, registryKnowsPp, type VerifyRow } from "@/lib/verification";
import { storedFileExists } from "@/lib/stored-file-check";

/**
 * Реестр платежей: одна таблица всех проведённых оплат — поставщику («Мы платим») и от заказчика («Нам платят»).
 * Ничего не считает заново: суммы, разнесение и ссылки — из loadPaymentsOverview, подтверждение и замечания — из verification.ts,
 * «файл загружен» — только если файл реально лежит на диске (stored-file-check.ts).
 */

/** Код оплаты в адресе карточки: s-… — оплата поставщику (Payment), c-… — оплата от заказчика (ProductionPayment). */
export const paymentCode = (kind: "raw" | "prod", id: string) => `${kind === "raw" ? "s" : "c"}-${id}`;
export function parsePaymentCode(code: string): { kind: "raw" | "prod"; id: string } | null {
  const m = /^([sc])-([A-Za-z0-9]{8,40})$/.exec(code);
  return m ? { kind: m[1] === "s" ? "raw" : "prod", id: m[2] } : null;
}

export type PayStatus = "verified" | "docs" | "check" | "mismatch";
export const PAY_STATUS_LABEL: Record<PayStatus, string> = {
  verified: "Подтверждена",
  docs: "Ждёт документа",
  check: "Не подтверждено",
  mismatch: "Расходится",
};

export type RegistryRow = {
  code: string;
  kind: "raw" | "prod";
  iso: string;
  year: number;
  amount: number;
  direction: "out" | "in";
  counterparty: string;
  what: "Аванс" | "Доплата" | "Расчёт";
  targets: { label: string; href: string }[];
  /** Не разнесено ни на закупку, ни на ТЗ, ₽. */
  unallocated: number;
  invoice: string;
  pp: string;
  /** Контрагент: куда вести ссылку (поставщик или заказчик); null — не указан. */
  cpId: string | null;
  /** Нижний регистр: всё, по чему ищет поле «Поиск» реестра (п/п, счёт, контрагент, основание, закупки/ТЗ/партия). */
  search: string;
  fileOk: boolean;
  status: PayStatus;
};

export type RegistryFull = {
  row: RegistryRow;
  ov: OverviewRow;
  verify: VerifyRow | null;
  /** Реестр сверки подтверждает сумму и дату (п/п или оплата с той же датой и суммой). */
  registryFact: string | null;
  files: { name: string; ok: boolean }[];
};

const field = (ov: OverviewRow, k: string) => ov.fields.find((f) => f[0] === k)?.[1] ?? "";

export async function loadPaymentsRegistryFull(orgId: string): Promise<RegistryFull[]> {
  const [ov, vPay, vProd, payFiles, prodFiles] = await Promise.all([
    loadPaymentsOverview(orgId),
    loadVerifyRows(prisma, orgId, "payment"),
    loadVerifyRows(prisma, orgId, "prodPayment"),
    prisma.payment.findMany({ where: { organizationId: orgId, status: "COMPLETED" }, select: { id: true, supplierId: true, invoiceNo: true, ppNo: true, docRef: true, document: { select: { originalName: true, storagePath: true } }, driveDocuments: { select: { title: true, storagePath: true } } } }),
    prisma.productionPayment.findMany({ where: { organizationId: orgId, status: "COMPLETED" }, select: { id: true, clientId: true, invoiceNo: true, ppNo: true, docRef: true, driveDocuments: { select: { title: true, storagePath: true } } } }),
  ]);
  const vmap = new Map<string, VerifyRow>();
  for (const v of [...vPay, ...vProd]) vmap.set(`${v.kind === "payment" ? "raw" : "prod"}:${v.id}`, v);
  const filesOf = new Map<string, { name: string; ok: boolean }[]>();
  const extra = new Map<string, { cpId: string | null; invoiceNo: string; ppNo: string; docRef: string }>();
  for (const p of payFiles) extra.set(`raw:${p.id}`, { cpId: p.supplierId, invoiceNo: p.invoiceNo ?? "", ppNo: p.ppNo ?? "", docRef: p.docRef ?? "" });
  for (const p of prodFiles) extra.set(`prod:${p.id}`, { cpId: p.clientId, invoiceNo: p.invoiceNo ?? "", ppNo: p.ppNo ?? "", docRef: p.docRef ?? "" });
  for (const p of payFiles) {
    const l = p.driveDocuments.map((d) => ({ name: d.title, ok: storedFileExists(d.storagePath) }));
    if (p.document) l.unshift({ name: p.document.originalName, ok: storedFileExists(p.document.storagePath) });
    filesOf.set(`raw:${p.id}`, l);
  }
  for (const p of prodFiles) filesOf.set(`prod:${p.id}`, p.driveDocuments.map((d) => ({ name: d.title, ok: storedFileExists(d.storagePath) })));

  return ov.map((o) => {
    const key = `${o.kind}:${o.id}`;
    const v = vmap.get(key) ?? null;
    const files = filesOf.get(key) ?? [];
    const fileOk = files.some((f) => f.ok);
    const pp = ppNoOf(o.doc);
    const registryFact = v?.registryFact ?? null;
    // Расходится: п/п названа и есть в документах сверки, но сумма или дата в базе с ними не совпали.
    const mismatch = !o.confirmed && !!pp && registryKnowsPp(pp) && !registryFact;
    const status: PayStatus = o.confirmed ? "verified" : mismatch ? "mismatch" : fileOk ? "check" : "docs";
    const targets = o.links.length > 0
      ? o.links.slice(0, 4)
      : [];
    const ex = extra.get(key);
    const invoice = field(o, "Счёт") || (ex?.invoiceNo ? `№${ex.invoiceNo}` : "");
    const ppText = field(o, "№ п/п") || (ex?.ppNo ? `№ ${ex.ppNo}` : "");
    const search = [invoice, ppText, ex?.invoiceNo, ex?.ppNo, ex?.docRef, o.doc, field(o, "Кому"), o.label, ...o.fields.filter((f) => ["За что", "Основание", "Заметка"].includes(f[0])).map((f) => f[1]), ...o.parts.map((x) => x.label), ...o.links.map((x) => x.label)]
      .filter(Boolean).join(" ").toLowerCase();
    const row: RegistryRow = {
      code: paymentCode(o.kind, o.id), kind: o.kind, iso: o.iso, year: o.year, amount: o.amount,
      direction: o.kind === "raw" ? "out" : "in",
      counterparty: field(o, "Кому") || "—",
      what: o.what === "Оплата" ? "Расчёт" : (o.what as "Аванс" | "Доплата"),
      targets, unallocated: o.unallocated,
      invoice, pp: ppText, cpId: ex?.cpId ?? null, search,
      fileOk, status,
    };
    return { row, ov: o, verify: v, registryFact, files };
  });
}

export async function loadPaymentsRegistry(orgId: string): Promise<RegistryRow[]> {
  const all = await loadPaymentsRegistryFull(orgId);
  return all.map((x) => x.row).sort((a, b) => (a.iso < b.iso ? 1 : a.iso > b.iso ? -1 : a.code < b.code ? 1 : -1));
}

/** «№103 от 03.07.2025» → «103»; пусто, если номера нет. */
export const invoiceToken = (s: string) => /№\s*([^\s;·,()]+)/.exec(s)?.[1] ?? "";

/**
 * Ссылка для номера счёта строки реестра: счёт найден в таблице Invoice (того же поставщика) —
 * одна закупка → на неё, несколько → список закупок по номеру. Нет счёта в базе — ссылки нет.
 */
export async function loadInvoiceLinks(orgId: string, rows: Pick<RegistryRow, "code" | "kind" | "invoice" | "cpId">[]): Promise<Map<string, string>> {
  const raw = rows.filter((r) => r.kind === "raw" && r.cpId && invoiceToken(r.invoice));
  const out = new Map<string, string>();
  if (raw.length === 0) return out;
  const tokens = Array.from(new Set(raw.map((r) => invoiceToken(r.invoice))));
  const invoices = await prisma.invoice.findMany({
    where: { organizationId: orgId, number: { in: tokens } },
    select: { number: true, supplierId: true, purchases: { select: { id: true }, take: 3 } },
  });
  for (const r of raw) {
    const t = invoiceToken(r.invoice);
    const ps = new Set<string>();
    for (const i of invoices) if (i.number === t && i.supplierId === r.cpId) for (const p of i.purchases) ps.add(p.id);
    if (ps.size === 1) out.set(r.code, `/purchases/${Array.from(ps)[0]}`);
    else if (ps.size > 1) out.set(r.code, `/purchases?q=${encodeURIComponent(t)}`);
  }
  return out;
}
