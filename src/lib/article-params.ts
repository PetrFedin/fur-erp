// Свои параметры артикула («Сезон: осень», «Цвет: бежевый», любые другие): название + значение.
// Хранятся в ProductModel.attributes (Json): массив [{ name, value }] в порядке добавления; правки попадают в журнал изменений
// как правки любого другого поля артикула. Параметры сразу попадают в фильтр «Параметры» списка «Изделия» (значение фильтра — «название=значение»).
// Запасной путь на время, пока колонка не применена к базе: служебная запись SystemState `article-params:<id>` (значение { params: [...] });
// из неё же миграция 20261026090000_product_model_attributes и scripts/migrate-article-params.ts переносят данные в колонку.
import { Prisma, type PrismaClient } from "@prisma/client";

export const PARAM_KEY_PREFIX = "article-params:";
export const PARAM_NAME_MAX = 40;
export const PARAM_VALUE_MAX = 120;
export const PARAMS_MAX = 30;
/** Разделитель «название=значение» в значении фильтра. */
export const PARAM_SEP = "=";

export type ArticleParam = { name: string; value: string };

/** Типовые названия — те же понятия, что в фильтрах списка «Изделия» (категория и длина правятся в «Реквизитах», их тут нет). */
export const STANDARD_PARAM_NAMES = ["Тип меха", "Цвет", "Размер", "Сезон", "Подкладка", "Фасон", "Стиль", "PLU"] as const;

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

/** JSON поля -> безопасный список (массив [{ name, value }] или старый вид { params: [...] }; чужой или битый формат даёт пустой список). */
export function readParams(value: unknown): ArticleParam[] {
  const raw = Array.isArray(value) ? value : value && typeof value === "object" ? (value as { params?: unknown }).params : null;
  if (!Array.isArray(raw)) return [];
  const out: ArticleParam[] = [];
  for (const p of raw) {
    const r = validateParam((p as ArticleParam | null)?.name, (p as ArticleParam | null)?.value);
    if ("param" in r && !out.some((x) => x.name.toLowerCase() === r.param.name.toLowerCase())) out.push(r.param);
  }
  return out.slice(0, PARAMS_MAX);
}

/** Колонки ProductModel.attributes в базе ещё нет (миграция не применена). */
export function isMissingAttributesColumn(e: unknown): boolean {
  const err = e as { code?: string; message?: string } | null;
  const msg = String(err?.message ?? "");
  return err?.code === "P2022" || (/attributes/.test(msg) && /does not exist|Unknown field|Unknown argument/i.test(msg));
}

type Db = Pick<PrismaClient, "systemState" | "productModel">;

async function loadLegacyParams(db: Db, orgId: string): Promise<Map<string, ArticleParam[]>> {
  const rows = await db.systemState.findMany({ where: { organizationId: orgId, key: { startsWith: PARAM_KEY_PREFIX } }, select: { key: true, value: true } });
  const out = new Map<string, ArticleParam[]>();
  for (const r of rows) {
    const list = readParams(r.value);
    if (list.length) out.set(r.key.slice(PARAM_KEY_PREFIX.length), list);
  }
  return out;
}

/** Параметры всех артикулов организации: id артикула -> список. Если колонки ещё нет в базе — читает из SystemState. */
export async function loadAllArticleParams(db: Db, orgId: string): Promise<Map<string, ArticleParam[]>> {
  try {
    const rows = await db.productModel.findMany({ where: { organizationId: orgId, attributes: { not: Prisma.DbNull } }, select: { id: true, attributes: true } });
    const out = new Map<string, ArticleParam[]>();
    for (const r of rows) {
      const list = readParams(r.attributes);
      if (list.length) out.set(r.id, list);
    }
    return out;
  } catch (e) {
    if (!isMissingAttributesColumn(e)) throw e;
    return loadLegacyParams(db, orgId);
  }
}

/** Параметры одного артикула и способ хранения (legacy — колонки в базе ещё нет). null — артикул не найден. */
export async function loadArticleParams(db: Db, orgId: string, modelId: string): Promise<{ params: ArticleParam[]; legacy: boolean } | null> {
  try {
    const row = await db.productModel.findFirst({ where: { id: modelId, organizationId: orgId }, select: { attributes: true } });
    return row ? { params: readParams(row.attributes), legacy: false } : null;
  } catch (e) {
    if (!isMissingAttributesColumn(e)) throw e;
    const row = await db.productModel.findFirst({ where: { id: modelId, organizationId: orgId }, select: { id: true } });
    if (!row) return null;
    const sys = await db.systemState.findUnique({ where: { organizationId_key: { organizationId: orgId, key: PARAM_KEY_PREFIX + modelId } }, select: { value: true } });
    return { params: readParams(sys?.value), legacy: true };
  }
}

/** Записать параметры артикула (пустой список — поле очищается). В обычном режиме запись идёт через клиент с журналом изменений. */
export async function writeArticleParams(db: Db, orgId: string, modelId: string, next: ArticleParam[], legacy: boolean): Promise<void> {
  if (legacy) {
    const key = PARAM_KEY_PREFIX + modelId;
    if (next.length === 0) await db.systemState.deleteMany({ where: { organizationId: orgId, key } });
    else await db.systemState.upsert({ where: { organizationId_key: { organizationId: orgId, key } }, create: { organizationId: orgId, key, value: { params: next } }, update: { value: { params: next } } });
    return;
  }
  await db.productModel.updateMany({ where: { id: modelId, organizationId: orgId }, data: { attributes: next.length ? next : Prisma.DbNull } });
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
