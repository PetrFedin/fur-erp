import { computeCostPlan } from "@/lib/cost-plan";
import { cellRef, colLetter } from "@/lib/calc-formula";
import { type CalcFormat, type CalcRow, type CalcHeader, type CalcStage, type ColRule, type CalcPayload, evalNum, n0, type RowCalc, type SheetCol } from "./shared";

export const FORMAT_LABEL: Record<CalcFormat, string> = {
  SP_RP: "Союзпушнина / Русьпушнина — соболь",
  SAGA: "SAGA — норка, свакара",
  FH: "Fur Harvesters — рысь",
  OTHER: "Другой",
  SHEET: "Своя таблица (столбцы и формулы)",
};

/** Ставка, которую поставщик вводит сам в шапке расчёта (значения по умолчанию в формате НЕ подставляются). */
export type RateInfo = { label: string; ph: string; names: string[]; warn?: boolean };

export type Col = { key: string; label: string; hint?: string; width?: number; text?: boolean; rate?: RateInfo };

/** Первые семь столбцов одинаковы во всех форматах. */
const LEAD: Col[] = [
  { key: "invoice", label: "№ счёта", text: true, width: 70 },
  { key: "fur", label: "Мех", text: true, width: 150 },
  { key: "size", label: "Описание / размер", text: true, width: 150 },
  { key: "lot", label: "Лот", text: true, width: 70 },
  { key: "qty", label: "Кол-во", width: 70 },
  { key: "operation", label: "Операция", text: true, width: 110 },
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

/** Свободная таблица: из встроенных только описание лота, остальные столбцы — свои (customColumns). */
const SHEET_COLS: Col[] = [
  { key: "fur", label: "Мех", text: true, width: 110 },
  { key: "size", label: "Описание / размер", text: true, width: 130 },
  { key: "lot", label: "Лот", text: true, width: 70 },
];

export function columnsFor(f: CalcFormat): Col[] {
  if (f === "SHEET") return SHEET_COLS;
  return [...LEAD, ...(f === "SAGA" ? SAGA_COLS : f === "FH" ? FH_COLS : SP_COLS), ...TAIL];
}

export const STAGE_LABEL: Record<CalcStage, string> = { PRELIM: "Предварительный", FINAL: "Окончательный" };

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

/** Год аукциона расчёта: выбранный → из названия («СП 09-26» → 2026) → из даты счёта; иначе null. */
export function calcYear(h: Pick<CalcHeader, "auction" | "year" | "invoiceDate">): number | null {
  const y = Number((h.year ?? "").trim());
  if (Number.isInteger(y) && y >= 2000 && y <= 2100) return y;
  const m = /(\d{1,2})[-.](\d{2})\s*(?:\(.*)?$/.exec((h.auction ?? "").trim());
  if (m) return 2000 + Number(m[2]);
  const d = /^(\d{4})-\d{2}-\d{2}$/.exec(h.invoiceDate ?? "");
  return d ? Number(d[1]) : null;
}

/** Месяц из названия аукциона «СП 09-26» → «09»; иначе «01». */
export function calcMonth(h: Pick<CalcHeader, "auction">): string {
  const m = /(\d{1,2})[-.]\d{2}\s*(?:\(.*)?$/.exec((h.auction ?? "").trim());
  return m && Number(m[1]) >= 1 && Number(m[1]) <= 12 ? m[1].padStart(2, "0") : "01";
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

const filled = (s: string | undefined) => (s ?? "").trim() !== "";

/** Курс для расчёта: курс ЦБ на дату счёта + надбавка агента, %. */
export function effectiveRate(h: CalcHeader): number {
  return n0(h.cbRate) * (1 + n0(h.agentPct) / 100);
}

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

export const UNIT_COL = "unit";

export const QTY_COL = "qty";

/** Столбцы таблицы: ввод формата → вычисляемые встроенные → свои. Букву получает каждый по порядку. */
export function sheetColumns(p: CalcPayload): SheetCol[] {
  const out: SheetCol[] = columnsFor(p.format).map((c) => ({ id: c.key, letter: "", title: c.label, kind: "input" as const, text: c.text, hint: c.hint }));
  if (p.format !== "SHEET") {
    out.push({ id: UNIT_COL, letter: "", title: "Цена за шкуру, ₽", kind: "calc", unit: "₽" });
    if (p.format === "SAGA") out.push({ id: "unitUsd", letter: "", title: "Цена за шкуру, $", kind: "calc", unit: "$" });
    out.push({ id: "total", letter: "", title: "Сумма, ₽", kind: "calc", unit: "₽" });
  }
  for (const c of p.customColumns ?? []) {
    if (c.kind === "input") out.push({ id: c.id, letter: "", title: c.title || "Новый столбец", kind: "input", unit: c.unit, text: c.text, userInput: true });
    else out.push({ id: c.id, letter: "", title: c.title || "Новый столбец", kind: "custom", unit: c.unit, formula: c.formula, rules: c.rules });
  }
  out.forEach((c, i) => { c.letter = colLetter(i); });
  return out;
}

/** Имя параметра для формул: без регистра, «ё»=«е», пробелы → «_». */
export const paramKey = (n: string) => n.trim().toLowerCase().replace(/ё/g, "е").replace(/\s+/g, "_");

/** Имя параметра допустимо: буквы/цифры/_ , не начинается с цифры и не совпадает с именем столбца (A, AB). */
export function paramNameProblem(name: string, taken: string[]): string | null {
  const k = paramKey(name);
  if (!k) return "Укажите имя параметра";
  if (!/^[\p{L}_][\p{L}\p{N}_]*$/u.test(k)) return "Имя: буквы, цифры и «_», без пробелов, не с цифры";
  if (/^[a-z]{1,3}$/.test(k)) return "Имя из 1–3 латинских букв занято под столбцы (A, B, AA…) — выберите другое";
  if (/^(round|min|max|if|sum|abs|average|subtotal|округл|мин|макс|если|сумм|срзнач)$/.test(k)) return "Имя совпадает с функцией";
  if (cellRef(k)) return "Имя похоже на адрес ячейки (H3) — выберите другое";
  if (taken.map(paramKey).includes(k)) return "Параметр с таким именем уже есть";
  return null;
}

/** Именованные параметры шапки: курс, ставки формата (ставка_сбора, брокер, комиссия_рм…) и свои. Значение — число либо текст ошибки. */
export function paramValues(p: CalcPayload): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  out["курс"] = effectiveRate(p.header);
  out["ндс"] = filled(p.header.vat) ? n0(p.header.vat) : 22;
  for (const c of rateCols(p.format)) for (const nm of c.rate!.names) out[paramKey(nm)] = n0(headerRate(p.header, c.key));
  for (const q of p.params ?? []) {
    if (!q.name.trim()) continue;
    const v = evalNum(q.value);
    out[paramKey(q.name)] = filled(q.value) && !Number.isFinite(v) ? `параметр «${q.name}»: значение не число` : Number.isFinite(v) ? v : 0;
  }
  return out;
}

/** Имена параметров для подсказки в интерфейсе: [имя, значение/пояснение]. */
export function paramList(p: CalcPayload): { name: string; label: string; own: boolean }[] {
  const out: { name: string; label: string; own: boolean }[] = [{ name: "курс", label: "Курс для расчёта", own: false }, { name: "ндс", label: "НДС, %", own: false }];
  const seen = new Set(out.map((o) => o.name));
  for (const c of rateCols(p.format)) for (const nm of c.rate!.names) if (!seen.has(paramKey(nm))) { seen.add(paramKey(nm)); out.push({ name: paramKey(nm), label: c.rate!.label, own: false }); }
  for (const q of p.params ?? []) if (q.name.trim() && !seen.has(paramKey(q.name))) { seen.add(paramKey(q.name)); out.push({ name: paramKey(q.name), label: "Свой параметр", own: true }); }
  return out;
}

/**
 * НДС расчёта, % — одно значение для обеих сторон (кабинет Веллмеха, проверка у заказчика, сверка).
 * В «своей таблице» (SHEET) шапка НДС не используется: ставка живёт в параметре («ндс», «ндс_проц»…), поэтому берём его (нет параметра — ставка не указана);
 * в остальных форматах — поле шапки. Пусто — null (не указан).
 */
export function calcVatPct(p: CalcPayload): number | null {
  if (p.format === "SHEET") {
    for (const q of p.params ?? []) {
      if (/^ндс/.test(paramKey(q.name))) { const v = evalNum(q.value); if (Number.isFinite(v)) return v; }
    }
    return null; // ставки НДС в таблице нет: «22» в шапке — значение по умолчанию, а не введённое поставщиком
  }
  const v = evalNum(p.header.vat);
  return Number.isFinite(v) ? v : null;
}

/** Номер лота для сопоставления «лот Веллмеха ↔ лот заказчика»: у заказчика бывает приставка аукциона («FW26-30», «СП0926-4») или суффикс («1498-1») при совпадении номеров у разных аукционов. */
export function lotKey(s: string | null | undefined): string {
  const t = (s ?? "").trim().toLowerCase().replace(/ё/g, "е").replace(/\s+/g, "");
  const m = /^[a-zа-я]+\d*-(\d+)$/.exec(t) ?? /^(\d+)-\d{1,2}$/.exec(t);
  return m ? m[1] : t;
}

export const colLetterOf = colLetter;

export const matchRule = (r: ColRule, rowNo: number, raw: CalcRow): boolean => {
  if (r.rowFrom !== undefined && Number.isFinite(r.rowFrom) && rowNo < r.rowFrom) return false;
  if (r.rowTo !== undefined && Number.isFinite(r.rowTo) && rowNo > r.rowTo) return false;
  if (r.whenCol) {
    const have = (raw[r.whenCol] ?? "").trim().toLowerCase().replace(/ё/g, "е");
    const want = (r.whenValue ?? "").trim().toLowerCase().replace(/ё/g, "е");
    const op = r.op ?? "=";
    const a = evalNum(have), b = evalNum(want);
    const num = Number.isFinite(a) && Number.isFinite(b);
    switch (op) {
      case "=": if (!(num ? Math.abs(a - b) < 1e-12 : have === want)) return false; break;
      case "<>": if (num ? Math.abs(a - b) < 1e-12 : have === want) return false; break;
      case ">": if (!(num && a > b)) return false; break;
      case "<": if (!(num && a < b)) return false; break;
      case ">=": if (!(num && a >= b)) return false; break;
      case "<=": if (!(num && a <= b)) return false; break;
      case "содержит": if (!have.includes(want)) return false; break;
    }
  }
  return true;
};
