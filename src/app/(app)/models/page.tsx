import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { formatMoney } from "@/lib/utils";

export default async function ModelsPage() {
  const session = await requireSession();
  const models = await prisma.productModel.findMany({
    where: { organizationId: session.user.organizationId },
    include: { _count: { select: { materials: true } } },
    orderBy: { name: "asc" },
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Модели изделий</h1>
        <Link href="/models/new" className={buttonVariants()}>
          + Новая модель
        </Link>
      </div>

      <Table>
        <Thead>
          <Tr>
            <Th>Название</Th>
            <Th>Категория</Th>
            <Th>Цена продажи</Th>
            <Th>Позиций в BOM</Th>
            <Th>Статус</Th>
          </Tr>
        </Thead>
        <Tbody>
          {models.map((m) => (
            <Tr key={m.id}>
              <Td className="font-medium">
                <Link href={`/models/${m.id}`} className="hover:underline">
                  {m.name}
                </Link>
              </Td>
              <Td>{m.category ?? "—"}</Td>
              <Td>{m.sellingPrice ? formatMoney(m.sellingPrice.toString()) : "—"}</Td>
              <Td>{m._count.materials}</Td>
              <Td>
                <Badge variant={m.isActive ? "success" : "default"}>
                  {m.isActive ? "Активна" : "Неактивна"}
                </Badge>
              </Td>
            </Tr>
          ))}
          {models.length === 0 && (
            <Tr>
              <Td colSpan={5} className="py-8 text-center text-neutral-400">
                Моделей пока нет
              </Td>
            </Tr>
          )}
        </Tbody>
      </Table>
    </div>
  );
}
