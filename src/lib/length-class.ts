import type { Prisma } from "@prisma/client";

/** Длина изделия по системе продаж (ProductModel.lengthClass). Для аксессуаров длины нет — «без длины». */
export const LENGTH_VALUES = ["Short", "Regular", "Long"] as const;
export const NO_LENGTH = "none";
export const LENGTH_ALLOWED: string[] = [...LENGTH_VALUES, NO_LENGTH];
export const LENGTH_OPTIONS = [...LENGTH_VALUES.map((v) => ({ value: v as string, label: v as string })), { value: NO_LENGTH, label: "Без длины" }];

/** Условие для ProductModel по выбранным значениям фильтра «Длина»; null — фильтр не выбран. */
export function lengthWhere(vals: readonly string[] | undefined): Prisma.ProductModelWhereInput | null {
  const v = (vals ?? []).filter((x) => LENGTH_ALLOWED.includes(x));
  if (v.length === 0) return null;
  const rest = v.filter((x) => x !== NO_LENGTH);
  return { OR: [...(rest.length ? [{ lengthClass: { in: rest } }] : []), ...(v.includes(NO_LENGTH) ? [{ lengthClass: null }] : [])] };
}

/** Для списков в памяти: подходит ли длина (null = без длины) под выбранные значения. */
export function matchesLength(vals: readonly string[] | undefined, lengthClass: string | null | undefined): boolean {
  const v = vals ?? [];
  if (v.length === 0) return true;
  return v.includes(lengthClass ? lengthClass : NO_LENGTH);
}

/** Длина из текста («short», «REGULAR»): Short / Regular / Long; NS, пусто и прочее — null. */
export function parseLength(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim().toLowerCase();
  return LENGTH_VALUES.find((x) => x.toLowerCase() === v) ?? null;
}
