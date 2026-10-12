/**
 * «Новая партия закупки»: чистая логика мастера (без базы и без server-only — работает и в браузере, и в серверных
 * действиях, и в scripts/test-batch-intake.ts).
 *
 *   detectColumns(таблица)        — находит строку заголовка и столбцы: лот, мех, цвет, размер/сорт, количество, цена, валюта, НДС…
 *   applyMapping(таблица, …)      — превращает таблицу в строки мастера (IntakeRow, всё строками — как в ячейках)
 *   validateRows(строки, справочники, решения) — ошибки/предупреждения по строкам и список «решений по справочникам»
 *   itemsOf(…)                    — строки → позиции закупки (число, цена, НДС, расчёт costPlan, если в файле есть сборы)
 *   recognizeFromName / recognizeFromText — тип, номер, дата и сумма документа
 *   reconcileAmount(…)            — сверка суммы документа с суммой лотов (допуск 50 ₽) с понятной причиной расхождения
 *
 * Суммы закупки здесь НЕ считаются: их считает src/lib/purchase-totals.ts (серверное действие подставляет позиции).
 */
import { formatPercent } from "@/lib/utils";
import { colorKey, matchColorRef, splitColorCode, suggestColorRef, type ColorRefLite } from "@/lib/color-ref";
import { canonicalFur, furKey, type FurIndex } from "@/lib/fur-ref";
import { buildCostPlanJson, computeCostPlan, DEFAULT_VAT, roundPrice, roundQty, roundRate, roundVat } from "@/lib/cost-plan";
import { guessDocType } from "@/lib/drive-docs";

// ======================================================================= столбцы

export type FieldKey =
  | "lot" | "material" | "color" | "grade" | "qty" | "price" | "currency" | "vat" | "invoice"
  | "rate" | "fee" | "dressing" | "transport" | "broker" | "transit" | "fileUnit" | "fileTotal";

export const BASIC_FIELDS: { key: FieldKey; label: string }[] = [
  { key: "lot", label: "Лот" },
  { key: "material", label: "Мех" },
  { key: "color", label: "Цвет" },
  { key: "grade", label: "Размер / сорт" },
  { key: "qty", label: "Количество" },
  { key: "price", label: "Цена (молоток)" },
  { key: "currency", label: "Валюта" },
  { key: "vat", label: "НДС, %" },
  { key: "invoice", label: "Счёт аукциона №" },
];
export const CALC_FIELDS: { key: FieldKey; label: string }[] = [
  { key: "rate", label: "Курс" },
  { key: "fee", label: "Аукционный сбор" },
  { key: "dressing", label: "Выделка, ₽" },
  { key: "transport", label: "Транспорт, ₽" },
  { key: "broker", label: "Брокерский" },
  { key: "transit", label: "Комиссия за транзит, ₽" },
  { key: "fileUnit", label: "Себестоимость за ед. (в файле)" },
  { key: "fileTotal", label: "Себестоимость общая (в файле)" },
];
export const ALL_FIELDS = [...BASIC_FIELDS, ...CALC_FIELDS];
export const FIELD_LABEL: Record<FieldKey, string> = Object.fromEntries(ALL_FIELDS.map((f) => [f.key, f.label])) as Record<FieldKey, string>;

/** Порядок столбцов, когда заголовка нет (вставка из таблицы без шапки). */
export const DEFAULT_ORDER: FieldKey[] = ["lot", "material", "color", "grade", "qty", "price", "currency", "vat"];

export type Mapping = Partial<Record<FieldKey, number>>;
export type Detected = { headerIdx: number; mapping: Mapping; headers: string[]; currencyHint: string | null; recognized: number };

const normHead = (h: string) => h.toLowerCase().replace(/ё/g, "е").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();

// Порядок важен: более частные правила — раньше общих. Первое подходящее правило на столбец, первый столбец на поле.
const RULES: { key: FieldKey; re: RegExp }[] = [
  { key: "fileTotal", re: /себестоимост.*(общ|итого|всего)|total cost/ },
  { key: "fileUnit", re: /себестоимост|unit cost|cost per/ },
  { key: "invoice", re: /^(invoice|инвойс|№? ?сч[её]т)/ },
  { key: "lot", re: /^(lot|лот|№ ?лота|номер лота)/ },
  { key: "qty", re: /(quantity|qty|колич|кол-во|кол во|штук|^шт)/ },
  { key: "rate", re: /(^курс|exchange rate|^rate)/ },
  { key: "vat", re: /(ндс|vat)/ },
  { key: "fee", re: /(аукционн\S* сбор|auction fee|^сбор)/ },
  { key: "dressing", re: /выделк/ },
  { key: "transport", re: /транспорт|перевозк/ },
  { key: "broker", re: /брокер/ },
  { key: "transit", re: /транзит/ },
  { key: "currency", re: /(валют|currency|^curr)/ },
  { key: "price", re: /(закупка|цена|price|молот|hammer)/ },
  { key: "color", re: /(color|colour|цвет|operation|операци|оттенок)/ },
  { key: "grade", re: /(size|размер|сорт|grade|качеств|description|описан)/ },
  { key: "material", re: /^(fur|мех|вид меха|материал|наименование|товар|порода|вид)(?![a-zа-яё0-9])/ },
];

/** Число из ячейки: пробелы/неразрывные пробелы, ₽ $ € %, десятичная запятая. Не число — NaN. */
export function num(s: string | null | undefined): number {
  if (s == null) return NaN;
  const t = s.replace(/[\s  ]/g, "").replace(/[₽$€%]/g, "").replace(",", ".");
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(t)) return NaN;
  return Number(t);
}

/** Распознаёт шапку и столбцы. Столбец «НДС» принимается, только если в нём ставки (0…100), а не суммы. */
export function detectColumns(table: string[][]): Detected {
  let best: { idx: number; mapping: Mapping; score: number; hint: string | null } | null = null;
  const limit = Math.min(table.length, 15);
  for (let i = 0; i < limit; i++) {
    const row = table[i];
    const mapping: Mapping = {};
    let hint: string | null = null;
    row.forEach((cell, c) => {
      const h = normHead(cell);
      if (!h) return;
      for (const r of RULES) {
        if (!r.re.test(h)) continue;
        if (mapping[r.key] !== undefined) continue;
        if (r.key === "vat") {
          const vals = table.slice(i + 1, i + 40).map((x) => num(x[c])).filter((n) => Number.isFinite(n));
          if (vals.length > 0 && vals.some((n) => n < 0 || n > 100)) continue; // суммы НДС, а не ставка
        }
        mapping[r.key] = c;
        if (r.key === "price") hint = /\$|usd|долл/.test(h) ? "USD" : /€|eur|евро/.test(h) ? "EUR" : /руб|₽|rub/.test(h) ? "RUB" : null;
        return;
      }
    });
    const score = Object.keys(mapping).length;
    const hasCore = mapping.qty !== undefined || mapping.price !== undefined || mapping.lot !== undefined;
    if (score >= 3 && hasCore && (!best || score > best.score)) best = { idx: i, mapping, score, hint };
  }
  if (best) return { headerIdx: best.idx, mapping: best.mapping, headers: table[best.idx].map((x) => x.replace(/[\r\n]+/g, " ").trim()), currencyHint: best.hint, recognized: best.score };
  const mapping: Mapping = {};
  DEFAULT_ORDER.forEach((k, i) => (mapping[k] = i));
  return { headerIdx: -1, mapping, headers: [], currencyHint: null, recognized: 0 };
}

export type IntakeRow = {
  /** Ключ строки в таблице мастера. */
  n: number;
  lot: string; material: string; color: string; grade: string; qty: string; price: string; vat: string; currency: string; invoice: string;
  rate: string; fee: string; dressing: string; transport: string; broker: string; transit: string; fileUnit: string; fileTotal: string;
};

export const EMPTY_ROW: Omit<IntakeRow, "n"> = {
  lot: "", material: "", color: "", grade: "", qty: "", price: "", vat: "", currency: "", invoice: "",
  rate: "", fee: "", dressing: "", transport: "", broker: "", transit: "", fileUnit: "", fileTotal: "",
};

const TOTAL_RE = /^(итого|всего|total|сумма|ИТОГО)/i;

/** Строки данных по таблице и разметке столбцов. Пустые строки и строки «Итого» пропускаются. */
export function applyMapping(table: string[][], headerIdx: number, mapping: Mapping, startN = 1): IntakeRow[] {
  const out: IntakeRow[] = [];
  let n = startN;
  for (const raw of table.slice(headerIdx + 1)) {
    const cell = (k: FieldKey) => {
      const c = mapping[k];
      return c === undefined ? "" : (raw[c] ?? "").replace(/[\r\n]+/g, " ").trim();
    };
    const row: Omit<IntakeRow, "n"> = { ...EMPTY_ROW };
    for (const f of ALL_FIELDS) row[f.key] = cell(f.key);
    const first = raw.find((x) => x.trim() !== "") ?? "";
    if (!row.lot && !row.material && !row.qty && !row.price) continue;
    if (TOTAL_RE.test(first.trim()) && !row.qty) continue;
    if (TOTAL_RE.test(first.trim()) && !row.material) continue;
    out.push({ n: n++, ...row });
  }
  return out;
}

/** Вставка из Excel/Google Sheets (табуляция), либо «;» / «,» — в таблицу ячеек. */
export function parsePasteTable(text: string): string[][] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return [];
  const first = lines[0];
  const cnt = (ch: string) => first.split(ch).length - 1;
  const delim = cnt("\t") > 0 ? "\t" : cnt(";") > 0 ? ";" : cnt(",") > 0 && !/\d,\d/.test(first) ? "," : null;
  return lines.slice(0, 5000).map((l) => (delim ? l.split(delim) : l.split(/ {2,}/)).map((c) => {
    const t = c.trim();
    return t.length >= 2 && t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1).replace(/""/g, '"').trim() : t;
  }));
}

// ======================================================================= проверка строк

export type FurOption = { id: string; name: string };
export type FurDecision = { mode: "ref"; id: string } | { mode: "add" };
export type ColorDecision = { mode: "ref"; id: string } | { mode: "add" } | { mode: "keep" };
export type Decisions = { fur: Record<string, FurDecision>; color: Record<string, ColorDecision> };

export type IntakeContext = {
  /** Валюта партии (из шапки). */
  currency: string;
  /** Ставка НДС по умолчанию, %, для пустых ячеек. */
  vatDefault: number;
  materials: FurOption[];
  furIndex?: FurIndex;
  colors: (ColorRefLite & { id: string })[];
  /** Лоты, уже заведённые в этом аукционе: ключ номера → номер закупки. */
  existingLots: Map<string, string>;
  /** Курс партии, для сверки с «курсом» в файле. */
  rate: number;
};

export type RowCheck = {
  n: number;
  errors: string[];
  warnings: string[];
  infos: string[];
  /** Найденный материал справочника (id) или null. */
  materialId: string | null;
  /** Имя нового материала, который будет создан (решение «добавить»). */
  newMaterial: string | null;
  colorRefId: string | null;
  /** Текст цвета для записи (как в справочнике или как есть). */
  colorText: string | null;
  newColor: string | null;
};

export type UnknownRef = {
  key: string;
  text: string;
  rows: number[];
  suggestion: { id: string; name: string; reason: string } | null;
};

export type ValidationResult = {
  checks: RowCheck[];
  unknownFurs: UnknownRef[];
  unknownColors: UnknownRef[];
  errorCount: number;
  warningCount: number;
};

const cleanText = (s: string) => s.replace(/\s+/g, " ").trim();

export function validateRows(rows: IntakeRow[], ctx: IntakeContext, dec: Decisions): ValidationResult {
  const checks: RowCheck[] = [];
  const furUnknown = new Map<string, UnknownRef>();
  const colorUnknown = new Map<string, UnknownRef>();
  const lotFirst = new Map<string, number>();
  const matByKey = new Map(ctx.materials.map((m) => [furKey(m.name), m]));
  const matById = new Map(ctx.materials.map((m) => [m.id, m]));
  const pos = new Map(rows.map((r, i) => [r.n, i + 1]));

  for (const r of rows) {
    const c: RowCheck = { n: r.n, errors: [], warnings: [], infos: [], materialId: null, newMaterial: null, colorRefId: null, colorText: null, newColor: null };
    const where = pos.get(r.n);

    // --- количество / цена / НДС / валюта
    const qty = num(r.qty);
    if (!r.qty.trim()) c.errors.push("не указано количество");
    else if (!Number.isFinite(qty)) c.errors.push(`количество «${r.qty}» — не число`);
    else if (qty < 0.001) c.errors.push("количество должно быть не меньше 0,001");
    else if (qty > 99_999_999_999) c.errors.push("количество слишком большое");

    const price = num(r.price);
    if (!r.price.trim()) c.errors.push("не указана цена");
    else if (!Number.isFinite(price)) c.errors.push(`цена «${r.price}» — не число`);
    else if (price < 0) c.errors.push("цена не может быть отрицательной");
    else if (price === 0) c.warnings.push("цена 0 — проверьте");
    else if (Number.isFinite(qty) && qty * price >= 999_999_999_999) c.errors.push("сумма строки слишком велика");

    if (r.vat.trim()) {
      const v = num(r.vat);
      if (!Number.isFinite(v)) c.errors.push(`НДС «${r.vat}» — не число`);
      else if (v < 0 || v > 100) c.errors.push("НДС должен быть от 0 до 100");
    }
    const cur = r.currency.trim().toUpperCase();
    if (cur && cur !== ctx.currency) c.errors.push(`валюта строки ${cur} не совпадает с валютой партии ${ctx.currency}: партия ведётся в одной валюте`);
    if (r.rate.trim()) {
      const rt = num(r.rate);
      if (Number.isFinite(rt) && ctx.rate > 0 && Math.abs(rt - ctx.rate) / ctx.rate > 0.0005 && ctx.currency !== "RUB")
        c.warnings.push(`курс в файле ${rt} отличается от курса партии ${ctx.rate}`);
    }

    // --- лот: повтор в файле / уже заведён в этом аукционе
    const lot = cleanText(r.lot);
    if (!lot) c.warnings.push("нет номера лота");
    else {
      const k = lot.toLowerCase();
      if (lotFirst.has(k)) c.errors.push(`лот «${lot}» повторяется — он уже указан в строке ${lotFirst.get(k)}`);
      else lotFirst.set(k, where ?? 0);
      const ex = ctx.existingLots.get(k);
      if (ex) c.errors.push(`лот «${lot}» уже заведён в этом аукционе (закупка ${ex}) — дубль`);
    }

    // --- мех
    const mat = cleanText(r.material);
    if (!mat) c.errors.push("не указан мех");
    else {
      const mk = furKey(mat);
      let found = matByKey.get(mk);
      if (!found) {
        const canon = canonicalFur(mat, ctx.furIndex);
        const byCanon = canon ? matByKey.get(furKey(canon.name)) : undefined;
        if (byCanon) {
          found = byCanon;
          c.infos.push(`«${mat}» распознан как «${byCanon.name}»`);
        }
      }
      if (found) c.materialId = found.id;
      else {
        const d = dec.fur[mk];
        if (d?.mode === "ref" && matById.has(d.id)) {
          c.materialId = d.id;
          c.infos.push(`«${mat}» → «${matById.get(d.id)!.name}»`);
        } else if (d?.mode === "add") {
          c.newMaterial = mat;
          c.infos.push(`«${mat}» будет добавлен в справочник материалов`);
        } else {
          c.errors.push(`мех «${mat}» нет в справочнике — выберите из списка или добавьте`);
          const u = furUnknown.get(mk) ?? { key: mk, text: mat, rows: [], suggestion: null };
          u.rows.push(r.n);
          if (!u.suggestion) {
            const canon = canonicalFur(mat, ctx.furIndex);
            const near = ctx.materials.find((m) => furKey(mat).includes(furKey(m.name)) || furKey(m.name).includes(mk));
            const pick = near ?? (canon ? ctx.materials.find((m) => furKey(m.name) === furKey(canon.name)) : undefined);
            if (pick) u.suggestion = { id: pick.id, name: pick.name, reason: "похоже по названию" };
          }
          furUnknown.set(mk, u);
        }
      }
    }

    // --- цвет (может быть пустым)
    const colorRaw = cleanText(r.color);
    if (colorRaw) {
      const m = matchColorRef(colorRaw, ctx.colors);
      if (m) {
        c.colorRefId = m.id;
        c.colorText = splitColorCode(colorRaw).code ? colorRaw : m.name;
      } else {
        const ck = colorKey(colorRaw);
        const d = dec.color[ck];
        if (d?.mode === "ref") {
          const ref = ctx.colors.find((x) => x.id === d.id);
          if (ref) {
            c.colorRefId = ref.id;
            c.colorText = ref.name;
            c.infos.push(`цвет «${colorRaw}» → «${ref.name}»`);
          }
        } else if (d?.mode === "add") {
          c.newColor = colorRaw;
          c.colorText = colorRaw;
          c.infos.push(`цвет «${colorRaw}» будет добавлен в справочник (на подтверждение)`);
        } else if (d?.mode === "keep") {
          c.colorText = colorRaw;
          c.warnings.push(`цвет «${colorRaw}» оставлен текстом без справочника`);
        } else {
          c.errors.push(`цвет «${colorRaw}» нет в справочнике — выберите из списка, добавьте или оставьте как есть`);
          const u = colorUnknown.get(ck) ?? { key: ck, text: colorRaw, rows: [], suggestion: null };
          u.rows.push(r.n);
          if (!u.suggestion) {
            const s = suggestColorRef(colorRaw, ctx.colors);
            if (s) u.suggestion = { id: s.ref.id, name: s.ref.name, reason: s.reason };
          }
          colorUnknown.set(ck, u);
        }
      }
    }
    checks.push(c);
  }

  return {
    checks,
    unknownFurs: [...furUnknown.values()],
    unknownColors: [...colorUnknown.values()],
    errorCount: checks.reduce((s, c) => s + c.errors.length, 0),
    warningCount: checks.reduce((s, c) => s + c.warnings.length, 0),
  };
}

// ======================================================================= позиции

export type ItemDraft = {
  n: number;
  invoice: string;
  lot: string | null;
  materialId: string | null;
  newMaterial: string | null;
  grade: string | null;
  colorText: string | null;
  colorRefId: string | null;
  newColor: string | null;
  quantity: number;
  unitPrice: number;
  vatRate: number;
  /** Готовый JSON расчёта (если в файле есть сборы/выделка/брокерский) — как у «Править расчёт». */
  costPlan: ReturnType<typeof buildCostPlanJson> | null;
  /** Себестоимость за единицу из файла (для сверки с расчётом приложения). */
  fileUnit: number | null;
  fileTotal: number | null;
  /** Расхождение расчёта приложения с файлом по единице, ₽ (если оба есть). */
  planDiffUnit: number | null;
  /** Часть единицы, которую выставляет аукцион: товар + сбор + НДС на сбор, ₽ (если есть расчёт). */
  auctionUnit: number | null;
};

const optNum = (s: string): number | null => {
  const v = num(s);
  return Number.isFinite(v) ? v : null;
};

/**
 * Строки (уже без ошибок) → позиции закупки. `mapping` нужен, чтобы понять, проценты в столбцах «сбор»/«брокерский»
 * или рубли за единицу (если в заголовке «%» и все значения ≤ 100 — это проценты).
 */
export function itemsOf(
  rows: IntakeRow[],
  checks: RowCheck[],
  ctx: { vatDefault: number; rate: number; currency: string; pctCols?: Partial<Record<"fee" | "broker", boolean>> },
): ItemDraft[] {
  const byN = new Map(checks.map((c) => [c.n, c]));
  const out: ItemDraft[] = [];
  for (const r of rows) {
    const c = byN.get(r.n);
    if (!c) continue;
    const quantity = roundQty(num(r.qty));
    const unitPrice = roundPrice(num(r.price));
    const vatRate = roundVat(r.vat.trim() ? num(r.vat) : ctx.vatDefault);
    const fee = optNum(r.fee), dressing = optNum(r.dressing), transport = optNum(r.transport), broker = optNum(r.broker), transit = optNum(r.transit);
    const hasCalc = [fee, dressing, transport, broker, transit].some((x) => x !== null);
    const rate = ctx.currency === "RUB" ? 1 : ctx.rate;
    const goods = unitPrice * rate;
    const pct = (v: number | null, isPct?: boolean) => (v === null ? 0 : isPct ? v : goods > 0 ? (v / goods) * 100 : 0);
    let costPlan: ItemDraft["costPlan"] = null;
    let planDiffUnit: number | null = null;
    let auctionUnit: number | null = null;
    const fileUnit = optNum(r.fileUnit);
    if (hasCalc && Number.isFinite(quantity) && Number.isFinite(unitPrice)) {
      const inputs = {
        quantity, price: unitPrice, rate, vat: vatRate,
        feePct: Math.round(pct(fee, ctx.pctCols?.fee) * 1e6) / 1e6,
        dressing: dressing ?? 0,
        transport: transport ?? 0,
        brokerPct: Math.round(pct(broker, ctx.pctCols?.broker) * 1e6) / 1e6,
        transit: transit ?? 0,
      };
      costPlan = buildCostPlanJson(inputs, { furDescription: r.grade || null }, new Date().toISOString());
      const cp = computeCostPlan(inputs);
      auctionUnit = cp.goods + cp.fee + cp.feeVat;
      if (fileUnit !== null) planDiffUnit = Math.round((cp.unitIncl - fileUnit) * 100) / 100;
    }
    out.push({
      n: r.n,
      invoice: cleanText(r.invoice),
      lot: cleanText(r.lot) || null,
      materialId: c.materialId,
      newMaterial: c.newMaterial,
      grade: cleanText(r.grade) || null,
      colorText: c.colorText,
      colorRefId: c.colorRefId,
      newColor: c.newColor,
      quantity,
      unitPrice,
      vatRate,
      costPlan,
      fileUnit,
      fileTotal: optNum(r.fileTotal),
      planDiffUnit,
      auctionUnit,
    });
  }
  return out;
}

/** Столбцы «сбор»/«брокерский» — проценты? (заголовок содержит «%» и все значения ≤ 100) */
export function percentColumns(table: string[][], headerIdx: number, mapping: Mapping): Partial<Record<"fee" | "broker", boolean>> {
  const out: Partial<Record<"fee" | "broker", boolean>> = {};
  for (const k of ["fee", "broker"] as const) {
    const c = mapping[k];
    if (c === undefined) continue;
    const head = headerIdx >= 0 ? table[headerIdx][c] ?? "" : "";
    const vals = table.slice(headerIdx + 1).map((x) => num(x[c])).filter((v) => Number.isFinite(v));
    out[k] = /%/.test(head) && vals.length > 0 && vals.every((v) => v <= 100);
  }
  return out;
}

// ======================================================================= документы

export type DocKindKey = "AUCTION_INVOICE" | "SPECIFICATION" | "ADVANCE_INVOICE" | "CALC_SHEET" | "UPD" | "PAYMENT_PROOF" | "OTHER";
export const DOC_KINDS: { key: DocKindKey; label: string }[] = [
  { key: "AUCTION_INVOICE", label: "Счёт аукциона / инвойс" },
  { key: "ADVANCE_INVOICE", label: "Счёт на оплату" },
  { key: "UPD", label: "УПД / акт" },
  { key: "CALC_SHEET", label: "Расчётный лист" },
  { key: "SPECIFICATION", label: "Спецификация" },
  { key: "PAYMENT_PROOF", label: "Платёжный документ" },
  { key: "OTHER", label: "Другое" },
];
export const DOC_KIND_LABEL: Record<DocKindKey, string> = Object.fromEntries(DOC_KINDS.map((k) => [k.key, k.label])) as Record<DocKindKey, string>;
/** Какие типы документов имеют сумму, сверяемую с лотами. */
export const AMOUNT_KINDS: DocKindKey[] = ["AUCTION_INVOICE", "ADVANCE_INVOICE", "UPD", "CALC_SHEET"];

const DRIVE_TO_KIND: Record<string, DocKindKey> = {
  AUCTION_INVOICE: "AUCTION_INVOICE", PAYMENT_INVOICE: "ADVANCE_INVOICE", UPD: "UPD", CALC_SHEET: "CALC_SHEET",
  SPECIFICATION: "SPECIFICATION", PAYMENT_PROOF: "PAYMENT_PROOF",
};

export type DocFind = { kind: DocKindKey | null; number: string | null; date: string | null; amount: number | null; amountNote: string | null };

/** ISO-дата (гггг-мм-дд) из «22.09.2026», «22.09.26» или «22 сентября 2026». */
export function parseRuDate(s: string): string | null {
  const months = ["январ", "феврал", "март", "апрел", "ма", "июн", "июл", "август", "сентябр", "октябр", "ноябр", "декабр"];
  let m = /(\d{1,2})[./](\d{1,2})[./](\d{4}|\d{2})\b/.exec(s);
  let d: number, mo: number, y: number;
  if (m) {
    d = +m[1]; mo = +m[2]; y = +m[3];
    if (y < 100) y += 2000;
  } else {
    m = /(\d{1,2})\s+([а-яё]+)\s+(\d{4})/i.exec(s);
    if (!m) return null;
    const idx = months.findIndex((x, i) => (x === "ма" ? /^ма[йя]/i.test(m![2]) : m![2].toLowerCase().startsWith(x)) && i >= 0);
    if (idx < 0) return null;
    d = +m[1]; mo = idx + 1; y = +m[3];
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Деньги из текста: «60 831 100,00», «1,234,567.89», «60831100». */
export function parseMoney(raw: string): number | null {
  let t = raw.replace(/[\s  ]/g, "");
  if (!t) return null;
  const lastComma = t.lastIndexOf(","), lastDot = t.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    const dec = lastComma > lastDot ? "," : ".";
    t = dec === "," ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  } else if (lastComma >= 0) {
    t = /,\d{1,2}$/.test(t) && t.indexOf(",") === lastComma ? t.replace(",", ".") : t.replace(/,/g, "");
  } else if (lastDot >= 0) {
    t = /\.\d{1,2}$/.test(t) && t.indexOf(".") === lastDot ? t : t.replace(/\./g, "");
  }
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

export function recognizeFromName(fileName: string): Pick<DocFind, "kind" | "number" | "date"> {
  const base = fileName.replace(/\.[A-Za-z0-9]{1,5}$/, "");
  const g = guessDocType(fileName);
  const kind = g ? (DRIVE_TO_KIND[g] ?? "OTHER") : null;
  let number: string | null = null;
  const withSign = /(?:№|N°|N\s|No\.?\s*|#)\s*([A-Za-zА-Яа-я0-9][\w\-/.]*)/i.exec(base);
  if (withSign) number = withSign[1].replace(/[._-]+$/, "");
  else {
    const afterWord = /(?:сч[её]т|упд|upd|инвойс|invoice|специф\S*|акт)[\s_\-:]*(\d[\w\-/]*)/i.exec(base);
    if (afterWord) number = afterWord[1].replace(/[._-]+$/, "");
    else {
      const stripped = base.replace(/\d{1,2}[.\-_]\d{1,2}[.\-_]\d{2,4}/g, " ");
      const solo = /(?:^|[\s_\-])(\d{2,7})(?=$|[\s_\-])/.exec(stripped);
      if (solo) number = solo[1];
    }
  }
  const dm = /\d{1,2}[.\-_]\d{1,2}[.\-_]\d{2,4}/.exec(base);
  return { kind, number, date: dm ? parseRuDate(dm[0].replace(/[\-_]/g, ".")) : null };
}

const AMOUNT_LABELS: { re: RegExp; rank: number; note: string }[] = [
  { re: /(?:всего|итого)\s+к\s+оплате/gi, rank: 6, note: "«Всего к оплате»" },
  { re: /(?:итого|всего)\s+с\s+ндс/gi, rank: 6, note: "«Итого с НДС»" },
  { re: /всего\s+по\s+сч[её]ту|сумма\s+сч[её]та/gi, rank: 5, note: "«Всего по счёту»" },
  { re: /к\s+оплате/gi, rank: 4, note: "«К оплате»" },
  { re: /(?:grand\s+total|total\s+amount|amount\s+due|total\s+due|invoice\s+total)/gi, rank: 5, note: "«Total»" },
  { re: /стоимость\s+всего\s+с\s+налогом|всего\s+по\s+документу/gi, rank: 5, note: "«Всего с налогом»" },
  { re: /итого/gi, rank: 2, note: "«Итого»" },
  { re: /\btotal\b/gi, rank: 2, note: "«Total»" },
];
const MONEY_AFTER = /[^\d\-]{0,70}?(\d[\d\s .,]*\d|\d)/y;

/** Тип, номер, дата и сумма документа по тексту (PDF/DOCX/XLSX уже превращены в текст). */
export function recognizeFromText(textRaw: string): DocFind {
  const text = textRaw.replace(/ /g, " ");
  const head = text.slice(0, 2500);
  let kind: DocKindKey | null = null;
  if (/универсальн\S*\s+передат/i.test(head) || /\bупд\b/i.test(head)) kind = "UPD";
  else if (/сч[её]т[- ]?фактур/i.test(head)) kind = "UPD";
  else if (/сч[её]т\s+на\s+оплату/i.test(head)) kind = "ADVANCE_INVOICE";
  else if (/\binvoice\b|инвойс/i.test(head)) kind = "AUCTION_INVOICE";
  else if (/сч[её]т\s*(?:№|n)/i.test(head)) kind = "AUCTION_INVOICE";
  else if (/расч[её]тн\S*\s+лист|расч[её]т\s+себестоимост|калькуляц/i.test(head)) kind = "CALC_SHEET";
  else if (/спецификаци/i.test(head)) kind = "SPECIFICATION";

  let number: string | null = null;
  let date: string | null = null;
  const reNumDate = /(?:сч[её]т(?:[- ]фактура)?(?:\s+на\s+оплату)?|универсальный\s+передаточный\s+документ|упд|invoice|инвойс|спецификация|акт)\s*(?:№|N°|No\.?|N|#)\s*([A-Za-zА-Яа-я0-9][\w\-/]*)(?:\s*(?:от|dated?|date:?)\s*([0-9]{1,2}[./][0-9]{1,2}[./][0-9]{2,4}|[0-9]{1,2}\s+[а-яё]+\s+[0-9]{4}))?/i;
  const m = reNumDate.exec(head);
  if (m) {
    number = m[1].replace(/[._-]+$/, "");
    if (m[2]) date = parseRuDate(m[2]);
  }
  if (!date) {
    const dm = /(?:от|date:?|dated)\s*(\d{1,2}[./]\d{1,2}[./]\d{2,4}|\d{1,2}\s+[а-яё]+\s+\d{4})/i.exec(head);
    if (dm) date = parseRuDate(dm[1]);
  }

  let best: { v: number; rank: number; note: string; at: number } | null = null;
  for (const lab of AMOUNT_LABELS) {
    lab.re.lastIndex = 0;
    let mm: RegExpExecArray | null;
    while ((mm = lab.re.exec(text))) {
      MONEY_AFTER.lastIndex = mm.index + mm[0].length;
      const am = MONEY_AFTER.exec(text);
      if (!am) continue;
      const v = parseMoney(am[1]);
      if (v === null || v < 100) continue;
      if (!best || lab.rank > best.rank || (lab.rank === best.rank && mm.index > best.at)) best = { v, rank: lab.rank, note: lab.note, at: mm.index };
    }
  }
  return { kind, number, date, amount: best?.v ?? null, amountNote: best?.note ?? null };
}

// ======================================================================= сверка суммы документа

export const DOC_TOLERANCE_RUB = 50;

export type Recon = {
  ok: boolean;
  diff: number; // документ − лоты (с НДС, ₽)
  message: string;
  reasons: string[];
};

export type ReconTotals = {
  inclVat: number;
  exclVat: number;
  currency: string;
  rate: number;
  /** Σ количество × цена в валюте закупки, без НДС. */
  foreignExcl: number;
  vatRates: number[];
  /** Часть суммы, которую выставляет аукцион (товар + сбор + НДС на сбор), ₽ — для сверки счёта аукциона. */
  auctionPart?: number | null;
};

const rub = (n: number) => n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₽";

/** Сверка суммы документа с суммой лотов. Допуск — 50 ₽; расхождение объясняется: 4%, НДС, курс, валюта. */
export function reconcileAmount(docAmount: number, t: ReconTotals, tol = DOC_TOLERANCE_RUB, kind?: DocKindKey): Recon {
  // Счёт аукциона выставляет только товар + сбор + НДС на сбор: выделка, транспорт, брокерский и НДС на товар в него не входят.
  if (kind === "AUCTION_INVOICE" && t.auctionPart != null && Math.abs(docAmount - t.auctionPart) <= tol) {
    return {
      ok: true,
      diff: Math.round((docAmount - t.auctionPart) * 100) / 100,
      message: `Сумма счёта аукциона ${rub(docAmount)} совпадает с частью лотов, которую выставляет аукцион (товар + сбор + НДС на сбор): ${rub(t.auctionPart)}. Полная себестоимость лотов ${rub(t.inclVat)} включает ещё выделку, транспорт, брокерский и НДС на товар.`,
      reasons: [],
    };
  }
  const diff = Math.round((docAmount - t.inclVat) * 100) / 100;
  if (Math.abs(diff) <= tol) {
    return { ok: true, diff, message: `Сумма документа ${rub(docAmount)} совпадает с суммой лотов ${rub(t.inclVat)}${Math.abs(diff) > 0.005 ? ` (разница ${rub(diff)} в пределах допуска ${tol} ₽)` : ""}.`, reasons: [] };
  }
  const reasons: string[] = [];
  const near = (a: number, b: number, rel = 0.0008) => Math.abs(a - b) <= Math.max(tol, Math.abs(b) * rel);
  if (near(docAmount, t.inclVat * 1.04)) reasons.push(`4%: документ больше суммы лотов на 4% (${rub(diff)}) — похоже, в нём учтена надбавка 4%. Поставщику её не платят и в закупку она не входит: 4% начисляется только при списании сырья в ТЗ.`);
  else if (near(docAmount, t.inclVat / 1.04)) reasons.push(`4%: документ меньше суммы лотов примерно на 4% (${rub(diff)}) — проверьте, не вычтена ли скидка или надбавка 4%.`);
  if (near(docAmount, t.exclVat)) reasons.push(`НДС: сумма документа ${rub(docAmount)} равна сумме лотов БЕЗ НДС — в документе, похоже, цены без НДС.`);
  else {
    const mainVat = t.vatRates.length === 1 ? t.vatRates[0] : null;
    for (const r of [0, 10, 20, 22]) {
      if (mainVat !== null && r === mainVat) continue;
      if (near(docAmount, t.exclVat * (1 + r / 100))) {
        reasons.push(`НДС: в документе, похоже, ставка ${r}%${mainVat !== null ? `, в лотах — ${mainVat}%` : ""}. Проверьте ставку НДС в таблице лотов.`);
        break;
      }
    }
  }
  if (t.currency !== "RUB") {
    if (near(docAmount, t.foreignExcl, 0.0002) || near(docAmount, t.foreignExcl * 1.22, 0.0002)) {
      reasons.push(`Валюта: сумма документа совпадает с суммой лотов в ${t.currency} (${t.foreignExcl.toLocaleString("ru-RU", { maximumFractionDigits: 2 })}). Это документ в валюте — сравнивайте его с рублёвым счётом.`);
    } else if (t.foreignExcl > 0 && t.exclVat > 0) {
      const implied = (docAmount / t.inclVat) * t.rate;
      const dev = Math.abs(implied - t.rate) / t.rate;
      if (dev <= 0.04) reasons.push(`Курс: если разница только в курсе, то по документу курс ≈ ${implied.toFixed(4)} вместо ${t.rate} (отклонение ${(dev * 100).toFixed(2)}%). Сверьте курс на дату счёта.`);
    }
  }
  const pct = t.inclVat > 0 ? (diff / t.inclVat) * 100 : 0;
  if (reasons.length === 0) reasons.push(`Причина неясна: разница ${rub(diff)} (${formatPercent(pct)}). Проверьте количество и цены лотов, не пропущен ли лот, и ставку НДС.`);
  return {
    ok: false,
    diff,
    message: `Сумма документа ${rub(docAmount)} ${diff > 0 ? "больше" : "меньше"} суммы лотов ${rub(t.inclVat)} на ${rub(Math.abs(diff))} (допуск ${tol} ₽).`,
    reasons,
  };
}

// ======================================================================= прочее

export const DEFAULT_VAT_RATE = DEFAULT_VAT;
export { roundRate };

// ======================================================================= данные мастера (клиент ⇄ сервер)

export type BatchHeader = {
  /** Аукцион из справочника ("" — не выбран). */
  auctionId: string;
  /** Новый аукцион: создаётся вместе с закупкой. */
  newAuction: { name: string; date: string; house: string } | null;
  supplierId: string;
  warehouseId: string;
  orderDate: string;
  currency: string;
  exchangeRate: string;
  vatDefault: string;
  /** Номер счёта, если в таблице нет столбца «Счёт аукциона №» (одна закупка). */
  invoiceNumber: string;
  /** Принять на склад сразу (иначе закупка остаётся черновиком — мех ещё в пути). */
  receiveNow: boolean;
  notes: string;
};

export type DocMeta = {
  /** Порядковый номер файла в отправке (индекс в FormData files). */
  idx: number;
  name: string;
  kind: DocKindKey;
  number: string;
  date: string;
  amount: string;
};

export type BatchPayload = {
  /** Ключ защиты от двойной отправки (один на «Создать»). */
  key: string;
  header: BatchHeader;
  rows: IntakeRow[];
  decisions: Decisions;
  pct: Partial<Record<"fee" | "broker", boolean>>;
  docs: DocMeta[];
  /** Пользователь подтвердил, что знает о расхождениях сумм документов с лотами. */
  ackMismatch: boolean;
};

export type PurchaseTotals = {
  key: string;
  invoice: string;
  lots: number;
  qty: number;
  inclVat: number;
  exclVat: number;
  avgInclPerUnit: number;
  avgExclPerUnit: number;
  /** Средняя цена молотка в валюте закупки за шкуру (без НДС). */
  avgForeign: number | null;
  foreignExcl: number;
  auctionPart: number | null;
  vatRates: number[];
};

export type DocRecon = {
  idx: number;
  name: string;
  kind: DocKindKey;
  /** С чем сверяли: «закупка 3017» / «вся партия». */
  against: string;
  amount: number | null;
  recon: Recon | null;
  note: string | null;
};

export type BatchPreview = {
  validation: ValidationResult;
  purchases: PurchaseTotals[];
  totals: { lots: number; qty: number; inclVat: number; exclVat: number; avgInclPerUnit: number; avgExclPerUnit: number; avgForeign: number | null; foreignExcl: number };
  docs: DocRecon[];
  /** Почему нельзя создавать (пусто — можно). */
  blocking: string[];
  /** Расхождения расчёта с файлом по «себестоимости за единицу» > 1 ₽. */
  planDiffRows: number;
  debtNow: number;
  receiving: boolean;
  newMaterials: string[];
  newColors: string[];
  mismatchDocs: number;
};

export type BatchResult = {
  ok: true;
  duplicate: boolean;
  receiving: boolean;
  auction: { id: string | null; name: string; created: boolean };
  purchases: { id: string; number: string; invoice: string; lots: number; qty: number; inclVat: number }[];
  totals: BatchPreview["totals"];
  debt: { before: number | null; after: number };
  purchased: { before: number | null; after: number };
  stock: { material: string; before: number; after: number }[];
  docsAttached: number;
  createdMaterials: string[];
  createdColors: string[];
  tasks: { text: string; href: string; kind: "doc" | "pay" | "check" | "receive" }[];
};
