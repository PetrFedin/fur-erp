import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { escapeLike } from "@/lib/input";
import { compareModelNames, modelCodeVariants } from "@/lib/model-code";
import { buttonVariants } from "@/components/ui/button";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { Clamp } from "@/components/clamp";
import { InfoHint } from "@/components/info-hint";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { PhotoGalleryButton } from "@/components/photo-gallery";
import { loadPhotoSummary } from "@/lib/article-photos";
import { loadArticleFurTypes } from "@/lib/article-fur-type";
import { readSort, sortRows, thSort, type SortParams } from "@/lib/table-sort";
import { parseSupplierDescription, supplierArticleTitle, supplierSafeText } from "@/lib/supplier-article";

/**
 * «Изделия» для внешнего поставщика (Веллмех): артикул, название, категория, длина, мех и подкладка — и всё.
 * Никаких цен, наценок, себестоимости, остатков и ТЗ-сумм; описание артикула целиком не показывается (в нём бывают цены) —
 * только очищенное название и строки «Мех/Подкладка», которые вносит сам поставщик. Страница не берёт денежные поля вообще,
 * а page.tsx возвращает её раньше любых денежных запросов.
 */
export async function SupplierArticles({ orgId, q, noname, sp = {} }: { orgId: string; q: string; noname?: boolean; sp?: SortParams }) {
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
  // Фото изделий подрядчик видеть может; ссылок магазина и PLU здесь нет вообще (читаются только фото).
  const photos = await loadPhotoSummary(prisma, orgId);
  const all = models.map((m) => {
    const own = parseSupplierDescription(m.description);
    const tz = fromTz.get(m.id);
    return {
      ...m,
      furType: furTypes.get(m.id)?.fur ?? null,
      title: supplierArticleTitle(m.salesName, m.description),
      // Строки из описания артикула проходят тот же фильтр денег, что и текст ТЗ: в описании у нас бывают цены.
      fur: tz?.fur || supplierSafeText(own.fur, 200),
      lining: tz?.lining || supplierSafeText(own.lining, 200),
      sizes: supplierSafeText(own.sizes, 200),
      colors: supplierSafeText(own.colors, 200),
    };
  });
  const unnamed = all.filter((m) => !m.title).length;
  const byDefault = (noname ? all.filter((m) => !m.title) : all).sort(
    (a, b) => Number(!!a.title) - Number(!!b.title) || compareModelNames(a.name, b.name)
  );
  // Сортировка по клику на заголовок (?sort=…&dir=…); без неё — как раньше: сначала с названием, по артикулу.
  const sort = readSort(sp, ["name", "title", "category", "length", "fur", "furTz", "sizes", "colors"]);
  const rows = sortRows(byDefault, sort, { name: (m) => m.name, title: (m) => m.title, category: (m) => m.category, length: (m) => m.lengthClass, fur: (m) => m.furType, furTz: (m) => m.fur, sizes: (m) => m.sizes, colors: (m) => m.colors });
  const th = (k: string) => thSort("/articles", sp, k, sort);
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
            : <>Без названия: <Link href="/articles?noname=1" className="font-medium text-blue-700 hover:underline max-md:inline-block max-md:min-w-11 max-md:py-3 max-md:text-center">{unnamed}</Link> · <Link href="/chat?new=1" className="text-blue-700 hover:underline max-md:inline-block max-md:py-3">написать в чат</Link><InfoHint label="Без названия">Просим прислать наименование изделия: напишите нам в чате. Существующие артикулы правим мы.</InfoHint></>}
        </p>
      )}
      <Table stickyHeader className="min-w-[980px]">
        <Thead>
          <Tr>
            <Th {...th("name")}>Артикул</Th>
            <Th {...th("title")}>Название изделия</Th>
            <Th {...th("category")}>Категория</Th>
            <Th {...th("length")}>Длина</Th>
            <Th {...th("fur")}>Тип меха</Th>
            <Th {...th("furTz")}>Мех и подкладка</Th>
            <Th {...th("sizes")}>Размеры</Th>
            <Th {...th("colors")}>Цвета</Th>
          </Tr>
        </Thead>
        <Tbody>
          {rows.map((m) => (
            <Tr key={m.id} className={m.isActive ? undefined : "text-neutral-400"}>
              <Td className="font-medium">{m.name}{photos.get(m.id) ? <span className="ml-2 inline-block align-middle"><PhotoGalleryButton modelId={m.id} photos={photos.get(m.id)!} title={m.name} compact /></span> : null}{!m.isActive && <span className="ml-2 text-xs font-normal">не активен</span>}</Td>
              <Td className="max-w-[20rem]">{m.title ? <Clamp>{m.title}</Clamp> : <span className="text-amber-800">Нет названия</span>}</Td>
              <Td>{m.category || "—"}</Td>
              <Td>{m.lengthClass || "—"}</Td>
              <Td>{m.furType || "—"}</Td>
              <Td>
                <div className="max-w-[16rem]"><Clamp>{m.fur || "—"}</Clamp>{m.lining ? <Clamp className="text-xs text-neutral-500">подкладка: {m.lining}</Clamp> : null}</div>
              </Td>
              <Td className="max-w-[10rem] text-xs"><Clamp>{m.sizes || "—"}</Clamp></Td>
              <Td className="max-w-[10rem] text-xs"><Clamp>{m.colors || "—"}</Clamp></Td>
            </Tr>
          ))}
          {rows.length === 0 && (
            <Tr><Td colSpan={8} className="py-8 text-center text-neutral-500">{q ? "Нет результатов" : "Нет артикулов"}</Td></Tr>
          )}
        </Tbody>
      </Table>
      <p className="text-xs text-neutral-500">Всего артикулов: {rows.length}</p>
    </div>
  );
}
