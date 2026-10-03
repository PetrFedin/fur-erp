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

// =====================================================================================
// Счета Веллмех: один счёт — одна запись (с оплатами по документам). Группа = аукцион/партия.
// =====================================================================================
type Basis = "pp" | "balance" | "upd" | "registry" | "calc" | "letter" | "credit";
type Evidence = "fact" | "approved" | "planned";
type Pay = {
  date: string | null;
  dateApprox?: boolean;
  amountRub: number;
  ppNo: string | null;
  basis: Basis | null;
  evidence: Evidence;
  source: string;
  fileId?: string | null;
  note?: string;
};
type Invoice = {
  id: string;
  section: "purchase" | "production";
  no: string | null;
  date: string | null;
  year: number | null;
  amountRub: number;
  purpose: string;
  fileId: string | null;
  fileTitle: string | null;
  groupIds: string[];
  /** Доли счёта по группам (общий платёж); сумма долей = сумме счёта. */
  shares: Record<string, number>;
  paid: Pay[];
  approvals: { date: string | null; by: string; note: string }[];
  superseded?: boolean;
  noInvoice?: boolean;
  notes: string[];
};

const extra = (() => {
  try {
    return JSON.parse(readFileSync(resolve("docs-inventory", "reconciliation-extra.json"), "utf8")) as Any;
  } catch {
    return { findings: [], invoiceNotes: [], recheck: null };
  }
})();

const firstNo = (v: unknown): string | null => {
  const m = /^\s*(\d+)/.exec(str(v));
  return m ? m[1] : null;
};
const yearOf = (d: string | null): number | null => (d ? Number(d.slice(0, 4)) : null);

const BASIS_RE: [RegExp, Basis][] = [
  [/баланс/i, "balance"],
  [/fin|расч[её]т(?! себест)|xlsx/i, "calc"],
  [/реестр/i, "registry"],
  [/УПД/i, "upd"],
  [/письм/i, "letter"],
];
function basisOf(p: Any): Basis | null {
  if (p.ppNo) return "pp";
  const src = str(p.source);
  for (const [re, b] of BASIS_RE) if (re.test(src)) return b;
  return null;
}
// Недатированные платежи по умолчанию «только согласовано». Исключения (по документам — оплата подтверждена письмом):
const FACT_BY_LETTER = new Set(["149|2026"]);
// Датированные, но фактом не являющиеся (в письме — «планируем оплатить до 24.12», выписки нет).
const NOT_FACT_DESPITE_DATE = new Set(["241|2025"]);

function classify(p: Any, key: string): { evidence: Evidence; basis: Basis | null } {
  const src = str(p.source);
  if (/ожида/i.test(src) && !p.date) return { evidence: "planned", basis: null };
  if (/нет счёта/i.test(str(p.forInvoiceNo))) return { evidence: "planned", basis: null };
  if (p.evidence) {
    const e = str(p.evidence);
    return { evidence: "fact", basis: e.startsWith("fact_by_letter") ? "letter" : /баланс/i.test(src) ? "balance" : basisOf(p) };
  }
  if (p.status === "approved-not-proven") return { evidence: "approved", basis: null };
  if (FACT_BY_LETTER.has(key)) return { evidence: "fact", basis: "letter" };
  if (NOT_FACT_DESPITE_DATE.has(key)) return { evidence: "approved", basis: null };
  if (p.date) return { evidence: "fact", basis: basisOf(p) ?? "calc" };
  return { evidence: "approved", basis: null };
}

const invoices = new Map<string, Invoice>();
const invKey = (section: string, no: string | null, date: string | null, year: number | null, label?: string) =>
  `${section}:${no ?? label ?? "x"}:${date ?? year ?? ""}`;

// Группы-дубли: их счета/платежи читаются, но относятся к канонической группе.
const SKIPPED_TO: Record<string, string[]> = {
  "Спец. 10 (РП 04-26 + СП 05-26)": ["P:РП 04-26", "P:СП 05-26"],
  "СП 12.25 (соболь, счёт аукциона 4014)": ["P:СП 12.25 (УПД 283, спец. 8)"],
};
// Доли общих счетов по группам: разнесение по УПД (СП/РП 03.25, 05.25) и по договору (спец. 10).
const SHARE_RULES: Record<string, Record<string, number>> = {
  "31": { "P:СП 03.25": 87110090.04, "P:РП 03.25": 38760761.96 },
  "37": { "P:СП 03.25": 87110090.04, "P:РП 03.25": 38760761.96 },
  "75": { "P:СП 03.25": 87110090.04, "P:РП 03.25": 38760761.96 },
  "83": { "P:СП 05.25": 29605789.3, "P:РП 05.25": 3594289.9 },
  "143@2025": { "P:СП 05.25": 29605789.3, "P:РП 05.25": 3594289.9 },
  "117@2026": { "P:РП 04-26": 21608125, "P:СП 05-26": 6304375 },
  "197@2026": { "P:РП 04-26": 5438524.49, "P:СП 05-26": 1798287.54 },
};
const ruleKey = (no: string, year: number | null) => (SHARE_RULES[`${no}@${year}`] ? `${no}@${year}` : no);

function applyShares(inv: Invoice) {
  const no = inv.no ?? "";
  const rule = SHARE_RULES[ruleKey(no, inv.year)];
  const gids = inv.groupIds;
  if (rule && gids.length > 1) {
    const tot = gids.reduce((a, g) => a + (rule[g] ?? 0), 0) || 1;
    let left = inv.amountRub;
    gids.forEach((g, i) => {
      const v = i === gids.length - 1 ? left : Math.round(((inv.amountRub * (rule[g] ?? 0)) / tot) * 100) / 100;
      inv.shares[g] = v;
      left = Math.round((left - v) * 100) / 100;
    });
  } else if (gids.length === 1) inv.shares[gids[0]] = inv.amountRub;
  else {
    const v = Math.round((inv.amountRub / Math.max(1, gids.length)) * 100) / 100;
    gids.forEach((g) => (inv.shares[g] = v));
  }
}

function addInvoice(section: "purchase" | "production", groupIds: string[], x: Any, fallbackYear: number | null, label?: string): Invoice | null {
  const no = /^\(нет/.test(str(x.no)) ? null : firstNo(x.no) ? str(x.no).trim() : null;
  const date = x.date ?? null;
  const year = yearOf(date) ?? fallbackYear;
  const amount = num(x.amountRub);
  if (amount == null) return null;
  const superseded = /ранняя редакция/i.test(str(x.no)) || /НЕ оплачен, заменён/.test(str(x.purpose));
  const k = invKey(section, superseded ? `${no}-old` : no, date, year, label ?? str(x.purpose).slice(0, 20));
  let inv = invoices.get(k);
  if (!inv) {
    inv = {
      id: k,
      section,
      no: no && /^\d+$/.test(no) ? no : no ? (firstNo(no) ?? no) : null,
      date,
      year,
      amountRub: amount,
      purpose: str(x.purpose ?? x.basis ?? label ?? ""),
      fileId: x.fileId ?? null,
      fileTitle: x.fileId ? str(x.title) : null,
      groupIds: [],
      shares: {},
      paid: [],
      approvals: [],
      superseded: superseded || undefined,
      noInvoice: no == null && !superseded ? true : undefined,
      notes: [],
    };
    if (no == null) inv.no = null;
    invoices.set(k, inv);
  }
  if (!inv.fileId && x.fileId) {
    inv.fileId = x.fileId;
    inv.fileTitle = str(x.title);
  }
  if (!inv.purpose && (x.purpose ?? x.basis)) inv.purpose = str(x.purpose ?? x.basis);
  for (const g of groupIds) if (!inv.groupIds.includes(g)) inv.groupIds.push(g);
  return inv;
}

const addPay = (inv: Invoice, pay: Pay) => {
  const dup = inv.paid.find(
    (p) => (p.date === pay.date || p.date == null || pay.date == null) && Math.abs(p.amountRub - pay.amountRub) < 0.005 && p.evidence === pay.evidence,
  );
  if (dup) {
    if (!dup.date && pay.date) Object.assign(dup, { date: pay.date, dateApprox: pay.dateApprox });
    return;
  }
  inv.paid.push(pay);
};

type Src = { gid: string[]; rawKey: string; section: "purchase" | "production"; g: Any };
const sources: Src[] = [];
for (const file of ["chain-p2025.json", "chain-p2026.json"]) {
  for (const g of load(file).groups as Any[]) {
    const key = str(g.key);
    const canon = SKIPPED_TO[key];
    const own = `P:${key}`;
    // 2025-версия СП 12.25 — только для данных (файл счёта №241), берём канонический id 2026-версии.
    sources.push({ gid: canon ?? [own], rawKey: key, section: "purchase", g });
  }
}
for (const g of load("chain-production.json").groups as Any[]) sources.push({ gid: [`W:${g.key}`], rawKey: str(g.key), section: "production", g });

const groupYear = (title: string): number | null => {
  const m = /(?:\.|-)(\d\d)(?:\b|\s|$)/.exec(title);
  if (m && /\d\d[.-]\d\d/.test(title)) return 2000 + Number(m[1]);
  if (/2025/.test(title)) return 2025;
  if (/2026/.test(title)) return 2026;
  return null;
};

// Платежи спец. 10 берём только из полной записи (иначе РП/СП-части задвоятся).
const SPEC10 = "Спец. 10 (РП 04-26 + СП 05-26)";
const spec10Nos = new Set(["117", "131", "149", "197"]);

for (const s of sources) {
  const { g, section } = s;
  const fy = section === "purchase" ? groupYear(s.rawKey) : null;
  const list: Any[] = section === "purchase" ? g.documents?.wellmechInvoices ?? [] : g.documents?.invoices ?? [];
  const created: Invoice[] = [];
  for (const x of list) {
    const wanted = s.rawKey === SPEC10 ? [] : [];
    void wanted;
    const spec10Groups: Record<string, string[]> = { "117": ["P:РП 04-26", "P:СП 05-26"], "197": ["P:РП 04-26", "P:СП 05-26"], "131": ["P:РП 04-26"], "149": ["P:СП 05-26"] };
    const inv = addInvoice(section, s.rawKey === SPEC10 ? spec10Groups[str(x.no)] ?? s.gid : s.gid, x, fy);
    if (inv) created.push(inv);
  }
  // платежи
  for (const p of (g.paymentsByDocs ?? []) as Any[]) {
    if (/зач[её]т/i.test(str(p.forInvoiceNo))) continue; // зачёты переплат — не оплата счёта
    const amount = num(p.amountRub);
    if (amount == null) continue;
    const no = firstNo(p.forInvoiceNo);
    let inv: Invoice | undefined;
    if (/нет счёта/i.test(str(p.forInvoiceNo))) inv = created.find((c) => c.noInvoice);
    else if (no) inv = created.find((c) => c.no === no && !c.superseded);
    if (!inv) continue;
    // спец. 10: платежи только из полной записи
    if (section === "purchase" && spec10Nos.has(no ?? "") && (inv.year ?? 0) === 2026 && s.rawKey !== SPEC10) continue;
    const k = `${no}|${inv.year}`;
    const c = classify(p, k);
    const pay: Pay = {
      date: p.date ? str(p.date).replace("?", "") : null,
      dateApprox: /\?/.test(str(p.date)) || undefined,
      amountRub: amount,
      ppNo: p.ppNo ? str(p.ppNo).split(/[ (]/)[0] : null,
      basis: c.basis,
      evidence: c.evidence,
      source: str(p.source).slice(0, 600),
      note: p.hypothesis ? str(p.hypothesis) : undefined,
    };
    addPay(inv, pay);
  }
  // согласования производства
  if (section === "production") {
    for (const a of (g.agreements ?? []) as Any[]) {
      const note = str(a.note);
      const hit = created.filter((c) => c.no && new RegExp(`(?:№\\s*|\\b)${c.no}\\b`).test(note));
      const targets = hit.length ? hit : created.length === 1 ? created : [];
      for (const t of targets) t.approvals.push({ date: a.date ?? null, by: str(a.by), note });
    }
  }
}
// «Спец. 10» тоже даёт счета РП/СП; если счёт появился дважды (из РП, СП и спец. 10) — группы объединены по ключу.
const invList = Array.from(invoices.values());
for (const inv of invList) {
  applyShares(inv);
  // общий платёж: у счёта-дубля один набор платежей (из полной записи)
}

// дополнительные находки (docs-inventory/reconciliation-extra.json)
for (const f of (extra.findings ?? []) as Any[]) {
  const cands = invList.filter((i) => i.no === str(f.invoiceNo) && (f.year == null || i.year === f.year));
  const inv = cands[0];
  if (!inv) continue;
  for (const p of (f.paid ?? []) as Any[]) {
    addPay(inv, {
      date: p.date ?? null,
      amountRub: Number(p.amountRub),
      ppNo: p.ppNo ?? null,
      basis: p.evidence === "fact" ? (p.ppNo ? "pp" : "letter") : null,
      evidence: p.evidence === "fact" ? "fact" : "approved",
      source: str(p.source),
      fileId: p.fileId ?? null,
    });
  }
}
for (const n of (extra.invoiceNotes ?? []) as Any[]) {
  const inv = invList.find((i) => i.no === str(n.invoiceNo) && (n.year == null || i.year === n.year));
  if (inv) inv.notes.push(str(n.note));
}

// год и привязка к БД для групп
const BATCH_YEAR_FALLBACK: Record<string, number> = { "Партия 8": 2026, "Партия 9": 2026 };
for (const g of groups) {
  const invs = invList.filter((i) => i.groupIds.includes(g.id) && !i.superseded);
  const years = invs.map((i) => i.year).filter((y): y is number => y != null);
  const raw = g.title;
  const fb = BATCH_YEAR_FALLBACK[raw] ?? groupYear(raw) ?? null;
  (g as Any).year = years.length ? Math.max(...years) : fb ?? (g.section === "production" ? 2026 : null);
  (g as Any).invoiceIds = invList.filter((i) => i.groupIds.includes(g.id)).map((i) => i.id);
}
// Привязка группы к базе: номера закупок (для закупок) и номер партии (для производства).
const purchaseNos: Record<string, string[]> = {};
for (const file of ["chain-p2025.json", "chain-p2026.json"]) {
  for (const g of load(file).groups as Any[]) purchaseNos[`P:${g.key}`] = ((g.db ?? {}).purchases ?? []).filter((x: string) => /^З-\d{4}-\d+$/.test(x));
}
for (const g of groups) {
  const m = /^Партия (\d+)/.exec(g.title);
  (g as Any).dbLink = g.section === "purchase" ? { purchases: purchaseNos[g.id] ?? [] } : m ? { batch: Number(m[1]) } : {};
}
// агрегат по групповым соглашениям производства (не привязанным к одному счёту)
for (const sct of sources) {
  if (sct.section !== "production") continue;
  const gr = groups.find((x) => x.id === sct.gid[0]);
  if (!gr) continue;
  (gr as Any).agreements = ((sct.g.agreements ?? []) as Any[]).map((a) => ({ date: a.date ?? null, by: str(a.by), note: str(a.note) }));
  (gr as Any).advanceRub = num(sct.g.totals?.advanceRub);
}

const out = {
  checkedAt: new Date().toISOString().slice(0, 10),
  note: "СП — Союзпушнина, РП — Русьпушнина. Платёжек и банковских выписок Меркури Мода в папке «мех» нет: «оплачено» — по письмам, балансу, УПД, единому реестру (п/п) и расчётам fin.",
  recheck: extra.recheck ?? null,
  groups,
  invoices: invList.sort((a, b) => (a.date ?? `${a.year}-99`).localeCompare(b.date ?? `${b.year}-99`)),
};
writeFileSync(resolve("src/data/reconciliation.json"), JSON.stringify(out, null, 1) + "\n");
const cnt: Record<string, number> = {};
for (const g of groups) cnt[`${g.section}/${g.status}`] = (cnt[`${g.section}/${g.status}`] ?? 0) + 1;
console.log(groups.length, "групп", cnt, "счетов", invList.length);
