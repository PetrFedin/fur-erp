import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { getFurIndex } from "@/lib/fur-ref-server";
import { loadFurLots } from "@/lib/fur-table-server";
import { getCommission4Mode } from "@/lib/commission4-mode";
import { loadOrderRows } from "@/lib/analytics-orders";
import { loadAuctionSummaries, auctionName } from "@/lib/auction-payments";
import { purchaseTotalInclVat } from "@/lib/purchase-totals";
import { figures, flowOf } from "@/lib/fur-table";
import { rawRowsFromLots } from "@/lib/raw-rows";
import { formatDate, formatMoney } from "@/lib/utils";
import { cleanNote } from "@/lib/note-tags";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { InfoHint } from "@/components/info-hint";
import { FurOrdersTable } from "@/components/fur-orders-table";
import { RawCards } from "../../../dashboard/raw-block";
import { LiningFabrics } from "./view";

export const metadata = { title: "Партия подкладки" };

/**
 * Карточка партии подкладки («Подкладка 05.26»): плитки куплено / использовано / остаток (м, ₽, цена ₽/м, НДС), паспорт партии, ткани партии и
 * «Использование по ТЗ». Только подкладка: без шкур, $ и молотка, счетов аукциона и фильтров меха. Расчёт тот же (fur-table.ts), что в таблице «Подкладка».
 */
export default async function LiningBatchPage({ params, searchParams }: PageProps<"/lots/lining/[batch]">) {
  const session = await requireSession();
  const { batch: raw } = await params;
  const sp = await searchParams;
  const name = decodeURIComponent(raw);
  const orgId = session.user.organizationId;
  const [furIdx, c4] = await Promise.all([getFurIndex(orgId), getCommission4Mode()]);
  const all = await loadFurLots(prisma, orgId, { kind: "lining", year: "all", furIdx });
  const lots = all.filter((l) => l.auction === name);
  if (lots.length === 0) notFound();

  const purchaseIds = [...new Set(lots.map((l) => l.purchaseId).filter((x): x is string => !!x))];
  const [purchases, pays, orders] = await Promise.all([
    prisma.purchase.findMany({ where: { organizationId: orgId, id: { in: purchaseIds } }, include: { supplier: true, items: true, expenses: true }, orderBy: { number: "asc" } }),
    loadAuctionSummaries(prisma, orgId, [name]),
    loadOrderRows(orgId, "all", c4),
  ]);
  const pay = pays.find((p) => p.name === name) ?? pays[0];
  const usedIds = new Set(lots.flatMap((l) => l.usages.map((u) => u.orderId)));
  const orderInfo = Object.fromEntries(
    orders.filter((o) => usedIds.has(o.id)).map((o) => [o.id, { number: o.number, article: o.modelLabel || o.modelName, category: o.category, batch: o.batchText ?? "Без партии", year: o.year, status: o.status, units: o.qty, group: o.categoryGroup }]),
  );

  const fl = flowOf(lots);
  const pair = { incl: figures(fl, { vat: "incl", c4 }), excl: figures(fl, { vat: "excl", c4 }) };
  const vatBy = (k: "recv" | "used" | "rem") => {
    const m: Record<string, number> = {};
    for (const l of lots) {
      const v = k === "recv" ? l.recvIncl - l.recvExcl : k === "used" ? l.usedIncl - l.usedExcl : l.remIncl - l.remExcl;
      if (Math.abs(v) > 1e-6) m[String(l.vatRate)] = (m[String(l.vatRate)] ?? 0) + v;
    }
    return m;
  };
  const headerEnd = <Link href="/lots?tab=lining" className="text-xs text-blue-700 hover:underline print:hidden">→ Сырьё — подкладка</Link>;
  const firstPurchase = purchases[0];
  const sumAll = purchases.reduce((a, p) => a + purchaseTotalInclVat(p).toNumber(), 0);
  const paid = pay ? pay.paid.toNumber() : null;
  const dates = purchases.map((p) => p.orderDate.getTime());
  const supplierNames = [...new Set(purchases.map((p) => p.supplier.name))];
  const firstOf = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  void auctionName;

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: "Сырьё", href: "/lots" }, { label: "Подкладка", href: "/lots?tab=lining" }, { label: name }]} />
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/lots?tab=lining" aria-label="Назад в «Сырьё — Подкладка»" title="Назад в «Сырьё — Подкладка»" className="inline-flex size-8 items-center justify-center rounded-lg border border-neutral-300 text-neutral-700 hover:bg-neutral-50">←</Link>
        <h1 className="text-xl font-semibold">Подкладка · {name}</h1>
        <InfoHint label="О карточке партии подкладки" wide>
          <p>Партия закупки подкладки: сколько метров и на какую сумму куплено, использовано в ТЗ и осталось. Цифры те же, что в таблице «Сырьё → Подкладка» и в плитках Главной. 4% начисляется только при списании в ТЗ.</p>
        </InfoHint>
      </div>

      <div data-raw-tiles>
        <RawCards view="lining" rows={rawRowsFromLots(lots)} fur={pair} lining={pair} c4={c4} headerEnd={headerEnd} vatRates={{ recv: vatBy("recv"), used: vatBy("used"), rem: vatBy("rem") }} />
      </div>

      <section aria-labelledby="lb-pass" className="rounded-lg border border-neutral-200 bg-white p-3">
        <h2 id="lb-pass" className="mb-2 text-base font-semibold">Партия</h2>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div><dt className="text-xs text-neutral-500">Дата закупки</dt><dd>{dates.length ? formatDate(new Date(Math.min(...dates))) : "—"}</dd></div>
          <div><dt className="text-xs text-neutral-500">Поставщик</dt><dd>{supplierNames.join(", ") || "—"}</dd></div>
          <div>
            <dt className="text-xs text-neutral-500">{purchases.length > 1 ? "Закупки" : "Закупка"}</dt>
            <dd>{purchases.map((p, i) => <span key={p.id}>{i > 0 ? ", " : ""}<Link href={`/purchases/${p.id}`} className="text-blue-700 hover:underline">{p.number}<span aria-hidden className="ml-0.5 text-[10px] text-neutral-400">↗</span></Link></span>)}</dd>
          </div>
          <div><dt className="text-xs text-neutral-500">Счёт / УПД</dt><dd>{[...new Set(purchases.map((p) => p.invoiceNumber).filter(Boolean))].join(", ") || "—"}</dd></div>
          <div><dt className="text-xs text-neutral-500">Сумма закупки, ₽ (с НДС)</dt><dd className="tabular-nums">{formatMoney(sumAll.toFixed(2))}</dd></div>
          <div>
            <dt className="text-xs text-neutral-500">Оплачено / долг, ₽</dt>
            <dd className="tabular-nums">{paid != null && pay ? <>{formatMoney(paid.toFixed(2))} · <span className={pay.total.toNumber() - paid > 0.5 ? "text-amber-700" : undefined}>{formatMoney((pay.total.toNumber() - paid).toFixed(2))}</span> <Link href={`/payments?auction=${encodeURIComponent(name)}#auction-block`} className="ml-1 text-xs text-blue-700 hover:underline">оплаты ›</Link></> : <Link href="/payments" className="text-blue-700 hover:underline">Оплаты ведутся по партии целиком →</Link>}</dd>
          </div>
          {cleanNote(firstPurchase?.notes) ? <div className="sm:col-span-2"><dt className="text-xs text-neutral-500">Примечание</dt><dd>{cleanNote(firstPurchase?.notes)}</dd></div> : null}
        </dl>
      </section>

      <LiningFabrics lots={lots} />
      <FurOrdersTable lots={lots} kind="lining" orderInfo={orderInfo} initialGrp={firstOf(sp.grp)} />
    </div>
  );
}
