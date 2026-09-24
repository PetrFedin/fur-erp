import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
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
  const materials = await prisma.rawMaterial.findMany({
    where: { organizationId: session.user.organizationId },
    include: { category: true },
    orderBy: { name: "asc" },
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Сырьё</h1>
        <Link href="/materials/new" className={buttonVariants()}>
          + Новое сырьё
        </Link>
      </div>

      <Table>
        <Thead>
          <Tr>
            <Th>Название</Th>
            <Th>Артикул</Th>
            <Th>Категория</Th>
            <Th>Ед. изм.</Th>
            <Th>Мин. остаток</Th>
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
              <Td>{m.sku ?? "—"}</Td>
              <Td>{m.category?.name ?? "—"}</Td>
              <Td>{UNIT_LABELS[m.unit]}</Td>
              <Td>{m.minStockLevel ? formatQty(m.minStockLevel.toString()) : "—"}</Td>
              <Td>
                <Badge variant={m.isActive ? "success" : "default"}>
                  {m.isActive ? "Активно" : "Неактивно"}
                </Badge>
              </Td>
            </Tr>
          ))}
          {materials.length === 0 && (
            <Tr>
              <Td colSpan={6} className="py-8 text-center text-neutral-400">
                Сырья пока нет
              </Td>
            </Tr>
          )}
        </Tbody>
      </Table>
    </div>
  );
}
