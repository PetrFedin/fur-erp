import data from "@/data/reconciliation.json";

// Чистая логика реестра сверки: статусы счетов, прогресс, итоги, год. Без БД и без React.

export type Evidence = "fact" | "approved" | "planned";
export type Basis = "pp" | "balance" | "upd" | "registry" | "calc" | "letter" | "credit";
export type Pay = {
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
export type Invoice = {
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
  shares: Record<string, number>;
  paid: Pay[];
  approvals: { date: string | null; by: string; note: string }[];
  superseded?: boolean;
  noInvoice?: boolean;
  notes: string[];
};
export type RecStatus = "ok" | "docs" | "unpaid" | "conflict" | "empty";
export type Group = (typeof data.groups)[number] & {
  status: RecStatus;
  year: number | null;
  invoiceIds: string[];
  dbLink: { purchases?: string[]; batch?: number };
  agreements?: { date: string | null; by: string; note: string }[];
  advanceRub?: number | null;
};

export const ALL_GROUPS = data.groups as unknown as Group[];
export const ALL_INVOICES = (data.invoices as unknown as Invoice[]).filter((i) => !i.superseded);
export const SUPERSEDED = (data.invoices as unknown as Invoice[]).filter((i) => i.superseded);
export const RECHECK =
  (data as unknown as { recheck?: { date: string; found: string[]; notFound: string[]; ownerDecisions: string[] } | null }).recheck ?? null;

export type InvStatus = "closed" | "partial" | "unpaid" | "approved";
export type Confirm = "docs" | "letter" | "approved" | "none";

export const TOL = 1; // рубль: копейки округления — это «закрыт»

export type InvCalc = {
  inv: Invoice;
  /** Доля счёта, относящаяся к рассматриваемой группе (для общих счетов), иначе вся сумма. */
  amount: number;
  paid: number;
  paidDocs: number;
  paidLetter: number;
  approved: number;
  remaining: number;
  pct: number;
  status: InvStatus;
  confirm: Confirm;
};

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Расчёт по счёту целиком (scale = доля группы / вся сумма счёта; 1 — счёт целиком). */
export function calcInvoice(inv: Invoice, scale = 1): InvCalc {
  const facts = inv.paid.filter((p) => p.evidence === "fact");
  const paidDocs = facts.filter((p) => p.basis !== "letter").reduce((a, p) => a + p.amountRub, 0);
  const paidLetter = facts.filter((p) => p.basis === "letter").reduce((a, p) => a + p.amountRub, 0);
  const paid = paidDocs + paidLetter;
  const remaining = Math.max(0, inv.amountRub - paid);
  const approvedPays = inv.paid.filter((p) => p.evidence === "approved").reduce((a, p) => a + p.amountRub, 0);
  const approvedByLetter = inv.approvals.length > 0 ? remaining : 0; // согласование в переписке (производство)
  const approved = Math.min(remaining, Math.max(approvedPays, approvedByLetter));
  const pct = inv.amountRub > 0 ? Math.min(100, (paid / inv.amountRub) * 100) : 0;
  let status: InvStatus;
  if (inv.amountRub - paid <= TOL) status = "closed";
  else if (paid > TOL) status = "partial";
  else if (approved > TOL) status = "approved";
  else status = "unpaid";
  const confirm: Confirm = paid > TOL ? (paidDocs >= paidLetter ? "docs" : "letter") : approved > TOL ? "approved" : "none";
  const s = scale;
  return {
    inv,
    amount: r2(inv.amountRub * s),
    paid: r2(paid * s),
    paidDocs: r2(paidDocs * s),
    paidLetter: r2(paidLetter * s),
    approved: r2(approved * s),
    remaining: r2(remaining * s),
    pct,
    status,
    confirm,
  };
}

export type Totals = {
  count: number;
  closed: number;
  partial: number;
  unpaid: number;
  approved: number;
  amount: number;
  paid: number;
  paidDocs: number;
  paidLetter: number;
  approvedRub: number;
  /** Остаток без согласования и без подтверждения. */
  noneRub: number;
  closedRub: number;
  partialRub: number;
  unpaidRub: number;
  approvedStatusRub: number;
  pct: number;
};

export function totalsOf(list: InvCalc[]): Totals {
  const t: Totals = {
    count: list.length, closed: 0, partial: 0, unpaid: 0, approved: 0, amount: 0, paid: 0, paidDocs: 0, paidLetter: 0,
    approvedRub: 0, noneRub: 0, closedRub: 0, partialRub: 0, unpaidRub: 0, approvedStatusRub: 0, pct: 0,
  };
  for (const c of list) {
    t.amount += c.amount;
    t.paid += c.paid;
    t.paidDocs += c.paidDocs;
    t.paidLetter += c.paidLetter;
    t.approvedRub += c.approved;
    t.noneRub += Math.max(0, c.remaining - c.approved);
    if (c.status === "closed") { t.closed++; t.closedRub += c.amount; }
    else if (c.status === "partial") { t.partial++; t.partialRub += c.amount; }
    else if (c.status === "approved") { t.approved++; t.approvedStatusRub += c.amount; }
    else { t.unpaid++; t.unpaidRub += c.amount; }
  }
  for (const k of ["amount", "paid", "paidDocs", "paidLetter", "approvedRub", "noneRub", "closedRub", "partialRub", "unpaidRub", "approvedStatusRub"] as const) t[k] = r2(t[k]);
  t.pct = t.amount > 0 ? (t.paid / t.amount) * 100 : 0;
  return t;
}

export type YearSel = "all" | "2025" | "2026";
export const inYearSel = (y: number | null, sel: YearSel) => sel === "all" || (y != null && String(y) === sel);

/**
 * Что видно при выбранном годе. Счёт — по году даты счёта (счёт №37 без даты — по году письма).
 * Группа видна, если в ней есть счёт этого года; группа без счетов — по году аукциона/партии.
 */
export function visibleFor(sel: YearSel) {
  const invs = ALL_INVOICES.filter((i) => inYearSel(i.year, sel));
  const ids = new Set(invs.map((i) => i.id));
  const groups = ALL_GROUPS.filter((g) => {
    const has = g.invoiceIds.some((id) => ids.has(id));
    const own = ALL_INVOICES.some((i) => i.groupIds.includes(g.id));
    return has || (!own && inYearSel(g.year, sel));
  });
  return { invs, ids, groups };
}

/** Счета группы: (счёт, доля группы). Для общего счёта — доля по разнесению. */
export function groupInvoices(g: Group, ids: Set<string>): InvCalc[] {
  const out: InvCalc[] = [];
  for (const id of g.invoiceIds) {
    if (!ids.has(id)) continue;
    const inv = ALL_INVOICES.find((i) => i.id === id);
    if (!inv) continue;
    const share = inv.shares[g.id] ?? inv.amountRub;
    out.push(calcInvoice(inv, inv.amountRub > 0 ? share / inv.amountRub : 1));
  }
  return out;
}

export const BASIS_LABEL: Record<Basis, string> = {
  pp: "п/п",
  balance: "баланс",
  upd: "УПД",
  registry: "единый реестр",
  calc: "расчёт fin",
  letter: "письмо «оплачено»",
  credit: "зачёт",
};
export const CONFIRM_LABEL: Record<Confirm, string> = {
  docs: "документами",
  letter: "только письмом",
  approved: "только согласовано",
  none: "нет подтверждения",
};
export const INV_STATUS_LABEL = (c: InvCalc) =>
  c.status === "closed" ? "ЗАКРЫТ" : c.status === "partial" ? `ЧАСТИЧНО (${Math.round(c.pct)} %)` : c.status === "approved" ? "ТОЛЬКО СОГЛАСОВАН" : "НЕ ОПЛАЧЕН";

export const invLabel = (i: Invoice) => (i.no ? `№${i.no}` : "без счёта");

/** Совпадение счёта и платежа БД по docRef «…№N [от dd.mm.yyyy]». */
export function docRefNo(ref: string | null | undefined): { no: string; date: string | null } | null {
  const m = /сч[её]т[^№\n]{0,20}№\s*(\d+)(?:\s*от\s*(\d{2})\.(\d{2})\.(\d{4}))?/i.exec(ref ?? "");
  if (!m) return null;
  return { no: m[1], date: m[2] ? `${m[4]}-${m[3]}-${m[2]}` : null };
}
