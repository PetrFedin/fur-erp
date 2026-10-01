import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { buttonVariants, Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { redirect } from "next/navigation";
import { RoleSelect } from "./role-select";
import { toggleUserActive } from "./actions";

export default async function UsersPage({ searchParams }: PageProps<"/users">) {
  const session = await requireRole("OWNER", "ADMIN");
  const canManage = true;
  const isOwner = session.user.role === "OWNER";
  const sp = await searchParams;
  const flashError = typeof sp.error === "string" ? sp.error.slice(0, 300) : "";
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

      {flashError && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{flashError}</p>
      )}

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
                {canManage && (isOwner || u.role !== "OWNER") ? (
                  <RoleSelect
                    userId={u.id}
                    role={u.role}
                    disabled={u.id === session.user.id}
                    allowOwner={isOwner}
                  />
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
                {canManage && u.id !== session.user.id && (isOwner || u.role !== "OWNER") && (
                  <form
                    action={async () => {
                      "use server";
                      const res = await toggleUserActive(u.id);
                      if (res.error) redirect(`/users?error=${encodeURIComponent(res.error)}`);
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
