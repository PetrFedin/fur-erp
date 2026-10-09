import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { ACCESS, hasRole } from "@/lib/access";
import { buttonVariants, Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { FilterBar } from "@/components/filters/filter-bar";
import { defineFilters, parseFilters, pick } from "@/lib/filters";
import { escapeLike } from "@/lib/input";
import { toggleClientActive } from "./actions";

// Список: поиск по названию, контакту, телефону и email; статус — активные / неактивные.
const LIST_FILTERS = defineFilters({ ...pick(["q", "status"], { q: { label: "Поиск" }, status: { allowed: ["active", "inactive"] } }) });

export default async function ClientsPage({ searchParams }: PageProps<"/clients">) {
  const session = await requireSession();
  const f = parseFilters(LIST_FILTERS, await searchParams);
  const needle = escapeLike(f.q);
  const canCreate = hasRole(session.user.role, ACCESS.clients);
  const clients = await prisma.client.findMany({
    where: {
      organizationId: session.user.organizationId,
      ...(f.status.length === 1 ? { isActive: f.status[0] === "active" } : {}),
      ...(f.q
        ? {
            OR: [
              { name: { contains: needle, mode: "insensitive" as const } },
              { contactName: { contains: needle, mode: "insensitive" as const } },
              { phone: { contains: needle, mode: "insensitive" as const } },
              { email: { contains: needle, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    orderBy: { name: "asc" },
  });

  const showContact = clients.some((x) => x.contactName);
  const showPhone = clients.some((x) => x.phone);
  const showEmail = clients.some((x) => x.email);
  const colCount = 3 + (showContact ? 1 : 0) + (showPhone ? 1 : 0) + (showEmail ? 1 : 0);

  const inactiveN = await prisma.client.count({ where: { organizationId: session.user.organizationId, isActive: false } });

  return (
    <div className="flex flex-col gap-4">
      <div className="-mb-2 text-sm"><Link href="/settings" className="text-neutral-500 hover:underline">← Настройки</Link></div>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Заказчики</h1>
        {canCreate && (
          <Link href="/clients/new" className={buttonVariants()}>
            + Новый заказчик
          </Link>
        )}
      </div>

      <FilterBar
        title="Фильтры заказчиков"
        controls={[
          { type: "text", name: "q", label: "Поиск", placeholder: "Название, контакт, телефон, email" },
          // «Статус» нужен, только если в справочнике есть и неактивные записи (иначе фильтр ничего не сужает).
          ...(inactiveN > 0 || f.status.length > 0 ? [{ type: "multi" as const, name: "status", label: "Статус", options: [{ value: "active", label: "Активные" }, { value: "inactive", label: "Неактивные" }], allLabel: "Все" }] : []),
        ]}
      />

      <Table stickyHeader>
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
              <Td colSpan={colCount} className="py-8 text-center text-neutral-500">
                {f.q || f.status.length ? "Ничего не найдено" : "Заказчиков пока нет"}
              </Td>
            </Tr>
          )}
        </Tbody>
      </Table>
    </div>
  );
}
