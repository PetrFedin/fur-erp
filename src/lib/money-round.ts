// ЕДИНОЕ правило округления денег на экране («вариант Б», решение владельца 15.10.2026).
//   • Суммы в БД и в расчётах точные (Decimal, копейки и дробные копейки); округляем ТОЛЬКО при показе.
//   • Итог блока = округлённая сумма НЕокруглённых значений (а не сумма округлённых).
//   • Части, которые на экране складываются в итог (куплено = использовано + остаток; виды = всего; года = всего),
//     выравниваются методом наибольших остатков так, чтобы сумма ПОКАЗАННЫХ частей == ПОКАЗАННОМУ итогу.
//     Каждая часть при этом отличается от точной не больше чем на 1 ₽ (а у «остаток = куплено − использовано» — не больше чем на 2 ₽).
// Чистые функции без зависимостей: работают и на сервере, и в клиентских таблицах, и в тестах.

const EPS = 1e-7;

/** Целые рубли: половина — от нуля (6 820 117,5 → 6 820 118), без «−0». */
export function roundRub(v: number): number {
  if (!Number.isFinite(v)) return 0;
  const r = Math.sign(v) * Math.round(Math.abs(v) + EPS);
  return r === 0 ? 0 : r;
}

/**
 * Метод наибольших остатков: целые рубли для списка точных значений так, чтобы Σ результата == target
 * (по умолчанию round(Σ значений)). Каждое значение получает floor (или ceil для отрицательных) либо на 1 больше —
 * тому, у кого больше дробная часть. Равные остатки — тому, у кого больше модуль, затем по порядку.
 */
export function lrAllocate(values: number[], target?: number): number[] {
  const n = values.length;
  if (n === 0) return [];
  const tgt = target ?? roundRub(values.reduce((s, v) => s + v, 0));
  const base = values.map((v) => Math.floor(v + EPS));
  const rem = values.map((v, i) => v - base[i]);
  let need = tgt - base.reduce((s, v) => s + v, 0);
  const out = base.slice();
  // Порядок раздачи «+1»: по убыванию остатка, затем по убыванию модуля, затем по индексу.
  const order = values.map((_, i) => i).sort((a, b) => rem[b] - rem[a] || Math.abs(values[b]) - Math.abs(values[a]) || a - b);
  let k = 0;
  while (need > 0) { out[order[k % n]] += 1; need -= 1; k += 1; }
  // Недобор в обратную сторону (target меньше Σ floor) — снимаем у тех, у кого остаток наименьший.
  const rev = order.slice().reverse();
  k = 0;
  while (need < 0) { out[rev[k % n]] -= 1; need += 1; k += 1; }
  return out;
}

/** «Куплено / использовано / остаток» в рублях. */
export type Trio = { r: number; u: number; m: number };

/** Сходится ли точная тройка: куплено = использовано + остаток (с запасом на копейки). */
const closes = (t: Trio) => Math.abs(t.r - t.u - t.m) < 1;

/**
 * Одна тройка: куплено = round(r); использовано и остаток выравниваются под него методом наибольших остатков.
 * Если тройка не сходится сама (фильтр по ТЗ: списано не из этих лотов) — каждое значение округляется отдельно.
 */
export function alignTrio(t: Trio): Trio {
  const R = roundRub(t.r);
  if (!closes(t)) return { r: R, u: roundRub(t.u), m: roundRub(t.m) };
  const [U, M] = lrAllocate([t.u, t.m], R);
  return { r: R, u: U, m: M };
}

/** Строки + итог для троек (см. alignSet): итог — round(точный итог), строки складываются в него, в каждой куплено = использовано + остаток. */
export function alignRows(rows: Trio[], totalExact?: Trio): { rows: Trio[]; total: Trio } {
  const a = alignSet(rows.map((t) => cellOf({ r: t.r, u: t.u, m: t.m })), totalExact ? cellOf({ r: totalExact.r, u: totalExact.u, m: totalExact.m }) : undefined);
  const t = (c: Cell): Trio => ({ r: c.r, u: c.u, m: c.m });
  return { rows: a.parts.map(t), total: t(a.total) };
}

/** Одна колонка: части и итог (оплачено, долг, доли состава). Итог = round(Σ точных частей); части — наибольшими остатками. */
export function alignColumn(values: number[], totalExact?: number): { values: number[]; total: number } {
  const tot = totalExact ?? values.reduce((s, v) => s + v, 0);
  const total = roundRub(tot);
  const complete = near(values.reduce((s, v) => s + v, 0), tot);
  return { values: complete ? lrAllocate(values, total) : values.map(roundRub), total };
}

/**
 * Деньги строки сырья: куплено r, использовано без 4% u, остаток m, «использовано с 4%» w, оплачено p, долг d.
 * Все поля необязательны (нет — 0). Связь r = u + m сохраняется в каждой строке; остальные колонки независимы.
 */
export type Cell = { r: number; u: number; m: number; w: number; p: number; d: number };
export const ZERO_CELL: Cell = { r: 0, u: 0, m: 0, w: 0, p: 0, d: 0 };
export const cellOf = (c: Partial<Cell>): Cell => ({ ...ZERO_CELL, ...c });
export const addCells = (list: Cell[]): Cell => list.reduce((a, c) => ({ r: a.r + c.r, u: a.u + c.u, m: a.m + c.m, w: a.w + c.w, p: a.p + c.p, d: a.d + c.d }), ZERO_CELL);
export const subCells = (a: Cell, b: Cell): Cell => ({ r: a.r - b.r, u: a.u - b.u, m: a.m - b.m, w: a.w - b.w, p: a.p - b.p, d: a.d - b.d });
const KEYS = ["r", "u", "m", "w", "p", "d"] as const;
const near = (a: number, b: number) => Math.abs(a - b) < 1.5;

/**
 * Итог и его части. Итог — всегда round(точный итог) по каждой колонке, одинаков во всех блоках экрана; части выравниваются под него
 * методом наибольших остатков, так что Σ показанных частей == показанному итогу, а в каждой строке куплено = использовано + остаток.
 * totalExact не передан — итог это сумма точных частей. Части не складываются в итог (фильтр, отбор) — каждая округляется отдельно.
 */
export function alignSet(parts: Cell[], totalExact?: Cell): { total: Cell; parts: Cell[] } {
  const sum = addCells(parts);
  const tot = totalExact ?? sum;
  const out = parts.map(() => ({ ...ZERO_CELL }));
  const total = { ...ZERO_CELL };
  const closesAll = parts.every((c) => near(c.r, c.u + c.m)) && near(tot.r, tot.u + tot.m);
  for (const k of KEYS) total[k] = roundRub(tot[k]);
  // Итог: куплено = round(точного); использовано и остаток делят его наибольшими остатками (каждое — не дальше 1 ₽ от точного).
  if (closesAll) [total.u, total.m] = lrAllocate([tot.u, tot.m], total.r);
  for (const k of KEYS) {
    if (closesAll && k === "m") continue; // остаток строки = куплено − использовано
    const complete = near(sum[k], tot[k]);
    const vals = parts.map((c) => c[k]);
    const al = complete ? lrAllocate(vals, total[k]) : vals.map(roundRub);
    al.forEach((v, i) => { out[i][k] = v; });
  }
  if (closesAll) {
    const completeRU = near(sum.r, tot.r) && near(sum.u, tot.u);
    if (completeRU) out.forEach((c) => { c.m = c.r - c.u; });
    else out.forEach((c, i) => { const t = alignTrio({ r: parts[i].r, u: parts[i].u, m: parts[i].m }); c.r = t.r; c.u = t.u; c.m = t.m; }); // строки не складываются в итог: у каждой свой остаток
  }
  return { total, parts: out };
}

/** Мех + подкладка: итог «Всего» = round(сумма точных); мех и подкладка выравниваются под него. */
export function alignKindsTop(fur: Cell, lin: Cell): { all: Cell; fur: Cell; lin: Cell } {
  const a = alignSet([fur, lin]);
  return { all: a.total, fur: a.parts[0], lin: a.parts[1] };
}

/** Тип плоских цифр потока сырья (FlowFigures): деньги куплено / использовано без 4% / с 4% / остаток. */
export type FlowMoney = { recvValue: number; usedValue: number; usedValueOther: number; remValue: number };

/** FlowFigures → Cell: baseIsOther — «использовано без 4%» лежит в usedValueOther (режим «с 4%»), иначе в usedValue. */
export const flowCell = (f: FlowMoney, baseIsOther: boolean): Cell => cellOf({ r: f.recvValue, u: baseIsOther ? f.usedValueOther : f.usedValue, m: f.remValue, w: baseIsOther ? f.usedValue : f.usedValueOther });
/** Cell → FlowFigures с теми же остальными полями (количества, цены). */
export const withCell = <T extends FlowMoney>(f: T, c: Cell, baseIsOther: boolean): T => ({ ...f, recvValue: c.r, remValue: c.m, usedValue: baseIsOther ? c.w : c.u, usedValueOther: baseIsOther ? c.u : c.w });

/**
 * Показ одной плитки «Куплено / Использовано / Остаток» (мех или подкладка): суммы — целые рубли, сходящиеся
 * (куплено = использовано без 4% + остаток). «С 4%» округляется отдельно; надбавка = разность показанных.
 */
export function alignFlowMoney<T extends FlowMoney>(f: T, baseIsOther: boolean): T {
  const a = alignSet([flowCell(f, baseIsOther)]);
  return withCell(f, a.parts[0], baseIsOther);
}

/** Потоки сырья: итог и части (например, виды меха под «Вся закупка», либо мех и подкладка под «Всего»). Части складываются в итог. */
export function alignFlowSet<T extends FlowMoney>(total: T | undefined, parts: T[], baseIsOther: boolean): { total: T; parts: T[] } {
  const a = alignSet(parts.map((f) => flowCell(f, baseIsOther)), total ? flowCell(total, baseIsOther) : undefined);
  const base = (total ?? parts[0]) as T;
  return { total: withCell(base, a.total, baseIsOther), parts: parts.map((f, i) => withCell(f, a.parts[i], baseIsOther)) };
}

/** Целая сумма в рублях с пробелами-разрядами: для проверок и выгрузок («583 498 702»). */
export const fmtRubInt = (v: number): string => roundRub(v).toLocaleString("ru-RU");
