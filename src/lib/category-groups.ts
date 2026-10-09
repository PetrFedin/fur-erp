/** Группы категорий (верхний уровень справочника): порядок = порядок в списках, таблицах и фильтрах. */
export const CATEGORY_GROUPS = ["Одежда", "Аксессуары"] as const;
export const NO_GROUP = "Без группы";

export const groupOf = (g: string | null | undefined): string => (g && g.trim() ? g.trim() : NO_GROUP);

/** Сортировка названий групп: сначала по порядку справочника, «Без группы» — в конце. */
export const groupRank = (g: string): number => {
  const i = (CATEGORY_GROUPS as readonly string[]).indexOf(g);
  return i >= 0 ? i : 99;
};
