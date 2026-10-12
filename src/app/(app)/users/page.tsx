import { UserNameEdit } from "./name-edit";
import { rowVersion } from "@/lib/concurrency";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { buttonVariants, Button } from "@/components/ui/button";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { redirect } from "next/navigation";
import { RoleSelect } from "./role-select";
import { toggleUserActive } from "./actions";
import { FilterBar } from "@/components/filters/filter-bar";
import { defineFilters, parseFilters, pick } from "@/lib/filters";
import { escapeLike } from "@/lib/input";

const ROLE_LABELS: Record<string, string> = {
  OWNER: "Владелец",
  ADMIN: "Администратор",
  PURCHASER: "Закупщик",
  WAREHOUSE: "Кладовщик",
  TECHNOLOGIST: "Технолог",
  ACCOUNTANT: "Бухгалтер",
  VIEWER: "Наблюдатель",
};

// Список: поиск по имени и email, роль (мультивыбор), статус. error — разовое сообщение после действия.
const USER_FILTERS = defineFilters({
  ...pick(["q"], { q: { label: "Поиск" } }),
  role: { kind: "multi", label: "Роль", allowed: Object.keys(ROLE_LABELS) },
});

export default async function UsersPage({ searchParams }: PageProps<"/users">) {
  const session = await requireRole("OWNER", "ADMIN");
  const canManage = true;
  const isOwner = session.user.role === "OWNER";
  const sp = await searchParams;
  const flashError = typeof sp.error === "string" ? sp.error.slice(0, 300) : "";
  const f = parseFilters(USER_FILTERS, sp);
  const users = await prisma.user.findMany({
    where: {
      organizationId: session.user.organizationId,
      ...(f.role.length ? { role: { in: f.role as Array<"OWNER"> } } : {}),
      ...(f.q ? { OR: [{ name: { contains: escapeLike(f.q), mode: "insensitive" as const } }, { email: { contains: escapeLike(f.q), mode: "insensitive" as const } }] } : {}),
    },
    orderBy: { createdAt: "asc" },
  });

  const presentRoles = new Set((await prisma.user.findMany({ where: { organizationId: session.user.organizationId }, select: { role: true } })).map((u) => u.role as string));

  return (
    <div className="flex flex-col gap-4">
      <div className="-mb-2 text-sm"><Link href="/settings" className="text-neutral-500 hover:underline">← Настройки</Link></div>
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

      <FilterBar
        title="Фильтры пользователей"
        dropOnChange={["error"]}
        controls={[
          { type: "text", name: "q", label: "Поиск", placeholder: "Имя или email" },
          { type: "multi", name: "role", label: "Роль", options: Object.entries(ROLE_LABELS).filter(([value]) => presentRoles.has(value)).map(([value, label]) => ({ value, label })), allLabel: "Все роли" },
        ]}
      />

      <Table stickyHeader>
        <Thead>
          <Tr>
            <Th>Имя</Th>
            <Th>Email</Th>
            <Th>Роль</Th>
            <Th></Th>
          </Tr>
        </Thead>
        <Tbody>
          {users.map((u) => (
            <Tr key={u.id}>
              <Td className="font-medium">
                {u.name}
                {canManage && (isOwner || u.role !== "OWNER") && <UserNameEdit userId={u.id} name={u.name} version={rowVersion(u, ["name"])} />}
              </Td>
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
          {users.length === 0 && (
            <Tr>
              <Td colSpan={5} className="py-8 text-center text-neutral-500">
                Ничего не найдено
              </Td>
            </Tr>
          )}
        </Tbody>
      </Table>
    </div>
  );
}
