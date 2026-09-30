import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { buttonVariants, Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { toggleClientActive } from "./actions";

export default async function ClientsPage() {
  const session = await requireSession();
  const clients = await prisma.client.findMany({
    where: { organizationId: session.user.organizationId },
    orderBy: { name: "asc" },
  });

  const showContact = clients.some((x) => x.contactName);
  const showPhone = clients.some((x) => x.phone);
  const showEmail = clients.some((x) => x.email);
  const colCount = 3 + (showContact ? 1 : 0) + (showPhone ? 1 : 0) + (showEmail ? 1 : 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Заказчики</h1>
        <Link href="/clients/new" className={buttonVariants()}>
          + Новый заказчик
        </Link>
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
          {clients.map((c) => (
            <Tr key={c.id}>
              <Td className="font-medium">
                <Link href={`/clients/${c.id}`} className="hover:underline">
                  {c.name}
                </Link>
              </Td>
              {showContact && <Td>{c.contactName ?? "—"}</Td>}
              {showPhone && <Td>{c.phone ?? "—"}</Td>}
              {showEmail && <Td>{c.email ?? "—"}</Td>}
              <Td>
                <Badge variant={c.isActive ? "success" : "default"}>
                  {c.isActive ? "Активен" : "Неактивен"}
                </Badge>
              </Td>
              <Td>
                <form
                  action={async () => {
                    "use server";
                    await toggleClientActive(c.id);
                  }}
                >
                  <Button type="submit" variant="ghost" size="sm">
                    {c.isActive ? "Деактивировать" : "Активировать"}
                  </Button>
                </form>
              </Td>
            </Tr>
          ))}
          {clients.length === 0 && (
            <Tr>
              <Td colSpan={colCount} className="py-8 text-center text-neutral-400">
                Заказчиков пока нет
              </Td>
            </Tr>
          )}
        </Tbody>
      </Table>
    </div>
  );
}
