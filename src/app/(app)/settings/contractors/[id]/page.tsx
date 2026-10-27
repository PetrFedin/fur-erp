import Link from "next/link";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { ACCESS, hasRole } from "@/lib/access";
import { loadClientDebt } from "@/lib/payment-alloc";
import { orderUnits } from "@/lib/production-totals";
import { TERMS } from "@/lib/terms";
import { payslipsText } from "@/lib/pay-kinds";
import { Button } from "@/components/ui/button";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { formatDate, formatMoney } from "@/lib/utils";
import { ContractorForm, ContractForm, CabinetAccessForm } from "../contractor-forms";
import { addContract, createCabinetAccess, toggleContract, toggleContractorActive, updateContractor } from "../actions";

const rub = (v: number) => formatMoney(v.toFixed(2));
const KIND_RU = { WORK: "Подряд (пошив)", SUPPLY: "Купля-продажа сырья" } as const;
const SHOWN = 40;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireSession();
  const r = await prisma.supplier.findFirst({ where: { id, organizationId: s.user.organizationId, isContractor: true }, select: { name: true } });
  return { title: r ? `Подрядчик ${r.name}` : "Подрядчик" };
}

/** Карточка подрядчика: его ТЗ, партии, оплаты за работу, долг, договоры, документы, этапы и доступ в кабинет. Данные только этого подрядчика. */
export default async function ContractorPage({ params }: PageProps<"/settings/contractors/[id]">) {
  const { id } = await params;
  const session = await requireSession();
  const orgId = session.user.organizationId;
  const c = await prisma.supplier.findFirst({ where: { id, organizationId: orgId, isContractor: true } });
  if (!c) notFound();
  const canEdit = hasRole(session.user.role, ACCESS.suppliers);
  const canUsers = hasRole(session.user.role, ACCESS.users);

  const [orders, payments, contracts, users, debt, docCount, inboxNew, stages] = await Promise.all([
    prisma.productionOrder.findMany({
      where: { organizationId: orgId, contractorId: id },
      select: { id: true, number: true, workOrderNumber: true, plannedQuantity: true, producedQuantity: true, status: true, batch: { select: { number: true, year: true } }, productModel: { select: { name: true } } },
      orderBy: [{ workOrderDate: "desc" }, { createdAt: "desc" }],
    }),
    prisma.productionPayment.findMany({
      where: { organizationId: orgId, contractorId: id, status: { not: "CANCELLED" } },
      select: { id: true, amount: true, paidAt: true, paymentType: true, docRef: true },
      orderBy: { paidAt: "desc" },
    }),
    prisma.supplierContract.findMany({ where: { organizationId: orgId, supplierId: id }, orderBy: [{ isActive: "desc" }, { date: "asc" }] }),
    prisma.user.findMany({ where: { organizationId: orgId, supplierId: id, role: "SUPPLIER" }, select: { id: true, name: true, email: true, isActive: true }, orderBy: { createdAt: "asc" } }),
    loadClientDebt(prisma, orgId, { year: "all", contractorId: id }),
    prisma.driveDocument.count({ where: { organizationId: orgId, storagePath: { not: null }, OR: [{ productionOrder: { contractorId: id } }, { productionPayment: { contractorId: id } }] } }),
    prisma.supplierInbox.count({ where: { organizationId: orgId, supplierId: id, status: "SENT" } }),
    c.suppliesRaw ? prisma.supplierRawStage.count({ where: { organizationId: orgId, supplierId: id } }) : Promise.resolve(0),
  ]);
  const batches = new Map<number, { year: number | null; n: number }>();
  for (const o of orders) if (o.batch) batches.set(o.batch.number, { year: o.batch.year, n: (batches.get(o.batch.number)?.n ?? 0) + 1 });
  const paid = payments.reduce((a, p) => a + Number(p.amount), 0);
  const row = "flex flex-wrap items-baseline justify-between gap-x-4 border-b border-neutral-100 py-1.5 last:border-0";
  const TYPE = { ADVANCE: "Аванс", PARTIAL: "Доплата", FINAL: "Расчёт" } as Record<string, string>;

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: "Настройки", href: "/settings" }, { label: "Подрядчики", href: "/settings/contractors" }, { label: c.name }]} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{c.name}{!c.isActive && <span className="ml-2 text-sm font-normal text-neutral-500">в архиве</span>}</h1>
        {canEdit && (
          <form action={async () => { "use server"; await toggleContractorActive(id); }}>
            <Button type="submit" variant="outline" size="sm">{c.isActive ? "В архив" : "Вернуть из архива"}</Button>
          </form>
        )}
      </div>

      <section className="rounded-lg border border-neutral-200 bg-white px-3 py-1 text-sm" aria-label="Долг по работе">
        <div className={row}><span className="text-neutral-600">Работа по ТЗ подрядчика</span><b className="tabular-nums">{rub(debt.billable)}</b></div>
        <div className={row}><span className="text-neutral-600">Оплачено (разнесено на ТЗ {rub(debt.allocated)} + аванс без разнесения {rub(debt.unallocated)})</span><b className="tabular-nums">{rub(debt.paid)}</b></div>
        <div className={row}><span className="text-neutral-600">{TERMS.workRest}</span><b className="tabular-nums">{rub(Math.max(debt.billable - debt.allocated, 0))}</b></div>
        {debt.unallocatedByKind.advance >= 1 && <div className={row}><span className="text-neutral-600">{TERMS.advance} (не разнесён на ТЗ)</span><b className="tabular-nums">{rub(debt.unallocatedByKind.advance)}</b></div>}
        <p className="py-1.5 text-xs text-neutral-500">«{TERMS.workRest}» считается так же, как на Главной и в «Оплатах», только по ТЗ и оплатам этого подрядчика. Оплат за работу: {payslipsText(payments.map((p) => ({ id: p.id, pp: /п\/п\s*№?\s*(\d+)/i.exec(p.docRef ?? "")?.[1] ?? null })))} на {rub(paid)}.</p>
      </section>

      <section className="flex flex-col gap-2" aria-label="ТЗ">
        <h2 className="text-base font-semibold">ТЗ <span className="font-normal text-neutral-500">· {orders.length}</span></h2>
        <Table>
          <Thead><Tr><Th>ТЗ</Th><Th>Изделие</Th><Th>Партия</Th><Th className="text-right">План, шт</Th><Th className="text-right">В выпуске, шт</Th></Tr></Thead>
          <Tbody>
            {orders.slice(0, SHOWN).map((o) => (
              <Tr key={o.id}>
                <Td><Link href={`/production/${o.id}`} className="text-blue-700 hover:underline">{o.workOrderNumber?.trim() || o.number}</Link></Td>
                <Td>{o.productModel.name}</Td>
                <Td>{o.batch ? <Link href={`/production/batches/${o.batch.number}`} className="text-blue-700 hover:underline">{o.batch.number}</Link> : "–"}</Td>
                <Td className="text-right tabular-nums">{Number(o.plannedQuantity)}</Td>
                <Td className="text-right tabular-nums">{orderUnits(o)}</Td>
              </Tr>
            ))}
            {orders.length === 0 && <Tr><Td colSpan={5} className="py-6 text-center text-neutral-500">ТЗ этого подрядчика пока нет</Td></Tr>}
          </Tbody>
        </Table>
        {orders.length > SHOWN && <p className="text-xs text-neutral-500">Показаны первые {SHOWN}. Все — в разделе «ТЗ», фильтр «Подрядчик».</p>}
        {batches.size > 0 && (
          <p className="text-sm text-neutral-700">Партии: {Array.from(batches).sort((a, b) => b[0] - a[0]).map(([n, v]) => <Link key={n} href={`/production/batches/${n}`} className="mr-2 text-blue-700 hover:underline">{n}{v.year ? ` (${v.year})` : ""}</Link>)}</p>
        )}
      </section>

      <section className="flex flex-col gap-2" aria-label="Оплаты за работу">
        <h2 className="text-base font-semibold">Оплаты за работу <span className="font-normal text-neutral-500">· {payments.length}</span></h2>
        <Table>
          <Thead><Tr><Th>Дата</Th><Th>Тип</Th><Th>Основание</Th><Th className="text-right">Сумма</Th></Tr></Thead>
          <Tbody>
            {payments.slice(0, 15).map((p) => (
              <Tr key={p.id}><Td>{formatDate(p.paidAt)}</Td><Td>{TYPE[p.paymentType] ?? p.paymentType}</Td><Td className="max-w-md truncate">{p.docRef ?? "–"}</Td><Td className="text-right tabular-nums">{rub(Number(p.amount))}</Td></Tr>
            ))}
            {payments.length === 0 && <Tr><Td colSpan={4} className="py-6 text-center text-neutral-500">Оплат пока нет</Td></Tr>}
          </Tbody>
        </Table>
        <p className="text-xs text-neutral-500">Полный список — «Оплаты → Реестр», фильтр «Контрагент».</p>
      </section>

      <section className="flex flex-col gap-2 rounded-lg border border-neutral-200 bg-white p-3" aria-label="Документы и этапы">
        <h2 className="text-base font-semibold">Документы и этапы</h2>
        <p className="text-sm text-neutral-700">
          Прикреплённых документов к ТЗ и оплатам подрядчика: <b>{docCount}</b> (<Link href="/documents" className="text-blue-700 hover:underline">все документы</Link>). Присланное им на проверку: <b>{inboxNew}</b> (<Link href="/inbox" className="text-blue-700 hover:underline">Входящие</Link>).
          {c.suppliesRaw && <> Этапов сырья: <b>{stages}</b>.</>}
        </p>
      </section>

      <section className="flex flex-col gap-2 rounded-lg border border-neutral-200 bg-white p-3" aria-label="Договоры">
        <h2 className="text-base font-semibold">Договоры</h2>
        <Table>
          <Thead><Tr><Th>Номер</Th><Th>Дата</Th><Th>Вид</Th><Th>Примечание</Th><Th></Th></Tr></Thead>
          <Tbody>
            {contracts.map((k) => (
              <Tr key={k.id} className={k.isActive ? "" : "text-neutral-500"}>
                <Td>№ {k.number}</Td><Td>{k.date ? formatDate(k.date) : "–"}</Td><Td>{KIND_RU[k.kind]}</Td><Td>{k.note ?? "–"}</Td>
                <Td>{canEdit && <form action={async () => { "use server"; await toggleContract(k.id); }}><Button type="submit" variant="ghost" size="sm">{k.isActive ? "В архив" : "Вернуть"}</Button></form>}</Td>
              </Tr>
            ))}
            {contracts.length === 0 && <Tr><Td colSpan={5} className="py-4 text-center text-neutral-500">Договоров нет</Td></Tr>}
          </Tbody>
        </Table>
        {canEdit && <ContractForm action={addContract.bind(null, id)} />}
      </section>

      {canUsers && (
        <section className="flex flex-col gap-2 rounded-lg border border-neutral-200 bg-white p-3" aria-label="Кабинет подрядчика">
          <h2 className="text-base font-semibold">Кабинет подрядчика</h2>
          <p className="text-sm text-neutral-600">Подрядчик входит под своим email и видит только свои ТЗ, расчёты, отгрузки и чат. Пользователей можно также вести в «Настройки → Пользователи».</p>
          {users.length > 0 && <ul className="text-sm">{users.map((u) => <li key={u.id}>{u.name} · {u.email}{!u.isActive && " · отключён"}</li>)}</ul>}
          {c.isActive ? <CabinetAccessForm action={createCabinetAccess.bind(null, id)} defaultEmail="" /> : <p className="text-sm text-neutral-500">Подрядчик в архиве — доступ не создаётся.</p>}
        </section>
      )}

      <section className="flex flex-col gap-2" aria-label="Реквизиты">
        <h2 className="text-base font-semibold">Реквизиты</h2>
        {canEdit ? <ContractorForm action={updateContractor.bind(null, id)} contractor={c} /> : (
          <p className="text-sm text-neutral-700">{[c.inn && `ИНН ${c.inn}`, c.contactName, c.phone, c.email, c.address].filter(Boolean).join(" · ") || "–"}</p>
        )}
      </section>
    </div>
  );
}
