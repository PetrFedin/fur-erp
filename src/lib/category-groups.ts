/** Группы категорий (верхний уровень справочника): порядок = порядок в списках, таблицах и фильтрах. */
export const CATEGORY_GROUPS = ["Одежда", "Аксессуары"] as const;
export const NO_GROUP = "Без группы";
/** Подписи пункта «Без группы» в фильтрах. Сейчас без группы только категория «Ремонт» (справочник), поэтому в фильтрах по ТЗ (Главная, ТЗ) — «Ремонт (без группы)»;
 *  среди артикулов без группы есть и модели без категории вообще (Изделия, Календарь) — там «Без группы · ремонт». */
export const NO_GROUP_TZ_LABEL = "Ремонт (без группы)";
export const NO_GROUP_ARTICLES_LABEL = "Без группы · ремонт";
/** Подпись пункта «Без группы» в фильтре Сводки по составу ТЗ: только ремонт — «Ремонт (без группы)», есть и другие — «Без группы · ремонт». */
export const noGroupLabelFor = (_repair: number, other: number): string => (other > 0 ? NO_GROUP_ARTICLES_LABEL : NO_GROUP_TZ_LABEL);

export const groupOf = (g: string | null | undefined): string => (g && g.trim() ? g.trim() : NO_GROUP);

/** Сортировка названий групп: сначала по порядку справочника, «Без группы» — в конце. */
export const groupRank = (g: string): number => {
  const i = (CATEGORY_GROUPS as readonly string[]).indexOf(g);
  return i >= 0 ? i : 99;
};
