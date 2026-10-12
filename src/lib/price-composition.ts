// Состав финальной рублёвой цены лота меха: «Сырьё (молоток)», выделка, выкраска, транспорт, сборы аукциона, комиссия Веллмех, прочее.
// Источник — расчётный лист лота (RawMaterialLot.costBreakdown.items) или расчёт позиции закупки (PurchaseItem.costPlan.costBreakdown.items).
// Листы бывают четырёх видов (по набору строк; единицы строк в них разные — «за лот» или «за шкуру», «$» в подписи иногда означает ₽):
//   lot  — «Стоимость молоток ЛОТ без НДС», «Услуги Аукциона в т.ч. НДС», «Выделка (тонировка / тортора) в т.ч. НДС», «Перевозка в т.ч. НДС», «Комиссия» — суммы за весь лот;
//   fx   — «Курс ЦБ (фиксация)» + «НДС на шкуры» + «Комиссия РМ, 4,5%» — суммы за шкуру, молоток считается из НДС на шкуры;
//   inv  — «Валютный курс инвойса» (EUR→USD) — суммы за шкуру, молоток = цена в евро из расчёта Drive × курс инвойса × курс ЦБ;
//   plan — «Итого себестоимость за единицу, ₽» (расчёт позиции закупки, мех ещё не получен) — суммы за шкуру;
//   cust — расчёт позиции закупки с «Пошлина 5%» (рысь): сборы в $ × курс ЦБ, остальное в ₽ за шкуру; молоток вместе с НДС 22% — остаток до себестоимости единицы.
// Все суммы собираются «с НДС» (в той базе, в какой посчитана цена лота: Σ = totalCost лота), а «без НДС» получается делением на (1 + ставка лота),
// как и везде в системе (unitExcl = unitIncl ÷ (1+ставка)). Что не распознано — «Прочие расходы» (остаток до цены лота, копейки не теряются).
import { lotUsdRef } from "@/lib/lot-hammer";

export type CompCat = "raw" | "fx" | "transport" | "dress" | "dye" | "agent" | "mediator" | "other";

export const COMP_CATS: { key: CompCat; label: string; hint: string }[] = [
  { key: "raw", label: "Сырьё (молоток)", hint: "Цена шкур на аукционе (молоток) до сборов, выделки, транспорта и комиссий; НДС на молоток входит в цену лота и учтён в этой доле." },
  { key: "fx", label: "Валютные комиссии", hint: "Курсовая разница, банк, валютный контроль. В расчётных листах лотов отдельных строк нет — сектор появится, когда они будут внесены." },
  { key: "transport", label: "Транспорт и таможня", hint: "Перевозка, доставка, транспорт на выделку и обратно, аванс на таможню." },
  { key: "dress", label: "Выделка", hint: "Выделка, тонировка, торторо, стрижка. Где в расчёте «выделка/крашение/стрижка» одной строкой — вся строка здесь." },
  { key: "dye", label: "Выкраска", hint: "Крашение и покраска, когда они выделены в расчёте отдельной строкой." },
  { key: "agent", label: "Аукционные сборы и брокер", hint: "Услуги аукциона (аукционный, маркетинговый сбор, сбор за доставку), брокерский процент." },
  { key: "mediator", label: "Комиссия Веллмех", hint: "Вознаграждение посредника: строки «Комиссия», «Комиссия РМ, 4,5%», «Брокерский %, 4,5% от цены»." },
  { key: "other", label: "Прочие расходы", hint: "Упаковка, округления и всё, что не распознано в расчёте: остаток до цены лота." },
];

export const CAT_LABEL: Record<CompCat, string> = Object.fromEntries(COMP_CATS.map((c) => [c.key, c.label])) as Record<CompCat, string>;

export type CompFormat = "lot" | "fx" | "inv" | "plan" | "cust";

export type Composition = {
  /** Составляющие цены лота, ₽ за весь лот, в базе «с НДС» (Σ = цена лота с НДС). */
  incl: Record<CompCat, number>;
  /** Цена лота с НДС, ₽ (Σ incl). */
  total: number;
  format: CompFormat;
  /** Часть сумм вычислена (не строкой расчёта): молоток из справочника Drive / остаток. */
  approx: boolean;
  /** Строки расчёта, не вошедшие ни в один сектор (для отчёта). */
  unused: string[];
  /** Часть «Прочих расходов» (incl), заданная строкой «Упаковка»; остальное — остаток до цены лота. */
  pack: number;
};

export const emptyCats = (): Record<CompCat, number> => ({ raw: 0, fx: 0, transport: 0, dress: 0, dye: 0, agent: 0, mediator: 0, other: 0 });

type Item = { label?: unknown; value?: unknown };

export function itemsOfBreakdown(b: unknown): { label: string; value: number }[] {
  const items = (b as { items?: unknown } | null | undefined)?.items;
  if (!Array.isArray(items)) return [];
  return (items as Item[])
    .filter((x) => x && typeof x.label === "string" && Number.isFinite(Number(x.value)))
    .map((x) => ({ label: (x.label as string).trim(), value: Number(x.value) }));
}

export type CompInput = {
  /** costBreakdown лота. */
  breakdown: unknown;
  /** costPlan позиций закупки лота (используется, когда у лота нет своего расчёта). */
  plans?: unknown[];
  /** Ставка НДС лота, %. */
  vatRate: number;
  /** Количество шкур. */
  qty: number;
  /** Цена лота с НДС за весь лот, ₽ (unitIncl × recv). */
  totalIncl: number;
  purchaseNumber?: string | null;
  lotNumber?: string | null;
};

const INFO = /^(курс|валютный курс|итого|нду?с(?![а-яa-z])|оплачено|расчётный$|расчетный$|корректировка|цена за ед|стоимость молоток за ед|стоимость молоток лот|расчётная цена|расчетная цена|цена закупка|брокерская комиссия, %|курс в гтд)/i;

const fixOk = (items: { label: string; value: number }[]) => items.some((x) => x.label === "Курс ЦБ (фиксация)" && x.value > 0);

function decodeItems(items: { label: string; value: number }[], c: CompInput): Composition | null {
  if (items.length === 0) return null;
  const used = new Set<string>();
  const v = (label: string): number | null => {
    const it = items.find((x) => x.label.toLowerCase() === label.toLowerCase());
    if (!it) return null;
    used.add(it.label);
    return it.value;
  };
  const has = (label: string) => items.some((x) => x.label.toLowerCase() === label.toLowerCase());
  const vStarts = (prefix: string): number => {
    let s = 0;
    for (const x of items) if (x.label.toLowerCase().startsWith(prefix.toLowerCase())) { used.add(x.label); s += x.value; }
    return s;
  };
  const q = c.qty > 0 ? c.qty : 0;
  const k = c.vatRate > 0 ? c.vatRate / 100 : 0;
  const cats = emptyCats();
  let format: CompFormat;
  let approx = false;
  let pack = 0;

  if (has("Стоимость молоток ЛОТ без НДС")) {
    format = "lot";
    const hammer = v("Стоимость молоток ЛОТ без НДС") ?? 0;
    cats.raw = hammer;
    cats.agent += v("Услуги Аукциона в т.ч. НДС") ?? 0;
    const combined = v("Выделка (тонировка / тортора) в т.ч. НДС") ?? 0;
    const transport = v("Перевозка в т.ч. НДС");
    cats.transport += transport ?? 0;
    cats.mediator += v("Комиссия") ?? 0;
    // «Брок. % 3» в листах с перевозкой уже внутри «Перевозки»; без неё — отдельная сумма за лот.
    if (transport == null) cats.agent += v("Брок. % 3") ?? 0;
    // Выделка и выкраска: общая строка = выделка + крашение, части названы отдельными строками.
    const dressLine = has("Выделка") ? v("Выделка") : null;
    const dyeRf = has("Крашение в РФ") ? v("Крашение в РФ") : null;
    const paint = has("Покраска") ? v("Покраска") : null;
    if (combined > 0) {
      if (dressLine != null) { cats.dress += Math.min(dressLine, combined); cats.dye += Math.max(combined - dressLine, 0); }
      else if (dyeRf != null) { cats.dye += Math.min(dyeRf, combined); cats.dress += Math.max(combined - dyeRf, 0); }
      else if (paint != null && paint > 0) {
        if (q > 0 && Math.abs(paint * q - combined) <= combined * 0.01) cats.dye += combined;
        else if (paint <= combined) { cats.dye += paint; cats.dress += combined - paint; }
        else cats.dress += combined;
      } else cats.dress += combined;
    }
    // НДС на молоток (в части листов не выписан строкой): входит в цену лота и относится к молотку.
    const rest0 = c.totalIncl - Object.values(cats).reduce((a, x) => a + x, 0);
    if (k > 0 && hammer > 0 && Math.abs(rest0 - hammer * k) <= Math.max(c.totalIncl * 0.01, 5)) { cats.raw += rest0; }
  } else if (has("НДС на шкуры") && has("Комиссия РМ, 4,5%") && !has("Валютный курс инвойса")) {
    format = "fx";
    const vatHides = v("НДС на шкуры") ?? 0;
    cats.raw = k > 0 ? (vatHides / k) * (1 + k) * q : 0;
    cats.agent += ((v("Аукционный сбор") ?? 0) + (v("НДС на аукционный сбор") ?? 0)) * q;
    cats.dress += (v("Выделка/крашение/стрижка, $") ?? 0) * q;
    cats.transport += (v("Транспорт на выделку и обратно") ?? 0) * q;
    cats.mediator += (v("Комиссия РМ, 4,5%") ?? 0) * q;
    if (k <= 0) return null;
  } else if (has("Валютный курс инвойса")) {
    format = "inv";
    const fix = v("Курс ЦБ (фиксация)") ?? 0;
    const inv = v("Валютный курс инвойса") ?? 0;
    const ref = lotUsdRef(c.purchaseNumber, c.lotNumber);
    if (ref && fix > 0) {
      const usd = ref.currency === "EUR" ? ref.price * inv : ref.price;
      if (usd > 0 && (ref.currency === "USD" || inv > 0)) { cats.raw = usd * fix * q; approx = true; }
    }
    cats.agent += (v("Аукционный сбор") ?? 0) * fix * q;
    pack = (v("Упаковка") ?? 0) * fix * q;
    cats.other += pack;
    cats.dress += ((v("Выделка/крашение/стрижка, $") ?? 0) + (v("Выделка/крашение/стрижка, ₽") ?? 0)) * q;
    cats.transport += ((v("Аванс на таможню (вкл. услуги перевозчика, 30,5%)") ?? 0) + (v("Доставка ФИН-КЛД-МСК (авиа)") ?? 0)) * q;
    cats.mediator += (v("Комиссия РМ, 4,5%") ?? 0) * q;
  } else if (has("Пошлина 5%") && has("Комиссия РМ, 4,5%")) {
    format = "cust";
    const fix = v("Курс ЦБ (фиксация)") ?? 0;
    cats.agent += (((v("Аукционный сбор") ?? 0) + (v("Брокерская комиссия, %") ?? 0)) * fix) * q;
    pack = (v("Упаковка") ?? 0) * fix * q;
    cats.other += pack;
    cats.dress += (v("Выделка/крашение/стрижка, $") ?? 0) * q;
    cats.transport += ((v("Транспорт на выделку и обратно") ?? 0) + (v("Транспорт Выделка-Склад") ?? 0) + (v("Пошлина 5%") ?? 0)) * q;
    cats.mediator += (v("Комиссия РМ, 4,5%") ?? 0) * q;
    v("НДС 22%");
  } else if (has("Итого себестоимость за единицу, ₽")) {
    format = "plan";
    cats.raw = ((v("Цена за ед. по курсу, ₽") ?? 0) + items.filter((x) => /^нду?с(?![а-яa-z]).*на товар/i.test(x.label)).reduce((a, x) => (used.add(x.label), a + x.value), 0)) * q;
    cats.agent += (vStarts("Аукционный сбор") + vStarts("НДС на аукционный сбор")) * q;
    cats.dress += vStarts("Выделка") * q;
    cats.transport += vStarts("Транспорт") * q;
    cats.mediator += vStarts("Брокерский %") * q;
  } else return null;

  const sum = Object.values(cats).reduce((a, x) => a + x, 0);
  const total = c.totalIncl > 0 ? c.totalIncl : sum;
  let rest = total - sum;
  if (format === "cust" && fixOk(items)) { cats.raw += rest; rest = 0; }
  if (format === "inv") {
    // Брокерская комиссия в этих листах задана только процентом (1,95–2,58%): её сумма — остаток до цены лота.
    if (cats.raw === 0 && rest > 0) { cats.raw = rest; rest = 0; approx = true; }
    else if (Math.abs(rest) <= total * 0.05) { cats.agent += rest; rest = 0; }
  }
  cats.other += rest;
  if (Math.abs(cats.other) < 0.005) cats.other = 0;
  return { incl: cats, total, format, approx, pack, unused: items.filter((x) => !used.has(x.label) && !INFO.test(x.label) && x.value !== 0).map((x) => x.label) };
}

/** Состав цены лота: по расчёту лота, а если его нет — по расчёту позиции закупки. null — разбивки нет. */
export function lotComposition(c: CompInput): Composition | null {
  const own = decodeItems(itemsOfBreakdown(c.breakdown), c);
  if (own) return own;
  for (const p of c.plans ?? []) {
    const r = decodeItems(itemsOfBreakdown((p as { costBreakdown?: unknown } | null | undefined)?.costBreakdown), c);
    if (r) return r;
  }
  return null;
}

/**
 * Суммы по секторам без НДС (÷ (1 + ставка)) и НДС отдельно. Σ excl + vat = цена лота с НДС.
 * exclOverride — цена лота без НДС, как она записана в учёте (quantity × unitExcl, с копеечным округлением): секторы подгоняются под неё.
 */
export function splitVat(comp: Composition, vatRate: number, exclOverride?: number): { excl: Record<CompCat, number>; exclTotal: number; vat: number } {
  const k = 1 + (vatRate > 0 ? vatRate / 100 : 0);
  const natural = comp.total / k;
  const exclTotal = exclOverride != null && Number.isFinite(exclOverride) && natural !== 0 ? exclOverride : natural;
  const f = natural !== 0 ? exclTotal / natural : 1;
  const excl = emptyCats();
  for (const cat of COMP_CATS) excl[cat.key] = (comp.incl[cat.key] / k) * f;
  return { excl, exclTotal, vat: comp.total - exclTotal };
}

// ───────────────────────────── для графиков ─────────────────────────────

/** Цвета секторов: акцент темы, его оттенки и нейтральные; различимы и без цвета — у каждого сектора подпись и цифры в легенде. */
export const COMP_COLOR: Record<CompCat | "nobd" | "vat", string> = {
  raw: "var(--ui-accent, #ff4a1c)",
  agent: "#ff9d80",
  mediator: "#a8310f",
  transport: "#3d5a80",
  dress: "#7a7a7a",
  dye: "#b4b4b4",
  fx: "#d9d9d9",
  other: "#f0c2b2",
  nobd: "#cfcac5",
  vat: "#ebe6e1",
};

export type CompSlice = { key: string; label: string; value: number; color: string; hint?: string; /** Детализация сектора (раскрывающиеся подстроки в таблице); сумма подстрок = сумма сектора. */ sub?: CompSlice[] };

/** Сектора для графика из сумм по категориям (без НДС), «без разбивки» и НДС (показывается сектором только в режиме «с НДС»). Нулевые не включаются. */
export function sliceList(cats: Record<CompCat, number>, o: { nobd?: number; vat?: number; withVat: boolean }): CompSlice[] {
  const out: CompSlice[] = COMP_CATS.map((c) => ({ key: c.key, label: c.label, value: cats[c.key], color: COMP_COLOR[c.key], hint: c.hint }));
  if ((o.nobd ?? 0) !== 0) out.push({ key: "nobd", label: "Без разбивки в расчёте", value: o.nobd ?? 0, color: COMP_COLOR.nobd, hint: "Лоты и позиции, у которых в расчёте нет строк состава цены (или только итог): вся их стоимость без деления на составляющие." });
  if (o.withVat && (o.vat ?? 0) !== 0) out.push({ key: "vat", label: "НДС", value: o.vat ?? 0, color: COMP_COLOR.vat, hint: "НДС, включённый в цену лота (цена с НДС − цена без НДС)." });
  return out.filter((s) => Math.abs(s.value) >= 0.005);
}
