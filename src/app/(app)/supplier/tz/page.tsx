import Link from "next/link";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { buttonVariants } from "@/components/ui/button";
import { prisma } from "@/lib/prisma";
import { requireInboxViewer, inboxScope, INBOX_STATUS_LABEL } from "@/lib/supplier-inbox";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "ТЗ поставщика" };

export default async function SupplierTzPage() {
  const s = await requireInboxViewer();
  const isSup = s.user.role === "SUPPLIER";
  const rows = await prisma.supplierInbox.findMany({
    where: { kind: "TZ", ...inboxScope(s) }, orderBy: { updatedAt: "desc" },
    select: { id: true, title: true, status: true, updatedAt: true, sentAt: true, payload: true, supplier: { select: { name: true } } },
  });
  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: "ТЗ" }]} />
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">ТЗ</h1>
        {isSup && <Link href="/supplier/tz/new" className={buttonVariants({ size: "sm" })}>+ Новое ТЗ</Link>}
      </div>
      <p className="text-sm text-neutral-600">Технические задания к Договору подряда. Отправленное ТЗ приходит к нам как черновик на проверку; Word можно скачать в любой момент.</p>
      <Table className="min-w-[640px]">
        <Thead><Tr><Th>ТЗ</Th>{!isSup && <Th>Поставщик</Th>}<Th>Изделий</Th><Th>Статус</Th><Th>Изменено</Th></Tr></Thead>
        <Tbody>
          {rows.map((r) => (
            <Tr key={r.id}>
              <Td><Link className="font-medium underline" href={`/supplier/tz/${r.id}`}>{r.title}</Link></Td>
              {!isSup && <Td>{r.supplier.name}</Td>}
              <Td className="tabular-nums">{(r.payload as { totals?: { qty?: number } })?.totals?.qty ?? "—"}</Td>
              <Td>{INBOX_STATUS_LABEL[r.status]}</Td>
              <Td className="tabular-nums">{formatDate(r.sentAt ?? r.updatedAt)}</Td>
            </Tr>
          ))}
          {rows.length === 0 && <Tr><Td colSpan={5} className="py-8 text-center text-neutral-500">ТЗ пока нет</Td></Tr>}
        </Tbody>
      </Table>
    </div>
  );
}
