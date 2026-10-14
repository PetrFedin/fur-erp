import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { escapeLike } from "@/lib/input";
import { compareModelNames } from "@/lib/model-code";
import { buttonVariants } from "@/components/ui/button";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";

/**
 * «Изделия» для внешнего поставщика (Веллмех): артикул, название, категория, длина — и всё.
 * Никаких цен, наценок, себестоимости, остатков и ТЗ: страница не обращается к денежным данным вообще,
 * поэтому её нельзя «случайно» показать — page.tsx возвращает её раньше, чем выполняются любые денежные запросы.
 */
export async function SupplierArticles({ orgId, q }: { orgId: string; q: string }) {
  const like = q ? { contains: escapeLike(q), mode: "insensitive" as const } : null;
  const models = await prisma.productModel.findMany({
    where: {
      organizationId: orgId,
      AND: [
        { OR: [{ category: null }, { category: { not: "Ремонт" } }] },
        ...(like ? [{ OR: [{ name: like }, { salesCode: like }, { salesName: like }, { category: like }] }] : []),
      ],
    },
    select: { id: true, name: true, salesCode: true, salesName: true, category: true, lengthClass: true, isActive: true },
  });
  const rows = models.sort((a, b) => compareModelNames(a.name, b.name));
  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: "Изделия" }]} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Изделия</h1>
        <Link href="/models/new" className={buttonVariants()}>+ Новый артикул</Link>
      </div>
      <form className="flex flex-wrap items-center gap-2" role="search">
        <input name="q" defaultValue={q} placeholder="код, название, категория" className="ui-field h-9 w-72 max-w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm" />
        <button type="submit" className={buttonVariants({ variant: "outline" })}>Найти</button>
        {q && <Link href="/articles" className="text-sm text-neutral-500 hover:underline">сбросить</Link>}
      </form>
      <Table stickyHeader className="min-w-[560px]">
        <Thead>
          <Tr>
            <Th>Артикул</Th>
            <Th>Название</Th>
            <Th>Категория</Th>
            <Th>Длина</Th>
          </Tr>
        </Thead>
        <Tbody>
          {rows.map((m) => (
            <Tr key={m.id} className={m.isActive ? undefined : "text-neutral-400"}>
              <Td className="font-medium">{m.name}{!m.isActive && <span className="ml-2 text-xs font-normal">не активен</span>}</Td>
              <Td>{[m.salesCode, m.salesName].filter(Boolean).join(" · ") || "—"}</Td>
              <Td>{m.category || "—"}</Td>
              <Td>{m.lengthClass || "—"}</Td>
            </Tr>
          ))}
          {rows.length === 0 && (
            <Tr><Td colSpan={4} className="py-8 text-center text-neutral-500">{q ? "Ничего не найдено" : "Артикулов пока нет"}</Td></Tr>
          )}
        </Tbody>
      </Table>
      <p className="text-xs text-neutral-500">Всего артикулов: {rows.length}. Новый артикул вносится кнопкой выше — цены и себестоимость ведёт ЦУМ.</p>
    </div>
  );
}
