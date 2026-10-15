import { readSort, sortRows, thSort } from "@/lib/table-sort";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { itemsSuffix, tzCountText } from "@/lib/tz-key";
import { TotalLabel } from "@/components/total-label";
import { Dash } from "@/components/tree-table";
import { InfoHint } from "@/components/info-hint";
import Link from "next/link";
import { IntegrityBanner } from "@/components/integrity-banner";
import { ArticleName } from "@/components/article-name";
import { notFound, redirect } from "next/navigation";
import { Decimal } from "@prisma/client/runtime/library";
import { prisma } from "@/lib/prisma";
import { orderLabel, orderHint } from "@/lib/order-label";
import { loadTzPositions } from "@/lib/order-label-db";
import { requireSession } from "@/lib/session";
import { RecordHistory } from "@/components/record-history";
import { RecordComments } from "@/components/comments/record-comments";
import { canEditProduction } from "@/lib/production-access";
import { ProductionTabs } from "@/components/production-tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { ResponsiveRows, RowCard } from "@/components/responsive-rows";
import { DriveDocuments } from "@/components/drive-documents";
import { SourceDocs } from "@/components/source-docs";
import { loadBatchSourceDocs } from "@/lib/source-docs-server";
import { docCounts } from "@/lib/doc-links";
import { toDriveView } from "@/lib/drive-docs-server";
import { batchExtraName, batchOrderInclude, batchTotals, orderStat } from "@/lib/batch-stats";
import { formatDate, formatMoney, formatQty } from "@/lib/utils";
import { TzVatBadge } from "@/components/tz-vat-badge";
import { vatBreakdown } from "@/lib/tz-vat";
import { getCommission4Mode } from "@/lib/commission4-mode";
import { c4Suffix } from "@/lib/commission4";
import { BatchDocsPay } from "../../docs-pay";
import { VerifyBlock } from "../../../verify/verify-block";
import { BatchEditButton } from "../../[id]/edit-buttons";
import { DeleteEntityButton } from "@/components/delete-entity-button";
import { deleteProductionBatch } from "../../actions";
import { batchDeleteBlocker } from "@/lib/batch-delete";
import { rowVersion, BATCH_V } from "@/lib/concurrency";
import { CollapsibleBlock } from "@/components/collapsible-block";
import { OrdersTree } from "@/components/orders-tree";
import { ProdTiles } from "@/components/prod-tiles";
import { TILE_BOX, TileCaption, TileHead, TileList, TileValue } from "../../../dashboard/tile";
import { loadOrdersDrill } from "@/lib/orders-drill";
import { cleanNote } from "@/lib/note-tags";

const PAY_TYPE: Record<string, string> = { ADVANCE: "Аванс", PARTIAL: "Доплата", FINAL: "Окончательная" };

export async function generateMetadata({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  return { title: `Партия ${number}` };
}

export default async function BatchPage({ params, searchParams }: { params: Promise<{ number: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { number: numRaw } = await params;
  const session = await requireSession();
  const c4Mode = await getCommission4Mode();
  const orgId = session.user.organizationId;
  const number = /^\d{1,6}$/.test(numRaw) ? parseInt(numRaw, 10) : NaN;
  if (!Number.isInteger(number) || number < 1) notFound();
  // Каноничный адрес без ведущих нулей: /batches/007 → /batches/7.
  if (numRaw !== String(number)) redirect(`/production/batches/${number}`);

  const batch = await prisma.productionBatch.findUnique({
    where: { organizationId_number: { organizationId: orgId, number } },
    include: { orders: { include: batchOrderInclude, orderBy: { createdAt: "asc" } } },
  });
  if (!batch) notFound();

  const t = batchTotals(batch.orders, c4Mode);
  // Ставки НДС лотов по действующим ТЗ партии (20% / 22% / смешанные).
  const batchVat = vatBreakdown(batch.orders.filter((o) => o.status !== "CANCELLED").flatMap((o) => o.materialUsages), c4Mode);
  const orders = [...batch.orders].sort((a, b) => {
    const x = parseInt(a.workOrderNumber ?? "", 10);
    const y = parseInt(b.workOrderNumber ?? "", 10);
    return (Number.isNaN(x) ? 1e9 : x) - (Number.isNaN(y) ? 1e9 : y);
  });

  const tzPos = await loadTzPositions(orgId, orders);
  const labelOf = (o: (typeof orders)[number]) => orderLabel({ workOrderNumber: o.workOrderNumber, number: o.number, ...tzPos.get(o.id) });

  // Оплаты партии: каждая — один раз, со списком ТЗ партии, которые она покрывает.
  const payMap = new Map<string, { p: (typeof orders)[number]["paymentAllocations"][number]["productionPayment"]; tz: string[] }>();
  for (const o of orders) {
    for (const a of o.paymentAllocations) {
      const e = payMap.get(a.productionPayment.id) ?? { p: a.productionPayment, tz: [] };
      const tzNo = o.workOrderNumber?.trim() || `Заказ ${o.number}`;
      if (!e.tz.includes(tzNo)) e.tz.push(tzNo);
      payMap.set(a.productionPayment.id, e);
    }
  }
  const payments = Array.from(payMap.values()).sort((a, b) => a.p.paidAt.getTime() - b.p.paidAt.getTime());
  // Разнесение по ТЗ партии: сколько из каждого платежа отнесено на ТЗ ЭТОЙ партии, и оплачено по каждому ТЗ.
  const shareByPay = new Map<string, Decimal>();
  const paidByOrder = new Map<string, Decimal>();
  for (const o of orders) {
    for (const sh of o.payShares) {
      if (sh.productionPayment.status === "CANCELLED") continue;
      shareByPay.set(sh.productionPaymentId, (shareByPay.get(sh.productionPaymentId) ?? new Decimal(0)).add(sh.amount));
      paidByOrder.set(o.id, (paidByOrder.get(o.id) ?? new Decimal(0)).add(sh.amount));
    }
  }

  // Сортировка ТЗ партии по клику на заголовок (?sort=…&dir=…); по умолчанию — по № ТЗ.
  const oSort = readSort(sp, ["tz", "article", "qty", "cost", "work", "paid", "left"]);
  const statOf = new Map(orders.map((o) => [o.id, orderStat(o, c4Mode)]));
  const sortedOrders = sortRows(orders, oSort, {
    tz: (o) => labelOf(o), article: (o) => o.productModel?.name ?? null, qty: (o) => statOf.get(o.id)!.qty.toNumber(), cost: (o) => statOf.get(o.id)!.cost.toNumber(),
    work: (o) => statOf.get(o.id)!.work.toNumber(), paid: (o) => (paidByOrder.get(o.id) ?? new Decimal(0)).toNumber(), left: (o) => statOf.get(o.id)!.work.sub(paidByOrder.get(o.id) ?? 0).toNumber(),
  });
  const oth = (k: string) => thSort(`/production/batches/${batch.number}`, sp, k, oSort);

  // Переплата: оплата больше работы партии.
  const overpaid = t.remaining.lessThan(-1);

  const orderIds = orders.map((o) => o.id);
  const driveRows = await prisma.driveDocument.findMany({
    where: {
      organizationId: orgId,
      OR: [
        { productionBatchId: batch.id },
        ...(orderIds.length ? [{ productionOrderId: { in: orderIds } }] : []),
        ...(payments.length ? [{ productionPaymentId: { in: payments.map((x) => x.p.id) } }] : []),
      ],
    },
    include: { productionOrder: { select: { number: true, workOrderNumber: true } } },
    orderBy: [{ docDate: "asc" }, { createdAt: "asc" }],
  });
  const driveDocs = driveRows.map((d) =>
    toDriveView(
      d,
      d.productionOrder
        ? orderLabel(d.productionOrder)
        : d.productionPaymentId
          ? "оплата"
          : null,
      session.user.role,
    ),
  );

  // Плитки и состав — те же данные, что на Главной (по всем годам): ТЗ партии со списаниями.
  const drill = await loadOrdersDrill(orgId, "all", c4Mode, { ids: new Set(batch.orders.map((o) => o.id)) });
  const payBy: Record<string, number> = { [`batch:${batch.number}`]: Number(t.paid) };
  for (const [id, v] of paidByOrder) payBy[`order:${id}`] = Number(v);
  const mny = (v: number) => formatMoney(v.toFixed(2));
  const workN = Number(t.work);
  const paidN = Number(t.paid);

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: "ТЗ", href: "/production" }, { label: "Партии пошива", href: "/production/batches" }, { label: `Партия ${batch.number}` }]} />
      <ProductionTabs active="batches" />
      <IntegrityBanner kind="batch" id={batch.id} />
      <div>
        <p className="flex items-center gap-3 text-sm">
          <Link href="/production/batches" className="text-neutral-500 hover:underline">
            ← Партии пошива
          </Link>
          <Link href={`/production/batches/${batch.number}/print`} className="ml-auto rounded border border-neutral-300 px-2 py-1 text-neutral-700 hover:bg-neutral-50">
            Печать сводки партии
          </Link>
        </p>
        <h1 className="text-xl font-semibold">
          Партия пошива {batch.number}
          {batchExtraName(batch.name) ? <span className="ml-2 text-base font-normal text-neutral-500">{batchExtraName(batch.name)}</span> : null}
        </h1>
        <p className="text-sm text-neutral-500">
          {[batch.year ? `${batch.year} г.` : null, batch.plannedUnits != null ? `план ${batch.plannedUnits} изд.` : null]
            .filter(Boolean)
            .join(" · ") || "—"}
        </p>
        {cleanNote(batch.notes) && <p className="mt-1 text-sm text-neutral-600 whitespace-pre-line">{cleanNote(batch.notes)}</p>}
        {canEditProduction(session.user.role) && (
          <div className="mt-2 flex flex-wrap items-start gap-2">
            <Link href={`/production/new?batch=${batch.number}`} className="inline-flex h-8 items-center rounded-md bg-neutral-900 px-3 text-sm font-medium text-white hover:bg-neutral-800">
              Создать ТЗ в этой партии
            </Link>
            <BatchEditButton
              batchId={batch.id}
              version={rowVersion(batch, BATCH_V)}
              defaults={{ number: String(batch.number), name: batch.name ?? "", year: batch.year != null ? String(batch.year) : "", plannedUnits: batch.plannedUnits != null ? String(batch.plannedUnits) : "", notes: batch.notes ?? "" }}
            />
            <DeleteEntityButton
              confirmText={`Удалить пустую партию ${batch.number}? Это нельзя отменить.`}
              blockedReason={await batchDeleteBlocker(session.user.organizationId, batch.id)}
              action={deleteProductionBatch.bind(null, batch.id)}
              redirectTo="/production/batches"
            />
          </div>
        )}
      </div>

      <ProdTiles
        orders={drill}
        c4={c4Mode}
        treeId="batch-tree-block"
        hideProduced
        hidePerUnit
        id="batch"
        title="Партия — итоги"
        headerEnd={<Link href="/production/batches" className="text-xs text-blue-700 hover:underline print:hidden">→ Партии пошива</Link>}
        extra={
          <div className="relative">
            <div className={TILE_BOX + " shadow-sm print:shadow-none"}>
              <TileHead>Работа подрядчику</TileHead>
              <TileValue className={t.remaining.greaterThan(1) ? "text-amber-700" : ""}>{t.remaining.abs().lessThan(1) ? "—" : mny(Math.abs(Number(t.remaining)))}</TileValue>
              <TileCaption>{overpaid ? "оплачено сверх работы" : "К оплате по партиям: работа − оплачено"}</TileCaption>
              <TileList items={[
                { k: "Работа подрядчику", v: mny(workN) },
                { k: "Оплачено (разнесено на партии)", v: mny(paidN), share: workN ? paidN / workN : null },
              ]} />
            </div>
            <div className="absolute right-3 top-3">
              <InfoHint label="Как считается оплата" wide align="right">
                <p><b>Оплачено (разнесено на партии)</b> — оплаты за работу, разнесённые на ТЗ партии (каждая один раз). <b>К оплате по партиям</b> = работа − оплачено. Суммы оплаты всегда с НДС.</p>
                <p className="mt-1">«Оплачено всего» на Главной и в «Оплатах» больше: разница = неразнесённый аванс (аванс подрядчику, ещё не отнесён к партиям). Мост — в «Партии пошива» → плитка «Работа подрядчику».</p>
              </InfoHint>
            </div>
          </div>
        }
      />
      {(batchVat.kind !== "none" || t.unallocated.greaterThan(0.005) || overpaid) && (
        <p className="flex flex-wrap items-center gap-2 text-sm text-neutral-600">
          {batchVat.kind !== "none" && <TzVatBadge b={batchVat} />}
          {t.unallocated.greaterThan(0.005) && (
            <span>
              Не отнесено к ТЗ: <span className="font-medium">{formatMoney(t.unallocated.toString())}</span>
              <InfoHint label="Про неотнесённую сумму" wide>
                Платёж больше остатка работы ТЗ партии. В остаток по ТЗ это не входит; список — <Link href="/attention" className="underline">Контроль → Что требует внимания → Неразнесённые авансы</Link>.
              </InfoHint>
            </span>
          )}
          {overpaid && (
            <span>
              Переплата {formatMoney(t.remaining.abs().toString())}
              <InfoHint label="Про переплату">Оплаты больше работы партии.</InfoHint>
            </span>
          )}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            ТЗ партии ({t.orders}{itemsSuffix(t.orders, t.items)}
            {batch.orders.length > t.items ? ` + ${batch.orders.length - t.items} отменено` : ""})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveRows
            table={
          <Table>
            <Thead>
              <Tr>
                <Th {...oth("tz")}>№ ТЗ</Th>
                <Th {...oth("article")}>Изделие</Th>
                <Th {...oth("qty")} unit="шт.">Кол-во</Th>
                <Th {...oth("cost")} className="hidden sm:table-cell" after={<>
                  <InfoHint label="Чем отличается от полной себестоимости">Мех + подкладка + расходы ТЗ (и 4 % в режиме «С 4%») — без работы подрядчика. В дереве ниже «Полная себестоимость (с работой)» = эта сумма + работа.</InfoHint>
                  <InfoHint label="Что значит 4%" wide>4% — наценка при купле-продаже меха и подкладки подрядчику (не комиссия Веллмеха; его вознаграждение 4,5% за сопровождение закупки сырья — отдельно, в расходах закупки): в ТЗ мы платим на 4% больше за мех и подкладку в ТЗ; работа, расходы, фурнитура и прочее не облагаются. Столбец «НДС» — ставки НДС лотов в списаниях ТЗ. «Оплачено» — разнесено на это ТЗ из оплат за работу; «Остаток» — работа минус оплачено.</InfoHint>
                </>}>
                  Себестоимость сырья, ₽{t.c4Applies ? c4Suffix(c4Mode) : ""}
                </Th>
                <Th {...oth("work")} className="hidden md:table-cell" unit="₽">Работа</Th>
                <Th {...oth("paid")} className="hidden md:table-cell" unit="₽">Оплачено</Th>
                <Th {...oth("left")} className="hidden md:table-cell" unit="₽">Остаток</Th>
                <Th className="hidden md:table-cell">НДС</Th>
              </Tr>
            </Thead>
            <Tbody>
              {sortedOrders.map((o) => {
                const s = orderStat(o, c4Mode);
                return (
                  <Tr key={o.id}>
                    <Td className="font-medium">
                      <Link href={`/production/${o.id}`} className="hover:underline" title={orderHint(o)}>
                        {labelOf(o)}
                      </Link>
                    </Td>
                    <Td>
                      <ArticleName model={o.productModel} />
                      {o.client && <span className="block text-xs text-neutral-500">{o.client.name}</span>}
                    </Td>
                    <Td>{formatQty(s.qty.toString())}</Td>
                    <Td className="hidden whitespace-nowrap sm:table-cell">{s.cost.isZero() ? "—" : formatMoney(s.cost.toString())}</Td>
                    <Td className="hidden whitespace-nowrap md:table-cell">{s.work.isZero() ? "—" : formatMoney(s.work.toString())}</Td>
                    <Td className="hidden whitespace-nowrap md:table-cell">{paidByOrder.has(o.id) ? formatMoney(paidByOrder.get(o.id)!.toString()) : "—"}</Td>
                    <Td className="hidden whitespace-nowrap md:table-cell">
                      {s.work.isZero() || o.status === "CANCELLED" ? "—" : (() => { const left = s.work.sub(paidByOrder.get(o.id) ?? 0); return <span className={left.greaterThan(0.005) ? "text-amber-700" : left.lessThan(-0.005) ? "text-red-600" : ""}>{formatMoney(left.toString())}</span>; })()}
                    </Td>
                    <Td className="hidden whitespace-nowrap md:table-cell">
                      <TzVatBadge b={vatBreakdown(o.materialUsages, c4Mode)} compact />
                    </Td>
                  </Tr>
                );
              })}
              {orders.length > 0 && (
                <Tr className="row-total">
                  <Td><TotalLabel unit="₽" /></Td>
                  <Td className="text-xs">{tzCountText(t.orders, t.items)}</Td>
                  <Td>{t.producedUnits.isZero() ? <Dash /> : formatQty(t.producedUnits.toString())}</Td>
                  <Td className="hidden whitespace-nowrap sm:table-cell">{t.cost.isZero() ? <Dash /> : formatMoney(t.cost.toString())}</Td>
                  <Td className="hidden whitespace-nowrap md:table-cell">{t.work.isZero() ? <Dash /> : formatMoney(t.work.toString())}</Td>
                  <Td className="hidden whitespace-nowrap md:table-cell">{t.paid.isZero() ? <Dash /> : formatMoney(t.paid.toString())}</Td>
                  <Td className="hidden whitespace-nowrap md:table-cell">{t.work.isZero() && t.paid.isZero() ? <Dash /> : t.remaining.abs().lessThan(1) ? "оплачено" : formatMoney(t.remaining.toString())}</Td>
                  <Td className="hidden md:table-cell" />
                </Tr>
              )}
              {orders.length === 0 && (
                <Tr>
                  <Td colSpan={8} className="py-6 text-center text-neutral-500">
                    К партии пока не привязано ни одного ТЗ. Привязать: откройте ТЗ → «Изменить» → поле «Партия» (ТЗ без партии видны в виде <Link href="/production/batches" className="underline underline-offset-2">«По партиям»</Link>, группа «Без партии»)
                  </Td>
                </Tr>
              )}
            </Tbody>
          </Table>
            }
          >
            {sortedOrders.map((o) => {
              const s = orderStat(o, c4Mode);
              const left = s.work.isZero() || o.status === "CANCELLED" ? null : s.work.sub(paidByOrder.get(o.id) ?? 0);
              return (
                <RowCard
                  key={o.id}
                  title={labelOf(o)}
                  href={`/production/${o.id}`}
                  subtitle={<><ArticleName model={o.productModel} />{o.client ? ` · ${o.client.name}` : ""}</>}
                  fields={[
                    { label: "Кол-во, шт.", value: formatQty(s.qty.toString()) },
                    { label: "Себестоимость сырья, ₽", value: s.cost.isZero() ? "—" : formatMoney(s.cost.toString()) },
                    { label: "Работа, ₽", value: s.work.isZero() ? "—" : formatMoney(s.work.toString()) },
                    { label: "Остаток, ₽", value: left == null ? "—" : <span className={left.greaterThan(0.005) ? "text-amber-700" : left.lessThan(-0.005) ? "text-red-600" : ""}>{formatMoney(left.toString())}</span> },
                  ]}
                  details={[
                    { label: "Оплачено, ₽", value: paidByOrder.has(o.id) ? formatMoney(paidByOrder.get(o.id)!.toString()) : "—" },
                    { label: "НДС", value: <TzVatBadge b={vatBreakdown(o.materialUsages, c4Mode)} compact /> },
                  ]}
                />
              );
            })}
            {orders.length > 0 && (
              <div className="row-total flex flex-wrap justify-between gap-x-3 gap-y-1 rounded-lg border border-neutral-200 px-3 py-2 text-sm">
                <span><TotalLabel unit="₽" /> · {tzCountText(t.orders, t.items)}</span>
                <span className="tabular-nums">{t.work.isZero() ? "—" : formatMoney(t.work.toString())}</span>
              </div>
            )}
            {orders.length === 0 && <p className="py-4 text-center text-sm text-neutral-500">К партии пока не привязано ни одного ТЗ.</p>}
          </ResponsiveRows>
        </CardContent>
      </Card>

      <CollapsibleBlock id="batch-tree-block" title="Состав партии: ТЗ и списания" summary={`${t.orders} ТЗ · раскрыть`} autoOpen={false}>
      <OrdersTree
        orders={drill}
        c4={c4Mode}
        id="batch-tree"
        title="Состав"
        payBy={payBy}
        defaultOpenDepth={0}
        modes={[{ id: "order", label: "ТЗ", dims: ["order"] }]}
        hint={<p>Каждое ТЗ партии раскрывается до строк списания по лотам (со ссылкой на лот и закупку), шкур подрядчика, расходов и работы. Итог равен плиткам выше.</p>}
      />
      </CollapsibleBlock>

      {/* Подтверждение — по клику (свёрнуто) */}
      <VerifyBlock kind="batch" id={batch.id} title="Подтверждение партии" collapsed />

      {/* Список оплат с покрываемыми ТЗ — справка; статус, платёжки и отметка оплаты — в блоке «Документы и оплата» ниже. */}
      <details className="rounded-lg border border-neutral-200 bg-white">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium">Какие ТЗ покрывает каждая оплата ({payments.length})</summary>
      <Card className="border-0 shadow-none">
        <CardContent>
          <ResponsiveRows
            table={
          <Table>
            <Thead>
              <Tr>
                <Th>Дата</Th>
                <Th>Тип</Th>
                <Th unit="₽">Сумма</Th>
                <Th className="hidden sm:table-cell" title="Часть платежа, отнесённая на ТЗ этой партии">На ТЗ партии</Th>
                <Th className="hidden sm:table-cell">Документ</Th>
                <Th className="hidden sm:table-cell">ТЗ</Th>
              </Tr>
            </Thead>
            <Tbody>
              {payments.map(({ p, tz }) => (
                <Tr key={p.id}>
                  <Td className="whitespace-nowrap">{formatDate(p.paidAt)}</Td>
                  <Td>
                    {PAY_TYPE[p.paymentType] ?? p.paymentType}
                    {p.status === "PENDING" && <span className="ml-1 text-xs text-neutral-500">план</span>}
                    {!p.confirmed && <span className="ml-1 text-xs text-amber-700">не подтверждена</span>}
                  </Td>
                  <Td className="whitespace-nowrap font-medium">{formatMoney(p.amount.toString())}</Td>
                  <Td className="hidden whitespace-nowrap sm:table-cell">{shareByPay.has(p.id) ? formatMoney(shareByPay.get(p.id)!.toString()) : "—"}</Td>
                  <Td className="hidden sm:table-cell">{p.docRef ?? "—"}</Td>
                  <Td className="hidden sm:table-cell">{tz.join(", ")}</Td>
                </Tr>
              ))}
              {payments.length === 0 && (
                <Tr>
                  <Td colSpan={7} className="py-6 text-center text-neutral-500">
                    Оплат по ТЗ партии пока нет
                  </Td>
                </Tr>
              )}
            </Tbody>
          </Table>
            }
          >
            {payments.map(({ p, tz }) => (
              <RowCard
                key={p.id}
                title={`${formatDate(p.paidAt)} · ${PAY_TYPE[p.paymentType] ?? p.paymentType}`}
                subtitle={<>{p.status === "PENDING" && "план"}{!p.confirmed && <span className="text-amber-700">{p.status === "PENDING" ? " · " : ""}не подтверждена</span>}</>}
                fields={[
                  { label: "Сумма, ₽", value: formatMoney(p.amount.toString()), strong: true },
                  { label: "На ТЗ партии, ₽", value: shareByPay.has(p.id) ? formatMoney(shareByPay.get(p.id)!.toString()) : "—" },
                  { label: "Документ", value: p.docRef ?? "—" },
                  { label: "ТЗ", value: tz.join(", ") || "—" },
                ]}
              />
            ))}
            {payments.length === 0 && <p className="py-4 text-center text-sm text-neutral-500">Оплат по ТЗ партии пока нет</p>}
          </ResponsiveRows>
        </CardContent>
      </Card>
      </details>

      <BatchDocsPay batchNumber={batch.number} />

      <SourceDocs
        data={await loadBatchSourceDocs({ organizationId: orgId, role: session.user.role }, batch.id)}
        footer={
          driveDocs.length > 0 ? (
            <details className="rounded-md border border-neutral-200 px-3 py-2">
              <summary className="cursor-pointer text-xs font-medium text-neutral-600">Все привязанные записи документов партии, её ТЗ и оплат ({driveDocs.length})</summary>
              <div className="mt-2">
                <DriveDocuments docs={driveDocs} entity="batch" entityId={batch.id} canEdit={canEditProduction(session.user.role)} title="Записи документов" />
              </div>
            </details>
          ) : null
        }
      />
      <RecordHistory model="ProductionBatch" recordId={batch.id} />
      <RecordComments entityType="ProductionBatch" entityId={batch.id} />
    </div>
  );
}
