

export type CalcFormat = "SP_RP" | "SAGA" | "FH" | "OTHER" | "SHEET";

export type CalcRow = Record<string, string>;

export type ExtraExpense = { name: string; amount: string; mode: "perHide" | "total" };

export type CalcHeader = {
  auction: string;
  /** Год аукциона (2026): группировка в списках, год новой закупки и аукциона при приёме. Пусто — берётся из названия «СП 09-26» или даты счёта. */
  year?: string;
  invoice: string; invoiceDate: string; seller: string; currency: string;
  cbRate: string; agentPct: string; rateComment: string; buyer: string; dest: string; broker: string; dueDate: string;
  /** НДС на товар и услуги, % (22 с 2026 года, 20 — для 2025). */
  vat: string;
  /** Ставки, которые вводит поставщик (ключ — столбец строки: feePct, brokerPct…). Пустая ячейка строки берёт ставку отсюда. */
  rates?: Record<string, string>;
  advanceDate: string; advance: string; interim: string;
  extras: ExtraExpense[];
};

export type CalcStage = "PRELIM" | "FINAL";

/** Правило столбца: для каких строк действует своя формула (первое подошедшее правило важнее основной формулы). */
export type ColRule = {
  /** Строки с … по … (номера с 1, как в таблице); пусто — любые. */
  rowFrom?: number; rowTo?: number;
  /** Условие по значению ячейки этой строки в столбце ввода (id): «норка», «> 100». */
  whenCol?: string; op?: "=" | "<>" | ">" | "<" | ">=" | "<=" | "содержит"; whenValue?: string;
  formula: string;
};

export type CustomCol = {
  id: string; letter: string; title: string; unit: string; formula: string;
  /** «input» — столбец ввода (в свободной таблице); по умолчанию — формула. */
  kind?: "input" | "formula"; text?: boolean;
  rules?: ColRule[];
  /** Итог по столбцу в итоговой строке (по умолчанию сумма для чисел). */
  total?: "sum" | "avg" | "none";
};

/** Итоговая строка: контрольная разность между двумя итогами с допуском. */
export type CheckDiff = { id: string; title: string; a: string; b: string; tol: string };

/** Параметр шапки для формул; label и hint — пояснение и пример из образца формата (в расчёт не влияют). */
export type CalcParam = { name: string; value: string; label?: string; hint?: string };

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
  /** Свободная таблица: столбец цены закупки (молотка) за шкуру — нужен для приёма в закупку. */
  priceColumn?: string;
  /** Откуда взят набор столбцов: id пресета / шаблона и его название (для подписи). */
  formatId?: string; formatName?: string;
  /** Контрольные разности под таблицей. */
  checks?: CheckDiff[];
};

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

export const n0 = (s: string | undefined) => { const v = evalNum(s); return Number.isFinite(v) ? v : 0; };

export type RowCalc = { ok: boolean; problems: string[]; unitRub: number; totalRub: number; unitUsd: number | null; parts: { label: string; value: number }[]; extraRub: number };

// ============================================================================================ таблица «Детально»: столбцы и формулы

export type SheetCol = { id: string; letter: string; title: string; kind: "input" | "calc" | "custom"; unit?: string; text?: boolean; formula?: string; hint?: string; userInput?: boolean; rules?: ColRule[] };
