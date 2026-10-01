import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { ACCESS, hasRole } from "@/lib/access";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { toggleSupplierActive } from "./actions";

export default async function SuppliersPage() {
  const session = await requireSession();
  const canCreate = hasRole(session.user.role, ACCESS.suppliers);
  const suppliers = await prisma.supplier.findMany({
    where: { organizationId: session.user.organizationId },
    orderBy: { name: "asc" },
  });

  const showContact = suppliers.some((x) => x.contactName);
  const showPhone = suppliers.some((x) => x.phone);
  const showEmail = suppliers.some((x) => x.email);
  const colCount = 3 + (showContact ? 1 : 0) + (showPhone ? 1 : 0) + (showEmail ? 1 : 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Поставщики</h1>
        {canCreate && (
          <Link href="/suppliers/new" className={buttonVariants()}>
            + Новый поставщик
          </Link>
        )}
      </div>

      <Table>
        <Thead>
          <Tr>
            <Th>Название</Th>
            {showContact && <Th>Контакт</Th>}
            {showPhone && <Th>Телефон</Th>}
            {showEmail && <Th>Email</Th>}
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
              {showContact && <Td>{s.contactName ?? "—"}</Td>}
              {showPhone && <Td>{s.phone ?? "—"}</Td>}
              {showEmail && <Td>{s.email ?? "—"}</Td>}
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
              <Td colSpan={colCount} className="py-8 text-center text-neutral-400">
                Поставщиков пока нет
              </Td>
            </Tr>
          )}
        </Tbody>
      </Table>
    </div>
  );
}
