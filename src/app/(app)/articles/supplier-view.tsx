import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { escapeLike } from "@/lib/input";
import { compareModelNames, modelCodeVariants } from "@/lib/model-code";
import { buttonVariants } from "@/components/ui/button";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { loadArticleFurTypes } from "@/lib/article-fur-type";
import { parseSupplierDescription, supplierArticleTitle, supplierSafeText } from "@/lib/supplier-article";

/**
 * «Изделия» для внешнего поставщика (Веллмех): артикул, название, категория, длина, мех и подкладка — и всё.
 * Никаких цен, наценок, себестоимости, остатков и ТЗ-сумм; описание артикула целиком не показывается (в нём бывают цены) —
 * только очищенное название и строки «Мех/Подкладка», которые вносит сам поставщик. Страница не берёт денежные поля вообще,
 * а page.tsx возвращает её раньше любых денежных запросов.
 */
export async function SupplierArticles({ orgId, q, noname }: { orgId: string; q: string; noname?: boolean }) {
  const variants = q ? modelCodeVariants(q) : [];
  const like = (v: string) => ({ contains: escapeLike(v), mode: "insensitive" as const });
  const models = await prisma.productModel.findMany({
    where: {
      organizationId: orgId,
      AND: [
        { OR: [{ category: null }, { category: { not: "Ремонт" } }] },
        ...(q ? [{ OR: variants.flatMap((v) => [{ name: like(v) }, { salesName: like(v) }, { category: like(v) }]) }] : []),
      ],
    },
    select: { id: true, name: true, salesName: true, description: true, category: true, lengthClass: true, isActive: true },
  });
  // Мех и подкладка по последним ТЗ артикула (текст, как в приложении к договору) — без сумм и количеств.
  const orders = await prisma.productionOrder.findMany({
    where: { organizationId: orgId, productModelId: { in: models.map((m) => m.id) } },
    select: { productModelId: true, materialDescription: true, lining: true },
    orderBy: { createdAt: "desc" },
  });
  const fromTz = new Map<string, { fur: string | null; lining: string | null }>();
  for (const o of orders) {
    const cur = fromTz.get(o.productModelId) ?? { fur: null, lining: null };
    cur.fur ??= supplierSafeText(o.materialDescription);
    cur.lining ??= supplierSafeText(o.lining);
    fromTz.set(o.productModelId, cur);
  }
  const furTypes = await loadArticleFurTypes(orgId);
  const all = models.map((m) => {
    const own = parseSupplierDescription(m.description);
    const tz = fromTz.get(m.id);
    return {
      ...m,
      furType: furTypes.get(m.id)?.fur ?? null,
      title: supplierArticleTitle(m.salesName, m.description),
      fur: own.fur || tz?.fur || null,
      lining: own.lining || tz?.lining || null,
    };
  });
  const unnamed = all.filter((m) => !m.title).length;
  const rows = (noname ? all.filter((m) => !m.title) : all).sort(
    (a, b) => Number(!!a.title) - Number(!!b.title) || compareModelNames(a.name, b.name)
  );
  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: "Изделия" }]} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Изделия</h1>
        <Link href="/models/new" className={buttonVariants()}>+ Новый артикул</Link>
      </div>
      <form className="flex flex-wrap items-center gap-2" role="search">
        <input name="q" defaultValue={q} placeholder="код, название, категория" className="ui-field h-9 w-72 max-w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm" />
        {noname && <input type="hidden" name="noname" value="1" />}
        <button type="submit" className={buttonVariants({ variant: "outline" })}>Найти</button>
        {q && <Link href={noname ? "/articles?noname=1" : "/articles"} className="text-sm text-neutral-500 hover:underline">сбросить</Link>}
      </form>
      {unnamed > 0 && (
        <p className="text-sm">
          {noname
            ? <Link href="/articles" className="text-blue-700 hover:underline">← Показать все артикулы</Link>
            : <>Без названия: <Link href="/articles?noname=1" className="font-medium text-blue-700 hover:underline">{unnamed}</Link> — просим прислать наименование изделия.</>}
        </p>
      )}
      <Table stickyHeader className="min-w-[860px]">
        <Thead>
          <Tr>
            <Th>Артикул</Th>
            <Th>Название изделия</Th>
            <Th>Категория</Th>
            <Th>Длина</Th>
            <Th>Тип меха</Th>
            <Th>Мех (материал)</Th>
            <Th>Подкладка</Th>
          </Tr>
        </Thead>
        <Tbody>
          {rows.map((m) => (
            <Tr key={m.id} className={m.isActive ? undefined : "text-neutral-400"}>
              <Td className="font-medium">{m.name}{!m.isActive && <span className="ml-2 text-xs font-normal">не активен</span>}</Td>
              <Td>{m.title ?? <span className="text-amber-700">— <span className="text-xs">название не задано</span></span>}</Td>
              <Td>{m.category || "—"}</Td>
              <Td>{m.lengthClass || "—"}</Td>
              <Td>{m.furType || "—"}</Td>
              <Td>{m.fur || "—"}</Td>
              <Td>{m.lining || "—"}</Td>
            </Tr>
          ))}
          {rows.length === 0 && (
            <Tr><Td colSpan={7} className="py-8 text-center text-neutral-500">{q ? "Ничего не найдено" : "Артикулов пока нет"}</Td></Tr>
          )}
        </Tbody>
      </Table>
      <p className="text-xs text-neutral-500">Всего артикулов: {rows.length}. Новый артикул вносится кнопкой выше — цены ведёт ЦУМ.</p>
    </div>
  );
}
