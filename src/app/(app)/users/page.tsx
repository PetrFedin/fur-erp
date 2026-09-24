import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { buttonVariants, Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { RoleSelect } from "./role-select";
import { toggleUserActive } from "./actions";

export default async function UsersPage() {
  const session = await requireSession();
  const canManage = session.user.role === "OWNER" || session.user.role === "ADMIN";
  const users = await prisma.user.findMany({
    where: { organizationId: session.user.organizationId },
    orderBy: { createdAt: "asc" },
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Пользователи</h1>
        {canManage && (
          <Link href="/users/new" className={buttonVariants()}>
            + Новый пользователь
          </Link>
        )}
      </div>

      <Table>
        <Thead>
          <Tr>
            <Th>Имя</Th>
            <Th>Email</Th>
            <Th>Роль</Th>
            <Th>Статус</Th>
            <Th></Th>
          </Tr>
        </Thead>
        <Tbody>
          {users.map((u) => (
            <Tr key={u.id}>
              <Td className="font-medium">{u.name}</Td>
              <Td>{u.email}</Td>
              <Td>
                {canManage ? (
                  <RoleSelect userId={u.id} role={u.role} disabled={u.id === session.user.id} />
                ) : (
                  u.role
                )}
              </Td>
              <Td>
                <Badge variant={u.isActive ? "success" : "default"}>
                  {u.isActive ? "Активен" : "Неактивен"}
                </Badge>
              </Td>
              <Td>
                {canManage && u.id !== session.user.id && (
                  <form
                    action={async () => {
                      "use server";
                      await toggleUserActive(u.id);
                    }}
                  >
                    <Button type="submit" variant="ghost" size="sm">
                      {u.isActive ? "Деактивировать" : "Активировать"}
                    </Button>
                  </form>
                )}
              </Td>
            </Tr>
          ))}
        </Tbody>
      </Table>
    </div>
  );
}
