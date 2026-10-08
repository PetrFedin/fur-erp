import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatMoney, formatDate } from "@/lib/utils";
import { AllocationEditButton } from "@/components/allocation-editor";
import { loadAllocEditorData, loadClientDebt } from "@/lib/payment-alloc";
import { canEditProduction } from "@/lib/production-access";
import { PAYMENT_TYPE_LABELS_RU } from "@/lib/payment-alloc-labels";

const KIND_LABEL = { advance: "аванс без разнесения", excess: "сверх работы ТЗ" } as const;

/**
 * Долг заказчиков (вкладка «От заказчиков»): работа − оплачено, где оплачено = разнесено по ТЗ + неразнесённые авансы;
 * ниже — список платежей с неразнесённым остатком и кнопка «Разнесение» (тот же редактор, что в карточке ТЗ).
 */
export async function ClientDebtBlock({ orgId, year, role }: { orgId: string; year: string; role: string }) {
  const debt = await loadClientDebt(prisma, orgId, { year });
  const canEdit = canEditProduction(role);
  const pays = debt.payments;
  const links = pays.length && canEdit
    ? await prisma.productionPaymentOrder.findMany({ where: { productionPaymentId: { in: pays.map((p) => p.id) } }, select: { productionPaymentId: true, productionOrderId: true } })
    : [];
  const edit = canEdit
    ? await loadAllocEditorData(prisma, orgId, pays.map((p) => ({ id: p.id, clientId: p.clientId, linkedOrderIds: links.filter((l) => l.productionPaymentId === p.id).map((l) => l.productionOrderId) })))
    : new Map();
  const rest = debt.unallocatedByKind;
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-white p-4" aria-label="Долг заказчиков">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Долг заказчиков <span className="font-normal text-neutral-500">· с НДС</span></h2>
        <span className={"text-xl font-semibold tabular-nums " + (debt.balance > 0 ? "text-amber-700" : "")}>{formatMoney(debt.balance.toFixed(2))}</span>
      </div>
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div><dt className="text-xs text-neutral-500">Работа заказчикам</dt><dd className="tabular-nums">{formatMoney(debt.billable.toFixed(2))}</dd></div>
        <div><dt className="text-xs text-neutral-500">Разнесено по ТЗ</dt><dd className="tabular-nums">{formatMoney(debt.allocated.toFixed(2))}</dd></div>
        <div><dt className="text-xs text-neutral-500">Неразнесённые авансы</dt><dd className="tabular-nums">{formatMoney(debt.unallocated.toFixed(2))}</dd></div>
        <div><dt className="text-xs text-neutral-500">Оплачено всего</dt><dd className="tabular-nums">{formatMoney(debt.paid.toFixed(2))}</dd></div>
      </dl>
      <p className="text-xs text-neutral-500">
        Остаток = работа − оплачено. «Неразнесённые авансы» — части платежей, которые не отнесены ни к одному ТЗ: аванс без разнесения {formatMoney(rest.advance.toFixed(2))}
        {rest.excess > 0.005 ? <>, платежи сверх работы ТЗ (например, шкуры подрядчика) {formatMoney(rest.excess.toFixed(2))}</> : null}. Итог долга от разнесения не зависит.
      </p>
      <div id="unallocated" className="scroll-mt-20">
        <h3 className="mb-1 text-sm font-medium">Неразнесённые авансы ({pays.length})</h3>
        {pays.length === 0 ? (
          <p className="text-sm text-neutral-500">Все платежи отнесены к ТЗ.</p>
        ) : (
          <ul className="divide-y divide-neutral-100 text-sm">
            {pays.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <div>
                    <span className="font-medium tabular-nums">{formatMoney(p.rest.toFixed(2))}</span>
                    <span className="text-neutral-500"> из {formatMoney(p.amount.toFixed(2))} · {formatDate(p.paidAt)} · {PAYMENT_TYPE_LABELS_RU[p.paymentType] ?? p.paymentType} · {KIND_LABEL[p.kind]}</span>
                  </div>
                  <div className="text-xs text-neutral-500">{p.clientName ?? "без заказчика"}{p.docRef ? ` · ${/^п\/п/i.test(p.docRef) ? p.docRef : `п/п ${p.docRef}`}` : ""}{p.linkedOrders > 0 ? ` · в наборе ${p.linkedOrders} ТЗ` : " · без ТЗ"}</div>
                </div>
                {edit.get(p.id) && <AllocationEditButton paymentId={p.id} amount={p.amount.toFixed(2)} orders={edit.get(p.id)!.orders} initial={edit.get(p.id)!.initial} label="Разнести" />}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-1 text-xs text-neutral-500">Платёж разносится по ТЗ автоматически при создании; здесь — то, что не удалось разнести. <Link href="/attention" className="text-blue-600 hover:underline">Контроль → Задачи</Link></p>
      </div>
    </section>
  );
}
