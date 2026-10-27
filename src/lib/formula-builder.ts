/**
 * Конструктор формулы простыми кнопками: выбранная операция и операнды → текст формулы как в Excel.
 * Операнд — буква столбца (H), имя параметра (курс) или число/выражение (4,5). Чистая логика: работает в браузере и в тестах.
 */
import { FormulaError, parseFormula, refsOf, cellRef, lettersBetween } from "@/lib/calc-formula";
import { calcAll, paramKey, rowFilled, type CalcPayload, type ColRule } from "@/lib/supplier-calc";

export type OpKind = "sum" | "product" | "mulNum" | "pct" | "pctProduct" | "diff" | "divCount" | "rate" | "round" | "cond" | "custom";
export const OP_LABEL: Record<OpKind, string> = {
  sum: "Сумма столбцов",
  product: "Произведение столбцов",
  mulNum: "Столбец × число или параметр",
  pct: "Процент от столбца",
  pctProduct: "Процент от произведения столбцов",
  diff: "Разность",
  divCount: "Деление суммы на количество (+ НДС)",
  rate: "Курс × (1 + комиссия)",
  round: "Округление",
  cond: "Условие: если … то … иначе …",
  custom: "Своя формула (текстом, как в Excel)",
};
export const OP_HINT: Record<OpKind, string> = {
  sum: "Отметьте столбцы, которые сложить",
  product: "Отметьте столбцы, которые перемножить",
  mulNum: "Например: цена × курс, или сбор × 1,22",
  pct: "Например: 7,35 % от цены, 22 % от сбора",
  pctProduct: "Например: цена × курс × 4,5 % (комиссия РМ)",
  diff: "Первый минус второй",
  divCount: "Например: сумма перевозки без НДС × 1,22 ÷ число шкур",
  rate: "Например: курс ЦБ × (1 + 1,5 % комиссии агента)",
  round: "До копеек (2 знака) или до рубля (0)",
  cond: "Если значение больше/меньше/равно — одна формула, иначе другая",
  custom: "+ − * / ( ), ROUND, MIN, MAX, IF, SUM, AVERAGE, SUBTOTAL; проценты 4,5%; ячейка H3; диапазон D:I",
};

export type Spec = {
  op: OpKind;
  /** Отмеченные столбцы (буквы) для суммы/произведения. */
  cols: string[];
  /** Операнды: a, b, c — буква, имя параметра или число (выражение). */
  a: string; b: string; c: string;
  /** Для условия: оператор сравнения и ветки. */
  cmp: ">" | "<" | ">=" | "<=" | "=" | "<>";
  then: string; otherwise: string;
  /** Для округления: знаков. */
  digits: string;
  text: string;
};
export const EMPTY_SPEC: Spec = { op: "mulNum", cols: [], a: "", b: "", c: "", cmp: ">", then: "", otherwise: "", digits: "2", text: "" };

const trim = (s: string) => s.trim();
/** Операнд, которому в составе произведения нужны скобки (выражение с + или −). */
const wrap = (s: string) => (/[+\-]/.test(s.replace(/^-/, "")) && !/^\(.*\)$/.test(s) ? `(${s})` : s);
/** Процент как доля: число → «4,5%», имя параметра/столбца → «курс/100». */
const pctOf = (s: string) => (/^[0-9.,\s]+$/.test(s) ? `${s.replace(/\s/g, "")}%` : `${wrap(s)}/100`);

/** Операции, у которых не хватает данных, дают null. */
export function buildFormula(sp: Spec): string | null {
  const a = trim(sp.a), b = trim(sp.b), c = trim(sp.c);
  switch (sp.op) {
    case "sum": return sp.cols.length >= 2 ? "=" + sp.cols.join("+") : null;
    case "product": return sp.cols.length >= 2 ? "=" + sp.cols.join("*") : null;
    case "mulNum": return a && b ? `=${wrap(a)}*${wrap(b)}` : null;
    case "pct": return a && b ? `=${wrap(a)}*${pctOf(b)}` : null;
    case "pctProduct": return sp.cols.length >= 1 && b ? `=${sp.cols.join("*")}*${pctOf(b)}` : null;
    case "diff": return a && b ? `=${wrap(a)}-${wrap(b)}` : null;
    case "divCount": return a && b ? `=${c ? `${wrap(a)}*(1+${pctOf(c)})` : wrap(a)}/${wrap(b)}` : null;
    case "rate": return a && b ? `=${wrap(a)}*(1+${pctOf(b)})` : null;
    case "round": return a ? `=ROUND(${a};${trim(sp.digits) || "2"})` : null;
    case "cond": return a && b && trim(sp.then) && trim(sp.otherwise) ? `=IF(${a}${sp.cmp}${b};${trim(sp.then)};${trim(sp.otherwise)})` : null;
    case "custom": return trim(sp.text) ? (trim(sp.text).startsWith("=") ? trim(sp.text) : "=" + trim(sp.text)) : null;
  }
}

/** Условие по текстовому столбцу («если мех = норка») нельзя записать как IF: оно становится правилом столбца. */
export function buildTextRule(whenCol: string, whenValue: string, thenFormula: string, elseFormula: string): { formula: string; rules: ColRule[] } {
  return { formula: elseFormula, rules: [{ whenCol, op: "=", whenValue, formula: thenFormula }] };
}

/** Живой пример: значения ссылок и результат формулы на первой заполненной строке. */
export type Preview = { rowNo: number; inputs: { name: string; value: string }[]; result: number | null; error?: string; text: string };
const num = (n: number) => n.toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 4 });
export function previewFormula(p: CalcPayload, formula: string, skipId?: string): Preview | null {
  const f = formula.trim();
  if (!f) return null;
  let node;
  try { node = parseFormula(f); } catch (e) { return { rowNo: 0, inputs: [], result: null, error: e instanceof FormulaError ? e.message : "Ошибка в формуле", text: "" }; }
  const idx = Math.max(0, p.rows.findIndex(rowFilled));
  const probe: CalcPayload = {
    ...p, overrides: {},
    customColumns: [...(p.customColumns ?? []).filter((c) => c.id !== skipId), { id: "__draft", letter: "", title: "?", unit: "", formula: f }],
  };
  const t = calcAll(probe);
  const sh = t.sheet;
  const refs = refsOf(node);
  const names = new Set<string>();
  for (const r of [...refs.row, ...refs.sum]) names.add(r);
  const inputs: { name: string; value: string }[] = [];
  const byLetter = new Map(sh.cols.map((c) => [c.letter, c]));
  const params = new Map((p.params ?? []).map((q) => [paramKey(q.name), q.value]));
  for (const n of names) {
    const cr = cellRef(n);
    const L = (cr ? cr.col : n).toUpperCase();
    if (/^[A-Za-z]{1,3}$/.test(L) && byLetter.has(L)) {
      const c = byLetter.get(L)!;
      const rowI = cr ? cr.row - 1 : idx;
      const v = sh.cells[c.id]?.[rowI]?.v;
      if (v != null) inputs.push({ name: cr ? n.toUpperCase() : L, value: num(v) });
    } else if (params.has(paramKey(n))) inputs.push({ name: n, value: params.get(paramKey(n)) || "–" });
  }
  void lettersBetween;
  const cell = sh.cells["__draft"]?.[idx];
  const result = cell?.v ?? null;
  const text = `${inputs.map((x) => `${x.name} = ${x.value}`).join(", ")}${inputs.length ? " → " : ""}${result != null ? num(Math.round(result * 1e4) / 1e4) : "–"}`;
  return { rowNo: idx + 1, inputs, result, error: cell?.err, text };
}
