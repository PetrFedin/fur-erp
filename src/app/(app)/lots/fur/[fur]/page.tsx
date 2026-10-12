import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { getYearFilter } from "@/lib/year-filter";
import { getFurIndex } from "@/lib/fur-ref-server";
import { loadFurLots } from "@/lib/fur-table-server";
import { loadDashboard } from "@/lib/dashboard-data";
import { parseDashFilters } from "@/lib/dashboard-calc";
import { getCommission4Mode } from "@/lib/commission4-mode";
import { figures, flowOf } from "@/lib/fur-table";
import { rawRowsFromLots } from "@/lib/raw-rows";
import { FurSelectionTotal } from "@/components/fur-selection-total";
import { YearNote } from "@/components/year-note";
import { InfoHint } from "@/components/info-hint";
import { loadOrderRows } from "@/lib/analytics-orders";
import { RawCards } from "../../../dashboard/raw-block";
import { FilteredPayTiles } from "../../../dashboard/filtered-pay-tiles";

export const metadata = { title: "Вид меха" };

/**
 * Страница вида меха (Сырьё → Мех → «Лиса»): плитки «Куплено / Использовано / Остаток» и оплаты по виду, таблица «По аукционам» и «По годам»
 * с раскрытием до лотов и ТЗ, «Использование по ТЗ». Расчёт — тот же (fur-table.ts), что в таблице «Мех» на /lots: цифры совпадают.
 */
export default async function FurKindPage({ params, searchParams }: PageProps<"/lots/fur/[fur]">) {
  const session = await requireSession();
  const { fur: rawName } = await params;
  const sp = await searchParams;
  const name = decodeURIComponent(rawName);
  const orgId = session.user.organizationId;
  const year = await getYearFilter();
  const furIdx = await getFurIndex(orgId);

  const [lots, c4, dash] = await Promise.all([
    loadFurLots(prisma, orgId, { kind: "fur", year, furIdx }),
    getCommission4Mode(),
    getCommission4Mode().then((c) => loadDashboard(orgId, year, parseDashFilters({}), c)),
  ]);
  const own = [
    ...lots.filter((l) => l.item === name).map((l) => ({ ...l, paid: dash.lotMoney[l.id]?.paid ?? 0, due: dash.lotMoney[l.id]?.due ?? 0 })),
    ...dash.syntheticLots.filter((l) => l.item === name),
  ];
  if (own.length === 0) notFound();
  // Сведения о ТЗ, в которые ушёл этот мех: артикул, партия, год, статус, число изделий.
  const usedIds = new Set(own.flatMap((l) => l.usages.map((u) => u.orderId)));
  const orderInfo = Object.fromEntries(
    (await loadOrderRows(orgId, "all", c4)).filter((o) => usedIds.has(o.id)).map((o) => [o.id, { number: o.number, article: o.modelLabel || o.modelName, category: o.category, batch: o.batchText ?? "Без партии", year: o.year, status: o.status, units: o.qty, group: o.categoryGroup }]),
  );

  const fl = flowOf(own);
  const pair = { incl: figures(fl, { vat: "incl", c4 }), excl: figures(fl, { vat: "excl", c4 }) };
  const paid = own.reduce((a, l) => a + (l.paid ?? 0), 0);
  const due = own.reduce((a, l) => a + (l.due ?? 0), 0);
  const headerEnd = <Link href="/lots" className="text-xs text-blue-700 hover:underline print:hidden">→ Сырьё — мех</Link>;
  const tiles = (
    <div key="raw-tiles" data-raw-tiles>
      <RawCards view="fur" rows={rawRowsFromLots(own)} fur={pair} lining={dash.raw.lining} c4={c4} headerEnd={headerEnd} pay={<FilteredPayTiles figs={pair.incl} paid={paid} due={due} c4={c4} />} />
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/lots" aria-label="Назад в «Сырьё — Мех»" title="Назад в «Сырьё — Мех»" className="inline-flex size-8 items-center justify-center rounded-lg border border-neutral-300 text-neutral-700 hover:bg-neutral-50">←</Link>
        <h1 className="text-xl font-semibold">{name}</h1>
        <YearNote year={year} />
        <span className="inline-flex">
          <InfoHint label="О странице вида меха" wide>
            <p>Детализация по виду меха «{name}»: куплено → использовано → остаток по аукционам (партиям закупки) и годам, до лотов и ТЗ. Нажмите на название аукциона — откроется его страница со счетами и лотами; «карточка ›» — карточка лота; «ТЗ» — техзадание, в которое ушли шкуры.</p>
            <p className="mt-1">Цифры те же, что в таблице «Мех» на странице «Сырьё» и в плитках Главной. Без фильтров плитки оплат — доля оплат и долга партий по стоимости лотов вида.</p>
          </InfoHint>
        </span>
        <nav aria-label="Хлебные крошки" className="text-xs text-neutral-500 print:hidden">
          <Link href="/lots" className="hover:underline">Сырьё</Link> › <Link href="/lots" className="hover:underline">Мех</Link> › {name}
        </nav>
      </div>
      <FurSelectionTotal lots={own} kind="fur" globalYear={year} initialQuery={sp} lockItem={name} orderInfo={orderInfo} raw={{ tiles, c4, fur: pair, lining: dash.raw.lining, headerEnd, rows: rawRowsFromLots(own) }} />
    </div>
  );
}
