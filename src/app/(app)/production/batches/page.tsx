import { positionsWord, itemsSuffix } from "@/lib/tz-key";
import Link from "next/link";
import { requireSession } from "@/lib/session";
import { ProductionTabs } from "@/components/production-tabs";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { formatMoney, formatPercent, formatQty } from "@/lib/utils";
import { TzVatBadge } from "@/components/tz-vat-badge";
import { vatBreakdown } from "@/lib/tz-vat";
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
import { loadBatchPanels } from "@/lib/production-doc-checklist";
import { DocsPayBadge } from "@/components/docs-pay-badge";
import { VerifyPill } from "@/components/verify-control";
import { loadVerifyFlags } from "@/lib/verification";
import { payShort } from "@/lib/doc-panel";
import { docCounts } from "@/lib/doc-links";
import { OrdersTree } from "@/components/orders-tree";
import { ProdTiles } from "@/components/prod-tiles";
import { TILE_BOX, TileCaption, TileHead, TileList, TileValue } from "../../dashboard/tile";
import { loadOrdersDrill } from "@/lib/orders-drill";

export const metadata = { title: "Партии пошива" };

export default async function BatchesPage({ searchParams }: PageProps<"/production/batches">) {
  const sp = await searchParams;
  const showEmpty = (Array.isArray(sp.empty) ? sp.empty[0] : sp.empty) === "1";
  const session = await requireSession();
  const c4Mode = await getCommission4Mode();
  const year = await getYearFilter();
  const modelSel = (Array.isArray(sp.model) ? sp.model : sp.model ? [sp.model] : []).filter((v) => /^[\w-]{1,40}$/.test(v));
  const modelInfo = modelSel.length === 1 ? await prisma.productModel.findFirst({ where: { id: modelSel[0], organizationId: session.user.organizationId }, select: { name: true } }) : null;
  const allBatchesRaw = await loadBatchesWithOrders(session.user.organizationId);
  // ?model=… — партии, в которых есть ТЗ выбранного артикула (из карточки артикула); суммы партий считаются по всем ТЗ партии.
  const allBatches = modelSel.length ? allBatchesRaw.filter((b) => b.orders.some((o) => o.status !== "CANCELLED" && modelSel.includes(o.productModelId))) : allBatchesRaw;
  // Общий год: ТЗ партии отбираются по дате ТЗ (дата ТЗ → конец → начало → год партии); партия без ТЗ за год не показывается.
  const batches =
    year === "all"
      ? allBatches
      : allBatches
          .map((b) => ({ ...b, orders: b.orders.filter((o) => orderInYear({ ...o, batch: { year: b.year } }, year)) }))
          .filter((b) => b.orders.length > 0 || b.year === Number(year));
  // «Документы» — как на карточке партии: документы самой партии + её ТЗ + оплат этих ТЗ (каждый файл один раз).
  const orgId = session.user.organizationId;
  const batchDocCnt = await docCounts(orgId, "batch", batches.map((b) => b.id));
  const docsOf = (b: (typeof batches)[number]) => batchDocCnt.get(b.id)?.total ?? 0;
  const allRows = batches.map((b) => ({ b, t: batchTotals(b.orders, c4Mode), docs: docsOf(b) }));
  // Пустые партии (ни одного ТЗ) скрыты по умолчанию; ?empty=1 показывает.
  const isEmptyBatch = (r: (typeof allRows)[number]) => r.b.orders.length === 0;
  const emptyCount = allRows.filter(isEmptyBatch).length;
  // Индикатор «документы и оплата» и фильтр «только без документов / без оплаты».
  const need = (Array.isArray(sp.need) ? sp.need[0] : sp.need) === "docs" ? "docs" : (Array.isArray(sp.need) ? sp.need[0] : sp.need) === "pay" ? "pay" : "";
  const panelByNumber = new Map((await loadBatchPanels(prisma, orgId, { c4Mode, canUpload: false, canMark: false })).map((p) => [p.number, p]));
  const vflags = await loadVerifyFlags(prisma, orgId);
  const needsOf = (n: number) => {
    const d = panelByNumber.get(n);
    if (!d) return null;
    return { docs: d.panel.missingCount > 0 || d.unmatched, pay: d.panel.pay.state === "UNPAID" || d.panel.pay.state === "PARTIAL" || d.panel.proofMissing > 0 };
  };
  const rows = (showEmpty ? allRows : allRows.filter((r) => !isEmptyBatch(r))).filter((r) => {
    if (!need) return true;
    const n = needsOf(r.b.number);
    return n ? n[need] : false;
  });
  const needHref = (v: string) => {
    const qs = new URLSearchParams();
    if (showEmpty) qs.set("empty", "1");
    if (v) qs.set("need", v);
    return `/production/batches${qs.size ? `?${qs}` : ""}`;
  };
  // Дерево и плитки — из тех же ТЗ, что на Главной; оплаты — по партиям/ТЗ из разнесения оплат (как в таблице).
  const shownNums = new Set(rows.map((r) => r.b.number));
  const drillAll = await loadOrdersDrill(orgId, year, c4Mode);
  // Без фильтра по документам/оплате — все ТЗ (как на Главной, включая ТЗ без партии); с фильтром — только показанные партии.
  const drill = need ? drillAll.filter((o) => o.bk !== "none" && shownNums.has(Number(o.bk))) : drillAll;
  const payBy: Record<string, number> = {};
  let payPaid = 0, payWork = 0, payOver = 0;
  for (const r of rows) {
    payBy[`batch:${r.b.number}`] = Number(r.t.paid);
    payPaid += Number(r.t.paid); payWork += Number(r.t.work);
    if (r.t.remaining.lessThan(-0.005)) payOver += -Number(r.t.remaining);
    for (const o of r.b.orders) payBy[`order:${o.id}`] = o.payShares.reduce((a, x) => (x.productionPayment.status === "CANCELLED" ? a : a + Number(x.amount)), 0);
  }
  const payRest = payWork - payPaid;
  const money = (v: number) => formatMoney(v.toFixed(2));
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
      {modelSel.length > 0 && (
        <p className="rounded-md bg-neutral-100 px-3 py-2 text-sm text-neutral-700">
          Партии с ТЗ артикула {modelInfo ? <b>{modelInfo.name}</b> : "(выбранного)"} — суммы по партиям целиком.{" "}
          {modelSel.length === 1 && <Link href={`/models/${modelSel[0]}`} className="text-blue-700 hover:underline">К артикулу →</Link>}{" "}
          <Link href="/production/batches" className="text-blue-700 hover:underline">Показать все партии</Link>
        </p>
      )}
      <div>
        <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold">Партии пошива</h1><YearNote year={year} />
          <InfoHint label="Что такое партия пошива" wide>
            <p>Партия пошива — группа ТЗ, отправленных одной поставкой. Не путать с партией закупки (аукцион, поставка меха). Откройте партию, чтобы увидеть ТЗ, оплаты и документы.</p>
            <p className="mt-1">
              Год: {year === "all" ? "все годы" : `${year}`} — партия попадает в год по датам её ТЗ (дата ТЗ, иначе окончание или начало, иначе год партии); в цифрах только ТЗ этого года.
            </p>
            <p className="mt-1">
              <b>Остаток</b> = работа заказчику (цена за ед. × количество) минус оплаты заказчика по ТЗ партии; каждая оплата учитывается один раз.
            </p>
            <p className="mt-1">
              <b>Себестоимость</b> = сырьё и подкладка + расходы ТЗ. «С 4%» добавляет 4% к сырью и подкладке (работа не облагается); оплаты и остаток от 4% не меняются. Суммы партий всегда с НДС: переключатель «Без НДС» вверху на них не действует (в списке ТЗ и в аналитике он работает).
            </p>
            <p className="mt-1">
              Группировка ТЗ по партиям — вид «По партиям» на странице <Link href="/production?view=batches" className="underline">ТЗ</Link>.
            </p>
          </InfoHint></div>
      </div>
      <ProdTiles
        orders={drill}
        c4={c4Mode}
        treeId="orders-tree"
        id="batches"
        title="Партии — итоги"
        extra={
          <div className="relative">
            <div className={TILE_BOX + " shadow-sm print:shadow-none"}>
              <TileHead>Оплата работы</TileHead>
              <TileValue className={payRest > 0.5 ? "text-amber-700" : ""}>{money(Math.max(payRest, 0))}</TileValue>
              <TileCaption>задолженность: работа − оплачено</TileCaption>
              <TileList items={[
                { k: "Работа", v: money(payWork) },
                { k: "Оплачено", v: money(payPaid), share: payWork ? payPaid / payWork : null },
                ...(payOver > 0.5 ? [{ k: "Сверх работы (шкуры подрядчика и др.)", v: money(payOver), sub: true }] : []),
              ]} />
            </div>
            <div className="absolute right-3 top-3">
              <InfoHint label="Как считается оплата работы" wide align="right">
                <p><b>Оплачено</b> — оплаты заказчика, разнесённые на ТЗ партий (каждая оплата один раз, отменённые не входят). <b>Задолженность</b> = Σ работа − Σ оплачено по партиям, где работа больше оплаты; суммы всегда с НДС и от переключателей не зависят.</p>
              </InfoHint>
            </div>
          </div>
        }
      />

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
      <div className="flex flex-wrap items-center gap-2 text-sm" role="group" aria-label="Фильтр по документам и оплате">
        <span className="text-xs text-neutral-500">Документы и оплата:</span>
        {(
          [
            ["", "Все"],
            ["docs", "Только без документов"],
            ["pay", "Только без оплаты"],
          ] as const
        ).map(([v, text]) => (
          <Link
            key={v}
            href={needHref(v)}
            aria-current={need === v ? "page" : undefined}
            className={
              "rounded-md border px-3 py-1 max-md:inline-flex max-md:min-h-8 max-md:items-center " +
              (need === v ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 text-neutral-700 hover:bg-neutral-100")
            }
          >
            {text}
          </Link>
        ))}
        <InfoHint label="Что значат цвета" wide>
          <p>Красная точка — у партии не хватает обязательных документов или работа не оплачена; жёлтая — оплата частичная или по оплатам нет платёжки; зелёная — документы есть и всё оплачено.</p>
          <p className="mt-1">«Без оплаты» — не оплачено или оплачено частично, либо по оплате нет платёжки. Откройте партию: там чек-лист, загрузка файлов и кнопка «Отметить оплату».</p>
        </InfoHint>
      </div>
      <ResponsiveRows table={
      <Table stickyHeader>
        <Thead>
          <Tr>
            <Th>Партия</Th>
            <Th>ТЗ</Th>
            <Th>
              Произведено, шт.
              <InfoHint label="Что значит произведено">Все ТЗ партии без отменённых и без ремонта: завершённые и в работе (как на Главной).</InfoHint>
            </Th>
            <Th className="hidden md:table-cell">
              Себестоимость
              <Mode4Badge mode={c4Mode} />
              <C4Hint mode={c4Mode} base={c4Lines ? c4Base.toFixed(2) : null} extra={c4Lines ? c4Extra.toFixed(2) : null} excluded={c4Excl.toFixed(2)} title="4% по партиям списка" />
            </Th>
            <Th className="hidden md:table-cell">Работа</Th>
            <Th className="hidden lg:table-cell">Оплачено</Th>
            <Th>Остаток</Th>
            <Th className="hidden lg:table-cell">
              Документы и оплата
              <InfoHint label="Что значат документы и оплата" align="right">Чего не хватает по документам и оплачена ли работа заказчиком. Ниже — проверка: подтверждена ли партия (все ТЗ подтверждены, документы и оплата сопоставлены) или ждёт ручной проверки.</InfoHint>
            </Th>
          </Tr>
        </Thead>
        <Tbody>
          {rows.map(({ b, t, docs }) => (
            <Tr key={b.id}>
              <Td className="font-medium">
                <Link href={`/production/batches/${b.number}`} className="hover:underline">
                  Партия {b.number}
                </Link>
                <span className="ml-1.5 text-xs font-normal text-neutral-500">{b.year ?? ""}</span>
                {batchExtraName(b.name) && <span className="block text-xs font-normal text-neutral-500">{batchExtraName(b.name)}</span>}
              </Td>
              <Td>
                <Link href={`/production?batch=${b.number}`} className="hover:underline">
                  {t.orders}
                </Link>
                {t.items > t.orders ? <span className="ml-1 text-xs text-neutral-500">· {t.items} {positionsWord(t.items)}</span> : null}
              </Td>
              <Td>
                {formatQty(t.producedUnits.toString())}
                {b.plannedUnits != null && <span className="block text-xs text-neutral-500">план {b.plannedUnits}</span>}
              </Td>
              <Td className="hidden whitespace-nowrap md:table-cell">{t.cost.isZero() ? "—" : formatMoney(t.cost.toString())}
                {c4Mode === "on" && !t.c4Applies && !t.cost.isZero() && <span className="block text-xs text-neutral-500">без 4%</span>}
                <TzVatBadge b={vatBreakdown(b.orders.filter((o) => o.status !== "CANCELLED").flatMap((o) => o.materialUsages), c4Mode)} compact hint={false} />
              </Td>
              <Td className="hidden whitespace-nowrap md:table-cell">{t.work.isZero() ? "—" : formatMoney(t.work.toString())}</Td>
              <Td className="hidden whitespace-nowrap lg:table-cell">{t.paid.isZero() ? "—" : formatMoney(t.paid.toString())}</Td>
              <Td className={"whitespace-nowrap " + (t.remaining.greaterThan(0.005) ? "text-amber-700" : "")}>
                {t.work.isZero() && t.paid.isZero()
                  ? "—"
                  : t.remaining.lessThan(-0.005)
                    ? `сверх работы ${formatMoney(t.remaining.abs().toString())}`
                    : formatMoney(t.remaining.toString())}
              </Td>
              <Td className="hidden lg:table-cell">
                {panelByNumber.get(b.number) ? (
                  <span className="inline-flex items-center gap-1">
                  <Link href={`/production/batches/${b.number}`} className="inline-block">
                    <DocsPayBadge
                      tone={panelByNumber.get(b.number)!.tone}
                      missing={panelByNumber.get(b.number)!.panel.missingCount}
                      noDocs={panelByNumber.get(b.number)!.unmatched}
                      payText={panelByNumber.get(b.number)!.panel.pay.state === "PARTIAL" ? `оплата ${formatPercent(panelByNumber.get(b.number)!.panel.pay.percent)}` : payShort(panelByNumber.get(b.number)!.panel.pay)}
                      proofMissing={panelByNumber.get(b.number)!.panel.proofMissing}
                    />
                  </Link>
                  </span>
                ) : (
                  "—"
                )}
                <div className="mt-1"><VerifyPill flag={vflags.batchByNumber.get(b.number)} tab="batches" /></div>
              </Td>
            </Tr>
          ))}
          {rows.length === 0 && (
            <Tr>
              <Td colSpan={8} className="py-8 text-center text-neutral-500">
                {emptyForYear(year, "партий", "Партий пока нет. Они появятся после привязки ТЗ к партиям.")}
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
              ? `сверх работы ${formatMoney(t.remaining.abs().toString())}`
              : formatMoney(t.remaining.toString());
          return (
            <RowCard
              key={b.id}
              title={`Партия ${b.number}${b.year ? ` · ${b.year}` : ""}`}
              href={`/production/batches/${b.number}`}
              subtitle={batchExtraName(b.name)}
              fields={[
                { label: "Остаток", value: <span className={t.remaining.greaterThan(0.005) ? "text-amber-700" : ""}>{rem}</span>, strong: true },
                { label: "Оплачено", value: t.paid.isZero() ? "—" : formatMoney(t.paid.toString()) },
                { label: "ТЗ", value: <><Link href={`/production?batch=${b.number}`} className="underline">{t.orders}</Link>{itemsSuffix(t.orders, t.items)}</> },
                { label: "Произведено", value: `${formatQty(t.producedUnits.toString())}${b.plannedUnits != null ? ` (план ${b.plannedUnits})` : ""}` },
              ]}
              details={[
                { label: `Себестоимость${anyC4 ? c4Suffix(c4Mode) : ""}`, value: t.cost.isZero() ? "—" : formatMoney(t.cost.toString()) },
                { label: "Работа", value: t.work.isZero() ? "—" : formatMoney(t.work.toString()) },
                { label: "Год", value: b.year },
                { label: "Проверка", value: <VerifyPill flag={vflags.batchByNumber.get(b.number)} tab="batches" /> },
                {
                  label: "Документы и оплата",
                  value: panelByNumber.get(b.number) ? (
                    <DocsPayBadge
                      tone={panelByNumber.get(b.number)!.tone}
                      missing={panelByNumber.get(b.number)!.panel.missingCount}
                      noDocs={panelByNumber.get(b.number)!.unmatched}
                      payText={panelByNumber.get(b.number)!.panel.pay.state === "PARTIAL" ? `оплата ${formatPercent(panelByNumber.get(b.number)!.panel.pay.percent)}` : payShort(panelByNumber.get(b.number)!.panel.pay)}
                      proofMissing={panelByNumber.get(b.number)!.panel.proofMissing}
                    />
                  ) : null,
                },
              ]}
            />
          );
        })}
        {rows.length === 0 && (
          <p className="py-8 text-center text-neutral-500">{emptyForYear(year, "партий", "Партий пока нет. Они появятся после привязки ТЗ к партиям.")}</p>
        )}
      </ResponsiveRows>

      <OrdersTree
        orders={drill}
        c4={c4Mode}
        title="Партии → ТЗ → состав"
        payBy={payBy}
        modes={[{ id: "batch", label: "Партии", dims: ["batch", "order"] }]}
        hint={<p>Те же ТЗ и суммы, что в плитках выше и в блоке «Производство» на Главной. «Оплачено» — оплаты заказчика, разнесённые на партию и ТЗ; «К оплате по работе» = работа − оплачено (сверх — оплачено больше работы).</p>}
        empty={emptyForYear(year, "партий", "Партий пока нет.")}
      />
    </div>
  );
}
