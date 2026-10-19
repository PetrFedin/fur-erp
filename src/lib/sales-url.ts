// Состояние страницы «Продажи и остатки» в адресе: разбор параметров и сборка ссылки. Чистые функции.
import { NO_FILTERS, parseStruct, type Cat, type Filters, type Gran, type Struct } from "@/lib/sales-section";

export const MKEYS = ["conf", "received", "sold", "returns", "revenue", "discountSum", "discountGiven", "avgPrice", "cardPrice", "listPrice", "avgIn", "avgEx", "toCard", "priceToList", "unitCost", "markupW", "grossProfit", "grossMarginPct", "stock", "sellThrough", "coverMonths", "firstReceipt", "lastSale"] as const;
export type MKey = (typeof MKEYS)[number];
export type Tab = "overview" | "seasons" | "stock" | "top" | "orders";
export const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "Обзор" }, { key: "seasons", label: "Динамика по сезонам" }, { key: "stock", label: "Остатки" }, { key: "top", label: "Топ и аутсайдеры" }, { key: "orders", label: "Заказы" },
];
export type Mode = "total" | "seasons" | "months";
export type Ui = { f: Filters; vat: "ex" | "in"; tab: Tab; struct: Struct; tdim: "month" | "week"; mode: Mode; gran: Gran; cols: MKey[] | null };
export const DEFAULT_UI: Ui = { f: NO_FILTERS, vat: "in", tab: "overview", struct: "a", tdim: "month", mode: "total", gran: "month", cols: null };

type Sp = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const iso = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

export function parseUi(sp: Sp): Ui {
  const cat = one(sp.cat);
  const tab = one(sp.tab);
  const g = one(sp.g);
  const mode = one(sp.mode);
  const cols = (one(sp.cols) ?? "").split(",").filter((k): k is MKey => (MKEYS as readonly string[]).includes(k));
  return {
    f: { from: iso(one(sp.from)), to: iso(one(sp.to)), season: one(sp.season)?.slice(0, 20) || null, cat: (cat === "clothes" || cat === "acc" ? cat : "all") as Cat, q: (one(sp.q) ?? "").slice(0, 80) },
    vat: one(sp.vat) === "ex" ? "ex" : "in",
    tab: TABS.some((t) => t.key === tab) ? (tab as Tab) : "overview",
    struct: parseStruct(one(sp.s)),
    tdim: one(sp.td) === "week" ? "week" : "month",
    mode: mode === "seasons" || mode === "months" ? mode : "total",
    gran: g === "day" || g === "week" || g === "season" ? g : "month",
    cols: cols.length ? cols : null,
  };
}

export function uiQuery(ui: Ui): string {
  const p = new URLSearchParams();
  const d = DEFAULT_UI;
  if (ui.f.from) p.set("from", ui.f.from);
  if (ui.f.to) p.set("to", ui.f.to);
  if (ui.f.season) p.set("season", ui.f.season);
  if (ui.f.cat !== "all") p.set("cat", ui.f.cat);
  if (ui.f.q) p.set("q", ui.f.q);
  if (ui.vat !== d.vat) p.set("vat", ui.vat);
  if (ui.tab !== d.tab) p.set("tab", ui.tab);
  if (ui.struct !== d.struct) p.set("s", ui.struct);
  if (ui.tdim !== d.tdim) p.set("td", ui.tdim);
  if (ui.mode !== d.mode) p.set("mode", ui.mode);
  if (ui.gran !== d.gran) p.set("g", ui.gran);
  if (ui.cols) p.set("cols", ui.cols.join(","));
  return p.toString();
}

export const movementHref = (article: string | null, color: string | null, model: string | null) =>
  article ? `/sales/movement?a=${encodeURIComponent(article)}${color ? `&c=${encodeURIComponent(color)}` : ""}` : model ? `/sales/movement?m=${encodeURIComponent(model)}` : null;
