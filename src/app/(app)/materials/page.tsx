import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { ACCESS, hasRole } from "@/lib/access";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { formatQty } from "@/lib/utils";
import { FilterBar } from "@/components/filters/filter-bar";
import { defineFilters, parseFilters, pick, splitNone } from "@/lib/filters";
import { escapeLike } from "@/lib/input";

const UNIT_LABELS: Record<string, string> = {
  PIECE: "шт.",
  KG: "кг",
  M2: "м²",
  M: "м",
  SET: "компл.",
};

// Список: поиск по названию и артикулу; вид (мех — всё, кроме метров, подкладка — метры), категория, статус.
const MATERIAL_FILTERS = defineFilters({
  ...pick(["q", "category", "status"], { q: { label: "Поиск" }, status: { allowed: ["active", "inactive"] } }),
  type: { kind: "multi", label: "Вид", allowed: ["fur", "lining"] },
});

export default async function MaterialsPage({ searchParams }: PageProps<"/materials">) {
  const session = await requireSession();
  const canCreate = hasRole(session.user.role, ACCESS.materials);
  const f = parseFilters(MATERIAL_FILTERS, await searchParams);
  const cat = splitNone(f.category);
  const orgId = session.user.organizationId;
  const [materials, categories] = await Promise.all([
    prisma.rawMaterial.findMany({
      where: {
        organizationId: orgId,
        // Вид «мех» — единицы не метры (как на странице «Сырьё»), «подкладка» — метры.
        ...(f.type.length === 1 ? { unit: f.type[0] === "lining" ? "M" : { not: "M" } } : {}),
        ...(f.status.length === 1 ? { isActive: f.status[0] === "active" } : {}),
        ...(f.category.length ? { OR: [...(cat.rest.length ? [{ category: { name: { in: cat.rest } } }] : []), ...(cat.none ? [{ categoryId: null }] : [])] } : {}),
        ...(f.q ? { AND: [{ OR: [{ name: { contains: escapeLike(f.q), mode: "insensitive" as const } }, { sku: { contains: escapeLike(f.q), mode: "insensitive" as const } }] }] } : {}),
      },
      include: { category: true },
      orderBy: { name: "asc" },
    }),
    prisma.rawMaterialCategory.findMany({ where: { organizationId: orgId }, select: { name: true }, orderBy: { name: "asc" } }),
  ]);

  const showSku = materials.some((m) => m.sku);
  const showCategory = materials.some((m) => m.category);
  const showMin = materials.some((m) => m.minStockLevel);
  const colCount = 3 + (showSku ? 1 : 0) + (showCategory ? 1 : 0) + (showMin ? 1 : 0);

  const inactiveN = await prisma.rawMaterial.count({ where: { organizationId: orgId, isActive: false } });

  return (
    <div className="flex flex-col gap-4">
      <div className="-mb-2 text-sm"><Link href="/settings" className="text-neutral-500 hover:underline">← Настройки</Link></div>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Справочник материалов</h1>
        {canCreate && (
          <Link href="/materials/new" className={buttonVariants()}>
            + Добавить материал
          </Link>
        )}
      </div>

      <FilterBar
        title="Фильтры материалов"
        controls={[
          { type: "text", name: "q", label: "Поиск", placeholder: "Название или артикул" },
          { type: "multi", name: "type", label: "Вид", options: [{ value: "fur", label: "Мех" }, { value: "lining", label: "Подкладка" }], allLabel: "Все" },
          { type: "multi", name: "category", label: "Категория", options: categories.map((c) => ({ value: c.name, label: c.name })), noneLabel: "Без категории", allLabel: "Все категории" },
          // «Статус» нужен, только если в справочнике есть и неактивные записи (иначе фильтр ничего не сужает).
          ...(inactiveN > 0 || f.status.length > 0 ? [{ type: "multi" as const, name: "status", label: "Статус", options: [{ value: "active", label: "Активные" }, { value: "inactive", label: "Неактивные" }], allLabel: "Все" }] : []),
        ]}
      />

      <Table stickyHeader>
        <Thead>
          <Tr>
            <Th>Название</Th>
            {showSku && <Th>Артикул</Th>}
            {showCategory && <Th>Категория</Th>}
            <Th>Ед. изм.</Th>
            {showMin && <Th>Мин. остаток</Th>}
            <Th>Статус</Th>
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
              <Td>
                <Badge variant={m.isActive ? "success" : "default"}>
                  {m.isActive ? "Активно" : "Неактивно"}
                </Badge>
              </Td>
            </Tr>
          ))}
          {materials.length === 0 && (
            <Tr>
              <Td colSpan={colCount} className="py-8 text-center text-neutral-500">
                {f.q || f.type.length || f.category.length || f.status.length ? "Ничего не найдено" : "Сырья пока нет"}
              </Td>
            </Tr>
          )}
        </Tbody>
      </Table>
    </div>
  );
}
