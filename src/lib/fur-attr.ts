/**
 * Справочник признаков меха (FurAttrRef): чистые функции без базы — их используют страница /settings/fur-attrs,
 * фильтр «Признак меха» (параметр `attr`) и scripts/apply-fur-attrs.ts.
 *
 * Признак — то, что в описаниях лотов и ТЗ пишут про шкуру помимо вида и цвета: седина соболя (SIL.1…SIL.6, «серебристый»,
 * «без седины»), происхождение (дикий / клеточный / баргузинский), обработка (тонированный, крашеный), марки (Blackglama).
 * Определение по тексту — по названию и синонимам признака: совпадение целыми словами (без регистра, «ё»=«е», знаки
 * препинания как разделители), поэтому «SIL.3», «SIL 3» и «sil-3» — одно и то же.
 */

export type FurAttrLite = {
  id: string;
  name: string;
  aliases: string[];
  group?: string | null;
  /** Вид меха (канонический, как в справочнике меха): «Соболь»; null — подходит к любому. */
  furKind?: string | null;
  /** Определять по тексту автоматически (скрипт apply-fur-attrs.ts); false — только предлагать. */
  autoDetect?: boolean;
  confirmed?: boolean;
};

/** Ключ сравнения: слова через пробел, без регистра, «ё»=«е». */
export function attrKey(raw: string | null | undefined): string {
  return tokensOf(raw).join(" ");
}

export function tokensOf(raw: string | null | undefined): string[] {
  return (raw ?? "").toLowerCase().replace(/ё/g, "е").match(/[\p{L}\p{N}]+/gu) ?? [];
}

/** «a, b; c» или по строкам → список без пустых и повторов (по ключу), без совпадающих с названием. */
export function parseAttrAliases(raw: string, name: string): string[] {
  const seen = new Set<string>([attrKey(name)]);
  const out: string[] = [];
  for (const part of raw.split(/[\n,;]+/)) {
    const a = part.trim().replace(/\s+/g, " ");
    const k = attrKey(a);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(a);
  }
  return out;
}

export type AttrHit<T extends FurAttrLite> = { attr: T; alias: string };

/** Ищет в тексте названия и синонимы признаков. Диапазон («SIL 6/7», «SILVER 4-5») для алиаса, оканчивающегося цифрой, — не точное значение (ambiguous). */
export function findAttrs<T extends FurAttrLite>(text: string | null | undefined, refs: T[], opts: { furKind?: string | null; onlyAuto?: boolean } = {}): { matched: AttrHit<T>[]; ambiguous: AttrHit<T>[] } {
  const t = tokensOf(text);
  const matched: AttrHit<T>[] = [];
  const ambiguous: AttrHit<T>[] = [];
  if (t.length === 0) return { matched, ambiguous };
  for (const r of refs) {
    if (opts.furKind && r.furKind && r.furKind !== opts.furKind) continue;
    let hit: AttrHit<T> | null = null;
    let amb: AttrHit<T> | null = null;
    for (const a of [r.name, ...r.aliases]) {
      const at = tokensOf(a);
      const n = at.length;
      if (n === 0) continue;
      const endsDigit = /^\d+$/.test(at[n - 1]);
      for (let i = 0; i + n <= t.length; i++) {
        let ok = true;
        for (let j = 0; j < n; j++) if (t[i + j] !== at[j]) { ok = false; break; }
        if (!ok) continue;
        if (endsDigit && i + n < t.length && /^\d+$/.test(t[i + n])) amb = amb ?? { attr: r, alias: a };
        else hit = hit ?? { attr: r, alias: a };
      }
    }
    if (hit) matched.push(hit);
    else if (amb) ambiguous.push(amb);
  }
  if (opts.onlyAuto) return { matched: matched.filter((h) => h.attr.autoDetect !== false), ambiguous };
  return { matched, ambiguous };
}

// ───────────────────────────── засев справочника ─────────────────────────────
// Только то, что реально встречается в описаниях лотов, ТЗ и моделей (отчёт — docs/fur-attrs.md). Всё засеяно как
// «предложено» (confirmed=false): владелец подтверждает на /settings/fur-attrs. autoDetect=false — спорное, только в предложениях.

export type FurAttrSeed = { name: string; group: string; furKind: string | null; aliases: string[]; description: string; autoDetect: boolean };

const sil = (n: number): FurAttrSeed => ({
  name: `Седина ${n}`,
  group: "Седина",
  furKind: "Соболь",
  aliases: [`SIL.${n}`, `SIL ${n}`, `Silvery ${n}`, `Silver ${n}`],
  description: `Степень седины (серебристости) ${n} по аукционному обозначению SIL.${n}.`,
  autoDetect: true,
});

export const FUR_ATTR_SEEDS: FurAttrSeed[] = [
  {
    name: "Седина",
    group: "Седина",
    furKind: "Соболь",
    aliases: ["седой", "седина", "седины", "серебристый", "серебристая", "SIL", "Silver", "Silvery", "Sedena"],
    description: "Любая седина (серебристость) соболя; степень — отдельными признаками «Седина 1…6». Лот с SIL.n получает и этот признак.",
    autoDetect: true,
  },
  sil(1), sil(2), sil(3), sil(4), sil(5), sil(6),
  {
    name: "Без седины",
    group: "Седина",
    furKind: "Соболь",
    aliases: ["без седины", "без седина", "No Silver", "NO SILVER", "тёмный без седины"],
    description: "Явно указано, что седины нет (в описании модели: «No Silver», «тёмный без седины»). Прочерк «-» на месте SIL в сорте лота сюда не относится — проверить.",
    autoDetect: true,
  },
  {
    name: "Дикий",
    group: "Происхождение",
    furKind: "Соболь",
    aliases: ["дикий", "дикая", "Wild"],
    description: "Дикий (промысловый) соболь — в отличие от клеточного.",
    autoDetect: true,
  },
  {
    name: "Клеточный",
    group: "Происхождение",
    furKind: "Соболь",
    aliases: ["клеточный", "клеточная", "фермерский", "фермерская", "Farm"],
    description: "Клеточный (фермерский) соболь.",
    autoDetect: true,
  },
  {
    name: "Баргузинский",
    group: "Происхождение",
    furKind: "Соболь",
    aliases: ["баргузинский", "баргузинская"],
    description: "Баргузинский соболь (подвид / место промысла, как написано в сорте лота).",
    autoDetect: true,
  },
  {
    name: "Тонированный",
    group: "Обработка",
    furKind: "Соболь",
    aliases: ["тонированный", "тонированная", "тонировка", "тонированные"],
    description: "Шкура прошла тонировку (в сорте лота, ТЗ или в операции позиции закупки).",
    autoDetect: true,
  },
  {
    name: "Крашеный",
    group: "Обработка",
    furKind: null,
    aliases: ["крашеный", "крашенный", "крашеная", "крашенная", "крашеные", "крашенные", "краш"],
    description: "Окрашенная шкура («крашенная в чёрный», «браун краш.»).",
    autoDetect: true,
  },
  {
    name: "Blackglama",
    group: "Марка / сорт",
    furKind: "Норка",
    aliases: ["Blackglama", "Black Glama", "блэкглама", "блекглама", "BGL"],
    description: "Проверить: марка норки Blackglama. «Американский блек» в описаниях ТЗ может означать просто чёрный цвет — автоматически не ставится.",
    autoDetect: false,
  },
  {
    name: "Махагон",
    group: "Марка / сорт",
    furKind: "Норка",
    aliases: ["махагон", "mahogany"],
    description: "Проверить: «норка коричневая (махагон)» — это оттенок/марка или цвет; в справочнике цветов не заведён.",
    autoDetect: false,
  },
  {
    name: "ТОП",
    group: "Марка / сорт",
    furKind: null,
    aliases: ["топ"],
    description: "Проверить: «ТОП» в сорте лота и в названии ТЗ («пальто соболь ТОП») — что именно это значит (сорт, линейка), в документах не расшифровано.",
    autoDetect: false,
  },
  {
    name: "Тортор",
    group: "Обработка",
    furKind: "Соболь",
    aliases: ["тортор", "торторо"],
    description: "Проверить: «ТОРТОР» в описаниях моделей («седой ТОРТОР (Silvery 4/5)») и «Операция: торторо» в позициях закупки — вид выделки/сорт, значение не расшифровано.",
    autoDetect: false,
  },
];

/** Порядок групп на экране и в фильтре. */
export const ATTR_GROUP_ORDER = ["Седина", "Происхождение", "Обработка", "Марка / сорт"];

export const ATTR_NONE_LABEL = "Без признака";

