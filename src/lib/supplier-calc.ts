/**
 * Расчёт по лотам аукциона, который вносит поставщик (Веллмех): чистая логика без БД — работает и в браузере
 * (живой пересчёт), и в серверных действиях, и в scripts/test-supplier-calc.ts.
 * Форматы повторяют реальные файлы Веллмеха: СП/РП (соболь), SAGA (норка, свакара), Fur Harvesters (рысь).
 * СП/РП считаются через computeCostPlan — те же формулы, что в нашей закупке.
 */
import { computeCostPlan } from "@/lib/cost-plan";

export type CalcFormat = "SP_RP" | "SAGA" | "FH" | "OTHER";
export const FORMAT_LABEL: Record<CalcFormat, string> = {
  SP_RP: "Союзпушнина / Русьпушнина — соболь",
  SAGA: "SAGA — норка, свакара",
  FH: "Fur Harvesters — рысь",
  OTHER: "Другой",
};

/** Ставка, которую поставщик вводит сам в шапке расчёта (значения по умолчанию в формате НЕ подставляются). */
export type RateInfo = { label: string; ph: string; names: string[]; warn?: boolean };
export type Col = { key: string; label: string; hint?: string; width?: number; text?: boolean; rate?: RateInfo };
/** Первые семь столбцов одинаковы во всех форматах. */
const LEAD: Col[] = [
  { key: "invoice", label: "invoice", text: true, width: 70 },
  { key: "fur", label: "fur", text: true, width: 150 },
  { key: "size", label: "size / description", text: true, width: 150 },
  { key: "lot", label: "lot", text: true, width: 70 },
  { key: "qty", label: "quantity", width: 70 },
  { key: "operation", label: "operation", text: true, width: 110 },
  { key: "dest", label: "Куда", text: true, width: 80 },
];
const TAIL: Col[] = [{ key: "upd", label: "цена для УПД, ₽", hint: "вводится руками, если отличается от расчёта", width: 90 }];

const SP_COLS: Col[] = [
  { key: "price", label: "Закупка $", hint: "цена молотка за шкуру", width: 80 },
  { key: "feePct", label: "аукционный сбор, %", width: 80, rate: { label: "Ставка аукционного сбора, %", ph: "например 7,35", names: ["ставка_сбора", "сбор"] } },
  { key: "rate", label: "курс", hint: "пусто — курс из шапки", width: 80 },
  { key: "dressing", label: "выделка руб", hint: "с НДС", width: 80, rate: { label: "Выделка, ₽ за шкуру (с НДС)", ph: "например 1159", names: ["выделка"] } },
  { key: "transport", label: "Транспорт на выделку и обратно", width: 90, rate: { label: "Транспорт на выделку и обратно, ₽", ph: "например 20", names: ["транспорт"] } },
  { key: "brokerPct", label: "Брокерский %", hint: "комиссия РМ", width: 80, rate: { label: "Брокер / комиссия РМ, %", ph: "например 4,5", names: ["брокер", "комиссия_рм"] } },
  { key: "transit", label: "комиссия за транзит денег", width: 90, rate: { label: "Комиссия за транзит денег, ₽ за шкуру", ph: "если есть", names: ["транзит"], warn: false } },
];
const SAGA_COLS: Col[] = [
  { key: "price", label: "Закупка", hint: "за шкуру в валюте счёта (EUR или USD)", width: 80 },
  { key: "feePct", label: "аукционный сбор, %", width: 80, rate: { label: "Ставка аукционного сбора, %", ph: "например 9,2", names: ["ставка_сбора", "сбор"] } },
  { key: "feeFixed", label: "сбор + $ за шкуру", hint: "для норки 7,95 % + $0,1", width: 80, rate: { label: "Сбор + $ за шкуру (для норки)", ph: "например 0,1", names: ["сбор_фикс"], warn: false } },
  { key: "packing", label: "упаковка", hint: "$", width: 70, rate: { label: "Упаковка, $ за шкуру", ph: "например 0,25", names: ["упаковка"] } },
  { key: "brokerPct", label: "брок. %", width: 70, rate: { label: "Брокер, %", ph: "например 3", names: ["брокер"] } },
  { key: "coef", label: "Курс EUR→USD (если счёт в евро)", hint: "колонка «курс» в файле SAGA: лоты выставлены в евро, цена $ = цена € × этот курс; для счёта в долларах — 1", width: 110, rate: { label: "Курс EUR→USD (если счёт в евро)", ph: "например 1,153; для USD пусто", names: ["курс_eur"], warn: false } },
  { key: "dressing", label: "выделка крашение стрижка", hint: "$", width: 90 },
  { key: "customs", label: "аванс на таможню вкл. услуги перевозчика", hint: "$", width: 110 },
  { key: "air", label: "Доставка ФИН-КЛД-МСК (авиа)", hint: "$", width: 100, rate: { label: "Доставка ФИН-КЛД-МСК (авиа), $ за шкуру", ph: "например 1", names: ["авиа", "доставка"] } },
  { key: "adj", label: "корректировка", hint: "$", width: 80 },
  { key: "interestPct", label: "интерес РМ/финансирование, %", width: 100, rate: { label: "Интерес РМ / финансирование, %", ph: "например 4,5", names: ["комиссия_рм", "интерес"] } },
];
const FH_COLS: Col[] = [
  { key: "price", label: "Закупка $", width: 80 },
  { key: "feePct", label: "аукционный сбор, %", width: 80, rate: { label: "Ставка аукционного сбора, %", ph: "например 8,2", names: ["ставка_сбора", "сбор"] } },
  { key: "packing", label: "упаковка", hint: "$", width: 70, rate: { label: "Упаковка, $ за шкуру", ph: "например 11", names: ["упаковка"] } },
  { key: "brokerPct", label: "брокер, %", width: 70, rate: { label: "Брокер, %", ph: "например 3", names: ["брокер"] } },
  { key: "dressingUsd", label: "выделка+покраска $", hint: "в долларах, ×курс", width: 90, rate: { label: "Выделка + покраска, $ за шкуру", ph: "например 11", names: ["выделка"] } },
  { key: "base22", label: "для 22%", hint: "база НДС, ₽ за шкуру (руками)", width: 90 },
  { key: "vatPct", label: "НДС, %", width: 60, rate: { label: "НДС на базу «для 22%», %", ph: "например 22", names: ["ндс_база"] } },
  { key: "base5", label: "для 5%", hint: "база пошлины, ₽ за шкуру (руками)", width: 90 },
  { key: "dutyPct", label: "пошлина, %", width: 70, rate: { label: "Пошлина, %", ph: "например 5", names: ["пошлина"] } },
  { key: "trans1", label: "Транспот до выделки", hint: "$", width: 80, rate: { label: "Транспорт до выделки, $ за шкуру", ph: "например 6", names: ["транспорт1"] } },
  { key: "trans2", label: "Транспорт Выделка-Склад", hint: "$", width: 80, rate: { label: "Транспорт выделка → склад, $ за шкуру", ph: "например 6", names: ["транспорт2"] } },
  { key: "commPct", label: "Комиссия РМ, %", width: 80, rate: { label: "Комиссия РМ, %", ph: "например 0 или 2", names: ["комиссия_рм"] } },
];

export function columnsFor(f: CalcFormat): Col[] {
  return [...LEAD, ...(f === "SAGA" ? SAGA_COLS : f === "FH" ? FH_COLS : SP_COLS), ...TAIL];
}

export type CalcRow = Record<string, string>;
export type ExtraExpense = { name: string; amount: string; mode: "perHide" | "total" };
export type CalcHeader = {
  auction: string; invoice: string; invoiceDate: string; seller: string; currency: string;
  cbRate: string; agentPct: string; rateComment: string; buyer: string; dest: string; broker: string; dueDate: string;
  /** НДС на товар и услуги, % (22 с 2026 года, 20 — для 2025). */
  vat: string;
  /** Ставки, которые вводит поставщик (ключ — столбец строки: feePct, brokerPct…). Пустая ячейка строки берёт ставку отсюда. */
  rates?: Record<string, string>;
  advanceDate: string; advance: string; interim: string;
  extras: ExtraExpense[];
};
export type CalcStage = "PRELIM" | "FINAL";
export const STAGE_LABEL: Record<CalcStage, string> = { PRELIM: "Предварительный", FINAL: "Окончательный" };
export type CustomCol = { id: string; letter: string; title: string; unit: string; formula: string };
export type CalcParam = { name: string; value: string };
export type CalcPayload = {
  v: 1; format: CalcFormat; header: CalcHeader; rows: CalcRow[];
  /** Стадия расчёта; у старых расчётов нет — считаются окончательными. */
  stage?: CalcStage;
  /** Расчёт-основа (id SupplierInbox) — для окончательного это предварительный. */
  basedOnId?: string;
  customColumns?: CustomCol[];
  params?: CalcParam[];
  /** Ручные значения ячеек вычисляемых столбцов: { id строки: { id столбца: значение } }. */
  overrides?: Record<string, Record<string, string>>;
  /** Столбец, идущий в закупку как «Себестоимость за единицу, ₽» (по умолчанию встроенный «Цена за шкуру, ₽»). */
  unitCostColumn?: string;
  /** Столбец количества (по умолчанию «quantity»). */
  qtyColumn?: string;
};

/** Пустая ли строка (служебные поля, начинающиеся с «_», не в счёт). */
export const rowFilled = (r: CalcRow) => Object.entries(r).some(([k, v]) => !k.startsWith("_") && v.trim() !== "");
let idSeq = 0;
export const newId = (p = "r") => `${p}${Date.now().toString(36)}${(idSeq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;
/** Каждой строке — постоянный id (нужен для ручных значений); старые расчёты получают его при открытии. */
export function ensureRowIds(p: CalcPayload): CalcPayload {
  if (p.rows.every((r) => r._id)) return p;
  return { ...p, rows: p.rows.map((r) => (r._id ? r : { ...r, _id: newId() })) };
}

/** Ставки формата, которые вводятся в шапке. */
export function rateCols(f: CalcFormat): Col[] {
  return columnsFor(f).filter((c) => c.rate);
}
/** Значение ставки из шапки (пусто → не введена). */
export const headerRate = (h: CalcHeader, key: string) => (h.rates?.[key] ?? "").trim();
/** Строка с подставленными из шапки ставками (ячейка пуста → ставка шапки). */
export function resolveRow(f: CalcFormat, h: CalcHeader, r: CalcRow): CalcRow {
  const o: CalcRow = { ...r };
  for (const c of rateCols(f)) if ((o[c.key] ?? "").trim() === "" && headerRate(h, c.key) !== "") o[c.key] = headerRate(h, c.key);
  return o;
}
/** Ставки, которые не указаны ни в шапке, ни в строках → считаются как 0 (предупреждение перед отправкой). */
export function missingRates(p: CalcPayload): string[] {
  const used = p.rows.filter(rowFilled);
  return rateCols(p.format)
    .filter((c) => c.rate!.warn !== false && headerRate(p.header, c.key) === "" && used.some((r) => (r[c.key] ?? "").trim() === ""))
    .map((c) => c.rate!.label);
}

export function emptyHeader(f: CalcFormat): CalcHeader {
  return {
    auction: "", invoice: "", invoiceDate: "", seller: "", currency: "USD", cbRate: "",
    agentPct: "", rateComment: "", buyer: "ММ", dest: "", broker: "", dueDate: "",
    vat: "22", rates: {}, advanceDate: "", advance: "", interim: "", extras: [],
  };
}
export function emptyRow(f: CalcFormat): CalcRow {
  const r: CalcRow = {};
  for (const c of columnsFor(f)) r[c.key] = "";
  return r;
}
export function emptyPayload(f: CalcFormat): CalcPayload {
  return { v: 1, format: f, header: emptyHeader(f), rows: [{ ...emptyRow(f), _id: newId() }], stage: "FINAL" };
}
/** Смена формата: общие поля строк сохраняются, ставки нового формата подставляются по умолчанию. */
export function switchFormat(p: CalcPayload, f: CalcFormat): CalcPayload {
  const rows = p.rows.map((r) => {
    const n = emptyRow(f);
    for (const c of columnsFor(f)) if (r[c.key] !== undefined && (LEAD.some((l) => l.key === c.key) || c.key === "price" || c.key === "upd")) n[c.key] = r[c.key];
    if (r._id) n._id = r._id;
    return n;
  });
  return { ...p, format: f, rows };
}

/** Безопасный разбор числа или простой формулы из ячейки: «6,8*1,156», «(3,9+6)*1,156+250/91,89». Пусто/мусор → NaN. */
export function evalNum(s: string | undefined | null): number {
  if (s == null) return NaN;
  const t = String(s).replace(/[\s  ]/g, "").replace(/[₽$%]/g, "").replace(/,/g, ".").replace(/^=/, "");
  if (t === "" || !/^[0-9.+\-*/()]+$/.test(t)) return NaN;
  let i = 0;
  const peek = () => t[i];
  function expr(): number {
    let v = term();
    while (peek() === "+" || peek() === "-") { const o = t[i++]; const r = term(); v = o === "+" ? v + r : v - r; }
    return v;
  }
  function term(): number {
    let v = factor();
    while (peek() === "*" || peek() === "/") { const o = t[i++]; const r = factor(); v = o === "*" ? v * r : v / r; }
    return v;
  }
  function factor(): number {
    if (peek() === "-") { i++; return -factor(); }
    if (peek() === "+") { i++; return factor(); }
    if (peek() === "(") { i++; const v = expr(); if (peek() !== ")") return NaN; i++; return v; }
    const m = /^\d+\.?\d*|^\.\d+/.exec(t.slice(i));
    if (!m) return NaN;
    i += m[0].length;
    return Number(m[0]);
  }
  const v = expr();
  return i === t.length && Number.isFinite(v) ? v : NaN;
}
const n0 = (s: string | undefined) => { const v = evalNum(s); return Number.isFinite(v) ? v : 0; };
const filled = (s: string | undefined) => (s ?? "").trim() !== "";

/** Курс для расчёта: курс ЦБ на дату счёта + надбавка агента, %. */
export function effectiveRate(h: CalcHeader): number {
  return n0(h.cbRate) * (1 + n0(h.agentPct) / 100);
}

export type RowCalc = { ok: boolean; problems: string[]; unitRub: number; totalRub: number; unitUsd: number | null; parts: { label: string; value: number }[]; extraRub: number };

/** Расходы на весь счёт и прочие расходы на шкуру → ₽ на одну шкуру (суммы «на весь счёт» делятся на все шкуры). */
export function extraPerHide(h: CalcHeader, totalQty: number): number {
  let s = 0;
  for (const e of h.extras) {
    const a = n0(e.amount);
    s += e.mode === "total" ? (totalQty > 0 ? a / totalQty : 0) : a;
  }
  return s;
}

export function calcRow(f: CalcFormat, h: CalcHeader, raw: CalcRow, extraRub: number): RowCalc {
  const r = resolveRow(f, h, raw);
  const problems: string[] = [];
  const qty = n0(r.qty);
  const price = n0(r.price);
  if (!(qty > 0)) problems.push("нет количества");
  if (!(price > 0)) problems.push("нет цены");
  const rate = filled(r.rate) && f !== "SAGA" && f !== "FH" ? n0(r.rate) : effectiveRate(h);
  if (!(rate > 0)) problems.push("нет курса");
  const vat = filled(h.vat) ? n0(h.vat) : 22;
  const parts: { label: string; value: number }[] = [];
  let unit = 0;
  let unitUsd: number | null = null;
  if (f === "SAGA") {
    const fee = price * (n0(r.feePct) / 100) + n0(r.feeFixed);
    const broker = price * (n0(r.brokerPct) / 100);
    const coef = filled(r.coef) ? n0(r.coef) : 1;
    const interest = price * (n0(r.interestPct) / 100) * coef;
    const usd = (price + fee + n0(r.packing) + broker) * coef + interest + n0(r.dressing) + n0(r.adj) + n0(r.customs) + n0(r.air);
    unitUsd = usd;
    unit = usd * rate;
    parts.push({ label: "Цена $ за шкуру", value: usd }, { label: "Курс для расчёта", value: rate });
  } else if (f === "FH") {
    const goods = price * rate;
    const fee = price * (n0(r.feePct) / 100) * rate;
    const pack = n0(r.packing) * rate;
    const broker = price * (n0(r.brokerPct) / 100) * rate;
    const dress = n0(r.dressingUsd) * rate;
    const vatSum = n0(r.base22) * (n0(r.vatPct) / 100);
    const duty = n0(r.base5) * (n0(r.dutyPct) / 100);
    const tr = (n0(r.trans1) + n0(r.trans2)) * rate;
    const comm = goods * (n0(r.commPct) / 100);
    unit = goods + fee + pack + broker + dress + vatSum + duty + tr + comm;
    parts.push({ label: "Цена по курсу, ₽", value: goods }, { label: "Сбор аукциона, ₽", value: fee }, { label: "НДС, ₽", value: vatSum }, { label: "Пошлина, ₽", value: duty });
  } else {
    const c = computeCostPlan({
      quantity: qty, price, rate, feePct: n0(r.feePct), dressing: n0(r.dressing), transport: n0(r.transport),
      brokerPct: n0(r.brokerPct), transit: n0(r.transit), vat, serviceVatPct: vat,
    });
    unit = c.unitIncl;
    parts.push(
      { label: "Цена по курсу, ₽", value: c.goods }, { label: "Аукционный сбор, ₽", value: c.fee }, { label: "НДС на сбор, ₽", value: c.feeVat },
      { label: "НДС на товар, ₽", value: c.goodsVat }, { label: "Комиссия РМ, ₽", value: c.broker },
    );
  }
  unit += extraRub;
  return { ok: problems.length === 0, problems, unitRub: unit, totalRub: unit * qty, unitUsd, parts, extraRub };
}

export type CalcTotals = { qtys: number[]; qty: number; totalRub: number; advance: number; interim: number; rest: number; extraRub: number; calcs: RowCalc[]; rate: number };
export function calcAll(p: CalcPayload): CalcTotals {
  const qty = p.rows.reduce((s, r) => s + n0(r.qty), 0);
  const extraRub = extraPerHide(p.header, qty);
  const calcs = p.rows.map((r) => calcRow(p.format, p.header, r, extraRub));
  const totalRub = calcs.reduce((s, c) => s + c.totalRub, 0);
  const advance = n0(p.header.advance);
  const interim = n0(p.header.interim);
  return { qtys: p.rows.map((r) => n0(r.qty)), qty, totalRub, advance, interim, rest: totalRub - advance - interim, extraRub, calcs, rate: effectiveRate(p.header) };
}

/** Проверка перед отправкой: что обязательно заполнено. */
export function sendProblems(p: CalcPayload): string[] {
  const out: string[] = [];
  if (!p.header.auction.trim()) out.push("Укажите аукцион");
  if (!p.header.invoice.trim()) out.push("Укажите номер аукционного счёта");
  if (!(effectiveRate(p.header) > 0)) out.push("Укажите курс ЦБ");
  const rows = p.rows.filter(rowFilled);
  if (rows.length === 0) out.push("Добавьте хотя бы один лот");
  const t = calcAll(p);
  t.calcs.forEach((c, i) => { if (!c.ok && p.rows[i] && rowFilled(p.rows[i])) out.push(`Строка ${i + 1}: ${c.problems.join(", ")}`); });
  return out;
}

const TOTAL_RE = /^(итого|всего|total)/i;
const head = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();

/**
 * Реальный файл Веллмеха (таблица ячеек) → черновик расчёта. Формат определяется по шапке; проценты считаются
 * из рублёвых сумм файла (сбор / (цена×курс)), поэтому расчёт даёт те же цифры. Ничего не сохраняет.
 */
export function payloadFromTable(table: string[][]): { payload: CalcPayload; warnings: string[] } | { error: string } {
  let hi = -1;
  for (let i = 0; i < Math.min(table.length, 15); i++) {
    const hs = table[i].map(head);
    if (hs.some((h) => h.startsWith("invoice")) && hs.some((h) => h === "lot" || h.startsWith("lot")) && hs.some((h) => h.startsWith("quantity"))) { hi = i; break; }
  }
  if (hi < 0) return { error: "Не нашёл шапку расчёта (столбцы invoice, lot, quantity). Проверьте, что это расчёт по лотам." };
  const H = table[hi].map(head);
  const col = (re: RegExp, from = 0) => { for (let c = from; c < H.length; c++) if (re.test(H[c])) return c; return -1; };
  const isSaga = col(/упаковка/) >= 0 && col(/брок\.? ?%/) >= 0 && col(/^курс/) >= 0 && col(/интерес/) >= 0;
  const isFh = col(/^grade/) >= 0 || col(/для 5/) >= 0 || col(/пошлин/) >= 0;
  const format: CalcFormat = isSaga ? "SAGA" : isFh ? "FH" : "SP_RP";
  const warnings: string[] = [];
  const payload = emptyPayload(format);
  const g = (row: string[], c: number) => (c >= 0 ? (row[c] ?? "").replace(/[\r\n]+/g, " ").trim() : "");
  const x = (row: string[], c: number) => evalNum(g(row, c));
  const pct = (sum: number, base: number) => (Number.isFinite(sum) && base > 0 ? String(Math.round((sum / base) * 100 * 1e6) / 1e6) : "");
  const num = (v: number) => (Number.isFinite(v) ? String(Math.round(v * 1e6) / 1e6) : "");
  // Название аукциона из строк над шапкой: «СОЮЗПУШНИНА 09-26 (…)», «SAGA 03-26», «FH 06-26».
  for (let i = 0; i < hi; i++) for (const cell of table[i]) {
    const m = /(\S*\s?\d{2}-\d{2,4})/.exec(cell ?? "");
    if (m && !payload.header.auction) payload.header.auction = cell.replace(/\(.*$/, "").trim();
  }
  const cInv = col(/^invoice/), cFur = col(/^fur/), cSize = col(/^size|^description/), cLot = col(/^lot/), cQty = col(/^quantity/);
  const cOp = col(/^operation/), cDest = col(/^куда/), cPrice = isSaga ? col(/^закупка/) : col(/^закупка/);
  const cFee = col(/аукционный сбор/);
  const rows: CalcRow[] = [];
  const header: CalcHeader = payload.header;
  for (const raw of table.slice(hi + 1)) {
    const first = (raw.find((c) => c.trim() !== "") ?? "").trim();
    if (!first) continue;
    if (TOTAL_RE.test(first)) continue;
    const qty = x(raw, cQty), price = x(raw, cPrice);
    if (!Number.isFinite(qty) || !Number.isFinite(price)) continue;
    const r = emptyRow(format);
    r._id = newId();
    r.invoice = g(raw, cInv); r.fur = g(raw, cFur); r.size = [g(raw, col(/^grade/)), g(raw, col(/^color|^цвет/)), g(raw, cSize)].filter(Boolean).join(" "); r.lot = g(raw, cLot);
    // В файлах SAGA столбец перед «fur» без заголовка — это сам мех, а «fur» — описание.
    if (format === "SAGA" && cFur > 0 && H[cFur - 1] === "" && g(raw, cFur - 1)) { r.size = [g(raw, cFur), g(raw, cSize)].filter(Boolean).join(" "); r.fur = g(raw, cFur - 1); }
    r.qty = num(qty); r.operation = g(raw, cOp); r.dest = g(raw, cDest); r.price = num(price);
    if (format === "SAGA") {
      const coef = x(raw, col(/^курс/)) || 1;
      r.feePct = pct(x(raw, cFee), price); r.feeFixed = "0"; r.packing = num(x(raw, col(/упаковка/)));
      r.brokerPct = pct(x(raw, col(/брок/)), price); r.coef = num(coef);
      r.dressing = num(x(raw, col(/^выделка/))); r.customs = num(x(raw, col(/аванс на таможню|ндс 22%\+tax/)));
      r.air = num(x(raw, col(/доставка/))); r.adj = num(x(raw, col(/корректировка/)));
      r.interestPct = pct(x(raw, col(/интерес/)), price * coef);
      for (const k of ["packing", "dressing", "customs", "air", "adj"]) if (r[k] === "") r[k] = "0";
      if (!header.cbRate) { const u = x(raw, col(/курс цб|расчетный курс/)); if (Number.isFinite(u)) { header.cbRate = num(u); header.agentPct = "0"; header.rateComment = g(table[hi], col(/курс цб|расчетный курс/)); } }
    } else if (format === "FH") {
      const rate = x(raw, col(/^курс/));
      r.feePct = pct(x(raw, cFee), price * rate); r.packing = num(x(raw, col(/упаковка/))); r.brokerPct = pct(x(raw, col(/брок/)), price * rate);
      r.dressingUsd = rate > 0 ? num(x(raw, col(/выделка/)) / rate) : "";
      r.base22 = num(x(raw, col(/для 22/))); r.base5 = num(x(raw, col(/для 5/)));
      r.trans1 = rate > 0 ? num(x(raw, col(/до выделки/)) / rate) : ""; r.trans2 = rate > 0 ? num(x(raw, col(/выделка-склад/)) / rate) : "";
      const comm = x(raw, col(/комиссия рм/));
      r.commPct = Number.isFinite(comm) ? pct(comm, price * rate) : "0";
      if (!header.cbRate && rate > 0) { header.cbRate = num(rate); header.agentPct = "0"; header.rateComment = g(table[hi], col(/^курс/)); }
      for (const k of ["packing", "dressingUsd", "base22", "base5", "trans1", "trans2"]) if (r[k] === "") r[k] = "0";
    } else {
      const rate = x(raw, col(/^курс/));
      const base = price * rate;
      r.rate = num(rate);
      // СП: сбор и «НДС на услуги СП» — отдельные столбцы; РП: сбор уже с НДС 22 % внутри формулы (J = цена×7,85 %×курс×1,22).
      const feeIncl = col(/ндс на услуги/) < 0;
      r.feePct = feeIncl && Number.isFinite(x(raw, cFee)) ? String(Math.round((x(raw, cFee) / base / 1.22) * 100 * 1e6) / 1e6) : pct(x(raw, cFee), base);
      r.dressing = num(x(raw, col(/^выделка/))); r.transport = num(x(raw, col(/^транспорт/)));
      r.brokerPct = pct(x(raw, col(/^брокерский/)), base) || pct(x(raw, col(/комиссия рм/)), base);
      r.transit = num(x(raw, col(/транзит/)));
      const vsum = x(raw, col(/^ндс 2/));
      if (base > 0 && Number.isFinite(vsum) && !header.vat.startsWith("#")) header.vat = String(Math.round((vsum / base) * 100 * 1e4) / 1e4);
      if (!header.cbRate && rate > 0) { header.cbRate = num(rate); header.agentPct = "0"; }
      for (const k of ["feePct", "dressing", "transport", "brokerPct", "transit"]) if (r[k] === "") r[k] = "0";
    }
    if (r.invoice && !header.invoice) header.invoice = r.invoice;
    rows.push(r);
  }
  if (rows.length === 0) return { error: "В файле не нашлось строк лотов (нужны количество и цена)." };
  payload.rows = rows;
  payload.header = header;
  if (header.vat === "" || !Number.isFinite(evalNum(header.vat))) header.vat = "22";
  warnings.push(`Распознан формат «${FORMAT_LABEL[format]}», строк: ${rows.length}. Проверьте шапку и ставки — они взяты из сумм файла.`);
  return { payload, warnings };
}
