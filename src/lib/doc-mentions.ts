import "server-only";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { formatDate, formatMoney } from "@/lib/utils";

/**
 * «Где упомянута оплата» и «какие документы названы в папке Drive «мех»» — из инвентаризации docs-inventory
 * (chain-p2025.json, chain-p2026.json, chain-production.json). Только чтение; нет файла — пусто (панель всё равно работает по базе).
 * Ничего не выдумываем: берём только то, что в JSON названо документом.
 */

export type MentionDocKind = "AUCTION_INVOICE" | "PAYMENT_INVOICE" | "UPD" | "SPECIFICATION" | "CALC_SHEET" | "TZ_APPENDIX" | "APPROVAL_EMAIL";

export type MentionDoc = {
  kind: MentionDocKind;
  no: string | null;
  date: string | null;
  amountRub: number | null;
  title: string | null;
  fileId: string | null;
};

export type MentionPay = { date: string | null; amountRub: number | null; ppNo: string | null; forInvoiceNo: string | null; source: string };

export type Mentions = { group: string; docs: MentionDoc[]; payments: MentionPay[] };

type Raw = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

let cache: { auctions: Map<string, Mentions>; batches: Map<number, Mentions> } | null = null;

function readJson(name: string): Raw | null {
  try {
    const p = path.join(process.cwd(), "docs-inventory", name);
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, "utf8")) as Raw;
  } catch {
    return null;
  }
}

const AUCTION_SECTIONS: [string, MentionDocKind][] = [
  ["auctionInvoices", "AUCTION_INVOICE"],
  ["wellmechInvoices", "PAYMENT_INVOICE"],
  ["upd", "UPD"],
  ["specs", "SPECIFICATION"],
  ["calcs", "CALC_SHEET"],
];
const PRODUCTION_SECTIONS: [string, MentionDocKind][] = [
  ["tzAppendices", "TZ_APPENDIX"],
  ["calcs", "CALC_SHEET"],
  ["invoices", "PAYMENT_INVOICE"],
  ["upd", "UPD"],
  ["letters", "APPROVAL_EMAIL"],
];

function readDocs(documents: unknown, sections: [string, MentionDocKind][]): MentionDoc[] {
  const out: MentionDoc[] = [];
  const d = (documents ?? {}) as Raw;
  for (const [key, kind] of sections) {
    const list = d[key];
    if (!Array.isArray(list)) continue;
    for (const x of list as Raw[]) {
      out.push({ kind, no: str(x.no), date: str(x.date), amountRub: num(x.amountRub), title: str(x.title), fileId: str(x.fileId) });
    }
  }
  return out;
}

function readPays(list: unknown): MentionPay[] {
  if (!Array.isArray(list)) return [];
  return (list as Raw[]).map((x) => ({
    date: str(x.date),
    amountRub: num(x.amountRub),
    ppNo: str(x.ppNo),
    forInvoiceNo: str(x.forInvoiceNo ?? x.invoice),
    source: str(x.source) ?? "документы Drive",
  }));
}

function load() {
  if (cache) return cache;
  const auctions = new Map<string, Mentions>();
  const batches = new Map<number, Mentions>();
  for (const f of ["chain-p2025.json", "chain-p2026.json"]) {
    const j = readJson(f);
    const groups = Array.isArray(j?.groups) ? (j!.groups as Raw[]) : [];
    for (const g of groups) {
      const name = str(g.dbAuction);
      if (!name) continue;
      const m: Mentions = { group: str(g.key) ?? name, docs: readDocs(g.documents, AUCTION_SECTIONS), payments: readPays(g.paymentsByDocs) };
      const prev = auctions.get(name);
      // Несколько групп на один аукцион (например «Нет информации») не склеиваем: их суммы не относятся к аукциону целиком.
      if (prev) {
        prev.docs.push(...m.docs);
        prev.payments.push(...m.payments);
      } else auctions.set(name, m);
    }
  }
  const prod = readJson("chain-production.json");
  const pg = Array.isArray(prod?.groups) ? (prod!.groups as Raw[]) : [];
  for (const g of pg) {
    const n = num(g.batchNumber);
    if (n == null) continue;
    batches.set(n, { group: str(g.key) ?? `Партия ${n}`, docs: readDocs(g.documents, PRODUCTION_SECTIONS), payments: readPays(g.paymentsByDocs) });
  }
  cache = { auctions, batches };
  return cache;
}

export const auctionMentions = (name: string): Mentions | null => load().auctions.get(name) ?? null;
export const batchMentions = (n: number): Mentions | null => load().batches.get(n) ?? null;

/** «счёт №93 от 25.03.2026 (24 200 000 ₽)» */
export function mentionDocText(d: MentionDoc): string {
  const what: Record<MentionDocKind, string> = {
    AUCTION_INVOICE: "счёт аукциона",
    PAYMENT_INVOICE: "счёт Веллмех",
    UPD: "УПД",
    SPECIFICATION: "спецификация",
    CALC_SHEET: "расчёт",
    TZ_APPENDIX: "приложение к ТЗ",
    APPROVAL_EMAIL: "письмо",
  };
  const date = d.date && /^\d{4}-\d{2}-\d{2}$/.test(d.date) ? ` от ${formatDate(d.date)}` : "";
  return `${what[d.kind]}${d.no ? ` №${d.no}` : d.title ? ` «${d.title}»` : ""}${date}${d.amountRub ? ` (${formatMoney(d.amountRub)})` : ""}`;
}

export function mentionPayText(p: MentionPay): string {
  const date = p.date && /^\d{4}-\d{2}-\d{2}$/.test(p.date) ? formatDate(p.date) : p.date;
  return [
    p.forInvoiceNo ? `оплата по счёту №${p.forInvoiceNo}` : "оплата",
    date ? `от ${date}` : null,
    p.amountRub ? formatMoney(p.amountRub) : null,
    p.ppNo ? `п/п ${p.ppNo}` : null,
    `— ${p.source}`,
  ]
    .filter(Boolean)
    .join(" ");
}

export const driveFileUrl = (fileId: string) => `https://drive.google.com/file/d/${fileId}/view`;
