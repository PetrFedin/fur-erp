// Категория изделия, вид меха, размер и цвет для аналитики «Что произведено».
//
// В базе нет справочника категорий: у модели (ProductModel.category) лежит
// свободный текст-описание («Пальто женское из соболя», «Головной убор (ушанка)»),
// у ТЗ — описание материала («жилет соболь»). Категория ОПРЕДЕЛЯЕТСЯ ПО НАЗВАНИЮ
// прозрачным правилом ниже: берём то ключевое слово, которое встречается в тексте
// раньше всех (так «Пальто … с шарфом» — пальто, а не шарф). Данные не меняются.
// Если у модели выбрана категория из справочника (categoryRef) — берётся она, правило ниже — запасной вариант.
// Ничего не нашли — «категория не определена» (показывается отдельной строкой со списком).
//
// Правила и тестовые примеры (CATEGORY_CASES) — в этом файле; проверка:
//   npx tsx scripts/test-product-category.ts

export const UNDEFINED_CATEGORY = "Категория не определена";
export const UNDEFINED_FUR = "Мех не определён";
export const UNDEFINED_SIZE = "Размер не указан";
export const UNDEFINED_COLOR = "Цвет не указан";

/** Таблица соответствий «ключевое слово в названии → категория». Порядок не важен: выбирается слово, найденное раньше всех в тексте. */
export const CATEGORY_RULES: ReadonlyArray<{ category: string; words: readonly string[] }> = [
  { category: "Полупальто", words: ["полупальто"] },
  { category: "Пальто", words: ["пальто"] },
  { category: "Шуба / полушубок", words: ["полушуб", "шуб"] },
  { category: "Жакет", words: ["жакет"] },
  { category: "Куртка", words: ["куртк"] },
  { category: "Жилет", words: ["жилет"] },
  { category: "Юбка", words: ["юбк"] },
  { category: "Кейп", words: ["кейп", "накидк", "пончо"] },
  { category: "Головной убор", words: ["головн", "шапк", "ушанк", "кубанк", "бейсболк", "повязк", "косынк", "ободок"] },
  { category: "Шарф", words: ["шарф", "палантин", "снуд"] },
  { category: "Варежки", words: ["варежк", "перчатк"] },
  { category: "Ремонт", words: ["ремонт"] },
];

// Слово должно начинаться с границы слова (не внутри другого: «пальто» внутри «полупальто» не считается).
const wordStart = (w: string) => new RegExp(`(?<![а-яёa-z])${w}`, "i");

function firstHit(text: string, rules: ReadonlyArray<{ label: string; words: readonly string[] }>): string | null {
  let best: { label: string; at: number } | null = null;
  for (const r of rules) {
    for (const w of r.words) {
      const m = wordStart(w).exec(text);
      if (m && (best === null || m.index < best.at)) best = { label: r.label, at: m.index };
    }
  }
  return best?.label ?? null;
}

const CATEGORY_MATCH = CATEGORY_RULES.map((r) => ({ label: r.category, words: r.words }));

/** Категория по одному тексту (или null, если ключевых слов нет). */
export function categoryFromText(text: string | null | undefined): string | null {
  const t = (text ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  return t ? firstHit(t, CATEGORY_MATCH) : null;
}

/** Все категории, ключевые слова которых встречаются в тексте (больше одной — соответствие спорное). */
export function categoryHitsFromText(text: string | null | undefined): string[] {
  const t = (text ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!t) return [];
  return CATEGORY_MATCH.filter((r) => r.words.some((w) => wordStart(w).test(t))).map((r) => r.label);
}

export type CategorySource = "ref" | "category" | "description" | "name" | "none";

/**
 * Категория изделия: сначала текст категории модели, затем описание материала в ТЗ, затем название модели.
 * source — откуда взято (для пометки «определено по названию»).
 */
export function classifyProduct(input: {
  /** Каноническое название из справочника категорий (ProductModel.categoryRef.name) — главнее любого правила. */
  refName?: string | null;
  modelCategory?: string | null;
  orderDescription?: string | null;
  modelName?: string | null;
}): { category: string; source: CategorySource } {
  const ref = (input.refName ?? "").trim();
  if (ref) return { category: ref, source: "ref" };
  const a = categoryFromText(input.modelCategory);
  if (a) return { category: a, source: "category" };
  const b = categoryFromText(input.orderDescription);
  if (b) return { category: b, source: "description" };
  const c = categoryFromText(input.modelName);
  if (c) return { category: c, source: "name" };
  return { category: UNDEFINED_CATEGORY, source: "none" };
}

export const SOURCE_LABEL: Record<CategorySource, string> = {
  ref: "по справочнику категорий",
  category: "по названию (категория модели)",
  description: "по описанию материала в ТЗ",
  name: "по названию модели",
  none: "не определена",
};

/** Тестовая таблица соответствий: [текст, ожидаемая категория]. */
export const CATEGORY_CASES: ReadonlyArray<readonly [string, string]> = [
  ["Пальто женское из соболя", "Пальто"],
  ["Полупальто женское из соболя", "Полупальто"],
  ["полупальто из арктической лисы", "Полупальто"],
  ["Полупальто из дикого соболя", "Полупальто"],
  ["Пальто женское из норки с шарфом", "Пальто"],
  ["Шуба укороченная", "Шуба / полушубок"],
  ["Полушубок из лисы", "Шуба / полушубок"],
  ["Жакет женский вязаный из соболя", "Жакет"],
  ["Куртка женская из каракульчи", "Куртка"],
  ["Куртка меховая", "Куртка"],
  ["Куртка из стриженой норки", "Куртка"],
  ["Жилет женский из норки", "Жилет"],
  ["жилет соболь", "Жилет"],
  ["Юбка из свакары", "Юбка"],
  ["Головной убор", "Головной убор"],
  ["Головной убор (ободок из лоскута соболя)", "Головной убор"],
  ["Головной убор\n(повязка меховая)", "Головной убор"],
  ["Головной убор\n(Бейсболка)", "Головной убор"],
  ["косынка норка коричневая", "Головной убор"],
  ["Шарф меховой", "Шарф"],
  ["Варежки", "Варежки"],
  ["Ремонт", "Ремонт"],
  ["Кейп из соболя", "Кейп"],
  ["Шкура норки", UNDEFINED_CATEGORY],
  ["", UNDEFINED_CATEGORY],
];

// ───────────────────────────── Вид меха ─────────────────────────────

export const FUR_TEXT_RULES: ReadonlyArray<{ label: string; words: readonly string[] }> = [
  { label: "Соболь", words: ["соболь", "соболя", "соболе", "соболи", "соболин"] },
  { label: "Норка", words: ["норк"] },
  { label: "Каракуль (свакара)", words: ["каракул", "свакар", "swakara"] },
  { label: "Лиса", words: ["лис"] },
  { label: "Бобр", words: ["бобр"] },
  { label: "Рысь", words: ["рысь", "рыси"] },
];

/** Вид меха по тексту (запасной вариант, когда у ТЗ нет списаний сырья). */
export function furFromText(text: string | null | undefined): string | null {
  const t = (text ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  return t ? firstHit(t, FUR_TEXT_RULES) : null;
}

export const FUR_CASES: ReadonlyArray<readonly [string, string | null]> = [
  ["Пальто женское из соболя", "Соболь"],
  ["Жилет женский из норки", "Норка"],
  ["Юбка из свакары", "Каракуль (свакара)"],
  ["Полушубок из лисы", "Лиса"],
  ["Куртка женская из каракульчи", "Каракуль (свакара)"],
  ["Шуба укороченная", null],
];

// ───────────────────────────── Размер ─────────────────────────────

export const SIZE_ONE = "Единый размер";
export const SIZE_CM = "Размер в см (Д×Ш)";
export const SIZE_SET = "Набор размеров";

/**
 * Размер в ТЗ записан по-разному («46», «NS», «единый», «44, 46», «6 6 6 7 7 7 8 8», «210*30»).
 * Одно значение — как есть; «единый/NS» — «Единый размер»; «210*30» — размер в см;
 * несколько разных значений — «Набор размеров» (разбить единицы по размерам нельзя: их число по размерам в ТЗ не записано).
 */
export function normalizeSize(raw: string | null | undefined): string {
  const t = (raw ?? "").trim();
  if (!t) return UNDEFINED_SIZE;
  if (/^(ед|ns\b|one|универс)/i.test(t)) return SIZE_ONE;
  if (/^\d+([.,]\d+)?\s*[*xх×]\s*\d+/i.test(t)) return SIZE_CM;
  const tokens = Array.from(new Set(t.split(/[\s,;/.]+/).filter(Boolean)));
  if (tokens.length === 1) return /^\d+$/.test(tokens[0]) ? tokens[0] : tokens[0].toUpperCase();
  return SIZE_SET;
}

export const SIZE_CASES: ReadonlyArray<readonly [string | null, string]> = [
  [null, UNDEFINED_SIZE],
  ["", UNDEFINED_SIZE],
  ["46", "46"],
  ["NS", SIZE_ONE],
  ["единый размер", SIZE_ONE],
  ["Единый размер", SIZE_ONE],
  ["единый", SIZE_ONE],
  ["46, 48", SIZE_SET],
  ["6 6 6 7 7 7 8 8", SIZE_SET],
  ["46 46", "46"],
  ["58.58", "58"],
  ["210*30", SIZE_CM],
  ["57,58,59,60,61,62", SIZE_SET],
  ["42 44", SIZE_SET],
];

/** Порядок размеров: числа по возрастанию, затем остальные. */
export function compareSizes(a: string, b: string): number {
  const na = /^\d+$/.test(a) ? Number(a) : null;
  const nb = /^\d+$/.test(b) ? Number(b) : null;
  if (na !== null && nb !== null) return na - nb;
  if (na !== null) return -1;
  if (nb !== null) return 1;
  return a.localeCompare(b, "ru");
}

// ───────────────────────────── Цвет ─────────────────────────────

/** Цвет без различий регистра и пробелов: «коричневый» и «Коричневый» — один цвет; написание на латинице не переводим. */
export function normalizeColor(raw: string | null | undefined): string {
  const t = (raw ?? "").trim().replace(/\s+/g, " ");
  if (!t) return UNDEFINED_COLOR;
  const low = t.toLowerCase();
  return low.charAt(0).toUpperCase() + low.slice(1);
}

export const COLOR_CASES: ReadonlyArray<readonly [string | null, string]> = [
  ["коричневый", "Коричневый"],
  ["Коричневый", "Коричневый"],
  ["BLACK GLAMA", "Black glama"],
  ["  ", UNDEFINED_COLOR],
  [null, UNDEFINED_COLOR],
];
