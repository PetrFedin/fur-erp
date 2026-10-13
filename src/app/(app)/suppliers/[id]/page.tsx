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
import { loadPaymentsSourceDocs, loadPurchasesSourceDocs } from "@/lib/source-docs-server";
import { loadSupplierDebt } from "@/lib/supplier-debt";
import { purchaseTotalInclVat } from "@/lib/purchase-totals";
import { STATUS_LABELS } from "@/lib/fur-table";
import { formatDate, formatMoney } from "@/lib/utils";
import { SupplierForm } from "../supplier-form";
import { updateSupplier } from "../actions";

const rub = (v: { toString(): string } | number) => formatMoney(typeof v === "number" ? v.toFixed(2) : v.toString());
const PAY_SHOWN = 15;
const PUR_SHOWN = 15;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const r = await prisma.supplier.findFirst({ where: { id, organizationId: session.user.organizationId }, select: { name: true } });
  return { title: r ? `Поставщик ${r.name}` : "Поставщик" };
}

/**
 * Карточка поставщика: долг, оплаты, закупки и документы в одном месте, ниже — реквизиты (редактируются, как раньше).
 * Числа те же, что на Главной и в «Оплатах»: долг считает loadSupplierDebt, здесь — с фильтром по этому поставщику
 * (закупки, оплаты аукционов и авансы только его). Один поставщик — цифра совпадает с Главной.
 */
export default async function EditSupplierPage({ params }: PageProps<"/suppliers/[id]">) {
  const { id } = await params;
  const session = await requireSession();
  const orgId = session.user.organizationId;
  const supplier = await prisma.supplier.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!supplier) notFound();

  const boundAction = updateSupplier.bind(null, id);
  const canEdit = hasRole(session.user.role, ACCESS.suppliers);
  const canPay = hasRole(session.user.role, ACCESS.supplierPayments);

  const [purchases, payments, debt] = await Promise.all([
    prisma.purchase.findMany({
      where: { organizationId: orgId, supplierId: id },
      include: { items: true, expenses: true, payments: { where: { status: "COMPLETED" }, select: { amount: true } } },
      orderBy: { orderDate: "desc" },
    }),
    prisma.payment.findMany({
      where: { organizationId: orgId, supplierId: id, status: { not: "CANCELLED" } },
      select: { id: true, amount: true, paidAt: true, status: true, kind: true, docRef: true, confirmed: true, auctionSession: true, purchase: { select: { number: true } } },
      orderBy: { paidAt: "desc" },
    }),
    loadSupplierDebt(prisma, orgId, "all", id),
  ]);
  const live = purchases.filter((p) => p.status !== "CANCELLED");
  const totalAll = live.reduce((s, p) => s + Number(purchaseTotalInclVat(p).toString()), 0);
  const done = payments.filter((p) => p.status === "COMPLETED");
  const paidAll = done.reduce((s, p) => s + Number(p.amount), 0);
  const unlinked = done.filter((p) => !p.purchase && !p.auctionSession).reduce((s, p) => s + Number(p.amount), 0);

  const shownPays = payments.slice(0, PAY_SHOWN);
  const session2 = { organizationId: orgId, role: session.user.role };
  const [payDocs, purDocs] = await Promise.all([
    loadPaymentsSourceDocs(session2, { payments: shownPays.map((p) => p.id) }),
    loadPurchasesSourceDocs(session2, live.map((p) => p.id)),
  ]);

  const row = "flex flex-wrap items-baseline justify-between gap-x-4 border-b border-neutral-100 py-1.5 last:border-0";

  return (
    <div className="flex flex-col gap-3">
      <Breadcrumbs items={[{ label: "Настройки", href: "/settings" }, { label: "Поставщики", href: "/suppliers" }, { label: supplier.name }]} />
      <h1 className="text-xl font-semibold">{supplier.name}</h1>

      <WidgetRow id="supplier-debt" title="Долг и оплаты" headerEnd={canPay ? <PaymentWizardButton label="+ Внести оплату" preset={{ side: "supplier", supplierId: id }} /> : undefined}>
        <div className="rounded-lg border border-neutral-200 bg-white px-3 py-1 text-sm" data-supplier-summary>
          <div className={row}><span className="text-neutral-600">Куплено (закупки, с НДС)</span><b className="tabular-nums">{rub(totalAll)}</b></div>
          <div className={row}><span className="text-neutral-600">Оплачено</span><b className="tabular-nums">{rub(paidAll)}</b></div>
          {unlinked > 0.5 && <div className={row}><span className="text-neutral-600">в том числе аванс без привязки</span><span className="tabular-nums">{rub(unlinked)}</span></div>}
          <div className={row}><span className="font-medium">Долг</span><b className="tabular-nums">{rub(debt.debt.toString())}</b></div>
        </div>
      </WidgetRow>

      <Card>
        <CardHeader>
          <CardTitle as="h2" className="text-base">Оплаты <span className="font-normal text-neutral-500">· {payments.length}</span></CardTitle>
        </CardHeader>
        <CardContent>
          {payments.length === 0 ? (
            <p className="text-sm text-neutral-500">Оплат поставщику пока нет.</p>
          ) : (
            <Table>
              <Thead><Tr><Th>Дата</Th><Th>Цель</Th><Th>Основание</Th><Th className="text-right" unit="₽">Сумма</Th><Th>Документы</Th></Tr></Thead>
              <Tbody>
                {shownPays.map((p) => (
                  <Tr key={p.id}>
                    <Td>{Number(p.amount) === 0 ? <span>{formatDate(p.paidAt)}</span> : <Link href={`/payments/s-${p.id}`} className="text-blue-700 hover:underline">{formatDate(p.paidAt)}</Link>}{p.status === "PENDING" && <span className="ml-1 text-xs text-neutral-500">(план)</span>}</Td>
                    <Td>{p.auctionSession ? `Аукцион «${p.auctionSession}»` : p.purchase ? `Закупка ${p.purchase.number}` : "Аванс без привязки"}</Td>
                    <Td className="text-xs text-neutral-600">{p.docRef ?? "—"}{!p.confirmed && <span className="ml-1 text-amber-700">· не подтверждена</span>}</Td>
                    <Td className="text-right tabular-nums">{rub(p.amount.toString())}</Td>
                    <Td className="text-xs">{payDocs[p.id] ? <SourceDocs compact data={payDocs[p.id]} popover="right" /> : <span className="text-neutral-400">—</span>}</Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          )}
          {payments.length > PAY_SHOWN && <p className="mt-2 text-xs text-neutral-500">Показаны последние {PAY_SHOWN} из {payments.length}. Все оплаты — в разделе <Link href="/payments" className="text-blue-700 hover:underline">«Оплаты»</Link>.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2" className="text-base">Закупки <span className="font-normal text-neutral-500">· {live.length}</span></CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {live.length === 0 ? (
            <p className="text-sm text-neutral-500">Закупок у этого поставщика пока нет.</p>
          ) : (
            <Table>
              <Thead><Tr><Th>Закупка</Th><Th>Дата</Th><Th>Аукцион</Th><Th>Статус</Th><Th className="text-right" unit="₽">Сумма</Th></Tr></Thead>
              <Tbody>
                {live.slice(0, PUR_SHOWN).map((p) => (
                  <Tr key={p.id}>
                    <Td><Link href={`/purchases/${p.id}`} className="text-blue-700 hover:underline">{p.number}</Link></Td>
                    <Td>{formatDate(p.orderDate)}</Td>
                    <Td>{p.auctionSession ?? "—"}</Td>
                    <Td>{STATUS_LABELS[p.status] ?? p.status}</Td>
                    <Td className="text-right tabular-nums">{rub(purchaseTotalInclVat(p).toString())}</Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          )}
          {live.length > PUR_SHOWN && <p className="text-xs text-neutral-500">Показаны последние {PUR_SHOWN} из {live.length}. Все закупки — в разделе <Link href="/purchases" className="text-blue-700 hover:underline">«Закупки»</Link>.</p>}
          {live.length > 0 && <SourceDocs data={purDocs} title="Документы по закупкам" />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2" className="text-base">Реквизиты</CardTitle>
        </CardHeader>
        <CardContent>
          {!canEdit && <p className="mb-3 text-sm text-neutral-500">Только просмотр: редактировать поставщиков могут владелец, администратор и закупщик.</p>}
          <fieldset disabled={!canEdit} className="min-w-0 border-0 p-0">
            <SupplierForm action={boundAction} supplier={supplier} />
          </fieldset>
        </CardContent>
      </Card>
    </div>
  );
}
