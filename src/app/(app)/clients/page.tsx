import { readSort, sortRows, thSort } from "@/lib/table-sort";
import { ClientForm } from "./client-form";
import { createClient } from "./actions";
import { CreateDialog } from "@/components/create-dialog";
import { Breadcrumbs } from "@/components/breadcrumbs";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { ACCESS, hasRole } from "@/lib/access";
import { Button } from "@/components/ui/button";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { FilterBar } from "@/components/filters/filter-bar";
import { defineFilters, parseFilters, pick } from "@/lib/filters";
import { escapeLike } from "@/lib/input";
import { toggleClientActive } from "./actions";

// Список: поиск по названию, контакту, телефону и email; статус — активные / неактивные.
const LIST_FILTERS = defineFilters({ ...pick(["q"], { q: { label: "Поиск" } }) });

export const metadata = { title: "Заказчики" };

export default async function ClientsPage({ searchParams }: PageProps<"/clients">) {
  const session = await requireSession();
  const sp = await searchParams;
  const newOpen = sp.new === "1";
  const f = parseFilters(LIST_FILTERS, sp);
  const needle = escapeLike(f.q);
  const canCreate = hasRole(session.user.role, ACCESS.clients);
  const clients0 = await prisma.client.findMany({
    where: {
      organizationId: session.user.organizationId,
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

  const sort = readSort(sp, ["name", "contact", "phone", "email"]);
  const clients = sortRows(clients0, sort, { name: (x) => x.name, contact: (x) => x.contactName, phone: (x) => x.phone, email: (x) => x.email });
  const th = (k: string) => thSort("/clients", sp, k, sort);
  const showContact = clients.some((x) => x.contactName);
  const showPhone = clients.some((x) => x.phone);
  const showEmail = clients.some((x) => x.email);
  const colCount = 2 + (showContact ? 1 : 0) + (showPhone ? 1 : 0) + (showEmail ? 1 : 0);


  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: "Настройки", href: "/settings" }, { label: "Заказчики" }]} />
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Заказчики</h1>
        {canCreate && (
          <CreateDialog label="+ Новый заказчик" title="Новый заказчик" defaultOpen={newOpen}>
            <ClientForm action={createClient} />
          </CreateDialog>
        )}
      </div>

      <FilterBar
        title="Фильтры заказчиков"
        oneRow
        hideChips
        className="print:hidden"
        controls={[
          { type: "text", name: "q", label: "Поиск", placeholder: "Название, контакт, телефон, email" },
        ]}
      />

      <Table stickyHeader>
        <Thead>
          <Tr>
            <Th {...th("name")}>Название</Th>
            {showContact && <Th {...th("contact")}>Контакт</Th>}
            {showPhone && <Th {...th("phone")}>Телефон</Th>}
            {showEmail && <Th {...th("email")}>Email</Th>}
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
                {f.q  ? "Ничего не найдено" : "Заказчиков пока нет"}
              </Td>
            </Tr>
          )}
        </Tbody>
      </Table>
    </div>
  );
}
