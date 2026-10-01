import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { ACCESS, hasRole } from "@/lib/access";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { formatQty } from "@/lib/utils";

const UNIT_LABELS: Record<string, string> = {
  PIECE: "шт.",
  KG: "кг",
  M2: "м²",
  M: "м",
  SET: "компл.",
};

export default async function MaterialsPage() {
  const session = await requireSession();
  const canCreate = hasRole(session.user.role, ACCESS.materials);
  const materials = await prisma.rawMaterial.findMany({
    where: { organizationId: session.user.organizationId },
    include: { category: true },
    orderBy: { name: "asc" },
  });

  const showSku = materials.some((m) => m.sku);
  const showCategory = materials.some((m) => m.category);
  const showMin = materials.some((m) => m.minStockLevel);
  const colCount = 3 + (showSku ? 1 : 0) + (showCategory ? 1 : 0) + (showMin ? 1 : 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Справочник материалов</h1>
        {canCreate && (
          <Link href="/materials/new" className={buttonVariants()}>
            + Добавить материал
          </Link>
        )}
      </div>

      <Table>
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
              <Td colSpan={colCount} className="py-8 text-center text-neutral-400">
                Сырья пока нет
              </Td>
            </Tr>
          )}
        </Tbody>
      </Table>
    </div>
  );
}
