/**
 * Сверка фильтров страницы «Изделия»: логика src/lib/article-filters.ts против независимых SQL-запросов к базе.
 * Только чтение. Для каждого фильтра берутся до 3 значений (самые частые) и сравниваются: число ТЗ (без отменённых) и число моделей.
 *
 *   NODE_PATH=<папка с заглушкой server-only> node --env-file=.env node_modules/.bin/tsx scripts/verify-articles-filters.ts
 * (analytics-orders подключает пакет server-only, которого вне Next нет — нужна пустая заглушка модуля.)
 */
import { PrismaClient } from "@prisma/client";
import { loadOrderRows } from "../src/lib/analytics-orders";
import { articleModelWhere, hasLiningText, matchedOrderIds, type ArticleFilterValues } from "../src/lib/article-filters";

const prisma = new PrismaClient();
const EMPTY: ArticleFilterValues = { q: "", category: [], fur: [], color: [], size: [], season: [], batch: [], lining: [], tzyear: [], tz: [], price: [] };

async function sql(q: string): Promise<Array<Record<string, unknown>>> {
  return (await prisma.$queryRawUnsafe(q)) as Array<Record<string, unknown>>;
}

async function main() {
  const org = (await prisma.organization.findFirstOrThrow()).id;
  const rows = await loadOrderRows(org, "all", "off");
  const lining = new Map((await prisma.productionOrder.findMany({ where: { organizationId: org }, select: { id: true, lining: true } })).map((o) => [o.id, hasLiningText(o.lining)]));
  const byId = new Map(rows.map((r) => [r.id, r]));
  let bad = 0;
  const report = (name: string, v: string, lib: { n: number; m: number }, db: { n: number; m: number }) => {
    const ok = lib.n === db.n && lib.m === db.m;
    if (!ok) bad++;
    console.log(`${ok ? "OK " : "ОШИБКА"} ${name.padEnd(9)} ${v.padEnd(28).slice(0, 28)} библиотека: ТЗ ${lib.n}, моделей ${lib.m} | SQL: ТЗ ${db.n}, моделей ${db.m}`);
  };
  const libCount = (f: Partial<ArticleFilterValues>) => {
    const ids = matchedOrderIds(rows, lining, { ...EMPTY, ...f }) ?? rows.map((r) => r.id);
    return { n: ids.length, m: new Set(ids.map((i) => byId.get(i)!.modelId)).size };
  };
  const top = async (sqlText: string) => (await sql(sqlText)).map((r) => String(r.v));
  const base = `from "ProductionOrder" o left join "Season" s on s.id=o."seasonId" left join "ProductionBatch" b on b.id=o."batchId" left join "ColorRef" cr on cr.id=o."colorRefId" where o."organizationId"='${org}' and o.status<>'CANCELLED'`;
  const dbCount = async (cond: string) => {
    const r = (await sql(`select count(*)::int n, count(distinct o."productModelId")::int m ${base} and ${cond}`))[0];
    return { n: Number(r.n), m: Number(r.m) };
  };
  const yearExpr = `extract(year from coalesce(o."workOrderDate", o."endDate", o."startDate", make_date(b.year,1,1)))::int`;

  // цвет, размер, сезон, партия, год ТЗ, номер ТЗ
  for (const v of await top(`select coalesce(cr.name,o.color) v ${base} group by 1 order by count(*) desc limit 3`))
    report("цвет", v, libCount({ color: [v] }), await dbCount(`coalesce(cr.name,o.color)='${v.replace(/'/g, "''")}'`));
  for (const v of await top(`select btrim(o.size) v ${base} and btrim(o.size) ~ '^[0-9]+$' group by 1 order by count(*) desc limit 3`))
    report("размер", v, libCount({ size: [v] }), await dbCount(`btrim(o.size) ~ '^${v}([ ,.]+${v})*$'`));
  for (const v of await top(`select s.code v ${base} and s.code is not null group by 1 order by count(*) desc limit 3`))
    report("сезон", v, libCount({ season: [v] }), await dbCount(`s.code='${v}'`));
  for (const v of await top(`select b.number::text v ${base} and b.number is not null group by 1 order by count(*) desc limit 3`))
    report("партия", v, libCount({ batch: [v] }), await dbCount(`b.number=${v}`));
  for (const v of await top(`select ${yearExpr}::text v ${base} and ${yearExpr} is not null group by 1 order by count(*) desc limit 3`))
    report("год ТЗ", v, libCount({ tzyear: [v] }), await dbCount(`${yearExpr}=${v}`));
  for (const v of await top(`select o.number v ${base} order by random() limit 3`))
    report("ТЗ", v, libCount({ tz: [v] }), await dbCount(`o.number='${v}'`));
  // подкладка да / нет (+ без выбора)
  const liningCond = `(btrim(coalesce(o.lining,'')) not in ('','-','–','—') and lower(btrim(o.lining)) not in ('нет','без подкладки') or exists(select 1 from "ProductionMaterialUsage" u join "RawMaterial" r on r.id=u."rawMaterialId" where u."productionOrderId"=o.id and r.unit='M' and u.quantity>0))`;
  report("подкладка", "да", libCount({ lining: ["yes"] }), await dbCount(liningCond));
  report("подкладка", "нет", libCount({ lining: ["no"] }), await dbCount(`not ${liningCond}`));
  // вид меха: ТЗ с списаниями сырья — через справочник меха в SQL; ТЗ без списаний (вид по тексту) в сверку не входят
  const furSql = `select distinct o.id, o."productModelId" mid, coalesce(fr.name, rm.name) fur from "ProductionOrder" o join "ProductionMaterialUsage" u on u."productionOrderId"=o.id join "RawMaterial" rm on rm.id=u."rawMaterialId" and rm.unit<>'M' left join "FurRef" fr on fr."organizationId"=o."organizationId" and (lower(btrim(fr.name))=lower(btrim(rm.name)) or lower(btrim(coalesce(fr."nameEn",'')))=lower(btrim(rm.name)) or lower(btrim(rm.name)) in (select lower(btrim(a)) from unnest(fr.aliases) a)) where o."organizationId"='${org}' and o.status<>'CANCELLED'`;
  const furAll = await sql(furSql);
  const furVals = Object.entries(furAll.reduce<Record<string, number>>((m, r) => ((m[String(r.fur)] = (m[String(r.fur)] ?? 0) + 1), m), {})).sort((a, b) => b[1] - a[1]).slice(0, 3).map((x) => x[0]);
  for (const v of furVals) {
    const ids = new Set(furAll.filter((r) => String(r.fur) === v).map((r) => String(r.id)));
    const lib = (matchedOrderIds(rows, lining, { ...EMPTY, fur: [v] }) ?? []).filter((i) => byId.get(i)!.furFromUsage);
    report("мех", v, { n: lib.length, m: new Set(lib.map((i) => byId.get(i)!.modelId)).size }, { n: ids.size, m: new Set(furAll.filter((r) => ids.has(String(r.id))).map((r) => String(r.mid))).size });
  }
  // уровень модели: категория, цена, поиск
  const modelCount = (w: object) => prisma.productModel.count({ where: w });
  for (const v of await top(`select c.name v from "CategoryRef" c join "ProductModel" m on m."categoryRefId"=c.id group by 1 order by count(*) desc limit 3`)) {
    const db = Number((await sql(`select count(*)::int n from "ProductModel" m join "CategoryRef" c on c.id=m."categoryRefId" where c.name='${v}'`))[0].n);
    report("категория", v, { n: 0, m: await modelCount(articleModelWhere(org, { q: "", category: [v], price: [] })) }, { n: 0, m: db });
  }
  const withPrice = Number((await sql(`select count(*)::int n from "ProductModel" where "organizationId"='${org}' and "sellingPrice" is not null`))[0].n);
  const noPrice = Number((await sql(`select count(*)::int n from "ProductModel" where "organizationId"='${org}' and "sellingPrice" is null`))[0].n);
  report("цена", "есть", { n: 0, m: await modelCount(articleModelWhere(org, { q: "", category: [], price: ["yes"] })) }, { n: 0, m: withPrice });
  report("цена", "нет", { n: 0, m: await modelCount(articleModelWhere(org, { q: "", category: [], price: ["no"] })) }, { n: 0, m: noPrice });
  const codeProbe = String((await sql(`select name from "ProductModel" where "organizationId"='${org}' order by name limit 1`))[0].name).slice(0, 3);
  for (const q of [codeProbe, "жакет", "ушан"]) {
    const db = Number((await sql(`select count(*)::int n from "ProductModel" where "organizationId"='${org}' and (name ilike '%${q}%' or sku ilike '%${q}%' or "salesCode" ilike '%${q}%' or "salesName" ilike '%${q}%' or '${q}' = any(aliases))`))[0].n);
    const lib = await modelCount(articleModelWhere(org, { q, category: [], price: [] }));
    report("поиск", q, { n: 0, m: lib }, { n: 0, m: db });
  }
  // пустые фильтры = прежний запрос страницы
  const w = JSON.stringify(articleModelWhere(org, { q: "", category: [], price: [] }));
  console.log(w === JSON.stringify({ organizationId: org }) ? "OK  пустые фильтры: условие моделей = { organizationId } как раньше; matchedOrderIds = null" : "ОШИБКА пустые фильтры", matchedOrderIds(rows, lining, EMPTY) === null ? "" : "ОШИБКА matchedOrderIds");
  console.log(bad ? `Расхождений: ${bad}` : "Расхождений нет");
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
