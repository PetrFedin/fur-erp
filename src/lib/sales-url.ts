// Состояние страницы «Продажи и остатки» в адресе: разбор параметров и сборка ссылки. Чистые функции.
import { NO_FILTERS, parseStruct, type Cat, type Filters, type Gran, type Struct } from "@/lib/sales-section";

export const MKEYS = ["conf", "received", "sold", "returns", "revenue", "revenueEur", "discountSum", "discountGiven", "avgPrice", "avgPriceEur", "grossRev", "priceBefore", "listPrice", "priceToList", "unitCost", "markupW", "grossProfit", "grossMarginPct", "stock", "sellThrough", "coverMonths", "firstReceipt", "lastSale"] as const;
export type MKey = (typeof MKEYS)[number];
export type Tab = "overview" | "seasons" | "stock" | "top";
export const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "Обзор" }, { key: "seasons", label: "Динамика по сезонам" }, { key: "stock", label: "Остатки" }, { key: "top", label: "Топ и аутсайдеры" },
];
export type Ui = { f: Filters; vat: "ex" | "in"; tab: Tab; struct: Struct; gran: Gran; cols: MKey[] | null; chain: boolean };
export const DEFAULT_UI: Ui = { f: NO_FILTERS, vat: "in", tab: "overview", struct: "b", gran: "month", cols: null, chain: false };

type Sp = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const list = (v: string | string[] | undefined) => (one(v) ?? "").split("|").map((x) => x.trim()).filter(Boolean).slice(0, 30);
const iso = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

export function parseUi(sp: Sp): Ui {
  const cat = one(sp.cat);
  const tab = one(sp.tab);
  const g = one(sp.g);
  const cols = (one(sp.cols) ?? "").split(",").filter((k): k is MKey => (MKEYS as readonly string[]).includes(k));
  return {
    f: { from: iso(one(sp.from)), to: iso(one(sp.to)), seasons: list(sp.season), cat2: list(sp.c2), furs: list(sp.fur), cat: (cat === "clothes" || cat === "acc" ? cat : "all") as Cat, q: (one(sp.q) ?? "").slice(0, 80) },
    vat: one(sp.vat) === "ex" ? "ex" : "in",
    tab: TABS.some((t) => t.key === tab) ? (tab as Tab) : "overview",
    struct: parseStruct(one(sp.s)),
    gran: g === "season" ? "season" : "month",
    cols: cols.length ? cols : null,
    chain: one(sp.chain) === "1",
  };
}

export function uiQuery(ui: Ui): string {
  const p = new URLSearchParams();
  const d = DEFAULT_UI;
  if (ui.f.from) p.set("from", ui.f.from);
  if (ui.f.to) p.set("to", ui.f.to);
  if (ui.f.seasons.length) p.set("season", ui.f.seasons.join("|"));
  if (ui.f.cat2.length) p.set("c2", ui.f.cat2.join("|"));
  if (ui.f.furs.length) p.set("fur", ui.f.furs.join("|"));
  if (ui.f.cat !== "all") p.set("cat", ui.f.cat);
  if (ui.f.q) p.set("q", ui.f.q);
  if (ui.vat !== d.vat) p.set("vat", ui.vat);
  if (ui.tab !== d.tab) p.set("tab", ui.tab);
  if (ui.struct !== d.struct) p.set("s", ui.struct);
  if (ui.gran !== d.gran) p.set("g", ui.gran);
  if (ui.chain) p.set("chain", "1");
  if (ui.cols) p.set("cols", ui.cols.join(","));
  return p.toString();
}

export const movementHref = (article: string | null, color: string | null, model: string | null) =>
  article ? `/sales/movement?a=${encodeURIComponent(article)}${color ? `&c=${encodeURIComponent(color)}` : ""}` : model ? `/sales/movement?m=${encodeURIComponent(model)}` : null;
