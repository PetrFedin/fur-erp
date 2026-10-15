import { readSort, sortRows, thSort } from "@/lib/table-sort";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { positionsWord, itemsSuffix, tzCountText } from "@/lib/tz-key";
import Link from "next/link";
import { requireSession } from "@/lib/session";
import { ProductionTabs } from "@/components/production-tabs";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { formatDate, formatMoney, formatPercent, formatQty } from "@/lib/utils";
import { TzVatBadge } from "@/components/tz-vat-badge";
import { vatBreakdown } from "@/lib/tz-vat";
import { batchExtraName, batchTotals, loadBatchesWithOrders } from "@/lib/batch-stats";
import { getCommission4Mode } from "@/lib/commission4-mode";
import { c4Suffix } from "@/lib/commission4";
import { ResponsiveRows, RowCard } from "@/components/responsive-rows";
import { prisma } from "@/lib/prisma";
import { loadContractors } from "@/lib/contractors";
import { getYearFilter } from "@/lib/year-filter";
import { orderInYear } from "@/lib/year-scope";
import { YearNote, emptyForYear } from "@/components/year-note";
import { InfoHint } from "@/components/info-hint";
import { C4Hint, Mode4Badge } from "@/components/c4-note";
import { base4AndExtra } from "@/lib/commission4";
import { loadBatchPanels } from "@/lib/production-doc-checklist";
import { DocsPayBadge, docsPayIsOk } from "@/components/docs-pay-badge";
import { VerifyPill } from "@/components/verify-control";
import { loadVerifyFlags } from "@/lib/verification";
import { payShort } from "@/lib/doc-panel";
import { docCounts } from "@/lib/doc-links";
import { OrdersTree } from "@/components/orders-tree";
import { ProdTiles } from "@/components/prod-tiles";
import { TILE_BOX, TileCaption, TileHead, TileValue } from "../../dashboard/tile";
import { loadOrdersDrill } from "@/lib/orders-drill";
import { FilterBar } from "@/components/filters/filter-bar";
import { TotalLabel } from "@/components/total-label";
import { Dash } from "@/components/tree-table";
import { Decimal } from "@prisma/client/runtime/library";
import { loadClientDebt, isContractorHidesRest } from "@/lib/payment-alloc";

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
  const byModel = modelSel.length ? allBatchesRaw.filter((b) => b.orders.some((o) => o.status !== "CANCELLED" && modelSel.includes(o.productModelId))) : allBatchesRaw;
  // ?contractor=… — партии, в которых есть ТЗ выбранного подрядчика (none — подрядчик не указан); суммы партий считаются по всем её ТЗ.
  const contractorSel = (Array.isArray(sp.contractor) ? sp.contractor : sp.contractor ? [sp.contractor] : []).filter((v) => /^[\w-]{1,40}$/.test(v));
  const contractorOpts = (await loadContractors(session.user.organizationId)).map((c) => ({ value: c.id, label: c.name }));
  const allBatches = contractorSel.length ? byModel.filter((b) => b.orders.some((o) => o.status !== "CANCELLED" && (o.contractorId ? contractorSel.includes(o.contractorId) : contractorSel.includes("none")))) : byModel;
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
  const rows0 = (showEmpty ? allRows : allRows.filter((r) => !isEmptyBatch(r))).filter((r) => {
    if (!need) return true;
    const n = needsOf(r.b.number);
    return n ? n[need] : false;
  });
  // Сортировка по клику на заголовок (?sort=…&dir=…); по умолчанию порядок как в запросе.
  const sort = readSort(sp, ["batch", "orders", "units", "cost", "work", "paid", "remaining"]);
  const rows = sortRows(rows0, sort, {
    batch: (r) => r.b.number, orders: (r) => r.t.orders, units: (r) => r.t.producedUnits.toNumber(), cost: (r) => r.t.cost.toNumber(),
    work: (r) => r.t.work.toNumber(), paid: (r) => r.t.paid.toNumber(), remaining: (r) => r.t.remaining.toNumber(),
  });
  const th = (k: string) => thSort("/production/batches", sp, k, sort);
  // Дерево и плитки — из тех же ТЗ, что на Главной; оплаты — по партиям/ТЗ из разнесения оплат (как в таблице).
  const shownNums = new Set(rows.map((r) => r.b.number));
  const drillAll = await loadOrdersDrill(orgId, year, c4Mode);
  // Без фильтра по документам/оплате — все ТЗ (как на Главной, включая ТЗ вне партий); с фильтром — только показанные партии.
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
  // Мост к Главной и «Оплатам»: там оплачено всё, что мы перечислили (разнесено на ТЗ + аванс без разнесения), а работа — по всем ТЗ, в том числе без партии.
  // Без фильтров партий — тот же расчёт долга заказчиков (loadClientDebt), что на Главной.
  const bridgeOn = !need && modelSel.length === 0;
  const debt = bridgeOn ? await loadClientDebt(prisma, orgId, { year, orderIds: drillAll.map((o) => o.id), orderFiltersActive: false }) : null;
  const outAlloc = debt ? debt.allocated - payPaid : 0; // разнесено на ТЗ вне партий
  const outWork = debt ? debt.billable - payWork : 0; // работа ТЗ вне партий
  const unallocList = debt ? debt.payments.filter((p) => !isContractorHidesRest(p) && p.rest.greaterThan(0.005)) : [];
  // Итог таблицы — только показанные партии (как строки выше); ТЗ каждой партии свои, двойного счёта нет.
  const sumOrders = rows.reduce((a, r) => a + r.t.orders, 0);
  const sumItems = rows.reduce((a, r) => a + r.t.items, 0);
  const sumProduced = rows.reduce((a, r) => a.add(r.t.producedUnits), new Decimal(0));
  const sumCost = rows.reduce((a, r) => a.add(r.t.cost), new Decimal(0));
  const sumWork = rows.reduce((a, r) => a.add(r.t.work), new Decimal(0));
  const sumPaid = rows.reduce((a, r) => a.add(r.t.paid), new Decimal(0));
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
      <Breadcrumbs items={[{ label: "ТЗ", href: "/production" }, { label: "Партии пошива" }]} />
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
              <b>Остаток</b> = работа подрядчика (цена за ед. × количество) минус оплаты за работу по ТЗ партии; каждая оплата учитывается один раз.
            </p>
            <p className="mt-1">
              <b>Себестоимость сырья</b> = сырьё и подкладка + расходы ТЗ (без работы); <b>полная себестоимость</b> = она + работа подрядчика. «С 4%» добавляет 4% к сырью и подкладке (работа не облагается); оплаты и остаток от 4% не меняются. Суммы партий всегда с НДС: переключатель «Без НДС» вверху на них не действует (в списке ТЗ и в аналитике он работает).
            </p>
            <p className="mt-1">
              Группировка ТЗ по партиям — этот экран; список ТЗ — на странице <Link href="/production" className="underline">ТЗ</Link>.
            </p>
          </InfoHint></div>
      </div>
      <div className="print:hidden">
        <FilterBar
          title="Фильтры партий"
          oneRow
          hideChips
          controls={[
            ...(contractorOpts.length > 1 ? [{ type: "multi" as const, name: "contractor", label: "Подрядчик", options: contractorOpts, noneLabel: "Не указан", allLabel: "Все подрядчики" }] : []),
            { type: "multi", name: "need", label: "Документы и оплата", single: true, allLabel: "Все", options: [{ value: "docs", label: "Только без документов" }, { value: "pay", label: "Только без оплаты" }], hint: "Красная точка — не хватает документов или работа не оплачена; жёлтая — оплата частичная или нет платёжки; зелёная — всё в порядке. Откройте партию: там чек-лист и кнопка «Отметить оплату»." },
            ...(emptyCount > 0 || showEmpty ? [{ type: "multi" as const, name: "empty", label: "Пустые партии", single: true, allLabel: "Скрыты", options: [{ value: "1", label: `Показать пустые (${emptyCount})` }], hint: "Партии без ТЗ скрыты по умолчанию" }] : []),
          ]}
        />
      </div>
      <ProdTiles
        orders={drill}
        c4={c4Mode}
        treeId="orders-tree"
        id="batches"
        title="Партии — итоги"
        headerEnd={<Link href="/production" className="text-xs text-blue-700 hover:underline print:hidden">→ ТЗ</Link>}
        extra={
          <div className="relative">
            <div className={TILE_BOX + " shadow-sm print:shadow-none"}>
              <TileHead>Работа подрядчику</TileHead>
              <TileValue className={payRest > 1 ? "text-amber-700" : ""}>{payRest < 1 ? "—" : money(payRest)}</TileValue>
              <TileCaption>к доплате</TileCaption>
            </div>
            <div className="absolute right-3 top-3">
              <InfoHint label="Как считается работа подрядчику" wide align="right">
                <ul className="mb-2 space-y-0.5 tabular-nums">
                  <li>Работа подрядчику (партии): <b>{money(payWork)}</b></li>
                  <li>Оплачено (разнесено на партии): <b>{money(payPaid)}</b></li>
                  {payOver > 0.5 && <li>Сверх работы (шкуры подрядчика и др.): <b>{money(payOver)}</b></li>}
                  {debt && (
                    <>
                      <li>Оплачено всего: <b>{money(debt.paid)}</b>, из них разнесено на партии {money(payPaid)}{Math.abs(outAlloc) > 0.5 ? `, на ТЗ вне партий ${money(outAlloc)}` : ""}, не разнесено (аванс) {money(debt.unallocated)}</li>
                      <li>Работа подрядчику всего (Главная): <b>{money(debt.billable)}</b>{Math.abs(outWork) > 0.5 ? `, в т. ч. ТЗ вне партий ${money(outWork)}` : ""}</li>
                    </>
                  )}
                </ul>
                <p><b>Оплачено (разнесено на партии)</b> — оплаты за работу, разнесённые на ТЗ партий (каждая оплата один раз, отменённые не входят). <b>К доплате по партиям (до зачёта аванса без партии)</b> = Σ работа − Σ оплачено по партиям, где работа больше оплаты; суммы всегда с НДС и от переключателей не зависят.</p>
                {debt && (
                  <>
                    <p className="mt-1">Остаток по каждой партии после аванса, уже привязанного к её ТЗ. Договор №1605: аванс 70 %, доплата 30 % после сдачи партии. Часть аванса пока не привязана к партиям — после привязки цифра уменьшится до «Долга по работе» на Главной.</p>
                    <p className="mt-1"><b>Разница = неразнесённый аванс {money(debt.unallocated)}</b> (аванс подрядчику, ещё не отнесён к партиям): «Оплачено всего» − «Оплачено (разнесено на партии)».</p>
                    <p className="mt-1"><b>До Главной и «Оплат»:</b> там «оплачено» — всё, что перечислил заказчик ({money(debt.paid)}), а работа — по всем ТЗ ({money(debt.billable)}). Здесь по партиям: оплачено {money(payPaid)}, работа {money(payWork)}. Разница в оплате — {money(debt.unallocated)} аванса, не разнесённого на ТЗ{Math.abs(outAlloc) > 0.5 ? `, и ${money(outAlloc)} на ТЗ вне партий` : ""}; в работе — {money(outWork)} по ТЗ вне партий. Долг на Главной {money(debt.balance)} = {money(Math.max(payRest, 0))} здесь − {money(debt.unallocated)} аванса{Math.abs(outAlloc - outWork) > 0.5 ? ` ${outAlloc - outWork > 0 ? "+" : "−"} ${money(Math.abs(outAlloc - outWork))} по ТЗ вне партий` : ""}.</p>
                    {unallocList.length > 0 && (
                      <>
                        <p className="mt-1">Платежи с неразнесённым остатком (аванс):</p>
                        <ul className="mt-0.5 list-disc pl-4">
                          {unallocList.map((p) => (
                            <li key={p.id}>{formatDate(p.paidAt)} — {money(p.rest.toNumber())}{p.docRef ? ` · ${p.docRef}` : ""}</li>
                          ))}
                        </ul>
                        <p className="mt-1">Разнести их на ТЗ можно в <Link href="/payments?tab=clients#unallocated" className="underline">Оплаты → За работу → Неразнесённые авансы</Link>.</p>
                      </>
                    )}
                  </>
                )}
              </InfoHint>
            </div>
          </div>
        }
      />

      <ResponsiveRows table={
      <Table stickyHeader>
        <Thead>
          <Tr>
            <Th {...th("batch")}>Партия</Th>
            <Th {...th("orders")}>ТЗ</Th>
            <Th {...th("units")} unit="шт." after={<InfoHint label="Что значит «в выпуске»">Все ТЗ партии без отменённых и без ремонта: готово (завершённые ТЗ) + в работе (план ТЗ «В работе» и «Запланировано») — как «В выпуске» на Главной. Разбивка «готово / в работе» — на карточке партии.</InfoHint>}>
              В выпуске
            </Th>
            <Th {...th("cost")} className="hidden md:table-cell" after={<>
              <InfoHint label="Чем отличается от «Полная себестоимость (с работой)»">Здесь себестоимость сырья: мех, подкладка и 4 % (при включённом «С 4%»), плюс расходы ТЗ — без работы подрядчика. В таблице «Партии → ТЗ → состав» ниже столбец «Полная себестоимость (с работой)» — это та же сумма плюс работа, поэтому цифры по одной партии там больше.</InfoHint>
              <Mode4Badge mode={c4Mode} />
              <C4Hint mode={c4Mode} base={c4Lines ? c4Base.toFixed(2) : null} extra={c4Lines ? c4Extra.toFixed(2) : null} excluded={c4Excl.toFixed(2)} title="4% по партиям списка" />
            </>}>
              <span className="inline-flex flex-col leading-tight">Себестоимость сырья<span className="text-[11px] font-normal opacity-80">₽ · без работы</span></span>
            </Th>
            <Th {...th("work")} className="hidden md:table-cell" unit="₽">Работа</Th>
            <Th {...th("paid")} className="hidden lg:table-cell" unit="₽">Оплачено</Th>
            <Th {...th("remaining")} unit="₽">Остаток</Th>
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
                {b.year ? <span className="text-xs font-normal text-neutral-500">{" · "}{b.year}</span> : null}
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
              <Td className="hidden whitespace-nowrap md:table-cell" title={c4Mode === "on" && !t.c4Applies && !t.cost.isZero() ? "4% не начислены" : undefined}>{t.cost.isZero() ? "—" : formatMoney(t.cost.toString())}
                <TzVatBadge b={vatBreakdown(b.orders.filter((o) => o.status !== "CANCELLED").flatMap((o) => o.materialUsages), c4Mode)} compact hint={false} />
              </Td>
              <Td className="hidden whitespace-nowrap md:table-cell">{t.work.isZero() ? "—" : formatMoney(t.work.toString())}</Td>
              <Td className="hidden whitespace-nowrap lg:table-cell">{t.paid.isZero() ? "—" : formatMoney(t.paid.toString())}</Td>
              <Td className={"whitespace-nowrap " + (t.remaining.greaterThan(1) ? "text-amber-700" : "")}>
                {t.work.isZero() && t.paid.isZero()
                  ? "—"
                  : t.remaining.abs().lessThan(1)
                    ? "оплачено"
                  : t.remaining.lessThan(-0.005)
                    ? `сверх работы ${formatMoney(t.remaining.abs().toString())}`
                    : formatMoney(t.remaining.toString())}
              </Td>
              <Td className="hidden lg:table-cell">
                {(() => {
                  const pn = panelByNumber.get(b.number);
                  if (!pn) return "—";
                  if (docsPayIsOk({ missing: pn.panel.missingCount, noDocs: pn.unmatched, payOk: pn.panel.pay.state === "PAID", proofMissing: pn.panel.proofMissing })) return null;
                  return (
                    <Link href={`/production/batches/${b.number}`} className="inline-block">
                      <DocsPayBadge
                        tone={pn.tone}
                        missing={pn.panel.missingCount}
                        noDocs={pn.unmatched}
                        payText={payShort(pn.panel.pay)}
                        payOk={pn.panel.pay.state === "PAID"}
                        proofMissing={pn.panel.proofMissing}
                      />
                    </Link>
                  );
                })()}
                <div className="mt-1"><VerifyPill flag={vflags.batchByNumber.get(b.number)} tab="batches" /></div>
              </Td>
            </Tr>
          ))}
          {rows.length > 0 && (
            <Tr className="row-total">
              <Td><TotalLabel unit="₽" /></Td>
              <Td className="text-xs">{tzCountText(sumOrders, sumItems)}</Td>
              <Td>{sumProduced.isZero() ? <Dash /> : <>{formatQty(sumProduced.toString())} <span className="text-[11px] font-normal opacity-80">шт.</span></>}</Td>
              <Td className="hidden whitespace-nowrap md:table-cell">{sumCost.isZero() ? <Dash /> : formatMoney(sumCost.toString())}</Td>
              <Td className="hidden whitespace-nowrap md:table-cell">{sumWork.isZero() ? <Dash /> : formatMoney(sumWork.toString())}</Td>
              <Td className="hidden whitespace-nowrap lg:table-cell">{sumPaid.isZero() ? <Dash /> : formatMoney(sumPaid.toString())}</Td>
              <Td className="whitespace-nowrap">{sumWork.isZero() && sumPaid.isZero() ? <Dash /> : formatMoney(sumWork.sub(sumPaid).toString())}</Td>
              <Td className="hidden lg:table-cell" />
            </Tr>
          )}
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
            : t.remaining.abs().lessThan(1)
              ? "оплачено"
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
                { label: "Остаток", value: <span className={t.remaining.greaterThan(1) ? "text-amber-700" : ""}>{rem}</span>, strong: true },
                { label: "Оплачено", value: t.paid.isZero() ? "—" : formatMoney(t.paid.toString()) },
                { label: "ТЗ", value: <><Link href={`/production?batch=${b.number}`} className="underline">{t.orders}</Link>{itemsSuffix(t.orders, t.items)}</> },
                { label: "В выпуске", value: `${formatQty(t.producedUnits.toString())}${b.plannedUnits != null ? ` (план ${b.plannedUnits})` : ""}` },
              ]}
              details={[
                { label: `Себестоимость сырья${anyC4 ? c4Suffix(c4Mode) : ""}`, value: t.cost.isZero() ? "—" : formatMoney(t.cost.toString()) },
                { label: "Работа", value: t.work.isZero() ? "—" : formatMoney(t.work.toString()) },
                { label: "Год", value: b.year },
                ...(vflags.batchByNumber.get(b.number)?.verified ? [] : [{ label: "Проверка", value: <VerifyPill flag={vflags.batchByNumber.get(b.number)} tab="batches" /> }]),
                ...(() => {
                  const pn = panelByNumber.get(b.number);
                  if (!pn || docsPayIsOk({ missing: pn.panel.missingCount, noDocs: pn.unmatched, payOk: pn.panel.pay.state === "PAID", proofMissing: pn.panel.proofMissing })) return [];
                  return [{
                    label: "Документы и оплата",
                    value: (
                      <DocsPayBadge tone={pn.tone} missing={pn.panel.missingCount} noDocs={pn.unmatched} payText={payShort(pn.panel.pay)} payOk={pn.panel.pay.state === "PAID"} proofMissing={pn.panel.proofMissing} />
                    ),
                  }];
                })(),
              ]}
            />
          );
        })}
        {rows.length === 0 && (
          <p className="py-8 text-center text-neutral-500">{emptyForYear(year, "партий", "Партий пока нет. Они появятся после привязки ТЗ к партиям.")}</p>
        )}
      </ResponsiveRows>
      {debt ? (
        <p className="text-sm text-neutral-700" data-testid="batches-bridge">
          К доплате по партиям <b className="tabular-nums">{money(Math.max(payRest, 0))}</b>
          {" · "}Аванс вне партий <b className="tabular-nums">−{money(debt.unallocated)}</b>
          {debt.unallocated > 1 ? <> <Link href="/payments?tab=clients#unallocated" className="text-blue-700 hover:underline print:hidden">Разнести…</Link></> : null}
          {" → "}Долг по работе подрядчику = Главная <b className="tabular-nums">{money(debt.balance)}</b>
        </p>
      ) : null}

      <OrdersTree
        orders={drill}
        c4={c4Mode}
        title="Партии → ТЗ → состав"
        costLabel="Полная себестоимость (с работой)"
        costHint={<p>Мех + подкладка + 4 % + расходы + работа подрядчика. В таблице «Партии» выше показана «Себестоимость сырья» — без работы, поэтому у одной партии суммы разные (разница = работа).</p>}
        payBy={payBy}
        modes={[
          { id: "batch", label: "Партии", dims: ["batch", "order"] },
          { id: "year", label: "Годы → партии", dims: ["year", "batch", "order"] },
          { id: "article", label: "Артикулы", dims: ["article", "order"] },
          { id: "cat", label: "Категории", dims: ["category", "article", "order"] },
        ]}
        hint={<p>Те же ТЗ и суммы, что в плитках выше и в блоке «Производство» на Главной. «Оплачено» — оплаты за работу, разнесённые на партию и ТЗ; «К оплате» = работа − оплачено (сверх — оплачено больше работы).</p>}
        empty={emptyForYear(year, "партий", "Партий пока нет.")}
      />
    </div>
  );
}
