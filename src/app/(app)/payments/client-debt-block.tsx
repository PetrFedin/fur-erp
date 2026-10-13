import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatMoney, formatDate } from "@/lib/utils";
import { AllocationEditButton } from "@/components/allocation-editor";
import { isContractorHidesRest, loadAllocEditorData, loadClientDebt } from "@/lib/payment-alloc";
import { canEditProduction } from "@/lib/production-access";
import { PAYMENT_TYPE_LABELS_RU } from "@/lib/payment-alloc-labels";
import { InfoHint } from "@/components/info-hint";

const KIND_LABEL = { advance: "аванс без разнесения", excess: "сверх работы ТЗ" } as const;
const PP = /п\/п\s*№?\s*\d+/i;

/**
 * Вкладка «За производство» → «Неразнесённые авансы»: платежи заказчика, часть которых ещё не отнесена ни к одному ТЗ.
 * Итог совпадает со строкой «Аванс без партии» на /production/batches (тот же loadClientDebt; шкуры подрядчика — это сырьё, их здесь нет).
 * Кнопка «Разнести…» открывает редактор разнесения по ТЗ (тот же, что в карточке ТЗ). Якорь #unallocated — для ссылок из Контроля.
 */
export async function ClientDebtBlock({ orgId, year, role }: { orgId: string; year: string; role: string }) {
  const debt = await loadClientDebt(prisma, orgId, { year });
  const canEdit = canEditProduction(role);
  const pays = debt.payments.filter((p) => !isContractorHidesRest(p) && p.rest.toNumber() > 1); // копейки округления в список не выносим, в итог они входят
  const total = debt.unallocated;
  const links = pays.length && canEdit
    ? await prisma.productionPaymentOrder.findMany({ where: { productionPaymentId: { in: pays.map((p) => p.id) } }, select: { productionPaymentId: true, productionOrderId: true } })
    : [];
  const edit = canEdit
    ? await loadAllocEditorData(prisma, orgId, pays.map((p) => ({ id: p.id, clientId: p.clientId, linkedOrderIds: links.filter((l) => l.productionPaymentId === p.id).map((l) => l.productionOrderId) })))
    : new Map();
  return (
    <section id="unallocated" aria-label="Неразнесённые авансы" className="scroll-mt-20 flex flex-col gap-2 rounded-lg border border-neutral-200 bg-white p-3 sm:p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="block-title">
          <span className="inline-flex items-center gap-1.5">Неразнесённые авансы <span className="font-normal text-neutral-500">· {pays.length} на {formatMoney(total.toFixed(2))}</span>
            <InfoHint label="Про неразнесённые авансы" wide>
              <p>Часть платежа заказчика, не отнесённая ни к одному ТЗ. В долге заказчиков она уже учтена отдельной строкой, поэтому разнесение итог долга не меняет — оно переносит аванс из «без партии» в конкретные ТЗ и партии. Эта сумма — «Аванс без партии» на странице «Партии».</p>
              <p className="mt-1">Платежи в счёт шкур подрядчика — это сырьё, а не оплата работы, их здесь нет.</p>
            </InfoHint></span>
        </h2>
        <Link href="/production/batches" className="text-xs text-blue-700 hover:underline print:hidden">→ Партии</Link>
      </div>
      {pays.length === 0 ? (
        <p className="text-sm text-neutral-500">Все платежи заказчиков отнесены к ТЗ.</p>
      ) : (
        <ul className="divide-y divide-neutral-100 text-sm">
          {pays.map((p) => {
            const pp = PP.exec(p.docRef ?? "");
            return (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <div>
                    <Link href={`/payments/c-${p.id}`} className="text-blue-700 hover:underline">{formatDate(p.paidAt)}</Link>
                    <span className="text-neutral-500"> · {PAYMENT_TYPE_LABELS_RU[p.paymentType] ?? p.paymentType} · {p.clientName ?? "без заказчика"}{pp ? ` · ${pp[0]}` : ""}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-1.5 text-xs text-neutral-500">
                    <span>разнесено {formatMoney(p.allocated.toFixed(2))} из {formatMoney(p.amount.toFixed(2))}</span>
                    <span className="font-medium tabular-nums text-amber-700">не разнесено {formatMoney(p.rest.toFixed(2))}</span>
                    <span>· {KIND_LABEL[p.kind]}{p.linkedOrders > 0 ? ` · в наборе ${p.linkedOrders} ТЗ` : " · без ТЗ"}</span>
                    {p.docRef ? <InfoHint label="Основание платежа"><p>{p.docRef}</p></InfoHint> : null}
                  </div>
                </div>
                {edit.get(p.id) && <AllocationEditButton paymentId={p.id} amount={p.amount.toFixed(2)} orders={edit.get(p.id)!.orders} initial={edit.get(p.id)!.initial} label="Разнести…" />}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
