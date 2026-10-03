import Link from "next/link";
import { requireSession } from "@/lib/session";
import { ProductionTabs } from "@/components/production-tabs";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { formatMoney, formatQty } from "@/lib/utils";
import { batchExtraName, batchTotals, loadBatchesWithOrders } from "@/lib/batch-stats";
import { getCommission4Mode } from "@/lib/commission4-mode";
import { c4Suffix } from "@/lib/commission4";
import { ResponsiveRows, RowCard } from "@/components/responsive-rows";
import { prisma } from "@/lib/prisma";
import { getYearFilter } from "@/lib/year-filter";
import { orderInYear } from "@/lib/year-scope";
import { YearNote, emptyForYear } from "@/components/year-note";
import { InfoHint } from "@/components/info-hint";
import { C4Hint, Mode4Badge } from "@/components/c4-note";
import { base4AndExtra } from "@/lib/commission4";

export const metadata = { title: "Партии" };

export default async function BatchesPage({ searchParams }: PageProps<"/production/batches">) {
  const sp = await searchParams;
  const showEmpty = (Array.isArray(sp.empty) ? sp.empty[0] : sp.empty) === "1";
  const session = await requireSession();
  const c4Mode = await getCommission4Mode();
  const year = await getYearFilter();
  const allBatches = await loadBatchesWithOrders(session.user.organizationId);
  // Общий год: ТЗ партии отбираются по дате ТЗ (дата ТЗ → конец → начало → год партии); партия без ТЗ за год не показывается.
  const batches =
    year === "all"
      ? allBatches
      : allBatches
          .map((b) => ({ ...b, orders: b.orders.filter((o) => orderInYear({ ...o, batch: { year: b.year } }, year)) }))
          .filter((b) => b.orders.length > 0 || b.year === Number(year));
  // «Документы» — как на карточке партии: документы самой партии + её ТЗ + оплат этих ТЗ (каждый документ один раз).
  const orgId = session.user.organizationId;
  const orderIds = batches.flatMap((b) => b.orders.map((o) => o.id));
  const payIds = [...new Set(batches.flatMap((b) => b.orders.flatMap((o) => o.paymentAllocations.map((a) => a.productionPayment.id))))];
  const docRows = await prisma.driveDocument.findMany({
    where: {
      organizationId: orgId,
      OR: [
        { productionBatchId: { in: batches.map((b) => b.id) } },
        ...(orderIds.length ? [{ productionOrderId: { in: orderIds } }] : []),
        ...(payIds.length ? [{ productionPaymentId: { in: payIds } }] : []),
      ],
    },
    select: { id: true, productionBatchId: true, productionOrderId: true, productionPaymentId: true },
  });
  const docsOf = (b: (typeof batches)[number]) => {
    const orders = new Set(b.orders.map((o) => o.id));
    const pays = new Set(b.orders.flatMap((o) => o.paymentAllocations.map((a) => a.productionPayment.id)));
    return docRows.filter(
      (d) =>
        d.productionBatchId === b.id ||
        (d.productionOrderId != null && orders.has(d.productionOrderId)) ||
        (d.productionPaymentId != null && pays.has(d.productionPaymentId)),
    ).length;
  };
  const allRows = batches.map((b) => ({ b, t: batchTotals(b.orders, c4Mode), docs: docsOf(b) }));
  // Пустые партии (ни одного ТЗ) скрыты по умолчанию; ?empty=1 показывает.
  const isEmptyBatch = (r: (typeof allRows)[number]) => r.b.orders.length === 0;
  const emptyCount = allRows.filter(isEmptyBatch).length;
  const rows = showEmpty ? allRows : allRows.filter((r) => !isEmptyBatch(r));
  const anyC4 = rows.some((r) => r.t.c4Applies);
  // Расшифровка 4% по всем показанным партиям: сырьё и подкладка × 4%.
  let c4Base = 0;
  let c4Extra = 0;
  let c4Excl = 0;
  let c4Lines = 0;
  for (const r of rows) {
    for (const o of r.b.orders) {
      if (o.status === "CANCELLED") continue;
      const on = base4AndExtra(o.materialUsages);
      c4Base += Number(on.base);
      c4Extra += Number(on.extra);
      c4Excl += Number(on.excluded);
      c4Lines += o.materialUsages.length;
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <ProductionTabs active="batches" />
      <div>
        <h1 className="text-xl font-semibold">
          Партии
          <YearNote year={year} />
          <InfoHint label="Что такое партия" wide>
            <p>Партия — группа ТЗ, отправленных одной поставкой. Откройте партию, чтобы увидеть ТЗ, оплаты и документы.</p>
            <p className="mt-1">
              Год: {year === "all" ? "все годы" : `${year}`} — партия попадает в год по датам её ТЗ (дата ТЗ, иначе окончание или начало, иначе год партии); в цифрах только ТЗ этого года.
            </p>
            <p className="mt-1">
              <b>Остаток</b> = работа заказчику (цена за ед. × количество) минус оплаты заказчика по ТЗ партии; каждая оплата учитывается один раз.
            </p>
            <p className="mt-1">
              <b>Себестоимость</b> = сырьё и подкладка + расходы ТЗ. «С 4%» добавляет 4% к сырью и подкладке (работа не облагается); оплаты и остаток от 4% не меняются.
            </p>
            <p className="mt-1">
              Группировка ТЗ по партиям — вид «По партиям» на странице <Link href="/production?view=batches" className="underline">ТЗ</Link>.
            </p>
          </InfoHint>
        </h1>
      </div>
      {emptyCount > 0 && (
        <p className="text-sm text-neutral-500">
          {showEmpty ? (
            <>
              Показаны и пустые партии (без ТЗ).{" "}
              <Link href="/production/batches" className="underline underline-offset-2 hover:text-neutral-800">
                Скрыть пустые ({emptyCount})
              </Link>
            </>
          ) : (
            <>
              Партии без ТЗ скрыты.{" "}
              <Link href="/production/batches?empty=1" className="underline underline-offset-2 hover:text-neutral-800">
                Показать пустые ({emptyCount})
              </Link>
            </>
          )}
        </p>
      )}
      <ResponsiveRows table={
      <Table>
        <Thead>
          <Tr>
            <Th>Партия</Th>
            <Th className="hidden sm:table-cell">Год</Th>
            <Th>ТЗ</Th>
            <Th>Изделий</Th>
            <Th className="hidden md:table-cell" title="4% — доп. комиссия посредника к сырью и подкладке (договор, расчёты «+4%»); работа не облагается">
              Себестоимость
              <Mode4Badge mode={c4Mode} />
              <C4Hint mode={c4Mode} base={c4Lines ? c4Base.toFixed(2) : null} extra={c4Lines ? c4Extra.toFixed(2) : null} excluded={c4Excl.toFixed(2)} title="4% по партиям списка" />
            </Th>
            <Th className="hidden md:table-cell">Работа</Th>
            <Th className="hidden lg:table-cell">Оплачено</Th>
            <Th>Остаток</Th>
            <Th className="hidden sm:table-cell" title="Файлы из Google Drive: самой партии, её ТЗ и оплат">Файлов в Drive</Th>
          </Tr>
        </Thead>
        <Tbody>
          {rows.map(({ b, t, docs }) => (
            <Tr key={b.id}>
              <Td className="font-medium">
                <Link href={`/production/batches/${b.number}`} className="hover:underline">
                  Партия {b.number}
                </Link>
                {batchExtraName(b.name) && <span className="block text-xs font-normal text-neutral-500">{batchExtraName(b.name)}</span>}
              </Td>
              <Td className="hidden sm:table-cell">{b.year ?? "—"}</Td>
              <Td>
                <Link href={`/production?batch=${b.number}`} className="hover:underline">
                  {t.orders}
                </Link>
              </Td>
              <Td>
                {formatQty(t.units.toString())}
                {b.plannedUnits != null && <span className="block text-xs text-neutral-400">план {b.plannedUnits}</span>}
              </Td>
              <Td className="hidden whitespace-nowrap md:table-cell">{t.cost.isZero() ? "—" : formatMoney(t.cost.toString())}
                {c4Mode === "on" && !t.c4Applies && !t.cost.isZero() && <span className="block text-xs text-neutral-400">без 4%</span>}
              </Td>
              <Td className="hidden whitespace-nowrap md:table-cell">{t.work.isZero() ? "—" : formatMoney(t.work.toString())}</Td>
              <Td className="hidden whitespace-nowrap lg:table-cell">{t.paid.isZero() ? "—" : formatMoney(t.paid.toString())}</Td>
              <Td className={"whitespace-nowrap " + (t.remaining.greaterThan(0.005) ? "text-amber-600" : "")}>
                {t.work.isZero() && t.paid.isZero()
                  ? "—"
                  : t.remaining.lessThan(-0.005)
                    ? `переплата ${formatMoney(t.remaining.abs().toString())}`
                    : formatMoney(t.remaining.toString())}
              </Td>
              <Td className="hidden sm:table-cell">{docs || "—"}</Td>
            </Tr>
          ))}
          {rows.length === 0 && (
            <Tr>
              <Td colSpan={9} className="py-8 text-center text-neutral-400">
                {emptyForYear(year, "партий", "Партий пока нет. Они появятся после привязки ТЗ к партиям из Google Drive.")}
              </Td>
            </Tr>
          )}
        </Tbody>
      </Table>
      }>
        {rows.map(({ b, t, docs }) => {
          const rem = t.work.isZero() && t.paid.isZero()
            ? "—"
            : t.remaining.lessThan(-0.005)
              ? `переплата ${formatMoney(t.remaining.abs().toString())}`
              : formatMoney(t.remaining.toString());
          return (
            <RowCard
              key={b.id}
              title={`Партия ${b.number}`}
              href={`/production/batches/${b.number}`}
              subtitle={batchExtraName(b.name)}
              fields={[
                { label: "Остаток", value: <span className={t.remaining.greaterThan(0.005) ? "text-amber-600" : ""}>{rem}</span>, strong: true },
                { label: "Оплачено", value: t.paid.isZero() ? "—" : formatMoney(t.paid.toString()) },
                { label: "ТЗ", value: <Link href={`/production?batch=${b.number}`} className="underline">{t.orders}</Link> },
                { label: "Изделий", value: `${formatQty(t.units.toString())}${b.plannedUnits != null ? ` (план ${b.plannedUnits})` : ""}` },
              ]}
              details={[
                { label: `Себестоимость${anyC4 ? c4Suffix(c4Mode) : ""}`, value: t.cost.isZero() ? "—" : formatMoney(t.cost.toString()) },
                { label: "Работа", value: t.work.isZero() ? "—" : formatMoney(t.work.toString()) },
                { label: "Год", value: b.year },
                { label: "Файлов в Drive", value: docs || "—" },
              ]}
            />
          );
        })}
        {rows.length === 0 && (
          <p className="py-8 text-center text-neutral-400">{emptyForYear(year, "партий", "Партий пока нет. Они появятся после привязки ТЗ к партиям из Google Drive.")}</p>
        )}
      </ResponsiveRows>

    </div>
  );
}
