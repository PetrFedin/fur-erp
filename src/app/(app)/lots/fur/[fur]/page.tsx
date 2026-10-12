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
import { Breadcrumbs } from "@/components/breadcrumbs";
import { YearNote } from "@/components/year-note";
import { InfoHint } from "@/components/info-hint";
import { loadOrderRows } from "@/lib/analytics-orders";
import { loadFurKinds } from "@/lib/fur-kinds-server";
import { furKindsOfOrder, NO_LOTS_FUR_TITLE } from "@/lib/order-fur";
import { TILE_BOX, TileHead, TileValue, TileCaption } from "../../../dashboard/tile";
import { formatMoney } from "@/lib/utils";
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
  if (own.length === 0) {
    // Вид меха без лотов (сырьё подрядчика, «Бобр»): короткая страница без цен — изделия из него по данным ТЗ.
    const kinds = await loadFurKinds(orgId);
    if (!kinds.noLots.includes(name)) notFound();
    const ords = kinds.orders.filter((o) => furKindsOfOrder(o.fur).includes(name)).sort((a, b) => a.number.localeCompare(b.number, "ru", { numeric: true }));
    const units = ords.reduce((a, o) => a + o.qty, 0);
    const note = `${name} — сырьё подрядчика: закупки и лотов у нас нет (не наша закупка и не наш долг), в системе мех не списывается. Изделия — по данным ТЗ.`;
    return (
      <div className="flex flex-col gap-4">
        <Breadcrumbs items={[{ label: "Сырьё", href: "/lots" }, { label: "Мех", href: "/lots" }, { label: name }]} />
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/lots" aria-label="Назад в «Сырьё — Мех»" title="Назад в «Сырьё — Мех»" className="inline-flex size-8 items-center justify-center rounded-lg border border-neutral-300 text-neutral-700 hover:bg-neutral-50">←</Link>
          <h1 className="text-xl font-semibold">{name} · сырьё подрядчика</h1>
          <InfoHint label="О сырье подрядчика" wide><p>{note}</p><p className="mt-1">{NO_LOTS_FUR_TITLE}.</p></InfoHint>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {["Куплено", "Использовано", "Остаток"].map((t) => (
            <div key={t} className={TILE_BOX}><TileHead>{t}</TileHead><TileValue compact>—</TileValue><TileCaption>закупок и лотов нет</TileCaption></div>
          ))}
          <div className={TILE_BOX}><TileHead>Изделий в ТЗ, шт.</TileHead><TileValue compact>{units}</TileValue><TileCaption>{ords.length} ТЗ</TileCaption></div>
        </div>
        <section aria-labelledby="beaver-orders" className="space-y-2">
          <div className="flex items-center gap-2"><h2 id="beaver-orders" className="text-base font-semibold">Изделия из меха «{name}»</h2>
            <InfoHint label="Откуда данные" wide><p>Данные ТЗ (артикул, партия, количество изделий, работа). Это не списания сырья: расход по документам в системе не записан, суммы в «Сырьё» и на Главной не входят.</p></InfoHint></div>
          <div className="scroll-hint overflow-x-auto rounded-xl border border-neutral-200 bg-white">
            <table className="w-full table-fixed text-sm tabular-nums" style={{ minWidth: 640 }}>
              <thead><tr className="border-b border-neutral-200 text-xs text-neutral-500"><th className="px-2 py-1.5 text-left font-medium">ТЗ</th><th className="px-2 py-1.5 text-left font-medium">Артикул</th><th className="px-2 py-1.5 text-left font-medium">Партия</th><th className="px-2 py-1.5 text-right font-medium">Изделий, шт.</th><th className="px-2 py-1.5 text-right font-medium">Работа, ₽</th><th className="px-2 py-1.5 text-right font-medium">Работа за ед., ₽</th></tr></thead>
              <tbody>
                {ords.map((o) => (
                  <tr key={o.id} className="border-t border-neutral-100">
                    <td className="px-2 py-1.5"><Link href={`/production/${o.id}`} className="text-blue-700 hover:underline">ТЗ {o.number}</Link></td>
                    <td className="truncate px-2 py-1.5 text-xs" title={o.modelHint}>{o.modelLabel || o.modelName}</td>
                    <td className="truncate px-2 py-1.5 text-xs">{o.batchText ?? "—"}</td>
                    <td className="px-2 py-1.5 text-right">{o.qty}</td>
                    <td className="px-2 py-1.5 text-right">{o.work > 0 ? formatMoney(o.work) : "—"}</td>
                    <td className="px-2 py-1.5 text-right">{o.work > 0 && o.qty > 0 ? formatMoney(Math.round(o.work / o.qty)) : "—"}</td>
                  </tr>
                ))}
                {ords.length === 0 ? <tr><td colSpan={6} className="px-3 py-5 text-center text-neutral-500">ТЗ нет.</td></tr> : (
                  <tr className="row-total"><td className="px-2 py-2 text-left" colSpan={3}>Всего, шт.</td><td className="px-2 py-2 text-right">{units}</td><td className="px-2 py-2 text-right">{formatMoney(ords.reduce((a, o) => a + o.work, 0))}</td><td className="px-2 py-2" /></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    );
  }
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
      <Breadcrumbs items={[{ label: "Сырьё", href: "/lots" }, { label: "Мех", href: "/lots" }, { label: name }]} />
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
      </div>
      <FurSelectionTotal lots={own} kind="fur" globalYear={year} initialQuery={sp} lockItem={name} orderInfo={orderInfo} raw={{ tiles, c4, fur: pair, lining: dash.raw.lining, headerEnd, rows: rawRowsFromLots(own) }} />
    </div>
  );
}
