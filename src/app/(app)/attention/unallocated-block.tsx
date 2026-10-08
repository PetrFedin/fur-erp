import Link from "next/link";
import { InfoHint } from "@/components/info-hint";
import { prisma } from "@/lib/prisma";
import { formatMoney, formatDate } from "@/lib/utils";
import { loadUnallocatedPayments } from "@/lib/payment-alloc";

const KIND = { advance: "аванс без разнесения", excess: "сверх работы ТЗ" } as const;

/**
 * Контроль → Задачи: платежи заказчиков с неразнесённым остатком («аванс без разнесения» и «сверх работы», например шкуры подрядчика).
 * В число задач не входит (на долг заказчиков не влияет — он учитывает их отдельной строкой); разнести можно на /payments?tab=clients.
 */
export async function UnallocatedAdvancesBlock({ orgId }: { orgId: string }) {
  const list = await loadUnallocatedPayments(prisma, orgId);
  if (list.length === 0) return null;
  const total = list.reduce((s, p) => s + p.rest.toNumber(), 0);
  return (
    <section aria-label="Неразнесённые авансы" className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">
          Неразнесённые авансы <span className="font-normal text-neutral-500">· {list.length} на {formatMoney(total.toFixed(2))}</span>
          <span className="ml-1.5 align-middle"><InfoHint wide label="Что это">
            <p>Часть платежа заказчика, не отнесённая ни к одному ТЗ. На долг заказчиков не влияет (учтена отдельной строкой), в число задач не входит.</p>
          </InfoHint></span>
        </h2>
        <Link href="/payments?tab=clients#unallocated" className="text-sm text-blue-700 hover:underline">Разнести по ТЗ →</Link>
      </div>
      <ul className="mt-2 divide-y divide-neutral-100 text-sm">
        {list.slice(0, 3).map((p) => (
          <li key={p.id} className="flex flex-wrap justify-between gap-x-3 py-1.5">
            <span>
              <span className="font-medium tabular-nums">{formatMoney(p.rest.toFixed(2))}</span>
              <span className="text-neutral-500"> · {formatDate(p.paidAt)} · {p.clientName ?? "без заказчика"} · {KIND[p.kind]}</span>
            </span>
            <span className="text-xs text-neutral-500">из {formatMoney(p.amount.toFixed(2))}</span>
          </li>
        ))}
      </ul>
      {list.length > 3 && <p className="mt-1 text-xs text-neutral-500">…и ещё {list.length - 3}. <Link href="/payments?tab=clients#unallocated" className="text-blue-700 hover:underline">Все</Link></p>}
    </section>
  );
}
