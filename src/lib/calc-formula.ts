/**
 * Формулы столбцов расчёта (как в Excel): без eval, свой разбор и вычисление.
 * Ссылки: буква столбца (H, M, AA) — значение этой строки; имя параметра шапки (курс, ставка_сбора, свой) — число.
 * Арифметика + − * / ( ), сравнения > < >= <= = <>, десятичная запятая или точка, разделитель аргументов «;».
 * Функции: ROUND(x;n), MIN, MAX, IF(условие;a;b), SUM(столбец) — итог по всем строкам, ABS.
 * Чистая логика без зависимостей — работает и в браузере (живой пересчёт), и на сервере, и в тестах.
 */

export class FormulaError extends Error {}

type Tok =
  | { t: "num"; v: number; pos: number }
  | { t: "id"; v: string; pos: number }
  | { t: "op"; v: string; pos: number };

export type Node =
  | { t: "num"; v: number }
  | { t: "id"; name: string }
  | { t: "range"; a: string; b: string }
  | { t: "neg"; e: Node }
  | { t: "bin"; op: string; l: Node; r: Node }
  | { t: "call"; name: string; args: Node[] };

const ID_START = /[\p{L}_]/u;
const ID_PART = /[\p{L}\p{N}_]/u;

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const s = src.replace(/^\s*=/, "");
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c) || c === " ") { i++; continue; }
    if (/[0-9]/.test(c) || ((c === "." || c === ",") && /[0-9]/.test(s[i + 1] ?? ""))) {
      let j = i;
      while (j < s.length && /[0-9]/.test(s[j])) j++;
      if ((s[j] === "." || s[j] === ",") && /[0-9]/.test(s[j + 1] ?? "")) { j++; while (j < s.length && /[0-9]/.test(s[j])) j++; }
      else if (s[j] === "." || s[j] === ",") { if (!/[\p{L}_]/u.test(s[j + 1] ?? "")) j++; }
      out.push({ t: "num", v: Number(s.slice(i, j).replace(",", ".")), pos: i });
      i = j; continue;
    }
    if (ID_START.test(c)) {
      let j = i + 1;
      while (j < s.length && ID_PART.test(s[j])) j++;
      out.push({ t: "id", v: s.slice(i, j), pos: i });
      i = j; continue;
    }
    const two = s.slice(i, i + 2);
    if (two === ">=" || two === "<=" || two === "<>") { out.push({ t: "op", v: two, pos: i }); i += 2; continue; }
    if ("+-*/();<>=:%".includes(c)) { out.push({ t: "op", v: c, pos: i }); i++; continue; }
    if (c === "^") throw new FormulaError("Возведение в степень не поддерживается");
    throw new FormulaError(`Недопустимый символ «${c}»`);
  }
  return out;
}

export const FUNCS: Record<string, { min: number; max: number }> = {
  ROUND: { min: 2, max: 2 }, MIN: { min: 1, max: 20 }, MAX: { min: 1, max: 20 }, IF: { min: 3, max: 3 }, SUM: { min: 1, max: 20 }, ABS: { min: 1, max: 1 },
  AVERAGE: { min: 1, max: 20 }, SUBTOTAL: { min: 2, max: 2 },
};
const FUNC_ALIAS: Record<string, string> = { ОКРУГЛ: "ROUND", МИН: "MIN", МАКС: "MAX", ЕСЛИ: "IF", СУММ: "SUM", СРЗНАЧ: "AVERAGE", ПРОМЕЖУТОЧНЫЕ_ИТОГИ: "SUBTOTAL", ABS: "ABS" };
const funcName = (n: string) => { const u = n.toUpperCase(); return FUNCS[u] ? u : FUNC_ALIAS[u] ?? null; };

export function parseFormula(src: string): Node {
  const toks = tokenize(src);
  if (toks.length === 0) throw new FormulaError("Формула пустая");
  let i = 0;
  const peek = () => toks[i];
  const isOp = (v: string) => peek()?.t === "op" && (peek() as { v: string }).v === v;
  const expect = (v: string) => { if (!isOp(v)) throw new FormulaError(`Ожидалась «${v}»${peek() ? ` вместо «${(peek() as { v: string | number }).v}»` : " в конце формулы"}`); i++; };

  function cmp(): Node {
    let l = add();
    while (peek()?.t === "op" && [">", "<", ">=", "<=", "=", "<>"].includes((peek() as { v: string }).v)) {
      const op = (toks[i++] as { v: string }).v;
      l = { t: "bin", op, l, r: add() };
    }
    return l;
  }
  function add(): Node {
    let l = mul();
    while (isOp("+") || isOp("-")) { const op = (toks[i++] as { v: string }).v; l = { t: "bin", op, l, r: mul() }; }
    return l;
  }
  function mul(): Node {
    let l = unary();
    while (isOp("*") || isOp("/")) { const op = (toks[i++] as { v: string }).v; l = { t: "bin", op, l, r: unary() }; }
    return l;
  }
  function unary(): Node {
    if (isOp("-")) { i++; return { t: "neg", e: unary() }; }
    if (isOp("+")) { i++; return unary(); }
    let e = primary();
    while (isOp("%")) { i++; e = { t: "bin", op: "/", l: e, r: { t: "num", v: 100 } }; }
    return e;
  }
  function primary(): Node {
    const k = peek();
    if (!k) throw new FormulaError("Формула оборвана: не хватает значения");
    if (k.t === "num") { i++; return { t: "num", v: k.v }; }
    if (k.t === "id") {
      i++;
      if (isOp("(")) {
        const fn = funcName(k.v);
        if (!fn) throw new FormulaError(`Неизвестная функция ${k.v}. Доступны: ROUND, MIN, MAX, IF, SUM, AVERAGE, SUBTOTAL, ABS`);
        i++;
        const args: Node[] = [];
        if (!isOp(")")) { args.push(cmp()); while (isOp(";")) { i++; args.push(cmp()); } }
        expect(")");
        const spec = FUNCS[fn];
        if (args.length < spec.min || args.length > spec.max) throw new FormulaError(`${fn}: нужно аргументов ${spec.min === spec.max ? spec.min : `от ${spec.min} до ${spec.max}`}, а указано ${args.length} (аргументы разделяются «;»)`);
        return { t: "call", name: fn, args };
      }
      if (isOp(":")) {
        i++;
        const b = peek();
        if (!b || b.t !== "id") throw new FormulaError("После «:» ожидается столбец или ячейка, например D:I или D3:I3");
        i++;
        return { t: "range", a: k.v, b: b.v };
      }
      return { t: "id", name: k.v };
    }
    if (k.v === "(") { i++; const e = cmp(); expect(")"); return e; }
    throw new FormulaError(`Неожиданный знак «${k.v}»`);
  }

  const n = cmp();
  if (i < toks.length) throw new FormulaError(`Лишнее в конце формулы: «${(toks[i] as { v: string | number }).v}»`);
  return n;
}

export type EvalCtx = {
  /** Значение идентификатора в текущей строке: столбец по букве, ячейка (H3) или параметр по имени; бросает FormulaError. */
  ident(name: string): number;
  /** Итог по столбцу (буква) по всем строкам. */
  sum(letter: string): number;
  /** Значения столбца (буква) по всем заполненным строкам — для AVERAGE и SUBTOTAL. */
  colValues?(letter: string): number[];
  /** Значения диапазона: D:I — столбцы этой строки; D3:I10 — прямоугольник ячеек. */
  rangeValues?(a: string, b: string): number[];
  /** Буква существующего столбца (для SUM(R) = весь столбец, а не значение строки). */
  isColumn?(name: string): boolean;
};

/** Номер столбца по букве: A→0, Z→25, AA→26. */
export function colIndex(letter: string): number {
  let n = 0;
  for (const ch of letter.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
/** Ссылка на ячейку «H3» → столбец и номер строки (с 1); иначе null. */
export function cellRef(name: string): { col: string; row: number } | null {
  const m = /^([A-Za-z]{1,3})(\d{1,4})$/.exec(name);
  return m && Number(m[2]) >= 1 ? { col: m[1].toUpperCase(), row: Number(m[2]) } : null;
}
/** Буквы столбцов от a до b включительно (D:I → D,E,F,G,H,I). */
export function lettersBetween(a: string, b: string): string[] {
  const x = colIndex(a), y = colIndex(b);
  const out: string[] = [];
  for (let i = Math.min(x, y); i <= Math.max(x, y); i++) out.push(colLetter(i));
  return out;
}

function listOf(n: Node, ctx: EvalCtx, whole: boolean): number[] {
  if (n.t === "range") {
    if (!ctx.rangeValues) throw new FormulaError("Диапазон здесь недоступен");
    return ctx.rangeValues(n.a, n.b);
  }
  if (whole && n.t === "id" && ctx.isColumn?.(n.name)) {
    if (!ctx.colValues) throw new FormulaError(`Столбец ${n.name.toUpperCase()}: итоги здесь недоступны`);
    return ctx.colValues(n.name);
  }
  return [evalNode(n, ctx)];
}

export function evalNode(n: Node, ctx: EvalCtx): number {
  switch (n.t) {
    case "num": return n.v;
    case "id": return ctx.ident(n.name);
    case "range": throw new FormulaError("Диапазон можно писать только внутри SUM, AVERAGE, MIN, MAX");
    case "neg": return -evalNode(n.e, ctx);
    case "bin": {
      const a = evalNode(n.l, ctx), b = evalNode(n.r, ctx);
      switch (n.op) {
        case "+": return a + b;
        case "-": return a - b;
        case "*": return a * b;
        case "/": if (b === 0) throw new FormulaError("Деление на ноль"); return a / b;
        case ">": return a > b ? 1 : 0;
        case "<": return a < b ? 1 : 0;
        case ">=": return a >= b ? 1 : 0;
        case "<=": return a <= b ? 1 : 0;
        case "=": return Math.abs(a - b) < 1e-12 ? 1 : 0;
        case "<>": return Math.abs(a - b) < 1e-12 ? 0 : 1;
      }
      throw new FormulaError("Неизвестная операция");
    }
    case "call": {
      if (n.name === "IF") return evalNode(n.args[0], ctx) !== 0 ? evalNode(n.args[1], ctx) : evalNode(n.args[2], ctx);
      if (n.name === "SUM") {
        // SUM(R) — итог по столбцу R; SUM(D:I) — сумма столбцов этой строки
        const a = n.args[0];
        if (n.args.length === 1 && a.t === "id" && !cellRef(a.name) && /^[A-Za-z]{1,3}$/.test(a.name) && (!ctx.isColumn || ctx.isColumn(a.name))) return ctx.sum(a.name);
        return n.args.flatMap((x) => listOf(x, ctx, true)).reduce((s, x) => s + x, 0);
      }
      if (n.name === "AVERAGE" || n.name === "SUBTOTAL") {
        let args = n.args, mode = 1;
        if (n.name === "SUBTOTAL") {
          const code = evalNode(n.args[0], ctx);
          if (code === 9 || code === 109) mode = 9; else if (code === 1 || code === 101) mode = 1; else throw new FormulaError("SUBTOTAL: поддерживаются коды 9 (сумма) и 1 (среднее)");
          args = n.args.slice(1);
        }
        const v = args.flatMap((x) => listOf(x, ctx, true));
        if (mode === 9) return v.reduce((s, x) => s + x, 0);
        if (v.length === 0) throw new FormulaError("AVERAGE: нет значений");
        return v.reduce((s, x) => s + x, 0) / v.length;
      }
      if (n.name === "MIN" || n.name === "MAX") {
        const v = n.args.flatMap((x) => listOf(x, ctx, false));
        if (v.length === 0) throw new FormulaError(`${n.name}: нет значений`);
        return n.name === "MIN" ? Math.min(...v) : Math.max(...v);
      }
      const v = n.args.map((x) => evalNode(x, ctx));
      if (n.name === "ROUND") {
        const d = Math.round(v[1]);
        if (!(d >= 0 && d <= 10)) throw new FormulaError("ROUND: число знаков от 0 до 10");
        const f = 10 ** d;
        return Math.round((v[0] + Math.sign(v[0]) * 1e-12) * f) / f;
      }
      if (n.name === "ABS") return Math.abs(v[0]);
    }
  }
  throw new FormulaError("Не удалось вычислить формулу");
}

/**
 * Идентификаторы формулы: row — значения этой строки (столбцы по букве, диапазоны D:I, параметры);
 * sum — столбцы целиком (SUM(R), AVERAGE(R), прямоугольные диапазоны).
 */
export function refsOf(n: Node, acc: { row: Set<string>; sum: Set<string> } = { row: new Set(), sum: new Set() }, wholeCol = false) {
  switch (n.t) {
    case "id": if (wholeCol && /^[A-Za-z]{1,3}$/.test(n.name)) acc.sum.add(n.name); else acc.row.add(n.name); break;
    case "range": {
      const ca = cellRef(n.a), cb = cellRef(n.b);
      if (ca && cb) for (const l of lettersBetween(ca.col, cb.col)) acc.sum.add(l);
      else if (/^[A-Za-z]{1,3}$/.test(n.a) && /^[A-Za-z]{1,3}$/.test(n.b)) for (const l of lettersBetween(n.a, n.b)) acc.row.add(l);
      break;
    }
    case "neg": refsOf(n.e, acc); break;
    case "bin": refsOf(n.l, acc); refsOf(n.r, acc); break;
    case "call": {
      const whole = n.name === "SUM" || n.name === "AVERAGE" || n.name === "SUBTOTAL";
      n.args.forEach((a, k) => refsOf(a, acc, whole && !(n.name === "SUBTOTAL" && k === 0)));
    }
  }
  return acc;
}

/** Буква столбца: 0→A, 25→Z, 26→AA. */
export function colLetter(i: number): string {
  let s = "";
  for (let n = i; n >= 0; n = Math.floor(n / 26) - 1) s = String.fromCharCode(65 + (n % 26)) + s;
  return s;
}

/** Переименование ссылок на столбцы в тексте формулы (при удалении столбца и смене формата). Остальной текст сохраняется. */
export function renameColumnRefs(src: string, map: Record<string, string>): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (ID_START.test(c)) {
      let j = i + 1;
      while (j < src.length && ID_PART.test(src[j])) j++;
      const w = src.slice(i, j);
      const isCall = src.slice(j).trimStart().startsWith("(") && funcName(w) && !map[w.toUpperCase()];
      const cr = cellRef(w);
      if (!isCall && cr && map[cr.col] && !map[w.toUpperCase()]) out += map[cr.col] + cr.row;
      else out += !isCall && map[w.toUpperCase()] ? map[w.toUpperCase()] : w;
      i = j;
    } else if (/[0-9]/.test(c)) {
      let j = i + 1;
      while (j < src.length && /[0-9.,]/.test(src[j])) j++;
      out += src.slice(i, j); i = j;
    } else { out += c; i++; }
  }
  return out;
}

/** Разбор + вычисление одной формулы для тестов и подсказок: без столбцов, только параметры. */
export function evalSimple(src: string, params: Record<string, number> = {}): number {
  const ast = parseFormula(src);
  return evalNode(ast, {
    ident: (name) => { const v = params[name.toLowerCase()]; if (v === undefined) throw new FormulaError(`Неизвестный параметр «${name}»`); return v; },
    sum: () => { throw new FormulaError("SUM здесь недоступна"); },
  });
}
