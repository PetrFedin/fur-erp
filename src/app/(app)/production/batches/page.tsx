import Link from "next/link";
import { requireSession } from "@/lib/session";
import { ProductionTabs } from "@/components/production-tabs";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { formatMoney, formatQty } from "@/lib/utils";
import { batchTotals, loadBatchesWithOrders } from "@/lib/batch-stats";
import { getCommission4Mode } from "@/lib/commission4-mode";
import { c4Suffix } from "@/lib/commission4";

export const metadata = { title: "Партии" };

export default async function BatchesPage() {
  const session = await requireSession();
  const c4Mode = await getCommission4Mode();
  const batches = await loadBatchesWithOrders(session.user.organizationId);
  const rows = batches.map((b) => ({ b, t: batchTotals(b.orders, c4Mode) }));

  return (
    <div className="flex flex-col gap-4">
      <ProductionTabs active="batches" />
      <div>
        <h1 className="text-xl font-semibold">Партии</h1>
        <p className="text-sm text-neutral-500">
          Партия поставки (в Google Drive — «поставка N») объединяет ТЗ. Откройте партию, чтобы увидеть ТЗ, оплаты и документы.
        </p>
      </div>
      <Table>
        <Thead>
          <Tr>
            <Th>Партия</Th>
            <Th className="hidden sm:table-cell">Год</Th>
            <Th>ТЗ</Th>
            <Th>Изделий</Th>
            <Th className="hidden md:table-cell" title="4% — доп. комиссия посредника к сырью и подкладке (договор, расчёты «+4%»); работа не облагается">
              Себестоимость{c4Suffix(c4Mode)}
            </Th>
            <Th className="hidden md:table-cell">Работа</Th>
            <Th className="hidden lg:table-cell">Оплачено</Th>
            <Th>Остаток</Th>
            <Th className="hidden sm:table-cell">Документы</Th>
          </Tr>
        </Thead>
        <Tbody>
          {rows.map(({ b, t }) => (
            <Tr key={b.id}>
              <Td className="font-medium">
                <Link href={`/production/batches/${b.number}`} className="hover:underline">
                  №{b.number}
                </Link>
                {b.name && <span className="block text-xs font-normal text-neutral-500">{b.name}</span>}
              </Td>
              <Td className="hidden sm:table-cell">{b.year ?? "—"}</Td>
              <Td>
                <Link href={`/production?batch=${b.number}`} className="hover:underline">
                  {t.orders}
                </Link>
              </Td>
              <Td>
                {formatQty(t.units.toString())}
                {b.plannedUnits != null && <span className="block text-xs text-neutral-400">план {b.plannedUnits}</span>}
              </Td>
              <Td className="hidden whitespace-nowrap md:table-cell">{t.cost.isZero() ? "—" : formatMoney(t.cost.toString())}</Td>
              <Td className="hidden whitespace-nowrap md:table-cell">{t.work.isZero() ? "—" : formatMoney(t.work.toString())}</Td>
              <Td className="hidden whitespace-nowrap lg:table-cell">{t.paid.isZero() ? "—" : formatMoney(t.paid.toString())}</Td>
              <Td className={"whitespace-nowrap " + (t.remaining.greaterThan(0.005) ? "text-amber-600" : "")}>
                {t.work.isZero() && t.paid.isZero() ? "—" : formatMoney(t.remaining.toString())}
              </Td>
              <Td className="hidden sm:table-cell">{b._count.driveDocuments || "—"}</Td>
            </Tr>
          ))}
          {rows.length === 0 && (
            <Tr>
              <Td colSpan={9} className="py-8 text-center text-neutral-400">
                Партий пока нет. Они появятся после привязки ТЗ к «поставкам» из Google Drive.
              </Td>
            </Tr>
          )}
        </Tbody>
      </Table>
      <p className="text-xs text-neutral-500">
        Остаток = работа заказчику (цена за ед. × количество) минус оплаты заказчика по ТЗ партии; каждая оплата учитывается
        один раз. Группировка ТЗ по партиям —{" "}
        <Link href="/production?view=batches" className="underline">
          вид «По партиям»
        </Link>
        .
      </p>
    </div>
  );
}
