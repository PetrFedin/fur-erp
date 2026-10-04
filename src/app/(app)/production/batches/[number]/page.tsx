import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Decimal } from "@prisma/client/runtime/library";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { canEditProduction } from "@/lib/production-access";
import { ProductionTabs } from "@/components/production-tabs";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { DriveDocuments } from "@/components/drive-documents";
import { toDriveView } from "@/lib/drive-docs-server";
import { batchExtraName, batchOrderInclude, contractorHidesFromNotes, batchTotals, orderStat } from "@/lib/batch-stats";
import { formatDate, formatMoney, formatQty } from "@/lib/utils";
import { TzVatBadge } from "@/components/tz-vat-badge";
import { vatBreakdown } from "@/lib/tz-vat";
import { getCommission4Mode } from "@/lib/commission4-mode";
import { c4Suffix } from "@/lib/commission4";
import { BatchDocsPay } from "../../docs-pay";
import { VerifyBlock } from "../../../verify/verify-block";

const STATUS: Record<string, { label: string; variant: "default" | "warning" | "success" | "danger" }> = {
  PLANNED: { label: "Запланирован", variant: "default" },
  IN_PROGRESS: { label: "В работе", variant: "warning" },
  COMPLETED: { label: "Завершён", variant: "success" },
  CANCELLED: { label: "Отменён", variant: "danger" },
};
const PAY_TYPE: Record<string, string> = { ADVANCE: "Аванс", PARTIAL: "Доплата", FINAL: "Окончательная" };

export async function generateMetadata({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  return { title: `Партия ${number}` };
}

export default async function BatchPage({ params }: { params: Promise<{ number: string }> }) {
  const { number: numRaw } = await params;
  const session = await requireSession();
  const c4Mode = await getCommission4Mode();
  const orgId = session.user.organizationId;
  const number = /^\d{1,6}$/.test(numRaw) ? parseInt(numRaw, 10) : NaN;
  if (!Number.isInteger(number) || number < 1) notFound();
  // Каноничный адрес без ведущих нулей: /batches/007 → /batches/7.
  if (numRaw !== String(number)) redirect(`/production/batches/${number}`);

  const batch = await prisma.productionBatch.findUnique({
    where: { organizationId_number: { organizationId: orgId, number } },
    include: { orders: { include: batchOrderInclude, orderBy: { createdAt: "asc" } } },
  });
  if (!batch) notFound();

  const t = batchTotals(batch.orders, c4Mode);
  // Ставки НДС лотов по действующим ТЗ партии (20% / 22% / смешанные).
  const batchVat = vatBreakdown(batch.orders.filter((o) => o.status !== "CANCELLED").flatMap((o) => o.materialUsages), c4Mode);
  const orders = [...batch.orders].sort((a, b) => {
    const x = parseInt(a.workOrderNumber ?? "", 10);
    const y = parseInt(b.workOrderNumber ?? "", 10);
    return (Number.isNaN(x) ? 1e9 : x) - (Number.isNaN(y) ? 1e9 : y);
  });

  // Оплаты партии: каждая — один раз, со списком ТЗ партии, которые она покрывает.
  const payMap = new Map<string, { p: (typeof orders)[number]["paymentAllocations"][number]["productionPayment"]; tz: string[] }>();
  for (const o of orders) {
    for (const a of o.paymentAllocations) {
      const e = payMap.get(a.productionPayment.id) ?? { p: a.productionPayment, tz: [] };
      e.tz.push(o.workOrderNumber ?? o.number);
      payMap.set(a.productionPayment.id, e);
    }
  }
  const payments = Array.from(payMap.values()).sort((a, b) => a.p.paidAt.getTime() - b.p.paidAt.getTime());

  // Переплата: оплата больше работы партии. Если в заметке платежа сказано про шкуры подрядчика — объясняем.
  const overpaid = t.remaining.lessThan(-0.005);
  const hidesInPay = payments
    .map((x) => contractorHidesFromNotes(x.p.notes))
    .reduce<Decimal | null>((s, v) => (v ? (s ? s.add(v) : v) : s), null);

  const orderIds = orders.map((o) => o.id);
  const driveRows = await prisma.driveDocument.findMany({
    where: {
      organizationId: orgId,
      OR: [
        { productionBatchId: batch.id },
        ...(orderIds.length ? [{ productionOrderId: { in: orderIds } }] : []),
        ...(payments.length ? [{ productionPaymentId: { in: payments.map((x) => x.p.id) } }] : []),
      ],
    },
    include: { productionOrder: { select: { number: true, workOrderNumber: true } } },
    orderBy: [{ docDate: "asc" }, { createdAt: "asc" }],
  });
  const driveDocs = driveRows.map((d) =>
    toDriveView(
      d,
      d.productionOrder
        ? `ТЗ №${d.productionOrder.workOrderNumber ?? d.productionOrder.number}`
        : d.productionPaymentId
          ? "оплата"
          : null,
      session.user.role,
    ),
  );

  return (
    <div className="flex max-w-5xl flex-col gap-4">
      <ProductionTabs active="batches" />
      <div>
        <p className="flex items-center gap-3 text-sm">
          <Link href="/production/batches" className="text-neutral-500 hover:underline">
            ← Все партии
          </Link>
          <Link href={`/production/batches/${batch.number}/print`} className="ml-auto rounded border border-neutral-300 px-2 py-1 text-neutral-700 hover:bg-neutral-50">
            Печать сводки партии
          </Link>
        </p>
        <h1 className="text-xl font-semibold">
          Партия {batch.number}
          {batchExtraName(batch.name) ? <span className="ml-2 text-base font-normal text-neutral-500">{batchExtraName(batch.name)}</span> : null}
        </h1>
        <p className="text-sm text-neutral-500">
          {[batch.year ? `${batch.year} г.` : null, batch.plannedUnits != null ? `план ${batch.plannedUnits} изд.` : null]
            .filter(Boolean)
            .join(" · ") || "—"}
        </p>
        {batch.notes && <p className="mt-1 text-sm text-neutral-600 whitespace-pre-line">{batch.notes}</p>}
      </div>

      <dl className="grid grid-cols-2 gap-3 rounded-lg border border-neutral-200 bg-white p-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="ТЗ" value={String(t.orders)} />
        <Stat label="Изделий" value={formatQty(t.units.toString())} />
        <Stat label={`Себестоимость${t.c4Applies ? c4Suffix(c4Mode) : ""}`} value={formatMoney(t.cost.toString())} />
        <Stat label="Работа заказчику" value={formatMoney(t.work.toString())} />
        <Stat label="Оплачено" value={formatMoney(t.paid.toString())} />
        <Stat
          label={overpaid ? "Переплата" : "Остаток"}
          value={formatMoney(t.remaining.abs().toString())}
          warn={t.remaining.greaterThan(0.005)}
        />
      </dl>
      {batchVat.kind !== "none" && (
        <p className="flex flex-wrap items-center gap-2 text-sm text-neutral-600">
          Ставка НДС в списаниях сырья и подкладки: <TzVatBadge b={batchVat} />
        </p>
      )}
      {overpaid && (
        <p className="text-sm text-neutral-600">
          Переплата {formatMoney(t.remaining.abs().toString())}
          {hidesInPay ? ` (в оплате учтены шкуры подрядчика ${formatMoney(hidesInPay.toString())})` : " — оплаты больше работы партии"}.
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            ТЗ партии ({t.orders}
            {batch.orders.length > t.orders ? ` + ${batch.orders.length - t.orders} отменено` : ""})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <Thead>
              <Tr>
                <Th>№ ТЗ</Th>
                <Th>Изделие</Th>
                <Th>Шт.</Th>
                <Th>Статус</Th>
                <Th className="hidden sm:table-cell" title="4% — доп. комиссия посредника (Веллмех): мы платим на 4% больше за мех и подкладку в ТЗ; работа, расходы, фурнитура и прочее не облагаются">
                  Себестоимость{t.c4Applies ? c4Suffix(c4Mode) : ""}
                </Th>
                <Th className="hidden md:table-cell">Работа</Th>
                <Th className="hidden md:table-cell" title="Ставки НДС лотов в списаниях ТЗ">НДС</Th>
              </Tr>
            </Thead>
            <Tbody>
              {orders.map((o) => {
                const s = orderStat(o, c4Mode);
                const st = STATUS[o.status];
                return (
                  <Tr key={o.id}>
                    <Td className="font-medium">
                      <Link href={`/production/${o.id}`} className="hover:underline">
                        {o.workOrderNumber ?? o.number}
                      </Link>
                    </Td>
                    <Td>
                      {o.productModel.name}
                      {o.client && <span className="block text-xs text-neutral-500">{o.client.name}</span>}
                    </Td>
                    <Td>{formatQty(s.qty.toString())}</Td>
                    <Td>
                      <Badge variant={st.variant}>{st.label}</Badge>
                    </Td>
                    <Td className="hidden whitespace-nowrap sm:table-cell">{s.cost.isZero() ? "—" : formatMoney(s.cost.toString())}</Td>
                    <Td className="hidden whitespace-nowrap md:table-cell">{s.work.isZero() ? "—" : formatMoney(s.work.toString())}</Td>
                    <Td className="hidden whitespace-nowrap md:table-cell">
                      <TzVatBadge b={vatBreakdown(o.materialUsages, c4Mode)} compact />
                    </Td>
                  </Tr>
                );
              })}
              {orders.length === 0 && (
                <Tr>
                  <Td colSpan={7} className="py-6 text-center text-neutral-400">
                    К партии пока не привязано ни одного ТЗ
                  </Td>
                </Tr>
              )}
            </Tbody>
          </Table>
        </CardContent>
      </Card>

      <VerifyBlock kind="batch" id={batch.id} title="Подтверждение партии" />

      <BatchDocsPay batchNumber={batch.number} />

      {/* Список оплат с покрываемыми ТЗ — справка; статус, платёжки и отметка оплаты — в блоке «Документы и оплата» выше. */}
      <details className="rounded-lg border border-neutral-200 bg-white">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium">Какие ТЗ покрывает каждая оплата ({payments.length})</summary>
      <Card className="border-0 shadow-none">
        <CardContent>
          <Table>
            <Thead>
              <Tr>
                <Th>Дата</Th>
                <Th>Тип</Th>
                <Th>Сумма</Th>
                <Th className="hidden sm:table-cell">Документ</Th>
                <Th className="hidden sm:table-cell">ТЗ</Th>
              </Tr>
            </Thead>
            <Tbody>
              {payments.map(({ p, tz }) => (
                <Tr key={p.id}>
                  <Td className="whitespace-nowrap">{formatDate(p.paidAt)}</Td>
                  <Td>
                    {PAY_TYPE[p.paymentType] ?? p.paymentType}
                    {p.status === "PENDING" && <span className="ml-1 text-xs text-neutral-400">план</span>}
                    {!p.confirmed && <span className="ml-1 text-xs text-amber-600">не подтверждена</span>}
                  </Td>
                  <Td className="whitespace-nowrap font-medium">{formatMoney(p.amount.toString())}</Td>
                  <Td className="hidden sm:table-cell">{p.docRef ?? "—"}</Td>
                  <Td className="hidden sm:table-cell">{tz.join(", ")}</Td>
                </Tr>
              ))}
              {payments.length === 0 && (
                <Tr>
                  <Td colSpan={5} className="py-6 text-center text-neutral-400">
                    Оплат по ТЗ партии пока нет
                  </Td>
                </Tr>
              )}
            </Tbody>
          </Table>
        </CardContent>
      </Card>
      </details>

      <Card>
        <CardContent className="pt-4">
          <DriveDocuments
            docs={driveDocs}
            entity="batch"
            entityId={batch.id}
            canEdit={canEditProduction(session.user.role)}
            extraTargets={
              ["OWNER", "ADMIN"].includes(session.user.role)
                ? payments.map((x) => ({
                    entity: "productionPayment" as const,
                    id: x.p.id,
                    label: `Оплата ${formatDate(x.p.paidAt)} · ${formatMoney(x.p.amount.toString())}`,
                  }))
                : undefined
            }
          />
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-neutral-500">{label}</dt>
      <dd className={"text-base font-semibold " + (warn ? "text-amber-600" : "")}>{value}</dd>
    </div>
  );
}
