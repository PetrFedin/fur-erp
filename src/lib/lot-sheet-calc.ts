// Правка строк расчётного листа лота: чистая логика (без БД) — используется предпросмотром, записью и проверочным скриптом.
// Значение строки меняет состав цены и цену лота: Δ считается по модели состава (price-composition: sheetDelta) —
// сколько изменилась сумма секторов (с НДС) при тех же количестве и ставке. Связанные строки листа (молоток за шкуру, НДС на товар,
// «Итого …») сдвигаются вместе с изменённой, чтобы лист не расходился с ценой лота.
import { analyzeRows, lotComposition, sheetDelta, type CompCat, type CompInput, type CompRow } from "@/lib/price-composition";
import { isCompCat, sheetRowsOf, type SheetItem } from "@/lib/lot-sheet";

export type RawItem = Record<string, unknown>;
export type RowEdit = { idx: number; value?: number; title?: string; cat?: string; src?: string };

const num = (x: unknown) => Number(x);
const valid = (x: RawItem) => x && typeof x.label === "string" && Number.isFinite(num(x.value));

/** Строки модели состава из сырого массива items (с индексами исходного массива). */
export function toRows(raw: RawItem[]): { rows: CompRow[]; orig: number[] } {
  const rows: CompRow[] = [], orig: number[] = [];
  raw.forEach((x, i) => {
    if (!valid(x)) return;
    rows.push({ label: (x.label as string).trim(), value: num(x.value), cat: isCompCat(x.cat) ? x.cat : null });
    orig.push(i);
  });
  return { rows, orig };
}

const find = (raw: RawItem[], label: string) => raw.findIndex((x) => valid(x) && (x.label as string).trim().toLowerCase() === label.toLowerCase());
const TOTAL_INCL = /^итого за готовое сырье к оплате в т\.ч\. ндс( \(2\))?$/i;

/** Сдвиг итоговых строк листа на Δ цены лота (кроме правленных вручную). */
function shiftTotals(raw: RawItem[], dT: number, c: CompInput, skip: Set<number>) {
  const k = c.vatRate > 0 ? c.vatRate / 100 : 0;
  const q = c.qty > 0 ? c.qty : 1;
  raw.forEach((x, i) => {
    if (!valid(x) || skip.has(i)) return;
    const l = (x.label as string).trim();
    const lc = l.toLowerCase();
    if (TOTAL_INCL.test(l)) x.value = num(x.value) + dT;
    else if (/^итого за готовое сырье к оплате без ндс$/i.test(l)) x.value = num(x.value) + dT / (1 + k);
    else if (lc === "ндс" && raw.some((y) => valid(y) && /^итого за готовое сырье к оплате без ндс$/i.test(String(y.label).trim()))) x.value = num(x.value) + (dT * k) / (1 + k);
    else if (/^итого себестоимость за единицу/i.test(l)) x.value = num(x.value) + dT / q;
  });
}

/** Молоток лота изменился с h0 на h1: связанные строки листа «lot» пересчитываются. */
function propagateHammer(raw: RawItem[], h0: number, h1: number, q: number, vat: number, skip: Set<number>) {
  if (!(h0 > 0) || !(h1 >= 0) || h0 === h1) return;
  const f = h1 / h0;
  const set = (label: string, fn: (v: number) => number) => {
    const i = find(raw, label);
    if (i >= 0 && !skip.has(i)) raw[i].value = fn(num(raw[i].value));
  };
  const exclU = raw[find(raw, "Стоимость молоток за ед без НДС")]?.value;
  const inclU = raw[find(raw, "Стоимость молоток за ед в т.ч. НДС")]?.value;
  const r = num(exclU) > 0 && num(inclU) > 0 ? num(inclU) / num(exclU) : 1 + vat / 100;
  const vatGoods = raw[find(raw, "НДС на товар")]?.value;
  set("Стоимость молоток за ед без НДС", () => (q > 0 ? h1 / q : 0));
  set("Стоимость молоток за ед в т.ч. НДС", (v) => v * f);
  set("Стоимость молоток за ед в т.ч. Аукцион и НДС", (v) => v + ((h1 - h0) * r) / (q > 0 ? q : 1));
  set("НДС 20%", (v) => v * f);
  set("НДС на товар", (v) => v * f);
  const ri = find(raw, "расчётный");
  if (ri >= 0 && vatGoods != null && Math.abs(num(raw[ri].value) - num(vatGoods)) < 0.01 && !skip.has(ri)) raw[ri].value = num(raw[ri].value) * f;
  set("Итого за сырье к оплате по счету", (v) => v + (h1 - h0) * r);
}

export type EditResult = { items: RawItem[]; deltaT: number | null; notes: string[] };

/**
 * Применяет правки строк (значение/название/категория/источник). deltaT — на сколько меняется цена лота с НДС, ₽
 * (null — лист не распознан моделью и цену не определяет).
 */
export function applyRowEdits(rawIn: RawItem[], edits: RowEdit[], c: CompInput): EditResult {
  const raw = rawIn.map((x) => ({ ...x }));
  const notes: string[] = [];
  const before = toRows(rawIn).rows;
  const skip = new Set<number>();
  const q = c.qty > 0 ? c.qty : 0;
  const hammerIdx = find(raw, "Стоимость молоток ЛОТ без НДС");
  const usdIdx = find(raw, "Цена за ед. (ам. долл.)");
  const rateIdx = find(raw, "Курс");
  const H0 = hammerIdx >= 0 ? num(raw[hammerIdx].value) : 0;
  const usd0 = usdIdx >= 0 ? num(raw[usdIdx].value) : 0, rate0 = rateIdx >= 0 ? num(raw[rateIdx].value) : 0;
  const consistent = H0 > 0 && q > 0 && usd0 > 0 && rate0 > 0 && Math.abs(usd0 * rate0 * q - H0) <= H0 * 0.005;
  let hammerEdited = false;

  for (const e of edits) {
    const it = raw[e.idx];
    if (!it || !valid(it)) continue;
    for (const k of ["title", "cat", "src"] as const) {
      const v = e[k];
      if (v === undefined) continue;
      if (v === "" || (k === "title" && v === String(it.label ?? "").trim())) delete it[k];
      else it[k] = v;
    }
    if (e.value !== undefined && Number.isFinite(e.value) && e.value !== num(it.value)) {
      it.value = e.value;
      skip.add(e.idx);
      if (e.idx === hammerIdx) hammerEdited = true;
      else if (consistent && (e.idx === usdIdx || e.idx === rateIdx) && hammerIdx >= 0) {
        const u = num(raw[usdIdx].value), r = num(raw[rateIdx].value);
        raw[hammerIdx].value = u * r * q;
        hammerEdited = true;
        notes.push("Молоток лота пересчитан как цена в $ × курс × количество");
      }
    }
  }
  if (hammerEdited && hammerIdx >= 0) {
    const h1 = num(raw[hammerIdx].value);
    propagateHammer(raw, H0, h1, q, c.vatRate, new Set([...skip, hammerIdx]));
    if (consistent && usdIdx >= 0 && !skip.has(usdIdx) && !skip.has(rateIdx)) raw[usdIdx].value = (usd0 * h1) / H0;
  }

  const after = toRows(raw).rows;
  let dT = sheetDelta(before, after, c);
  if (dT == null) {
    // Лист из одних итогов (нет строк состава): цену определяет правка строки «Итого … в т.ч. НДС».
    const ti = edits.find((e) => e.value !== undefined && TOTAL_INCL.test(String(rawIn[e.idx]?.label ?? "").trim()));
    if (ti) dT = (ti.value as number) - num(rawIn[ti.idx].value);
    else if (edits.some((e) => e.value !== undefined)) notes.push("Расчёт без строк состава: цена лота по нему не определяется, значение сохранено как справка");
  }
  if (dT != null && Math.abs(dT) > 1e-9) {
    dT = Math.round(dT * 100) / 100;
    shiftTotals(raw, dT, c, skip);
  }
  return { items: raw, deltaT: dT, notes };
}

/** Строка листа, в которую уходит изменение цены лота (молоток); null — у такого листа якоря нет. */
export function anchorIndex(raw: RawItem[], c: CompInput): number | null {
  const comp = lotComposition({ ...c, breakdown: { items: raw }, plans: [] });
  if (!comp) return null;
  const label = comp.format === "lot" ? "Стоимость молоток ЛОТ без НДС" : comp.format === "fx" ? "НДС на шкуры" : comp.format === "plan" ? "Цена за ед. по курсу, ₽" : null;
  if (!label) return null;
  const i = find(raw, label);
  return i >= 0 ? i : null;
}

/**
 * Цена лота должна измениться на dT (с НДС): разница уходит в строку молотка, остальное пересчитывается как при правке строки.
 * Нет якоря — лист остаётся, разница попадёт в «Прочие расходы» (остаток до цены лота).
 */
export function pushPriceDelta(raw: RawItem[], dT: number, c: CompInput): EditResult & { anchored: boolean } {
  const i = anchorIndex(raw, c);
  if (i == null || Math.abs(dT) < 0.005) return { items: raw.map((x) => ({ ...x })), deltaT: 0, notes: [], anchored: false };
  const v = num(raw[i].value);
  const probe = applyRowEdits(raw, [{ idx: i, value: v + 1 }], c);
  const slope = probe.deltaT ?? 0;
  if (Math.abs(slope) < 1e-9) return { items: raw.map((x) => ({ ...x })), deltaT: 0, notes: [], anchored: false };
  const res = applyRowEdits(raw, [{ idx: i, value: v + dT / slope }], c);
  return { ...res, anchored: true };
}

/** Количество лота изменилось в ratio раз: суммы «за лот» листа масштабируются, «за шкуру» остаются. */
export function scaleLotRows(raw: RawItem[], ratio: number, c: CompInput): RawItem[] {
  const out = raw.map((x) => ({ ...x }));
  const { rows, orig } = toRows(raw);
  const items: SheetItem[] = rows.map((r, n) => ({ label: r.label, value: r.value, orig: orig[n] }));
  for (const r of sheetRowsOf(items, { qty: c.qty, vatRate: c.vatRate, defaultSrc: "" })) {
    if (r.basis === "lot") out[r.idx].value = num(out[r.idx].value) * ratio;
  }
  return out;
}

export { analyzeRows };
export type { CompCat };
