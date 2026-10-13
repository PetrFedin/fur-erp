import { Breadcrumbs } from "@/components/breadcrumbs";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { ACCESS, hasRole } from "@/lib/access";
import { Button, buttonVariants } from "@/components/ui/button";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { FilterBar } from "@/components/filters/filter-bar";
import { defineFilters, parseFilters, pick } from "@/lib/filters";
import { escapeLike } from "@/lib/input";
import { toggleSupplierActive } from "./actions";

// Список: поиск по названию, контакту, телефону и email; статус — активные / неактивные.
const LIST_FILTERS = defineFilters({ ...pick(["q"], { q: { label: "Поиск" } }) });

export default async function SuppliersPage({ searchParams }: PageProps<"/suppliers">) {
  const session = await requireSession();
  const f = parseFilters(LIST_FILTERS, await searchParams);
  const needle = escapeLike(f.q);
  const canCreate = hasRole(session.user.role, ACCESS.suppliers);
  const suppliers = await prisma.supplier.findMany({
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

  const showContact = suppliers.some((x) => x.contactName);
  const showPhone = suppliers.some((x) => x.phone);
  const showEmail = suppliers.some((x) => x.email);
  const colCount = 2 + (showContact ? 1 : 0) + (showPhone ? 1 : 0) + (showEmail ? 1 : 0);


  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: "Настройки", href: "/settings" }, { label: "Поставщики" }]} />
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Поставщики</h1>
        {canCreate && (
          <Link href="/suppliers/new" className={buttonVariants()}>
            + Новый поставщик
          </Link>
        )}
      </div>

      <FilterBar
        title="Фильтры поставщиков"
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
            <Th>Название</Th>
            {showContact && <Th>Контакт</Th>}
            {showPhone && <Th>Телефон</Th>}
            {showEmail && <Th>Email</Th>}
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
              <Td colSpan={colCount} className="py-8 text-center text-neutral-500">
                {f.q  ? "Ничего не найдено" : "Поставщиков пока нет"}
              </Td>
            </Tr>
          )}
        </Tbody>
      </Table>
    </div>
  );
}
