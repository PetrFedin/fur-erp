// Свои параметры артикула («Сезон: осень», «Цвет: бежевый», любые другие): название + значение.
// Хранятся без миграции схемы — по одной записи SystemState на артикул (ключ `article-params:<id артикула>`, значение { params: [{ name, value }] }).
// Параметры сразу попадают в фильтр «Параметры» списка «Изделия» (значение фильтра — «название=значение»).
// Если параметры понадобятся в отчётах и сортировке — перенести в колонку ProductModel.attributes (Json) отдельной миграцией.
import type { PrismaClient } from "@prisma/client";

export const PARAM_KEY_PREFIX = "article-params:";
export const PARAM_NAME_MAX = 40;
export const PARAM_VALUE_MAX = 120;
export const PARAMS_MAX = 30;
/** Разделитель «название=значение» в значении фильтра. */
export const PARAM_SEP = "=";

export type ArticleParam = { name: string; value: string };

/** Типовые названия — те же понятия, что в фильтрах списка «Изделия» (категория и длина правятся в «Реквизитах», их тут нет). */
export const STANDARD_PARAM_NAMES = ["Тип меха", "Цвет", "Размер", "Сезон", "Подкладка", "Фасон", "Стиль"] as const;

const clean = (v: unknown, max: number) =>
  (typeof v === "string" ? v : "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

export function validateParam(rawName: unknown, rawValue: unknown): { param: ArticleParam } | { error: string } {
  const name = clean(rawName, PARAM_NAME_MAX + 1);
  const value = clean(rawValue, PARAM_VALUE_MAX + 1);
  if (!name) return { error: "Укажите название параметра" };
  if (name.length > PARAM_NAME_MAX) return { error: `Название не длиннее ${PARAM_NAME_MAX} символов` };
  if (name.includes(PARAM_SEP)) return { error: "В названии не должно быть знака «=»" };
  if (!value) return { error: "Укажите значение параметра" };
  if (value.length > PARAM_VALUE_MAX) return { error: `Значение не длиннее ${PARAM_VALUE_MAX} символов` };
  return { param: { name, value } };
}

/** JSON записи -> безопасный список (чужой или битый формат даёт пустой список). */
export function readParams(value: unknown): ArticleParam[] {
  const raw = value && typeof value === "object" ? (value as { params?: unknown }).params : null;
  if (!Array.isArray(raw)) return [];
  const out: ArticleParam[] = [];
  for (const p of raw) {
    const r = validateParam((p as ArticleParam | null)?.name, (p as ArticleParam | null)?.value);
    if ("param" in r && !out.some((x) => x.name.toLowerCase() === r.param.name.toLowerCase())) out.push(r.param);
  }
  return out.slice(0, PARAMS_MAX);
}

type Db = Pick<PrismaClient, "systemState">;

/** Параметры всех артикулов организации: id артикула -> список. */
export async function loadAllArticleParams(db: Db, orgId: string): Promise<Map<string, ArticleParam[]>> {
  const rows = await db.systemState.findMany({ where: { organizationId: orgId, key: { startsWith: PARAM_KEY_PREFIX } }, select: { key: true, value: true } });
  const out = new Map<string, ArticleParam[]>();
  for (const r of rows) {
    const list = readParams(r.value);
    if (list.length) out.set(r.key.slice(PARAM_KEY_PREFIX.length), list);
  }
  return out;
}

/** Варианты фильтра «Параметры»: «Название: значение» (число артикулов), значение в адресе — «название=значение». */
export function paramFilterOptions(all: Map<string, ArticleParam[]>): { value: string; label: string; count: number; group: string }[] {
  const m = new Map<string, { name: string; value: string; count: number }>();
  for (const list of all.values()) for (const p of list) {
    const k = p.name + PARAM_SEP + p.value;
    const cur = m.get(k) ?? { name: p.name, value: p.value, count: 0 };
    cur.count += 1;
    m.set(k, cur);
  }
  return Array.from(m, ([value, x]) => ({ value, label: `${x.name}: ${x.value}`, count: x.count, group: x.name }))
    .sort((a, b) => a.label.localeCompare(b.label, "ru"));
}

/** Артикулы, у которых есть хотя бы одно из выбранных «название=значение». */
export function modelIdsWithParams(all: Map<string, ArticleParam[]>, selected: string[]): string[] {
  const want = new Set(selected);
  return Array.from(all).filter(([, list]) => list.some((p) => want.has(p.name + PARAM_SEP + p.value))).map(([id]) => id);
}
