// Расчётный лист лота для карточки: строки RawMaterialLot.costBreakdown.items (или costPlan позиции закупки) в виде таблицы
// «статья → значение → на шкуру → всего по лоту → категория сектора → источник».
// Значения, названия, категории и источники строк правятся в карточке лота (первоисточник): правка значения пересчитывает состав цены,
// молоток, $ и цену лота через lot-reprice (см. lot-sheet-calc.ts). В листе вперемешку суммы «за лот» и «за шкуру», курсы и проценты:
// колонки «на шкуру» / «всего по лоту» определяются по названию строки.
import { COMP_CATS, type CompCat } from "@/lib/price-composition";
import { SERVICE_VAT } from "@/lib/cost-plan";

export type SheetUnit = "₽" | "$" | "%" | "курс";
export type SheetItem = { label: string; value: number; title?: string; cat?: CompCat | null; src?: string; /** Индекс в исходном массиве items. */ orig?: number };

export type SheetRow = {
  idx: number;
  label: string;
  /** Название для показа (заметка), по умолчанию = label. */
  title: string;
  value: number;
  unit: SheetUnit;
  /** За что сумма: весь лот, одна шкура или не рублёвая строка. */
  basis: "lot" | "unit" | "none";
  perUnit: number | null;
  perLot: number | null;
  /** НДС внутри суммы строки, ₽ за лот (где он выделяется однозначно). */
  vat: number | null;
  /** Категория по словарю названий; null — справочная строка (курс, итог, НДС), в состав цены не входит. */
  autoCat: CompCat | null;
  /** Категория, выбранная вручную (заметка). */
  cat: CompCat | null;
  src: string;
  /** Подытог / справочная строка: не входит в сумму статей. */
  info: boolean;
  /** sector — входит в сектор состава цены; detail — уже входит в другую строку листа; info — справочная; unused — не учтена (не должно быть). */
  kind: "sector" | "detail" | "info" | "unused";
};

const CAT_KEYS = new Set<string>(COMP_CATS.map((c) => c.key));
export const isCompCat = (v: unknown): v is CompCat => typeof v === "string" && CAT_KEYS.has(v);

/** Справочные строки: курсы, итоги, НДС, «расчётный» — не статьи состава цены. */
const INFO = /^(курс|валютный курс|итого|нду?с(?![а-яa-z])|оплачено|расчётный$|расчетный$|корректировка|цена за ед|стоимость молоток за ед|цена закупка|брокерская комиссия, %|курс в гтд)/i;

/** Категория сектора по названию строки — по тому же словарю слов, что и в price-composition.ts. */
export function autoCatOfLabel(label: string): CompCat | null {
  const s = label.toLowerCase().replace(/ё/g, "е");
  if (/стоимость молоток лот|цена за ед\. по курсу/.test(s)) return "raw";
  if (INFO.test(label.trim())) return null;
  if (/аукцион|маркетинг|брок/.test(s) && !/комисс/.test(s)) return /брокерский %/.test(s) ? "mediator" : "agent";
  if (/выкраск|крашени|покраск/.test(s)) return "dye";
  if (/выдел|тониров|тортор|стрижк/.test(s)) return "dress";
  if (/перевозк|транспорт|доставк|таможн|пошлин/.test(s)) return "transport";
  if (/комисси/.test(s)) return /валют|банк/.test(s) ? "fx" : "mediator";
  if (/упаковк/.test(s)) return "other";
  return null;
}

function unitOf(label: string): SheetUnit {
  const s = label.toLowerCase();
  if (/курс/.test(s)) return "курс";
  if (/(комисси[яи]|ндс|брок[а-я.]*)\s*,\s*%\s*$/.test(s)) return "%";
  if (/\$|долл/.test(s)) return "$";
  return "₽";
}

/**
 * Строки таблицы. qty — получено; vatRate — ставка лота, %.
 * «Лотовый» лист (есть «Стоимость молоток ЛОТ без НДС»): суммы «за лот», кроме строк «за ед.», упаковки и «Брок. %».
 * Остальные листы: рублёвые строки — за шкуру.
 */
export function sheetRowsOf(items: SheetItem[], o: { qty: number; vatRate: number; defaultSrc: string; auto?: { cat: CompCat | null; kind: SheetRow["kind"] }[] | null }): SheetRow[] {
  const lotSheet = items.some((x) => x.label.trim().toLowerCase() === "стоимость молоток лот без ндс");
  const q = o.qty > 0 ? o.qty : 0;
  return items.map((it, idx) => {
    const label = it.label.trim();
    const unit = unitOf(label);
    const s = label.toLowerCase();
    let basis: SheetRow["basis"] = "none";
    if (unit === "₽") {
      if (lotSheet) basis = /за ед|упаковк|брок\. %/.test(s) ? "unit" : "lot";
      else basis = "unit";
    }
    const perLot = basis === "lot" ? it.value : basis === "unit" && q > 0 ? it.value * q : null;
    const perUnit = basis === "unit" ? it.value : basis === "lot" && q > 0 ? it.value / q : null;
    let vat: number | null = null;
    if (perLot != null) {
      if (/в т\.ч\. ндс/.test(s) && !/молоток/.test(s)) vat = (perLot * SERVICE_VAT) / (1 + SERVICE_VAT);
      else if (/стоимость молоток лот/.test(s) && o.vatRate > 0) vat = (perLot * o.vatRate) / 100;
    }
    const a = o.auto?.[idx];
    const autoCat = a ? a.cat : autoCatOfLabel(label);
    return {
      idx: it.orig ?? idx, label, title: it.title?.trim() || label, value: it.value, unit, basis, perUnit, perLot, vat, autoCat,
      cat: isCompCat(it.cat) ? it.cat : null, src: it.src?.trim() || o.defaultSrc, info: autoCat == null, kind: a ? a.kind : autoCat ? "sector" : "info",
    };
  });
}

/** Сырые строки расчёта с заметками (title/cat/src) — как лежат в costBreakdown лота. */
export function rawSheetItems(b: unknown): SheetItem[] {
  const items = (b as { items?: unknown } | null | undefined)?.items;
  if (!Array.isArray(items)) return [];
  const out: SheetItem[] = [];
  for (const [orig, x] of (items as Record<string, unknown>[]).entries()) {
    if (!x || typeof x.label !== "string" || !Number.isFinite(Number(x.value))) continue;
    out.push({
      label: x.label, value: Number(x.value), orig,
      title: typeof x.title === "string" ? x.title : undefined,
      cat: isCompCat(x.cat) ? x.cat : null,
      src: typeof x.src === "string" ? x.src : undefined,
    });
  }
  return out;
}
