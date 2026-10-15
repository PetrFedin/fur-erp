import Link from "next/link";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { ACCESS, hasRole } from "@/lib/access";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { InfoHint } from "@/components/info-hint";
import { CreateDialog } from "@/components/create-dialog";
import { ContractorForm } from "./contractor-forms";
import { createContractor, makeContractor, toggleContractorActive } from "./actions";

export const metadata = { title: "Подрядчики" };

/** Подрядчики: кто шьёт по ТЗ. Заведение, правка, архив; карточка с ТЗ, оплатами, долгом, договорами и доступом в кабинет. */
export default async function ContractorsPage({ searchParams }: PageProps<"/settings/contractors">) {
  const session = await requireSession();
  const sp = await searchParams;
  const orgId = session.user.organizationId;
  const canEdit = hasRole(session.user.role, ACCESS.suppliers);
  const [rows, others, orderCounts, contracts] = await Promise.all([
    prisma.supplier.findMany({ where: { organizationId: orgId, isContractor: true }, orderBy: [{ isActive: "desc" }, { name: "asc" }] }),
    canEdit ? prisma.supplier.findMany({ where: { organizationId: orgId, isContractor: false, isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : Promise.resolve([]),
    prisma.productionOrder.groupBy({ by: ["contractorId"], where: { organizationId: orgId, contractorId: { not: null } }, _count: { _all: true } }),
    prisma.supplierContract.findMany({ where: { organizationId: orgId, kind: "WORK", isActive: true }, select: { supplierId: true, number: true } }),
  ]);
  const cnt = new Map(orderCounts.map((r) => [r.contractorId, r._count._all]));
  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: "Настройки", href: "/settings" }, { label: "Подрядчики" }]} />
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Подрядчики</h1>
        {canEdit && (
          <CreateDialog label="+ Новый подрядчик" title="Новый подрядчик" defaultOpen={sp.new === "1"}>
            <ContractorForm action={createContractor} />
          </CreateDialog>
        )}
      </div>
      <p className="flex items-center gap-1.5 text-sm text-neutral-600">Шьют по ТЗ.<InfoHint label="Кто такой подрядчик">Подрядчик — тот, кто шьёт по ТЗ (договор подряда). У ТЗ выбирается подрядчик, ему идут оплаты за работу. Один контрагент может быть и поставщиком сырья, и подрядчиком.</InfoHint></p>
      <Table stickyHeader>
        <Thead><Tr><Th>Подрядчик</Th><Th>Договоры подряда</Th><Th className="text-right">ТЗ</Th><Th>Сырьё</Th><Th></Th></Tr></Thead>
        <Tbody>
          {rows.map((c) => (
            <Tr key={c.id} className={c.isActive ? "" : "text-neutral-500"}>
              <Td className="font-medium"><Link href={`/settings/contractors/${c.id}`} className="hover:underline">{c.name}</Link>{!c.isActive && <span className="ml-2 text-xs">в архиве</span>}</Td>
              <Td>{contracts.filter((k) => k.supplierId === c.id).map((k) => `№ ${k.number}`).join(", ") || "—"}</Td>
              <Td className="text-right tabular-nums">{cnt.get(c.id) ?? 0}</Td>
              <Td>{c.suppliesRaw ? "поставляет" : "нет"}</Td>
              <Td>
                {canEdit && (
                  <form action={async () => { "use server"; await toggleContractorActive(c.id); }}>
                    <Button type="submit" variant="ghost" size="sm">{c.isActive ? "В архив" : "Вернуть из архива"}</Button>
                  </form>
                )}
              </Td>
            </Tr>
          ))}
          {rows.length === 0 && <Tr><Td colSpan={5} className="py-8 text-center text-neutral-500">Нет подрядчиков</Td></Tr>}
        </Tbody>
      </Table>
      {canEdit && others.length > 0 && (
        <form action={makeContractor} className="flex flex-wrap items-end gap-2 rounded-lg border border-neutral-200 bg-white p-3 text-sm">
          <label className="flex flex-col gap-1">Добавить из поставщиков
            <Select name="supplierId" required defaultValue=""><option value="" disabled>Выберите поставщика</option>{others.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</Select>
          </label>
          <Button type="submit" size="sm">Сделать подрядчиком</Button>
        </form>
      )}
    </div>
  );
}
