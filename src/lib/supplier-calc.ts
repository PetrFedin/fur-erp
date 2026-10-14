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

export type Col = { key: string; label: string; hint?: string; width?: number; text?: boolean; def?: string };
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
  { key: "feePct", label: "аукционный сбор, %", def: "7.35", width: 80 },
  { key: "rate", label: "курс", hint: "пусто — курс из шапки", width: 80 },
  { key: "dressing", label: "выделка руб", hint: "с НДС", def: "1159", width: 80 },
  { key: "transport", label: "Транспорт на выделку и обратно", def: "20", width: 90 },
  { key: "brokerPct", label: "Брокерский %", hint: "комиссия РМ", def: "4.5", width: 80 },
  { key: "transit", label: "комиссия за транзит денег", width: 90 },
];
const SAGA_COLS: Col[] = [
  { key: "price", label: "Закупка", hint: "за шкуру в валюте счёта (EUR или USD)", width: 80 },
  { key: "feePct", label: "аукционный сбор, %", def: "9.2", width: 80 },
  { key: "feeFixed", label: "сбор + $ за шкуру", hint: "для норки 7,95 % + $0,1", width: 80 },
  { key: "packing", label: "упаковка", hint: "$", def: "0.25", width: 70 },
  { key: "brokerPct", label: "брок. %", def: "3", width: 70 },
  { key: "coef", label: "Курс EUR→USD (если счёт в евро)", hint: "колонка «курс» в файле SAGA: лоты выставлены в евро, цена $ = цена € × этот курс; для счёта в долларах — 1", def: "1.153", width: 110 },
  { key: "dressing", label: "выделка крашение стрижка", hint: "$", width: 90 },
  { key: "customs", label: "аванс на таможню вкл. услуги перевозчика", hint: "$", width: 110 },
  { key: "air", label: "Доставка ФИН-КЛД-МСК (авиа)", hint: "$", def: "1", width: 100 },
  { key: "adj", label: "корректировка", hint: "$", width: 80 },
  { key: "interestPct", label: "интерес РМ/финансирование, %", def: "4.5", width: 100 },
];
const FH_COLS: Col[] = [
  { key: "price", label: "Закупка $", width: 80 },
  { key: "feePct", label: "аукционный сбор, %", def: "8.2", width: 80 },
  { key: "packing", label: "упаковка", hint: "$", def: "11", width: 70 },
  { key: "brokerPct", label: "брокер, %", def: "3", width: 70 },
  { key: "dressingUsd", label: "выделка+покраска $", hint: "в долларах, ×курс", def: "11", width: 90 },
  { key: "base22", label: "для 22%", hint: "база НДС, ₽ за шкуру (руками)", width: 90 },
  { key: "vatPct", label: "НДС, %", def: "22", width: 60 },
  { key: "base5", label: "для 5%", hint: "база пошлины, ₽ за шкуру (руками)", width: 90 },
  { key: "dutyPct", label: "пошлина, %", def: "5", width: 70 },
  { key: "trans1", label: "Транспот до выделки", hint: "$", def: "6", width: 80 },
  { key: "trans2", label: "Транспорт Выделка-Склад", hint: "$", def: "6", width: 80 },
  { key: "commPct", label: "Комиссия РМ, %", def: "0", width: 80 },
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
  advanceDate: string; advance: string; interim: string;
  extras: ExtraExpense[];
};
export type CalcPayload = { v: 1; format: CalcFormat; header: CalcHeader; rows: CalcRow[] };

export function emptyHeader(f: CalcFormat): CalcHeader {
  return {
    auction: "", invoice: "", invoiceDate: "", seller: "", currency: "USD", cbRate: "",
    agentPct: f === "SAGA" ? "1.5" : f === "FH" ? "1.55" : "0", rateComment: "", buyer: "ММ", dest: "", broker: "", dueDate: "",
    vat: "22", advanceDate: "", advance: "", interim: "", extras: [],
  };
}
export function emptyRow(f: CalcFormat): CalcRow {
  const r: CalcRow = {};
  for (const c of columnsFor(f)) r[c.key] = c.def ?? "";
  return r;
}
export function emptyPayload(f: CalcFormat): CalcPayload {
  return { v: 1, format: f, header: emptyHeader(f), rows: [emptyRow(f)] };
}
/** Смена формата: общие поля строк сохраняются, ставки нового формата подставляются по умолчанию. */
export function switchFormat(p: CalcPayload, f: CalcFormat): CalcPayload {
  const rows = p.rows.map((r) => {
    const n = emptyRow(f);
    for (const c of columnsFor(f)) if (r[c.key] !== undefined && (LEAD.some((l) => l.key === c.key) || c.key === "price" || c.key === "upd")) n[c.key] = r[c.key];
    return n;
  });
  const h = emptyHeader(f);
  return { v: 1, format: f, header: { ...p.header, agentPct: h.agentPct }, rows };
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

export function calcRow(f: CalcFormat, h: CalcHeader, r: CalcRow, extraRub: number): RowCalc {
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

export type CalcTotals = { qty: number; totalRub: number; advance: number; interim: number; rest: number; extraRub: number; calcs: RowCalc[]; rate: number };
export function calcAll(p: CalcPayload): CalcTotals {
  const qty = p.rows.reduce((s, r) => s + n0(r.qty), 0);
  const extraRub = extraPerHide(p.header, qty);
  const calcs = p.rows.map((r) => calcRow(p.format, p.header, r, extraRub));
  const totalRub = calcs.reduce((s, c) => s + c.totalRub, 0);
  const advance = n0(p.header.advance);
  const interim = n0(p.header.interim);
  return { qty, totalRub, advance, interim, rest: totalRub - advance - interim, extraRub, calcs, rate: effectiveRate(p.header) };
}

/** Проверка перед отправкой: что обязательно заполнено. */
export function sendProblems(p: CalcPayload): string[] {
  const out: string[] = [];
  if (!p.header.auction.trim()) out.push("Укажите аукцион");
  if (!p.header.invoice.trim()) out.push("Укажите номер аукционного счёта");
  if (!(effectiveRate(p.header) > 0)) out.push("Укажите курс ЦБ");
  const rows = p.rows.filter((r) => Object.values(r).some((v) => v.trim() !== ""));
  if (rows.length === 0) out.push("Добавьте хотя бы один лот");
  const t = calcAll(p);
  t.calcs.forEach((c, i) => { if (!c.ok && p.rows[i] && Object.values(p.rows[i]).some((v) => v.trim() !== "")) out.push(`Строка ${i + 1}: ${c.problems.join(", ")}`); });
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
