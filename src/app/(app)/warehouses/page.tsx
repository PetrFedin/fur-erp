import { readSort, sortRows, thSort } from "@/lib/table-sort";
import { WarehouseForm } from "./warehouse-form";
import { createWarehouse } from "./actions";
import { CreateDialog } from "@/components/create-dialog";
import { Breadcrumbs } from "@/components/breadcrumbs";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { ACCESS, hasRole } from "@/lib/access";

import { Badge } from "@/components/ui/badge";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";

export const metadata = { title: "Склады" };

export default async function WarehousesPage({ searchParams }: PageProps<"/warehouses">) {
  const session = await requireSession();
  const sp = await searchParams;
  const newOpen = sp.new === "1";
  const canCreate = hasRole(session.user.role, ACCESS.warehouses);
  const warehouses0 = await prisma.warehouse.findMany({
    where: { organizationId: session.user.organizationId },
    orderBy: { name: "asc" },
  });

  const sort = readSort(sp, ["name", "address"]);
  const warehouses = sortRows(warehouses0, sort, { name: (w) => w.name, address: (w) => w.address?.trim() || null });
  const th = (k: string) => thSort("/warehouses", sp, k, sort);

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: "Настройки", href: "/settings" }, { label: "Склады" }]} />
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Склады</h1>
        {canCreate && (
          <CreateDialog label="+ Новый склад" title="Новый склад" defaultOpen={newOpen}>
            <WarehouseForm action={createWarehouse} />
          </CreateDialog>
        )}
      </div>

      <Table>
        <Thead>
          <Tr>
            <Th {...th("name")}>Название</Th>
            <Th {...th("address")}>Адрес</Th>
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
              <Td>{w.address?.trim() ? w.address : canCreate ? <Link href={`/warehouses/${w.id}`} className="text-xs text-neutral-500 hover:underline">не указан — заполнить</Link> : "—"}</Td>
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
