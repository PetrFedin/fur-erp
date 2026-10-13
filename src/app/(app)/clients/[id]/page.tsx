import Link from "next/link";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { ACCESS, hasRole } from "@/lib/access";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { WidgetRow } from "@/components/widget-row";
import { SourceDocs } from "@/components/source-docs";
import { PaymentWizardButton } from "@/components/payment-wizard";
import { loadPaymentsSourceDocs } from "@/lib/source-docs-server";
import { allocatedCentsByOrder, loadClientDebt, orderWorkCents } from "@/lib/payment-alloc";
import { PRODUCTION_EDIT_ROLES } from "@/lib/production-access";
import { PAYMENT_TYPE_LABELS_RU } from "@/lib/payment-alloc-labels";
import { ORDER_STATUS_LABELS } from "@/lib/dashboard-calc";
import { formatDate, formatMoney } from "@/lib/utils";
import { groupByTz, tzLabel, articlesWord } from "@/lib/tz-key";
import { cleanNote } from "@/lib/note-tags";
import { ClientForm } from "../client-form";
import { updateClient } from "../actions";

const rub = (v: number | string) => formatMoney(typeof v === "number" ? v.toFixed(2) : v);
const cents = (c: number) => rub(c / 100);
const PAY_SHOWN = 15;
const ORD_SHOWN = 20;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const r = await prisma.client.findFirst({ where: { id, organizationId: session.user.organizationId }, select: { name: true } });
  return { title: r ? `Заказчик ${r.name}` : "Заказчик" };
}

/**
 * Карточка заказчика: работа и оплаты (долг), оплаты с документами, ТЗ — в одном месте, ниже — реквизиты (редактируются, как раньше).
 * Числа те же, что в «Оплатах → За производство»: loadClientDebt; надбавка 4% на мех и подкладку в «Работе» не участвует.
 */
export default async function EditClientPage({ params }: PageProps<"/clients/[id]">) {
  const { id } = await params;
  const session = await requireSession();
  const orgId = session.user.organizationId;
  const client = await prisma.client.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!client) notFound();

  const canEdit = hasRole(session.user.role, ACCESS.clients);
  const canPay = hasRole(session.user.role, PRODUCTION_EDIT_ROLES as readonly string[]);

  const [debtAll, payments, orders] = await Promise.all([
    loadClientDebt(prisma, orgId, { year: "all" }),
    prisma.productionPayment.findMany({
      where: { organizationId: orgId, clientId: id, status: { not: "CANCELLED" } },
      select: { id: true, amount: true, notes: true, paidAt: true, paymentType: true, docRef: true, confirmed: true, allocations: { select: { amount: true, productionOrder: { select: { status: true } } } } },
      orderBy: { paidAt: "desc" },
    }),
    prisma.productionOrder.findMany({
      where: { organizationId: orgId, clientId: id, status: { not: "CANCELLED" } },
      select: { id: true, number: true, workOrderNumber: true, status: true, plannedQuantity: true, producedQuantity: true, clientWorkPricePerUnit: true, batch: { select: { number: true } } },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const debt = debtAll.rows.find((r) => r.clientId === id);
  const alloc = await allocatedCentsByOrder(prisma, orgId, orders.map((o) => o.id));
  const tzGroups = Array.from(groupByTz(orders).values());
  const shownPays = payments.slice(0, PAY_SHOWN);
  const payDocs = await loadPaymentsSourceDocs({ organizationId: orgId, role: session.user.role }, { productionPayments: shownPays.map((p) => p.id) });
  const row = "flex flex-wrap items-baseline justify-between gap-x-4 border-b border-neutral-100 py-1.5 last:border-0";

  return (
    <div className="flex flex-col gap-3">
      <Breadcrumbs items={[{ label: "Настройки", href: "/settings" }, { label: "Заказчики", href: "/clients" }, { label: client.name }]} />
      <h1 className="text-xl font-semibold">{client.name}</h1>

      <WidgetRow id="client-debt" title="Работа и оплаты" headerEnd={canPay ? <PaymentWizardButton label="+ Внести оплату" preset={{ side: "work", clientId: id }} /> : undefined}>
        <div className="rounded-lg border border-neutral-200 bg-white px-3 py-1 text-sm" data-client-summary>
          <div className={row}><span className="text-neutral-600">Работа по ТЗ</span><b className="tabular-nums">{rub(debt?.billable ?? 0)}</b></div>
          <div className={row}><span className="text-neutral-600">Оплачено</span><b className="tabular-nums">{rub(debt?.paid ?? 0)}</b></div>
          {(debt?.unallocated ?? 0) > 0.5 && <div className={row}><span className="text-neutral-600">в том числе не разнесено по ТЗ</span><span className="tabular-nums">{rub(debt!.unallocated)}</span></div>}
          <div className={row}><span className="font-medium">{(debt?.balance ?? 0) < -0.5 ? "Переплата" : "Долг"}</span><b className="tabular-nums">{rub(Math.abs(debt?.balance ?? 0))}</b></div>
          {(debt?.unpricedOrders ?? 0) > 0 && <p className="py-1.5 text-xs text-amber-700">ТЗ без цены работы: {debt!.unpricedOrders} — в «Работе» они не учтены.</p>}
        </div>
      </WidgetRow>

      <Card>
        <CardHeader>
          <CardTitle as="h2" className="text-base">Оплаты <span className="font-normal text-neutral-500">· {payments.length}</span></CardTitle>
        </CardHeader>
        <CardContent>
          {payments.length === 0 ? (
            <p className="text-sm text-neutral-500">Оплат от заказчика пока нет.</p>
          ) : (
            <Table>
              <Thead><Tr><Th>Дата</Th><Th>Вид</Th><Th>Основание</Th><Th className="text-right" unit="₽">Сумма</Th><Th className="text-right" unit="₽">Не разнесено</Th><Th>Документы</Th></Tr></Thead>
              <Tbody>
                {shownPays.map((p) => {
                  const allocated = p.allocations.filter((a) => a.productionOrder.status !== "CANCELLED").reduce((s, a) => s + Number(a.amount), 0);
                  const rest = Number(p.amount) - allocated;
                  return (
                    <Tr key={p.id}>
                      <Td>{Number(p.amount) === 0 ? <span>{formatDate(p.paidAt)}</span> : <Link href={`/payments/c-${p.id}`} className="text-blue-700 hover:underline">{formatDate(p.paidAt)}</Link>}</Td>
                      <Td>{PAYMENT_TYPE_LABELS_RU[p.paymentType] ?? p.paymentType}</Td>
                      <Td className="text-xs text-neutral-600">{Number(p.amount) === 0 ? <span className="mr-1 text-neutral-500">0 ₽{cleanNote(p.notes) ? ` — ${cleanNote(p.notes)}` : " — вынесено в оплату закупки"}</span> : null}{p.docRef ?? "—"}{!p.confirmed && <span className="ml-1 text-amber-700">· не подтверждена</span>}</Td>
                      <Td className="text-right tabular-nums">{rub(p.amount.toString())}</Td>
                      <Td className={"text-right tabular-nums " + (rest > 1 ? "text-amber-700" : "text-neutral-400")}>{rest > 1 ? rub(rest) : "—"}</Td>
                      <Td className="text-xs">{payDocs[p.id] ? <SourceDocs compact data={payDocs[p.id]} popover="right" /> : <span className="text-neutral-400">—</span>}</Td>
                    </Tr>
                  );
                })}
              </Tbody>
            </Table>
          )}
          {payments.length > PAY_SHOWN && <p className="mt-2 text-xs text-neutral-500">Показаны последние {PAY_SHOWN} из {payments.length}. Все оплаты — в разделе <Link href="/payments" className="text-blue-700 hover:underline">«Оплаты»</Link>.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2" className="text-base">ТЗ <span className="font-normal text-neutral-500">· {tzGroups.length}</span></CardTitle>
        </CardHeader>
        <CardContent>
          {orders.length === 0 ? (
            <p className="text-sm text-neutral-500">ТЗ этого заказчика пока нет.</p>
          ) : (
            <Table>
              <Thead><Tr><Th>ТЗ</Th><Th>Партия</Th><Th>Статус</Th><Th className="text-right" unit="₽">Работа</Th><Th className="text-right" unit="₽">Оплачено</Th></Tr></Thead>
              <Tbody>
                {tzGroups.slice(0, ORD_SHOWN).map((g) => {
                  const o = g[0];
                  const work = g.reduce((s, x) => s + orderWorkCents(x), 0);
                  const paid = g.reduce((s, x) => s + (alloc.get(x.id) ?? 0), 0);
                  const batches = Array.from(new Set(g.map((x) => x.batch?.number).filter(Boolean)));
                  const statuses = Array.from(new Set(g.map((x) => ORDER_STATUS_LABELS[x.status] ?? x.status)));
                  return (
                    <Tr key={o.id}>
                      <Td><Link href={`/production/${o.id}`} className="text-blue-700 hover:underline" title={o.number}>ТЗ {tzLabel(o)}</Link>{g.length > 1 && <span className="ml-1 text-xs text-neutral-500">· {g.length} {articlesWord(g.length)}</span>}</Td>
                      <Td>{batches.length ? batches.join(", ") : "—"}</Td>
                      <Td>{statuses.join(", ")}</Td>
                      <Td className="text-right tabular-nums">{work > 0 ? cents(work) : "—"}</Td>
                      <Td className="text-right tabular-nums">{cents(paid)}</Td>
                    </Tr>
                  );
                })}
              </Tbody>
            </Table>
          )}
          {tzGroups.length > ORD_SHOWN && <p className="mt-2 text-xs text-neutral-500">Показаны последние {ORD_SHOWN} из {tzGroups.length}. Все ТЗ — в разделе <Link href="/production" className="text-blue-700 hover:underline">«Производство»</Link>.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2" className="text-base">Реквизиты</CardTitle>
        </CardHeader>
        <CardContent>
          {!canEdit && <p className="mb-3 text-sm text-neutral-500">Только просмотр: редактировать заказчиков могут владелец, администратор и технолог.</p>}
          <fieldset disabled={!canEdit} className="min-w-0 border-0 p-0">
            <ClientForm action={updateClient.bind(null, id)} client={client} />
          </fieldset>
        </CardContent>
      </Card>
    </div>
  );
}
