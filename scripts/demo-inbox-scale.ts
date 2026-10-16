// Обезличивание «входящих от поставщика» (принятые расчёты аукционов и ТЗ Веллмеха) для демо-базы.
// Деньги в них домножаются на ТОТ ЖЕ целый коэффициент K, что и у заказчика (закупки, лоты, ТЗ), поэтому кабинет Веллмеха
// на демо-стенде показывает те же лоты, счета и суммы ×K, а не «Расчётов пока нет». Ставки, проценты, курсы и количества не меняются.
// Чистые функции без БД: их же использует scripts/make-demo-db.ts и проверяет тест (расчёт по обезличенному payload = K × расчёт по исходному).
import { calcAll, ensureRowIds, evalNum, paramKey, type CalcPayload } from "../src/lib/supplier-calc";

type Json = Record<string, unknown>;

/** Единицы столбцов, в которых лежат деньги (курсы «₽/$» и коэффициенты — нет). */
export const isMoneyUnit = (u: unknown) => typeof u === "string" && /^(\$|EUR|₽)/.test(u.trim()) && u.trim() !== "₽/$";
/** Параметры шапки «своей таблицы» с деньгами за шкуру (остальные — курсы и проценты). */
export const isMoneyParam = (name: string) => /^(выделка|транспорт|упаковка|сбор_фикс)/.test(paramKey(name)) && !/проц|курс|коэф/.test(paramKey(name));
/** Денежные ячейки строки в встроенных форматах (СП/РП, SAGA, FH). */
const BUILTIN_MONEY = new Set(["price", "dressing", "transport", "transit", "feeFixed", "packing", "dressingUsd", "base22", "base5", "trans1", "trans2", "customs", "air", "adj", "upd"]);

const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
/** Число или простая формула в ячейке → число × K (строкой, десятичная точка); пусто — как есть; не разобрать — ошибка. */
function scaleCell(v: unknown, K: number, where: string): unknown {
  if (typeof v !== "string" || v.trim() === "") return v;
  const n = evalNum(v);
  if (!Number.isFinite(n)) throw new Error(`демо: не удалось разобрать денежное значение «${v}» (${where})`);
  return String(r6(n * K));
}

export function scaleCalcPayload(src: CalcPayload, K: number, maskDest: (s: string) => string): CalcPayload {
  const p = JSON.parse(JSON.stringify(src)) as CalcPayload & Json;
  const cols = new Map((p.customColumns ?? []).map((c) => [c.id, c]));
  const moneyCol = (id: string) => (cols.has(id) ? isMoneyUnit(cols.get(id)!.unit) : ["unit", "unitUsd", "total"].includes(id));
  // строки
  for (const row of p.rows as Record<string, string>[]) {
    for (const k of Object.keys(row)) {
      if (k === "_id") continue;
      if (k.startsWith("@")) { if (isMoneyParam(k.slice(1))) row[k] = scaleCell(row[k], K, `строка ${k}`) as string; continue; }
      const money = p.format === "SHEET" ? cols.get(k)?.kind === "input" && isMoneyUnit(cols.get(k)!.unit) : BUILTIN_MONEY.has(k);
      if (money) row[k] = scaleCell(row[k], K, `строка ${k}`) as string;
    }
    if (typeof row.dest === "string" && row.dest) row.dest = maskDest(row.dest);
  }
  // ручные значения вычисляемых ячеек
  for (const byCol of Object.values(p.overrides ?? {})) for (const id of Object.keys(byCol)) if (moneyCol(id)) byCol[id] = scaleCell(byCol[id], K, `ручная ячейка ${id}`) as string;
  // параметры шапки
  for (const q of p.params ?? []) if (isMoneyParam(q.name)) { q.value = scaleCell(q.value, K, `параметр ${q.name}`) as string; q.hint = ""; }
  // формулы с денежной константой («=550/994*I*1.2»)
  const fix = (f: string) => f.replace(/^=(\d+(?:[.,]\d+)?)(\/\d+\*)/, (_m, a: string, rest: string) => `=${r6(Number(a.replace(",", ".")) * K)}${rest}`);
  for (const c of p.customColumns ?? []) { c.formula = fix(c.formula); for (const r of c.rules ?? []) r.formula = fix(r.formula); }
  // шапка
  const h = p.header;
  if (h.advance) h.advance = scaleCell(h.advance, K, "аванс") as string;
  if (h.interim) h.interim = scaleCell(h.interim, K, "промежуточный платёж") as string;
  for (const e of h.extras ?? []) e.amount = scaleCell(e.amount, K, "расход") as string;
  for (const k of Object.keys(h.rates ?? {})) if (BUILTIN_MONEY.has(k)) h.rates![k] = scaleCell(h.rates![k], K, `ставка ${k}`) as string;
  h.buyer = "Заказчик";
  h.dest = h.dest ? maskDest(h.dest) : h.dest;
  h.rateComment = ""; h.broker = "";
  // сохранённые итоги
  const tot = (p as Json).totals as { qty?: number; totalRub?: number } | undefined;
  if (tot && typeof tot.totalRub === "number") tot.totalRub = r6(tot.totalRub * K);
  return p;
}

/** Проверка: расчёт по обезличенному payload = K × расчёт по исходному (по каждой строке); иначе — текст ошибки. */
export function checkCalcScale(orig: CalcPayload, scaled: CalcPayload, K: number): string | null {
  const a = calcAll(ensureRowIds(orig)), b = calcAll(ensureRowIds(scaled));
  if (Math.abs(a.qty - b.qty) > 1e-9) return `количество ${a.qty} → ${b.qty}`;
  const rel = (x: number, y: number) => Math.abs(y - x * K) <= 1e-6 * Math.max(1, Math.abs(x * K));
  if (!rel(a.totalRub, b.totalRub)) return `итог ${a.totalRub} × ${K} ≠ ${b.totalRub}`;
  for (let i = 0; i < a.calcs.length; i++) if (!rel(a.calcs[i].totalRub, b.calcs[i].totalRub)) return `строка ${i + 1}: ${a.calcs[i].totalRub} × ${K} ≠ ${b.calcs[i].totalRub}`;
  return null;
}

// ============================================================================================ ТЗ

/** «383 330,44» → «1 149 991,32»: тот же вид записи (разделитель тысяч, запятая/точка, целые остаются целыми). */
export function scaleMoneyStr(s: unknown, K: number): unknown {
  if (typeof s !== "string" || s.trim() === "") return s;
  const t = s.trim();
  const sep = /\d([\s  ])\d{3}(\D|$)/.exec(t)?.[1] ?? "";
  const dec = t.includes(",") ? "," : ".";
  const num = Number(t.replace(/[\s  ]/g, "").replace(",", "."));
  if (!Number.isFinite(num) || !/^[\d\s  ]+([.,]\d+)?$/.test(t)) throw new Error(`демо: не удалось разобрать сумму ТЗ «${s}»`);
  const v = Math.round(num * K * 100) / 100;
  const hasFrac = /[.,]\d/.test(t) || !Number.isInteger(v);
  let out = hasFrac ? v.toFixed(2) : String(v);
  if (sep) { const [i, f] = out.split("."); out = i.replace(/\B(?=(\d{3})+(?!\d))/g, sep) + (f ? "." + f : ""); }
  return dec === "," ? out.replace(".", ",") : out;
}

export function scaleTzPayload(src: Json, K: number, who: { customer: string; customerPost: string; contractorPost: string; place: string }): Json {
  const p = JSON.parse(JSON.stringify(src)) as Json & { items?: Json[]; materials?: Json[]; terms?: Json; signers?: Json; totalRows?: { items?: string[]; mats?: string[] } };
  for (const it of p.items ?? []) for (const k of ["work", "price", "extra", "total"]) if (it[k]) it[k] = scaleMoneyStr(it[k], K);
  for (const m of p.materials ?? []) for (const k of ["priceNet", "total"]) if (m[k]) m[k] = scaleMoneyStr(m[k], K);
  delete p.totalText; // фраза «Общая стоимость … составляет …», вписанная вручную: система пересчитает сама
  if (p.totalRows) {
    delete p.totalRows.items;
    if (p.totalRows.mats) p.totalRows.mats = p.totalRows.mats.map((c, i) => (i >= 2 && c ? (scaleMoneyStr(c, K) as string) : c));
  }
  p.customer = who.customer;
  p.contract = "№ ДЕМО от 01.01.2025 г.";
  p.signers = { customerPost: who.customerPost, customerName: "Иванов И. И.", contractorPost: who.contractorPost, contractorName: "Петров П. П." };
  if (p.terms) p.terms.place = who.place;
  return p;
}
