import { isServiceAuction, shortAuctionName } from "@/lib/auction-names";
import Link from "next/link";
import { cleanSearch } from "@/lib/input";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input, Select } from "@/components/ui/input";
import { Button, buttonVariants } from "@/components/ui/button";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { formatQty, formatDate } from "@/lib/utils";
import { Decimal } from "@prisma/client/runtime/library";
import { LiningPurchaseForm } from "./lining-purchase-form";
import { Money } from "@/components/money";
import { lotUnitCostExclVat } from "@/lib/purchase-totals";
import { ResponsiveRows, RowCard } from "@/components/responsive-rows";
import { LazyDetails } from "./lazy-details";
import { MaterialLots, furLotsWhere } from "./material-lots";
import { loadMaterialLots } from "./material-lots-action";
import { PurchaseSummary } from "./summary-view";
import { AuctionView, auctionStatusText, loadAuctions, pluralPurchases } from "./auction-view";
import { getYearFilter } from "@/lib/year-filter";
import { furEnglish } from "@/lib/fur-ref";
import { getFurIndex } from "@/lib/fur-ref-server";
import { lotYear } from "@/lib/year-scope";
import { YearNote, emptyForYear } from "@/components/year-note";
import { InfoHint } from "@/components/info-hint";
import { getCommission4Mode } from "@/lib/commission4-mode";
import { Ref4 } from "@/components/c4-note";
import { loadAuctionPanels } from "@/lib/auction-doc-checklist";
import { TONE_DOT, overallTone, payShort } from "@/lib/doc-panel";
import { FurSelectionTotal } from "@/components/fur-selection-total";
import { FilterPanel } from "@/components/filter-panel";

const UNIT_LABELS: Record<string, string> = {
  PIECE: "шт.",
  KG: "кг",
  M2: "м²",
  M: "м",
  SET: "компл.",
};

export const metadata = { title: "Сырьё" };

export default async function RawStockPage({ searchParams }: PageProps<"/lots">) {
  const session = await requireSession();
  const sp = await searchParams;
  const year = await getYearFilter();
  const c4Mode = await getCommission4Mode();
  const tab: "fur" | "lining" | "summary" = sp.tab === "lining" ? "lining" : sp.tab === "summary" ? "summary" : "fur";
  const q = cleanSearch(sp.q);
  const materialId = cleanSearch(sp.material);
  const auctionQ = tab === "fur" ? cleanSearch(sp.auction, 200) : "";
  // Вид режима «Аукцион»: по счетам (по умолчанию) или плоским списком лотов; сохраняется при фильтрах.
  const showZeroLining = tab === "lining" && sp.zero === "1";
  const auctionView: "invoices" | "lots" = cleanSearch(sp.view, 20) === "lots" ? "lots" : "invoices";

  const [materials, auctions] = await Promise.all([
    prisma.rawMaterial.findMany({
      where: { organizationId: session.user.organizationId },
      select: { id: true, name: true, unit: true, minStockLevel: true },
      orderBy: { name: "asc" },
    }),
    tab === "fur" ? loadAuctions(session.user.organizationId, year) : Promise.resolve([]),
  ]);

  // Режим «Аукцион»: выбранное название — точное совпадение, иначе вхождение (без учёта регистра).
  const lowerQ = auctionQ.toLowerCase();
  const exact = auctions.filter((a) => a.name.toLowerCase() === lowerQ);
  const auctionNames = auctionQ
    ? (exact.length > 0 ? exact : auctions.filter((a) => a.name.toLowerCase().includes(lowerQ))).map((a) => a.name)
    : [];
  const auctionMode = tab === "fur" && Boolean(auctionQ);
  const canEditDocs = ["OWNER", "ADMIN", "PURCHASER"].includes(session.user.role);
  // Индикатор у чипа аукциона: цветная точка (нет документов / не оплачено — красная, частично или нет платёжки — жёлтая, всё есть — зелёная).
  const docInfo = new Map<string, { dot: string; text: string }>();
  if (tab === "fur") {
    for (const d of await loadAuctionPanels(prisma, session.user.organizationId, { canUpload: false, canMark: false })) {
      const tone = overallTone(d.panel.missingCount, d.panel.pay, d.panel.proofMissing);
      const parts = [d.panel.missingCount > 0 ? `нет документов: ${d.panel.missingCount}` : "документы есть", payShort(d.panel.pay)];
      if (d.panel.proofMissing > 0) parts.push(`платёжек нет: ${d.panel.proofMissing}`);
      docInfo.set(d.key, { dot: TONE_DOT[tone], text: parts.join(", ") });
    }
  }

  const tabLink = (t: string, label: string) => (
    <Link
      href={t === "fur" ? "/lots" : `/lots?tab=${t}`}
      className={
        "rounded-md px-3 py-1.5 text-sm " +
        (tab === t ? "bg-neutral-900 text-white" : "text-neutral-700 hover:bg-neutral-100")
      }
    >
      {label}
    </Link>
  );

  if (tab === "summary") {
    const one = (v: unknown) => (typeof v === "string" ? v.slice(0, 200) : undefined);
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-semibold">
              Сырьё
              <YearNote year={year} />
              <InfoHint label="О сводке" wide>
                <p>Сводка закупок по годам, аукционам и типам сырья. Год выбирается в шапке (Все / 2025 / 2026) и действует на всех страницах; год закупки — по дате заказа.</p>
              </InfoHint>
            </h1>
          </div>
        </div>
        <div className="flex gap-1 border-b border-neutral-200 pb-2">
          {tabLink("fur", "Мех")}
          {tabLink("lining", "Подкладка")}
          {tabLink("summary", "Сводка по годам")}
        </div>
        <PurchaseSummary
          organizationId={session.user.organizationId}
          year={year}
          searchParams={{ auction: one(sp.auction), material: one(sp.material), vat: one(sp.vat) }}
        />
      </div>
    );
  }

  const CHIPS_SHOWN = 6;
  // Служебные записи («Нет информации», «Не в реестре остатков…») — отдельной группой «Прочее» в конце.
  const realAuctions = auctions.filter((a) => !isServiceAuction(a.name));
  const serviceAuctions = auctions.filter((a) => isServiceAuction(a.name));
  const auctionChips = realAuctions.slice(0, CHIPS_SHOWN);
  const moreAuctions = realAuctions.slice(CHIPS_SHOWN);
  const isActiveName = (name: string) => auctionNames.length === 1 && auctionNames[0] === name;
  const auctionChip = (a: (typeof auctions)[number]) => {
    const active = auctionNames.length === 1 && auctionNames[0] === a.name;
    return (
      <Link
        key={a.name}
        href={`/lots?auction=${encodeURIComponent(a.name)}${auctionView === "lots" ? "&view=lots" : ""}`}
        className={
          "rounded-full border px-3 py-1 text-xs max-md:inline-flex max-md:min-h-8 max-md:items-center " +
          (active
            ? "border-neutral-900 bg-neutral-900 text-white"
            : "border-neutral-300 text-neutral-700 hover:bg-neutral-100")
        }
        title={`${a.name} — ${pluralPurchases(a.count)} · ${auctionStatusText(a)}${docInfo.get(a.name) ? ` · ${docInfo.get(a.name)!.text}` : ""}`}
      >
        {docInfo.get(a.name) && <span aria-hidden className={`mr-1.5 inline-block size-2 rounded-full ${docInfo.get(a.name)!.dot}`} />}
        {shortAuctionName(a.name)} <span className={active ? "text-neutral-300" : "text-neutral-400"}>· {a.count}</span>
      </Link>
    );
  };
  const filtersBlock = (
    <FilterPanel title="Фильтры сырья" applied={Boolean(q || materialId || auctionQ)}>
      {auctions.length > 0 && (
        <div className="mb-3 border-b border-neutral-200 pb-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Партия закупки</div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {auctionChips.map(auctionChip)}
            {moreAuctions.length > 0 && (
              <details className="group/more" open={moreAuctions.some((a) => isActiveName(a.name))}>
                <summary className="cursor-pointer list-none rounded-full border border-dashed border-neutral-300 px-3 py-1 text-xs text-neutral-600 hover:bg-neutral-100 max-md:inline-flex max-md:min-h-8 max-md:items-center [&::-webkit-details-marker]:hidden">
                  <span className="group-open/more:hidden">ещё {moreAuctions.length}</span>
                  <span className="hidden group-open/more:inline">скрыть</span>
                </summary>
                <div className="mt-2 flex flex-wrap gap-2">{moreAuctions.map(auctionChip)}</div>
              </details>
            )}
            {serviceAuctions.length > 0 && (
              <details className="group/other" open={serviceAuctions.some((a) => isActiveName(a.name))}>
                <summary className="cursor-pointer list-none rounded-full border border-dashed border-neutral-300 px-3 py-1 text-xs text-neutral-600 hover:bg-neutral-100 max-md:inline-flex max-md:min-h-8 max-md:items-center [&::-webkit-details-marker]:hidden">
                  Без подтверждённой партии ({serviceAuctions.length})
                </summary>
                <div className="mt-2 flex flex-wrap gap-2">{serviceAuctions.map(auctionChip)}</div>
              </details>
            )}
          </div>
        </div>
      )}
        <form className="grid grid-cols-2 items-end gap-2 sm:grid-cols-4" method="get">
          {auctionView === "lots" && <input type="hidden" name="view" value="lots" />}
          {auctionQ && <input type="hidden" name="auction" value={auctionQ} />}
          <div className="col-span-2">
            <label className="mb-1 block text-xs text-neutral-500">Поиск по № лота, материалу, цвету, сорту</label>
            <Input name="q" defaultValue={q} placeholder="напр. 15016 или соболь" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-neutral-500">Материал</label>
            <Select name="material" defaultValue={materialId}>
              <option value="">Все материалы</option>
              {materials
                .filter((m) => m.unit !== "M")
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
            </Select>
          </div>
          <div className="flex gap-2">
            <Button type="submit" variant="outline">
              Найти
            </Button>
            <Link
              href={auctionQ ? `/lots?auction=${encodeURIComponent(auctionQ)}${auctionView === "lots" ? "&view=lots" : ""}` : "/lots"}
              className="flex items-center text-sm text-neutral-500 hover:underline"
            >
              Сбросить
            </Link>
          </div>
        </form>
      </FilterPanel>
  );

  if (auctionMode) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-semibold">
              Сырьё
              <YearNote year={year} />
            </h1>
          </div>
          <Link href="/materials/new" className={buttonVariants()}>
            + Добавить материал
          </Link>
        </div>
        <div className="flex gap-1 border-b border-neutral-200 pb-2">
          {tabLink("fur", "Мех")}
          {tabLink("lining", "Подкладка")}
          {tabLink("summary", "Сводка по годам")}
        </div>
        {filtersBlock}
        {auctionNames.length === 0 ? (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Аукцион «{auctionQ}» не найден{year === "all" ? "" : ` за ${year} год`}. Выберите название из списка или{" "}
            <Link href="/lots" className="underline">
              сбросьте фильтр
            </Link>
            .
          </p>
        ) : (
          <AuctionView
            organizationId={session.user.organizationId}
            names={auctionNames}
            label={auctionNames.length === 1 ? auctionNames[0] : auctionQ}
            q={q}
            materialId={materialId}
            canEdit={canEditDocs}
            view={auctionView}
          />
        )}
      </div>
    );
  }

  const filtering = tab === "fur" && Boolean(q || materialId);
  const orgId = session.user.organizationId;
  const furIdx = await getFurIndex(orgId); // справочник меха: английское название — в подсказке к названию материала

  // Остатки/суммы по материалам считаем агрегатами по всем лотам; сами лоты меха не грузим —
  // они подгружаются при раскрытии материала (loadMaterialLots), при фильтре — только подходящие.
  const [currentLots, purchasedByMaterial, matchCounts, liningLots] = await Promise.all([
    prisma.rawMaterialLot.findMany({
      where: { organizationId: orgId, quantityRemaining: { gt: 0 }, ...lotYear(year) },
      select: {
        rawMaterialId: true,
        quantityRemaining: true,
        unitCost: true,
        vatRate: true,
        materialCostExclVat: true,
        expenseCostExclVat: true,
      },
    }),
    prisma.rawMaterialLot.groupBy({
      by: ["rawMaterialId"],
      where: { organizationId: orgId, ...lotYear(year) },
      _sum: { quantityReceived: true },
    }),
    filtering
      ? prisma.rawMaterialLot.groupBy({
          by: ["rawMaterialId"],
          where: furLotsWhere(orgId, { materialId, q, year }),
          _count: { _all: true },
        })
      : Promise.resolve([]),
    // Подкладка: ткани и их лоты (их мало), с закупками и использованием.
    tab === "lining"
      ? prisma.rawMaterialLot.findMany({
          where: { organizationId: orgId, rawMaterial: { unit: "M" as const }, ...lotYear(year) },
          include: {
            rawMaterial: true,
            purchase: { include: { supplier: true, documents: { orderBy: { createdAt: "asc" } } } },
            usages: { include: { productionOrder: true } },
          },
          orderBy: { receivedDate: "asc" },
        })
      : Promise.resolve(null),
  ]);
  const lots = liningLots ?? ([] as NonNullable<typeof liningLots>);
  const matchCountByMaterial = new Map(matchCounts.map((c) => [c.rawMaterialId, c._count._all]));

  type MaterialAgg = {
    id: string;
    name: string;
    unit: string;
    minStockLevel: Decimal | null;
    purchased: Decimal;
    remaining: Decimal;
    value: Decimal;
    valueExclVat: Decimal;
  };
  const materialAggMap = new Map<string, MaterialAgg>();
  for (const m of materials) {
    materialAggMap.set(m.id, {
      id: m.id,
      name: m.name,
      unit: m.unit,
      minStockLevel: m.minStockLevel,
      purchased: new Decimal(0),
      remaining: new Decimal(0),
      value: new Decimal(0),
      valueExclVat: new Decimal(0),
    });
  }
  for (const g of purchasedByMaterial) {
    const agg = materialAggMap.get(g.rawMaterialId);
    if (agg && g._sum.quantityReceived) agg.purchased = agg.purchased.add(g._sum.quantityReceived);
  }
  for (const l of currentLots) {
    const agg = materialAggMap.get(l.rawMaterialId);
    if (agg) {
      agg.remaining = agg.remaining.add(l.quantityRemaining);
      agg.value = agg.value.add(l.quantityRemaining.mul(l.unitCost));
      agg.valueExclVat = agg.valueExclVat.add(l.quantityRemaining.mul(lotUnitCostExclVat(l)));
    }
  }
  const materialRows = Array.from(materialAggMap.values()).filter(
    (r) => r.purchased.greaterThan(0) || r.remaining.greaterThan(0)
  );
  const furMaterialRows = materialRows.filter((r) => r.unit !== "M");
  const liningMaterialRows = materialRows.filter((r) => r.unit === "M");
  const furTotalValue = furMaterialRows.reduce((s, r) => s.add(r.value), new Decimal(0));
  const furTotalValueExclVat = furMaterialRows.reduce((s, r) => s.add(r.valueExclVat), new Decimal(0));
  const liningTotalValue = liningMaterialRows.reduce((s, r) => s.add(r.value), new Decimal(0));
  const liningTotalValueExclVat = liningMaterialRows.reduce((s, r) => s.add(r.valueExclVat), new Decimal(0));

  const furLots = lots;

  const furLotsByMaterial = new Map<string, typeof furLots>();
  for (const l of furLots) {
    const arr = furLotsByMaterial.get(l.rawMaterialId);
    if (arr) arr.push(l);
    else furLotsByMaterial.set(l.rawMaterialId, [l]);
  }

  const liningLotsByMaterial = furLotsByMaterial; // (та же группировка: на вкладке «Подкладка» lots — только ткани)
  // Вкладка «Подкладка»: по умолчанию без тканей с нулевым остатком (нехватку показываем всегда).
  const poolOf = (id: string) => (liningLotsByMaterial.get(id) ?? []).reduce((s, l) => s.add(l.quantityRemaining), new Decimal(0));
  const isZeroLining = (r: (typeof liningMaterialRows)[number]) => r.remaining.lessThanOrEqualTo(0) && poolOf(r.id).greaterThanOrEqualTo(0);
  const liningVisibleRows = showZeroLining ? liningMaterialRows : liningMaterialRows.filter((r) => !isZeroLining(r));
  const liningHiddenCount = liningMaterialRows.length - liningVisibleRows.length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">
            Сырьё
            <YearNote year={year} />
            <InfoHint label="О странице «Сырьё»" wide>
              <p>Остаток по материалу — разверните строку, чтобы увидеть лоты (закупки, цену, использование в ТЗ).</p>
              <p className="mt-1">
                Год ({year === "all" ? "все годы" : year}): в таблице только лоты закупок с датой заказа в выбранном году — «Куплено», «Остаток» и «Стоимость остатка» считаются по ним.
              </p>
              <p className="mt-1">
                Стоимость остатка = Σ(остаток лота × цена лота за единицу); цена лота — как в закупке (по курсу, с НДС и расходами). 4% здесь не начисляется: оно считается только при списании сырья и подкладки в ТЗ.
              </p>
            </InfoHint>
          </h1>
          <Link href="/analytics/raw" className="mt-1 inline-block text-sm text-neutral-600 underline hover:text-neutral-900">Аналитика сырья →</Link>
        </div>
        <Link
          href={tab === "lining" ? "/materials/new?unit=M" : "/materials/new"}
          className={buttonVariants()}
        >
          + Добавить материал
        </Link>
      </div>

      <div className="flex gap-1 border-b border-neutral-200 pb-2">
        {tabLink("fur", "Мех")}
        {tabLink("lining", "Подкладка")}
        {tabLink("summary", "Сводка по годам")}
      </div>

      {tab === "fur" ? (
        <>
          {filtersBlock}

          <Card>
            <CardHeader>
              <CardTitle>Мех</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-4">
                <FurSelectionTotal
                  rows={furMaterialRows.map((r) => ({
                    id: r.id,
                    name: r.name,
                    unit: r.unit,
                    purchased: r.purchased.toString(),
                    remaining: r.remaining.toString(),
                    remainingValue: r.value.toString(),
                    remainingValueExclVat: r.valueExclVat.toString(),
                  }))}
                />
              </div>
              <Table>
                <Thead className="max-md:hidden">
                  <Tr>
                    <Th>Материал</Th>
                    <Th>Куплено всего</Th>
                    <Th>Использовано</Th>
                    <Th>Остаток</Th>
                    <Th>Стоимость остатка</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {furMaterialRows.map((r) => {
                    if (filtering && !matchCountByMaterial.get(r.id)) return null;
                    const low = r.minStockLevel != null && r.remaining.lessThan(r.minStockLevel);
                    return (
                      <Tr key={r.id}>
                        <Td colSpan={5} className="p-0">
                          <LazyDetails className="group" defaultOpen={filtering} load={filtering ? undefined : loadMaterialLots.bind(null, r.id, q)} summary={
                            <summary className="grid cursor-pointer list-none grid-cols-2 gap-2 px-3 md:grid-cols-5 py-2 hover:bg-neutral-50 [&::-webkit-details-marker]:hidden">
                              <span className="col-span-2 font-medium md:col-span-1">
                                <span className="mr-1 inline-block text-neutral-400 transition-transform group-open:rotate-90">
                                  ›
                                </span>
                                <span title={furEnglish(r.name, furIdx) ?? undefined}>{r.name}</span>
                              </span>
                              <span>
                                <span className="block text-xs font-normal text-neutral-500 md:hidden">Куплено всего</span>
                                {formatQty(r.purchased.toString())} {UNIT_LABELS[r.unit]}
                              </span>
                              <span>
                                <span className="block text-xs font-normal text-neutral-500 md:hidden">Использовано</span>
                                {formatQty(r.purchased.sub(r.remaining).toString())} {UNIT_LABELS[r.unit]}
                              </span>
                              <span className="font-medium">
                                <span className="block text-xs font-normal text-neutral-500 md:hidden">Остаток</span>
                                {formatQty(r.remaining.toString())} {UNIT_LABELS[r.unit]}{" "}
                                {low && <Badge variant="danger">Мало</Badge>}
                              </span>
                              <span>
                                <span className="block text-xs font-normal text-neutral-500 md:hidden">Стоимость остатка</span>
                                <Money incl={r.value} excl={r.valueExclVat} />
                                <Ref4 mode={c4Mode} incl={r.value} excl={r.valueExclVat} />
                              </span>
                            </summary>
                          }>
                            {filtering && <MaterialLots organizationId={orgId} materialId={r.id} q={q} />}
                          </LazyDetails>
                        </Td>
                      </Tr>
                    );
                  })}
                  {furMaterialRows.length === 0 && (
                    <Tr>
                      <Td colSpan={5} className="py-6 text-center text-neutral-400">
                        {emptyForYear(year, "закупок меха", "Мех ещё не закупался")}
                      </Td>
                    </Tr>
                  )}
                </Tbody>
              </Table>
              <div className="mt-3 flex flex-wrap justify-end gap-x-4 gap-y-1 text-sm">
                <span><span className="text-neutral-500">Всего куплено меха:</span> <b>{formatQty(furMaterialRows.reduce((a, r) => a.add(r.purchased), new Decimal(0)).toString())} шт.</b></span>
                <span><span className="text-neutral-500">Использовано:</span> <b>{formatQty(furMaterialRows.reduce((a, r) => a.add(r.purchased.sub(r.remaining)), new Decimal(0)).toString())} шт.</b></span>
                <span><span className="text-neutral-500">Остаток:</span> <b>{formatQty(furMaterialRows.reduce((a, r) => a.add(r.remaining), new Decimal(0)).toString())} шт.</b></span>
                <span><span className="text-neutral-500">Стоимость остатка:</span> <b><Money incl={furTotalValue} excl={furTotalValueExclVat} /></b><Ref4 mode={c4Mode} incl={furTotalValue} excl={furTotalValueExclVat} className="ml-2 inline-block" /></span>
              </div>
            </CardContent>
          </Card>
        </>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Подкладка</CardTitle>
          </CardHeader>
          <CardContent>
            <LiningPurchaseForm
              materials={materials
                .filter((m) => m.unit === "M")
                .sort((a, b) => a.name.localeCompare(b.name, "ru", { numeric: true }))
                .map((m) => ({ id: m.id, name: m.name }))}
            />
            <Table>
              <Thead className="max-md:hidden">
                <Tr>
                  <Th>№ ткани</Th>
                  <Th>Куплено</Th>
                  <Th>Использовано</Th>
                  <Th>Остаток</Th>
                  <Th>Стоимость</Th>
                </Tr>
              </Thead>
              <Tbody>
                {liningVisibleRows.map((r) => {
                  const rowLots = liningLotsByMaterial.get(r.id) ?? [];
                  const perOrder = new Map<string, { id: string; number: string; qty: Decimal }>();
                  for (const l of rowLots) {
                    for (const u of l.usages) {
                      const e = perOrder.get(u.productionOrderId);
                      if (e) e.qty = e.qty.add(u.quantity);
                      else
                        perOrder.set(u.productionOrderId, {
                          id: u.productionOrderId,
                          number: u.productionOrder.number,
                          qty: u.quantity,
                        });
                    }
                  }
                  const depleted = r.remaining.lessThanOrEqualTo(0);
                  // Real остаток incl. negative pools (currentLots only sees > 0).
                  const poolRemaining = rowLots.reduce((s, l) => s.add(l.quantityRemaining), new Decimal(0));
                  const shortage = poolRemaining.lessThan(0) ? poolRemaining.neg() : null;
                  return (
                    <Tr key={r.id}>
                      <Td colSpan={5} className="p-0">
                        <details className="group">
                          <summary className="grid cursor-pointer list-none grid-cols-2 gap-2 px-3 md:grid-cols-5 py-2 hover:bg-neutral-50 [&::-webkit-details-marker]:hidden">
                            <span className="col-span-2 font-medium md:col-span-1">
                              <span className="mr-1 inline-block text-neutral-400 transition-transform group-open:rotate-90">
                                ›
                              </span>
                              {r.name}
                            </span>
                            <span>
                              <span className="block text-xs font-normal text-neutral-500 md:hidden">Куплено</span>
                              {formatQty(r.purchased.toString())} м
                            </span>
                            <span>
                              <span className="block text-xs font-normal text-neutral-500 md:hidden">Использовано</span>
                              {formatQty(r.purchased.sub(r.remaining).toString())} м
                            </span>
                            <span className="font-medium">
                              <span className="block text-xs font-normal text-neutral-500 md:hidden">Остаток</span>
                              {shortage ? "0" : formatQty(r.remaining.toString())} м{" "}
                              {shortage ? (
                                <Badge variant="warning">Не хватает {formatQty(shortage.toString())} м</Badge>
                              ) : (
                                depleted && <span className="text-xs font-normal text-neutral-500">остаток 0</span>
                              )}
                            </span>
                            <span>
                              <span className="block text-xs font-normal text-neutral-500 md:hidden">Стоимость</span>
                              <Money incl={r.value} excl={r.valueExclVat} />
                              <Ref4 mode={c4Mode} incl={r.value} excl={r.valueExclVat} />
                            </span>
                          </summary>
                          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 border-t border-neutral-100 bg-neutral-50 px-3 py-2">
                            <div>
                              <div className="mb-1 text-xs font-semibold text-neutral-500">Закупки</div>
                              <ResponsiveRows
                                table={
                              <Table>
                                <Thead>
                                  <Tr>
                                    <Th>Закупка</Th>
                                    <Th>Дата</Th>
                                    <Th>Куплено</Th>
                                    <Th>Цена за м</Th>
                                  </Tr>
                                </Thead>
                                <Tbody>
                                  {rowLots.map((l) => (
                                    <Tr key={l.id}>
                                      <Td>
                                        {l.purchase ? (
                                          <Link href={`/purchases/${l.purchase.id}`} className="hover:underline">
                                            {l.purchase.supplier.name} ({l.purchase.number})
                                          </Link>
                                        ) : (
                                          "—"
                                        )}
                                      </Td>
                                      <Td>{formatDate(l.receivedDate)}</Td>
                                      <Td>{formatQty(l.quantityReceived.toString())} м</Td>
                                      <Td>
                                        <Money incl={l.unitCost} excl={lotUnitCostExclVat(l)} />
                                        <Ref4 mode={c4Mode} incl={l.unitCost} excl={lotUnitCostExclVat(l)} />
                                      </Td>
                                    </Tr>
                                  ))}
                                  {rowLots.length === 0 && (
                                    <Tr>
                                      <Td colSpan={4} className="py-3 text-center text-neutral-400">
                                        Эта ткань пока не закупалась
                                      </Td>
                                    </Tr>
                                  )}
                                </Tbody>
                              </Table>
                                }
                              >
                                {rowLots.map((l) => (
                                  <RowCard
                                    key={l.id}
                                    title={
                                      l.purchase ? (
                                        <Link href={`/purchases/${l.purchase.id}`} className="hover:underline">
                                          {l.purchase.supplier.name} ({l.purchase.number})
                                        </Link>
                                      ) : (
                                        "—"
                                      )
                                    }
                                    subtitle={formatDate(l.receivedDate)}
                                    fields={[
                                      { label: "Куплено", value: `${formatQty(l.quantityReceived.toString())} м` },
                                      { label: "Цена за м", value: <><Money incl={l.unitCost} excl={lotUnitCostExclVat(l)} /><Ref4 mode={c4Mode} incl={l.unitCost} excl={lotUnitCostExclVat(l)} /></> },
                                    ]}
                                  />
                                ))}
                                {rowLots.length === 0 && <p className="py-3 text-center text-sm text-neutral-400">Эта ткань пока не закупалась</p>}
                              </ResponsiveRows>
                            </div>
                            <div>
                              <div className="mb-1 text-xs font-semibold text-neutral-500">Использована в ТЗ</div>
                              <ResponsiveRows
                                table={
                              <Table>
                                <Thead>
                                  <Tr>
                                    <Th>ТЗ</Th>
                                    <Th>Метров</Th>
                                  </Tr>
                                </Thead>
                                <Tbody>
                                  {Array.from(perOrder.values()).map((o) => (
                                    <Tr key={o.id}>
                                      <Td>
                                        <Link href={`/production/${o.id}`} className="hover:underline">
                                          ТЗ {o.number}
                                        </Link>
                                      </Td>
                                      <Td>{formatQty(o.qty.toString())} м</Td>
                                    </Tr>
                                  ))}
                                  {perOrder.size === 0 && (
                                    <Tr>
                                      <Td colSpan={2} className="py-3 text-center text-neutral-400">
                                        Пока не использовалась
                                      </Td>
                                    </Tr>
                                  )}
                                </Tbody>
                              </Table>
                                }
                              >
                                {Array.from(perOrder.values()).map((o) => (
                                  <RowCard
                                    key={o.id}
                                    title={
                                      <Link href={`/production/${o.id}`} className="hover:underline">
                                        ТЗ {o.number}
                                      </Link>
                                    }
                                    fields={[{ label: "Метров", value: `${formatQty(o.qty.toString())} м` }]}
                                  />
                                ))}
                                {perOrder.size === 0 && <p className="py-3 text-center text-sm text-neutral-400">Пока не использовалась</p>}
                              </ResponsiveRows>
                            </div>
                          </div>
                        </details>
                      </Td>
                    </Tr>
                  );
                })}
                {liningVisibleRows.length === 0 && (
                  <Tr>
                    <Td colSpan={5} className="py-6 text-center text-neutral-400">
                      {liningMaterialRows.length === 0 ? emptyForYear(year, "закупок подкладки", "Подкладка ещё не закупалась") : "Ткани с остатком закончились"}
                    </Td>
                  </Tr>
                )}
              </Tbody>
            </Table>
            {(liningHiddenCount > 0 || showZeroLining) && (
              <p className="mt-2 text-xs text-neutral-500">
                {showZeroLining ? (
                  <Link href="/lots?tab=lining" className="text-blue-600 hover:underline">
                    Скрыть ткани без остатка
                  </Link>
                ) : (
                  <>
                    Скрыто тканей без остатка: {liningHiddenCount}.{" "}
                    <Link href="/lots?tab=lining&zero=1" className="text-blue-600 hover:underline">
                      Показать все
                    </Link>
                  </>
                )}
              </p>
            )}
            <div className="mt-3 flex justify-end text-sm">
              <span className="text-neutral-500">Итого стоимость остатков подкладки: </span>
              <span className="ml-1 font-semibold text-neutral-900">
                <Money incl={liningTotalValue} excl={liningTotalValueExclVat} />
              </span>
              <Ref4 mode={c4Mode} incl={liningTotalValue} excl={liningTotalValueExclVat} className="ml-2 inline-block" />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
