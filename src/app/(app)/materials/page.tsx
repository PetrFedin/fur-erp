import { MaterialCreate } from "./material-create";
import { CreateDialog } from "@/components/create-dialog";
import { Breadcrumbs } from "@/components/breadcrumbs";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { ACCESS, hasRole } from "@/lib/access";

import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { formatQty } from "@/lib/utils";
import { FilterBar } from "@/components/filters/filter-bar";
import { defineFilters, parseFilters, pick, splitNone } from "@/lib/filters";
import { escapeLike } from "@/lib/input";
import { loadMaterialVat } from "@/lib/material-vat-server";
import { MaterialVatCell } from "@/components/material-vat-cell";
import { WidgetRow } from "@/components/widget-row";
import { TILE_BOX, TileCaption, TileHead, TileValue } from "../dashboard/tile";

const UNIT_LABELS: Record<string, string> = {
  PIECE: "шт.",
  KG: "кг",
  M2: "м²",
  M: "м",
  SET: "компл.",
};

// Список: поиск по названию и артикулу; вид (мех — всё, кроме метров, подкладка — метры), категория, статус.
const MATERIAL_FILTERS = defineFilters({
  ...pick(["q", "category"], { q: { label: "Поиск" } }),
  type: { kind: "multi", label: "Вид", allowed: ["fur", "lining"] },
});

export const metadata = { title: "Справочник материалов" };

export default async function MaterialsPage({ searchParams }: PageProps<"/materials">) {
  const session = await requireSession();
  const canCreate = hasRole(session.user.role, ACCESS.materials);
  const sp = await searchParams;
  const newOpen = sp.new === "1";
  const unitParam = typeof sp.unit === "string" ? sp.unit : undefined;
  const defaultUnit = unitParam && ["PIECE", "KG", "M2", "M", "SET"].includes(unitParam) ? unitParam : undefined;
  const f = parseFilters(MATERIAL_FILTERS, sp);
  const cat = splitNone(f.category);
  const orgId = session.user.organizationId;
  const [materials, categories] = await Promise.all([
    prisma.rawMaterial.findMany({
      where: {
        organizationId: orgId,
        // Вид «мех» — единицы не метры (как на странице «Сырьё»), «подкладка» — метры.
        ...(f.type.length === 1 ? { unit: f.type[0] === "lining" ? "M" : { not: "M" } } : {}),
        ...(f.category.length ? { OR: [...(cat.rest.length ? [{ category: { name: { in: cat.rest } } }] : []), ...(cat.none ? [{ categoryId: null }] : [])] } : {}),
        ...(f.q ? { AND: [{ OR: [{ name: { contains: escapeLike(f.q), mode: "insensitive" as const } }, { sku: { contains: escapeLike(f.q), mode: "insensitive" as const } }] }] } : {}),
      },
      include: { category: true },
      orderBy: { name: "asc" },
    }),
    prisma.rawMaterialCategory.findMany({ where: { organizationId: orgId }, orderBy: { name: "asc" } }),
  ]);

  const vatBy = await loadMaterialVat(orgId);
  const showSku = materials.some((m) => m.sku);
  const showCategory = materials.some((m) => m.category);
  const showMin = materials.some((m) => m.minStockLevel);
  const colCount = 3 + (showSku ? 1 : 0) + (showCategory ? 1 : 0) + (showMin ? 1 : 0);


  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: "Настройки", href: "/settings" }, { label: "Материалы" }]} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Справочник материалов</h1>
        {canCreate && (
          <CreateDialog label="+ Добавить материал" title="Новый материал" defaultOpen={newOpen}>
            <MaterialCreate categories={categories} defaultUnit={defaultUnit} />
          </CreateDialog>
        )}
      </div>

      <FilterBar
        title="Фильтры материалов"
        oneRow
        hideChips
        className="print:hidden"
        controls={[
          { type: "text", name: "q", label: "Поиск", placeholder: "Название или артикул" },
          { type: "multi", name: "type", label: "Вид", options: [{ value: "fur", label: "Мех" }, { value: "lining", label: "Подкладка" }], allLabel: "Все" },
          { type: "multi", name: "category", label: "Категория", options: categories.map((c) => ({ value: c.name, label: c.name })), noneLabel: "Без категории", allLabel: "Все категории" },
        ]}
      />

      <WidgetRow id="materials" title="Материалы — состав" headerEnd={<Link href="/lots" className="text-xs text-blue-700 hover:underline print:hidden">→ Сырьё</Link>}>
        <div className="grid grid-cols-1 items-stretch gap-3 sm:grid-cols-3 print:grid-cols-3">
          <div className={TILE_BOX}>
            <TileHead>Материалов</TileHead>
            <TileValue>{materials.length}</TileValue>
            <TileCaption>по текущим фильтрам</TileCaption>
          </div>
          <div className={TILE_BOX}>
            <TileHead>Мех</TileHead>
            <TileValue>{materials.filter((m) => m.unit !== "M").length}</TileValue>
            <TileCaption>позиций справочника</TileCaption>
          </div>
          <div className={TILE_BOX}>
            <TileHead>Подкладка</TileHead>
            <TileValue>{materials.filter((m) => m.unit === "M").length}</TileValue>
            <TileCaption>тканей, в метрах</TileCaption>
          </div>
        </div>
      </WidgetRow>

      <Table stickyHeader>
        <Thead>
          <Tr>
            <Th>Название</Th>
            {showSku && <Th>Артикул</Th>}
            {showCategory && <Th>Категория</Th>}
            <Th>Ед. изм.</Th>
            {showMin && <Th>Мин. остаток</Th>}
            <Th>НДС в ТЗ</Th>
          </Tr>
        </Thead>
        <Tbody>
          {materials.map((m) => (
            <Tr key={m.id}>
              <Td className="font-medium">
                <Link href={`/materials/${m.id}`} className="hover:underline">
                  {m.name}
                </Link>
              </Td>
              {showSku && <Td>{m.sku ?? "—"}</Td>}
              {showCategory && <Td>{m.category?.name ?? "—"}</Td>}
              <Td>{UNIT_LABELS[m.unit]}</Td>
              {showMin && <Td>{m.minStockLevel ? formatQty(m.minStockLevel.toString()) : "—"}</Td>}
              <Td className="text-xs">{vatBy.get(m.id) ? <MaterialVatCell s={vatBy.get(m.id)!} /> : "—"}</Td>
            </Tr>
          ))}
          {materials.length === 0 && (
            <Tr>
              <Td colSpan={colCount} className="py-8 text-center text-neutral-500">
                {f.q || f.type.length || f.category.length  ? "Ничего не найдено" : "Сырья пока нет"}
              </Td>
            </Tr>
          )}
        </Tbody>
      </Table>
    </div>
  );
}
