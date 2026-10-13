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
    prisma.payment.findMany({ where: { organizationId: orgId, status: "COMPLETED" }, select: { id: true, document: { select: { originalName: true, storagePath: true } }, driveDocuments: { select: { title: true, storagePath: true } } } }),
    prisma.productionPayment.findMany({ where: { organizationId: orgId, status: "COMPLETED" }, select: { id: true, driveDocuments: { select: { title: true, storagePath: true } } } }),
  ]);
  const vmap = new Map<string, VerifyRow>();
  for (const v of [...vPay, ...vProd]) vmap.set(`${v.kind === "payment" ? "raw" : "prod"}:${v.id}`, v);
  const filesOf = new Map<string, { name: string; ok: boolean }[]>();
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
    const row: RegistryRow = {
      code: paymentCode(o.kind, o.id), kind: o.kind, iso: o.iso, year: o.year, amount: o.amount,
      direction: o.kind === "raw" ? "out" : "in",
      counterparty: field(o, "Кому") || "—",
      what: o.what === "Оплата" ? "Расчёт" : (o.what as "Аванс" | "Доплата"),
      targets, unallocated: o.unallocated,
      invoice: field(o, "Счёт"), pp: field(o, "№ п/п"),
      fileOk, status,
    };
    return { row, ov: o, verify: v, registryFact, files };
  });
}

export async function loadPaymentsRegistry(orgId: string): Promise<RegistryRow[]> {
  const all = await loadPaymentsRegistryFull(orgId);
  return all.map((x) => x.row).sort((a, b) => (a.iso < b.iso ? 1 : a.iso > b.iso ? -1 : a.code < b.code ? 1 : -1));
}
