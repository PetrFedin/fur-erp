/**
 * Собирает компактный src/data/reconciliation.json («Реестр сверки») из отчётов агентов
 * docs-inventory/chain-p2025.json, chain-p2026.json, chain-production.json.
 * Запуск:  npx tsx scripts/build-reconciliation.ts
 * База не читается и не меняется.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const load = (n: string): Any => JSON.parse(readFileSync(resolve("docs-inventory", n), "utf8"));

type Status = "ok" | "docs" | "unpaid" | "conflict" | "empty";
type Check = { label: string; ok: boolean | null };
type Diff = { what: string; doc: string; db: string; why: string };
type Group = {
  id: string;
  section: "purchase" | "production";
  title: string;
  house: string;
  status: Status;
  doc: { costRub: number | null; invoicesRub: number | null; paidRub: number | null };
  db: { costRub: number | null; paidRub: number | null; remainingRub: number | null; refs: string };
  checks: Check[];
  diffs: Diff[];
  notes: string[];
  files: { title: string; fileId: string }[];
};

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string => (v == null ? "" : String(v));
const files = (g: Any): { title: string; fileId: string }[] => {
  const out: { title: string; fileId: string }[] = [];
  const seen = new Set<string>();
  const d = g.documents ?? {};
  for (const k of ["wellmechInvoices", "invoices", "upd", "specs", "calcs", "tzAppendices"]) {
    for (const x of d[k] ?? []) {
      if (x?.fileId && x?.title && !seen.has(x.fileId)) {
        seen.add(x.fileId);
        out.push({ title: x.title, fileId: x.fileId });
      }
    }
  }
  return out.slice(0, 14);
};
const diffsOf = (g: Any): Diff[] =>
  (g.diffs ?? []).map((d: Any) => ({ what: str(d.what), doc: str(d.docValue), db: str(d.dbValue), why: str(d.hypothesis) }));

const groups: Group[] = [];

// ---------- закупки (2025 и 2026)
for (const file of ["chain-p2025.json", "chain-p2026.json"]) {
  for (const g of load(file).groups as Any[]) {
    // Без повторов: «Спец. 10» — сумма РП 04-26 + СП 05-26; СП 12.25 есть и в отчёте 2025, и 2026 (берём 2026, где УПД №283).
    if (str(g.key).startsWith("Спец. 10") || (file === "chain-p2025.json" && str(g.key).startsWith("СП 12.25"))) continue;
    const m = g.matches ?? {};
    const t = g.totals ?? {};
    const db = g.db ?? {};
    const docCost = num(t.updRub) ?? num(t.calcRub) ?? num(t.invoicesRub);
    const dbCost = num(db.totalRub);
    const costOk = docCost != null && dbCost != null && Math.abs(docCost - dbCost) < 1;
    const costNear = docCost != null && dbCost != null && Math.abs(docCost - dbCost) < 2000;
    const paidDb = num(db.paidRub);
    const byDocs = (g.paymentsByDocs ?? []) as Any[];
    // СП 03.25 и РП 03.25 оплачены тремя платежами вместе: у каждой группы своя часть = её УПД.
    const paidDoc = ["СП 03.25", "РП 03.25"].includes(str(g.key))
      ? num(t.updRub)
      : num(t.paymentsRub) ?? (byDocs.length ? Math.round(byDocs.reduce((a, x) => a + (num(x.amountRub) ?? 0), 0) * 100) / 100 : null);
    const paidOk = paidDoc != null && paidDb != null && Math.abs(paidDoc - paidDb) < 1;
    const hasData = (db.purchases ?? []).length > 0;
    let status: Status;
    if (!hasData && docCost == null) status = "empty";
    else if (m.all100) status = "ok";
    else if (m.invoices_eq_upd && m.lots_eq !== false && costNear && paidDoc != null && paidDoc > 0 && paidOk) status = "docs";
    else if (costNear && (paidDoc == null || paidDoc === 0 || !paidOk)) status = "unpaid";
    else status = "conflict";
    groups.push({
      id: `P:${g.key}`,
      section: "purchase",
      title: str(g.key),
      house: str(g.house),
      status,
      doc: { costRub: docCost, invoicesRub: num(t.invoicesRub), paidRub: paidDoc },
      db: { costRub: dbCost, paidRub: paidDb, remainingRub: num(db.remainingRub), refs: (db.purchases ?? []).join(", ") },
      checks: [
        { label: "УПД/расчёт = база", ok: costOk ? true : (m.upd_eq_db ?? m.calc_eq_db ?? m.invoice_eq_db ?? null) },
        { label: "Счета = УПД", ok: m.invoices_eq_upd ?? null },
        { label: "Лоты и количество", ok: m.lots_eq ?? null },
        { label: "Оплата = документы", ok: m.paid_eq_docs ?? null },
      ],
      diffs: diffsOf(g),
      notes: (g.notes ?? []).map(str),
      files: files(g),
    });
  }
}

// ---------- производство
for (const g of load("chain-production.json").groups as Any[]) {
  const m = g.matches ?? {};
  const t = g.totals ?? {};
  const db = g.db ?? {};
  const work = num(t.workDocsRub);
  const inv = num(t.invoicesRub);
  const dbWork = num(db.workRub);
  const empty = g.kind === "production" && (g.key.startsWith("Партия 15") || g.key.startsWith("Партия 16"));
  let status: Status;
  if (empty) status = "empty";
  else if (m.all100) status = "ok";
  else if (m.all100_docs) status = "docs";
  else if (m.invoice_eq_calc !== false && m.work_eq !== false && (num(t.paymentsRub) ?? 0) === 0) status = "unpaid";
  else status = "conflict";
  groups.push({
    id: `W:${g.key}`,
    section: "production",
    title: str(g.key),
    house: g.batchNumber ? `партия ${g.batchNumber}` : (db.orders ?? []).length ? "без партии" : "оплата без привязки к ТЗ",
    status,
    doc: { costRub: work, invoicesRub: inv, paidRub: num(t.paymentsRub) },
    db: { costRub: dbWork, paidRub: num(db.paidRub), remainingRub: num(db.remainingRub), refs: (db.orders ?? []).length ? db.orders.length === 1 ? `ТЗ ${db.orders[0]}` : `ТЗ ${db.orders[0]}–${db.orders[db.orders.length - 1]}` : str(db.note).slice(0, 120) },
    checks: [
      { label: "ТЗ-приложения = база", ok: m.work_eq ?? null },
      { label: "Счёт = расчёт", ok: m.invoice_eq_calc ?? null },
      { label: "Оплата = документы", ok: m.paid_eq_docs ?? null },
      { label: "Остаток по документам 0", ok: m.remaining_zero_docs ?? null },
    ],
    diffs: diffsOf(g),
    notes: (g.notes ?? []).map(str),
    files: files(g),
  });
}

const out = {
  checkedAt: new Date().toISOString().slice(0, 10),
  note: "СП — Союзпушнина, РП — Русьпушнина. Платёжек и выписок в папке «мех» нет: «оплачено» — по письмам, балансу и УПД.",
  groups,
};
writeFileSync(resolve("src/data/reconciliation.json"), JSON.stringify(out, null, 1) + "\n");
const cnt: Record<string, number> = {};
for (const g of groups) cnt[`${g.section}/${g.status}`] = (cnt[`${g.section}/${g.status}`] ?? 0) + 1;
console.log(groups.length, "групп", cnt);
