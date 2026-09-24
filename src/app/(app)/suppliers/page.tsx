import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { toggleSupplierActive } from "./actions";

export default async function SuppliersPage() {
  const session = await requireSession();
  const suppliers = await prisma.supplier.findMany({
    where: { organizationId: session.user.organizationId },
    orderBy: { name: "asc" },
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Поставщики</h1>
        <Link href="/suppliers/new" className={buttonVariants()}>
          + Новый поставщик
        </Link>
      </div>

      <Table>
        <Thead>
          <Tr>
            <Th>Название</Th>
            <Th>Контакт</Th>
            <Th>Телефон</Th>
            <Th>Email</Th>
            <Th>Статус</Th>
            <Th></Th>
          </Tr>
        </Thead>
        <Tbody>
          {suppliers.map((s) => (
            <Tr key={s.id}>
              <Td className="font-medium">
                <Link href={`/suppliers/${s.id}`} className="hover:underline">
                  {s.name}
                </Link>
              </Td>
              <Td>{s.contactName ?? "—"}</Td>
              <Td>{s.phone ?? "—"}</Td>
              <Td>{s.email ?? "—"}</Td>
              <Td>
                <Badge variant={s.isActive ? "success" : "default"}>
                  {s.isActive ? "Активен" : "Неактивен"}
                </Badge>
              </Td>
              <Td>
                <form
                  action={async () => {
                    "use server";
                    await toggleSupplierActive(s.id);
                  }}
                >
                  <Button type="submit" variant="ghost" size="sm">
                    {s.isActive ? "Деактивировать" : "Активировать"}
                  </Button>
                </form>
              </Td>
            </Tr>
          ))}
          {suppliers.length === 0 && (
            <Tr>
              <Td colSpan={6} className="py-8 text-center text-neutral-400">
                Поставщиков пока нет
              </Td>
            </Tr>
          )}
        </Tbody>
      </Table>
    </div>
  );
}
