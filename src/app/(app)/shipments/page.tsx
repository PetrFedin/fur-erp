import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { buttonVariants, Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/input";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { ProductionTabs } from "@/components/production-tabs";
import { formatDate, formatQty } from "@/lib/utils";
import { SHIPMENT_STATUS, summarizeLines, isoDay, todayIso } from "@/lib/shipments";
import type { Prisma } from "@prisma/client";

export const metadata = { title: "Отгрузки" };

export default async function ShipmentsPage({ searchParams }: PageProps<"/shipments">) {
  const session = await requireSession();
  const orgId = session.user.organizationId;
  const sp = await searchParams;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const status = str(sp.status) in SHIPMENT_STATUS ? str(sp.status) : "";
  const client = str(sp.client);

  const where: Prisma.ShipmentWhereInput = {
    organizationId: orgId,
    ...(status ? { status: status as "PLANNED" } : {}),
    ...(client === "none" ? { clientId: null } : client ? { clientId: client } : {}),
  };
  const include = {
    client: { select: { name: true } },
    lines: {
      select: { size: true, quantity: true, productionOrder: { select: { workOrderNumber: true, number: true } } },
      orderBy: { id: "asc" as const },
    },
  };

  const today = todayIso();
  const weekEnd = new Date(today);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);
  const weekEndIso = isoDay(weekEnd);

  const [shipments, clients, upcoming] = await Promise.all([
    prisma.shipment.findMany({ where, include }),
    prisma.client.findMany({ where: { organizationId: orgId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.shipment.findMany({
      where: {
        organizationId: orgId,
        status: "PLANNED",
        plannedDate: { gte: new Date(today), lte: new Date(weekEndIso) },
      },
      select: { lines: { select: { quantity: true } } },
    }),
  ]);
  const upcomingQty = upcoming.reduce((s, sh) => s + sh.lines.reduce((a, l) => a + l.quantity, 0), 0);

  // Ближайшие плановые сверху: сначала запланированные по возрастанию даты,
  // затем отгруженные и отменённые — свежие сверху.
  const rank = (s: string) => (s === "PLANNED" ? 0 : 1);
  const rows = [...shipments].sort((a, b) => {
    if (rank(a.status) !== rank(b.status)) return rank(a.status) - rank(b.status);
    const d = a.plannedDate.getTime() - b.plannedDate.getTime();
    return rank(a.status) === 0 ? d : -d;
  });
  const hasFilters = Boolean(status || client);

  return (
    <div className="flex flex-col gap-4">
      <ProductionTabs active="shipments" />
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Отгрузки</h1>
        <Link href="/shipments/new" className={buttonVariants({ size: "lg" })}>
          + Новая отгрузка
        </Link>
      </div>

      <div className="rounded-lg border border-neutral-200 bg-white px-4 py-3 text-sm">
        На ближайшие 7 дней:{" "}
        <span className="font-semibold">
          {upcoming.length} {plural(upcoming.length, "отгрузка", "отгрузки", "отгрузок")}, {formatQty(upcomingQty)} шт.
        </span>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-2">
        <Select name="status" defaultValue={status} className="w-48">
          <option value="">Все статусы</option>
          {Object.entries(SHIPMENT_STATUS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </Select>
        <Select name="client" defaultValue={client} className="w-56">
          <option value="">Все заказчики</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
          <option value="none">Без заказчика</option>
        </Select>
        <Button type="submit" variant="outline" size="sm">
          Применить
        </Button>
        {hasFilters && (
          <Link href="/shipments" className="text-sm text-neutral-500 hover:underline">
            Сбросить
          </Link>
        )}
      </form>

      <Table>
        <Thead>
          <Tr>
            <Th>Плановая дата</Th>
            <Th>Заказчик</Th>
            <Th>ТЗ и что отгружается</Th>
            <Th>Кол-во, шт.</Th>
            <Th>Статус</Th>
            <Th>Фактическая дата</Th>
          </Tr>
        </Thead>
        <Tbody>
          {rows.map((s) => {
            const st = SHIPMENT_STATUS[s.status];
            const overdue = s.status === "PLANNED" && isoDay(s.plannedDate) < today;
            const qty = s.lines.reduce((a, l) => a + l.quantity, 0);
            return (
              <Tr key={s.id}>
                <Td className="whitespace-nowrap">
                  <Link href={`/shipments/${s.id}`} className="font-medium hover:underline">
                    {formatDate(s.plannedDate)}
                  </Link>
                  {overdue && <Badge variant="danger" className="ml-2">просрочена</Badge>}
                </Td>
                <Td>{s.client?.name ?? "—"}</Td>
                <Td>
                  {summarizeLines(s.lines).map((t) => (
                    <div key={t}>{t}</div>
                  ))}
                </Td>
                <Td className="font-medium">{formatQty(qty)}</Td>
                <Td>
                  <Badge variant={st.variant}>{st.label}</Badge>
                </Td>
                <Td className="whitespace-nowrap">{s.shippedDate ? formatDate(s.shippedDate) : "—"}</Td>
              </Tr>
            );
          })}
          {rows.length === 0 && (
            <Tr>
              <Td colSpan={6} className="py-8 text-center text-neutral-400">
                {hasFilters ? "Ничего не найдено" : "Отгрузок пока нет"}
              </Td>
            </Tr>
          )}
        </Tbody>
      </Table>
    </div>
  );
}

function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
