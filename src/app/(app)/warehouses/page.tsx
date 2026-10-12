import { Breadcrumbs } from "@/components/breadcrumbs";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { ACCESS, hasRole } from "@/lib/access";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";

export default async function WarehousesPage() {
  const session = await requireSession();
  const canCreate = hasRole(session.user.role, ACCESS.warehouses);
  const warehouses = await prisma.warehouse.findMany({
    where: { organizationId: session.user.organizationId },
    orderBy: { name: "asc" },
  });

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: "Настройки", href: "/settings" }, { label: "Склады" }]} />
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Склады</h1>
        {canCreate && (
          <Link href="/warehouses/new" className={buttonVariants()}>
            + Новый склад
          </Link>
        )}
      </div>

      <Table>
        <Thead>
          <Tr>
            <Th>Название</Th>
            <Th>Адрес</Th>
            <Th></Th>
          </Tr>
        </Thead>
        <Tbody>
          {warehouses.map((w) => (
            <Tr key={w.id}>
              <Td className="font-medium">
                <Link href={`/warehouses/${w.id}`} className="hover:underline">
                  {w.name}
                </Link>
              </Td>
              <Td>{w.address ?? "—"}</Td>
              <Td>{w.isDefault && <Badge variant="info">По умолчанию</Badge>}</Td>
            </Tr>
          ))}
          {warehouses.length === 0 && (
            <Tr>
              <Td colSpan={3} className="py-8 text-center text-neutral-500">
                Складов пока нет
              </Td>
            </Tr>
          )}
        </Tbody>
      </Table>
    </div>
  );
}
