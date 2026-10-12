import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { ACCESS, hasRole } from "@/lib/access";
import { getCategoryOptions } from "@/lib/categories";
import { RecordHistory } from "@/components/record-history";
import { RecordComments } from "@/components/comments/record-comments";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { ArticleForm } from "../article-form";
import { saveArticleForm } from "../actions";
import { BomAddForm } from "./bom-add-form";
import { BomRemoveButton } from "./bom-remove-button";
import { formatMoney, formatQty, formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { FITTING_STATUS, orderLabel, truncate } from "@/lib/fittings";
import { SHIPMENT_STATUS, summarizeLines } from "@/lib/shipments";
import { ArticleName } from "@/components/article-name";
import { ProdTiles } from "@/components/prod-tiles";
import { OrdersTree } from "@/components/orders-tree";
import { Money } from "@/components/money";
import { CostTwo } from "@/components/cost-two";
import { InfoHint } from "@/components/info-hint";
import { YearNote } from "@/components/year-note";
import { TotalLabel } from "@/components/total-label";
import { Dash, TD, TH } from "@/components/tree-table";
import { TILE_BOX, TileCaption, TileHead, TileList, TileValue } from "../../dashboard/tile";
import { getCommission4Mode } from "@/lib/commission4-mode";
import { getYearFilter } from "@/lib/year-filter";
import { loadOrdersDrill } from "@/lib/orders-drill";
import { loadOrderRows } from "@/lib/analytics-orders";
import { sumOrders, sumTotal } from "@/lib/orders-sum";
import { articleMetrics } from "@/lib/article-metrics";
import { groupOf, NO_GROUP } from "@/lib/category-groups";
import { canEditProduction } from "@/lib/production-access";
import { DRIVE_DOC_TYPE_LABELS, type DriveDocTypeKey } from "@/lib/drive-docs";

/** Тонкая вертикальная линия слева у первой колонки блока. */
const BL = " border-l border-neutral-200";

const UNIT_LABELS: Record<string, string> = {
  PIECE: "шт.",
  KG: "кг",
  M2: "м²",
  M: "м",
  SET: "компл.",
};

const MOVE_LABEL: Record<string, string> = {
  PRODUCTION_IN: "Выпуск по ТЗ",
  WRITE_OFF_OUT: "Списание",
  ADJUSTMENT_IN: "Корректировка +",
  ADJUSTMENT_OUT: "Корректировка −",
  TRANSFER_IN: "Перемещение (приход)",
  TRANSFER_OUT: "Перемещение (расход)",
};

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const m = await prisma.productModel.findFirst({ where: { id, organizationId: session.user.organizationId }, select: { name: true } });
  return { title: m ? `Артикул ${m.name}` : "Артикул" };
}

/** Компактная ссылка «→» на источник значения (справочник, ТЗ, лот, закупка, ценообразование). */
function Src({ href, title }: { href: string; title: string }) {
  return <Link href={href} title={title} aria-label={title} className="ml-1 text-blue-700 hover:underline">→</Link>;
}

/** Кнопка-ссылка раздела артикула со счётчиком записей: «—», если записей нет. */
function SectionLink({ href, label, count }: { href: string; label: string; count: number }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm hover:bg-neutral-50"
      title={count > 0 ? `${label} этого артикула` : `${label}: записей по этому артикулу нет`}
    >
      {label}
      <span className={"rounded-full px-1.5 text-xs tabular-nums " + (count > 0 ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-400")}>{count > 0 ? count : "—"}</span>
    </Link>
  );
}

export default async function EditModelPage({ params }: PageProps<"/models/[id]">) {
  const { id } = await params;
  const session = await requireSession();
  const orgId = session.user.organizationId;
  const canEdit = hasRole(session.user.role, ACCESS.models);
  const [model, materials, fittings, categoryOptions, orders, stocks, movements, shipments] = await Promise.all([
    prisma.productModel.findFirst({
      where: { id, organizationId: orgId },
      include: { materials: { include: { rawMaterial: true }, orderBy: { id: "asc" } }, categoryRef: { select: { group: true } } },
    }),
    prisma.rawMaterial.findMany({
      where: { organizationId: orgId, isActive: true },
      select: { id: true, name: true, unit: true },
      orderBy: { name: "asc" },
    }),
    prisma.fitting.findMany({
      where: { organizationId: orgId, productionOrder: { productModelId: id } },
      include: { productionOrder: { select: { number: true, workOrderNumber: true } } },
      orderBy: [{ fittingDate: "desc" }, { createdAt: "desc" }],
      take: 10,
    }),
    getCategoryOptions(orgId),
    prisma.productionOrder.findMany({
      where: { organizationId: orgId, productModelId: id },
      select: { id: true, number: true, workOrderNumber: true, status: true, batchId: true },
      orderBy: [{ createdAt: "desc" }],
    }),
    prisma.finishedGoodsStock.findMany({ where: { organizationId: orgId, productModelId: id } }),
    prisma.finishedGoodsMovement.findMany({
      where: { organizationId: orgId, productModelId: id },
      include: { productionOrder: { select: { id: true, number: true, workOrderNumber: true } } },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: 15,
    }),
    prisma.shipment.findMany({
      where: { organizationId: orgId, lines: { some: { productionOrder: { productModelId: id } } } },
      include: { lines: { orderBy: { id: "asc" }, select: { size: true, quantity: true, productionOrder: { select: { productModelId: true, number: true, workOrderNumber: true } } } } },
      orderBy: { plannedDate: "desc" },
      take: 10,
    }),
  ]);
  if (!model) notFound();

  const c4 = await getCommission4Mode();
  const year = await getYearFilter();
  const [drillAll, orderRows, planCount, supplyCount, fittingsCount, shipmentsCount, movementsCount] = await Promise.all([
    loadOrdersDrill(orgId, year, c4),
    loadOrderRows(orgId, year, c4),
    prisma.productionPlan.count({ where: { organizationId: orgId, OR: [{ modelId: id }, { articleCode: { equals: model.name, mode: "insensitive" } }] } }),
    prisma.supplyPlanEntry.count({ where: { organizationId: orgId, productModelId: id } }),
    prisma.fitting.count({ where: { organizationId: orgId, productionOrder: { productModelId: id } } }),
    prisma.shipment.count({ where: { organizationId: orgId, lines: { some: { productionOrder: { productModelId: id } } } } }),
    prisma.finishedGoodsMovement.count({ where: { organizationId: orgId, productModelId: id } }),
  ]);
  const drill = drillAll.filter((o) => o.mid === id);
  const docs = orders.length
    ? await prisma.driveDocument.findMany({
        where: { organizationId: orgId, productionOrderId: { in: orders.map((o) => o.id) } },
        select: { id: true, title: true, docType: true, docDate: true, docNumber: true, storagePath: true, productionOrderId: true },
        orderBy: [{ docDate: "asc" }, { createdAt: "asc" }],
        take: 200,
      })
    : [];
  const orderById = new Map(orders.map((o) => [o.id, o]));
  const cancelled = orders.filter((o) => o.status === "CANCELLED");
  const batchCount = new Set(orders.filter((o) => o.status !== "CANCELLED" && o.batchId).map((o) => o.batchId)).size;
  const colors = Array.from(new Set(orderRows.filter((r) => r.modelId === id && drill.some((d) => d.id === r.id)).flatMap((r) => r.colors))).sort((a, b) => a.localeCompare(b, "ru"));

  // Склад: остаток × средняя себестоимость завершённых ТЗ (как в списке «Изделия»); ТЗ в работе — отдельно, в «Себестоимости».
  const done = drill.filter((o) => o.st === "COMPLETED");
  const doneQty = done.reduce((a, o) => a + o.qty, 0);
  const sI = sumOrders(done, "incl");
  const sE = sumOrders(done, "excl");
  const stockQty = stocks.reduce((a, s) => a + s.quantity.toNumber(), 0);
  const legacy = stocks.reduce((a, s) => a + s.quantity.toNumber() * s.avgUnitCost.toNumber(), 0);
  const stockIncl = doneQty > 0 ? (stockQty * sumTotal(sI)) / doneQty : legacy;
  const stockExcl = doneQty > 0 ? (stockQty * sumTotal(sE)) / doneQty : legacy;
  const met = articleMetrics(drill);
  const all = sumOrders(drill, "incl");
  const unit = all.qty > 0 ? sumTotal(all) / all.qty : null;
  const price = model.sellingPrice ? model.sellingPrice.toNumber() : null;
  const markup = price && unit && unit > 0 ? price / unit : null;
  const group = groupOf(model.categoryRef?.group);
  const perItem = (q: number) => (met.qty > 0 ? formatQty(Math.round((q / met.qty) * 100) / 100) : "—");
  const newTzHref = `/production/new?article=${id}`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href="/articles" className="text-sm text-neutral-500 hover:underline">← Изделия</Link>
      </div>
      <div className="flex flex-wrap items-center gap-y-2">
        <h1 className="text-xl font-semibold"><ArticleName model={model} /></h1>
        <YearNote year={year} />
        {!model.isActive && <span className="ml-2"><Badge variant="default">не используется</Badge></span>}
        <span className="ml-2 inline-flex">
          <InfoHint label="О карточке артикула" wide>
            <p>Всё по артикулу: итоги, показатели, реквизиты и цена, ТЗ с составом по лотам и закупкам, склад и движения, отгрузки, документы ТЗ. Числа — те же ТЗ, что в «Произведено» на Главной (без отменённых и без ремонта). Год в шапке ограничивает ТЗ и себестоимость; склад и движения — текущие.</p>
            <p className="mt-1">Кнопки ниже ведут в разделы с фильтром по этому артикулу; число — сколько записей, «—» — нет.</p>
          </InfoHint>
        </span>
        {canEditProduction(session.user.role) && model.isActive ? (
          <Link href={newTzHref} className={buttonVariants({ size: "sm" }) + " ml-auto"}>+ Создать ТЗ на этот артикул</Link>
        ) : null}
      </div>

      <nav aria-label="Разделы артикула" className="flex flex-wrap gap-2">
        <SectionLink href={`/production?model=${id}`} label="ТЗ артикула" count={orders.filter((o) => o.status !== "CANCELLED").length} />
        <SectionLink href={`/production/batches?model=${id}`} label="Партии" count={batchCount} />
        <SectionLink href={`/shipments?model=${id}`} label="Отгрузки" count={shipmentsCount} />
        <SectionLink href={`/fittings?model=${id}`} label="Примерки" count={fittingsCount} />
        <SectionLink href={`/plan?q=${encodeURIComponent(model.name)}`} label="План заказа" count={planCount} />
        <SectionLink href={`/supply-plan?model=${id}`} label="План поставок" count={supplyCount} />
        <SectionLink href="#stock" label="Остаток / движения" count={movementsCount} />
        <SectionLink href="#docs" label="Документы" count={docs.length} />
      </nav>

      <ProdTiles
        orders={drill}
        c4={c4}
        treeId="model-tree"
        id="model"
        title="Артикул — итоги"
        headerEnd={<Link href={`/production?model=${id}`} className="text-xs text-blue-700 hover:underline print:hidden">→ ТЗ артикула</Link>}
        extraCount={1}
        extra={
          <div className="relative">
            <div className={TILE_BOX + " shadow-sm print:shadow-none"}>
              <TileHead>На складе и розница</TileHead>
              <TileValue>{stockQty > 0 ? `${formatQty(stockQty)} шт.` : "—"}</TileValue>
              <TileCaption>готовая продукция</TileCaption>
              <TileList items={[
                { k: "Стоимость остатка", v: stockQty > 0 ? <Money incl={stockIncl.toFixed(2)} excl={stockExcl.toFixed(2)} /> : "—" },
                { k: "Розничная цена, с НДС", v: price ? formatMoney(price.toFixed(2)) : "—" },
                { k: "Наценка", v: markup ? `×${markup.toFixed(2).replace(".", ",")}` : "—" },
              ]} />
            </div>
            <div className="absolute right-3 top-3">
              <InfoHint label="Как считается склад" wide align="right">
                <p>Стоимость остатка = остаток × средняя себестоимость завершённых ТЗ артикула. Наценка = розничная цена ÷ себестоимость за изделие. Цена задаётся ниже, в «Реквизитах».</p>
              </InfoHint>
            </div>
          </div>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle as="h2" className="flex items-center gap-1 text-base">
            Показатели по ТЗ
            <InfoHint label="Показатели" wide>
              <p>Считаются по ТЗ артикула теми же функциями, что в карточке ТЗ и на Главной. Основная цифра — с 4% (так мы платим), мелко под ней — без 4%; «с НДС / без НДС» — по переключателю в шапке.</p>
              <p className="mt-1"><b>Средневзвешенная цена шкуры</b> = сумма по всем списаниям меха этого вида ÷ число шкур. <b>Шкур на 1 изделие</b> = шкур ÷ произведено. Подкладка — так же, в метрах.</p>
              <p className="mt-1">Куда уходят: «Ценообразование» (какую цену заводить), «Сырьё» (использование), план закупок мех/подкладка.</p>
            </InfoHint>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          {met.qty === 0 ? (
            <p className="text-neutral-500">По артикулу ещё нет ТЗ{year === "all" ? "" : ` за ${year} год`} — показатели появятся после первого ТЗ. {canEditProduction(session.user.role) && model.isActive ? <Link href={newTzHref} className="text-blue-700 hover:underline">Создать ТЗ →</Link> : null}</p>
          ) : (
            <>
              <div className="table-scroll overflow-x-auto">
                <table className="w-full min-w-[640px] table-fixed text-left text-sm">
                  <colgroup><col className="w-[170px]" /><col /><col /><col /><col /></colgroup>
                  <thead>
                    <tr>
                      <th />
                      <th className="border-b border-neutral-200 px-1.5 pb-0.5 text-center text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Расход</th>
                      <th colSpan={2} className={"border-b border-neutral-200 px-1.5 pb-0.5 text-center text-[11px] font-semibold uppercase tracking-wide text-neutral-500" + BL}>Стоимость</th>
                      <th className={"border-b border-neutral-200 px-1.5 pb-0.5 text-center text-[11px] font-semibold uppercase tracking-wide text-neutral-500" + BL}>На изделие</th>
                    </tr>
                    <tr className="border-b border-neutral-200">
                      <th className="py-1.5 pr-2 text-xs font-medium text-neutral-500">Материал</th>
                      <th className={TH}>Списано</th>
                      <th className={TH + BL}>Сумма, ₽</th>
                      <th className={TH}>Ср. цена, ₽</th>
                      <th className={TH + BL}>Расход</th>
                    </tr>
                  </thead>
                  <tbody>
                    {met.furKinds.map((k) => (
                      <tr key={k.fur} className="border-b border-neutral-100 align-top">
                        <td className="py-1.5 pr-2">{k.fur}<Src href="/settings/furs" title="Справочник видов меха" /></td>
                        <td className={TD}>{formatQty(Math.round(k.qty * 100) / 100)} шк.</td>
                        <td className={TD + BL}><CostTwo on={k.on} off={k.off} /></td>
                        <td className={TD}>{k.qty > 0 ? <CostTwo on={{ incl: k.on.incl / k.qty, excl: k.on.excl / k.qty }} off={{ incl: k.off.incl / k.qty, excl: k.off.excl / k.qty }} suffix="/шк." /> : <Dash />}</td>
                        <td className={TD + BL}>{perItem(k.qty)} шк.</td>
                      </tr>
                    ))}
                    {met.lining.qty > 0 && (
                      <tr className="border-b border-neutral-100 align-top">
                        <td className="py-1.5 pr-2">Подкладка<Src href="/lining" title="Подкладка: лоты и закупки" /></td>
                        <td className={TD}>{formatQty(Math.round(met.lining.qty * 100) / 100)} м</td>
                        <td className={TD + BL}><CostTwo on={met.lining.on} off={met.lining.off} /></td>
                        <td className={TD}><CostTwo on={{ incl: met.lining.on.incl / met.lining.qty, excl: met.lining.on.excl / met.lining.qty }} off={{ incl: met.lining.off.incl / met.lining.qty, excl: met.lining.off.excl / met.lining.qty }} suffix="/м" /></td>
                        <td className={TD + BL}>{perItem(met.lining.qty)} м</td>
                      </tr>
                    )}
                    {met.furKinds.length === 0 && met.lining.qty === 0 && (
                      <tr><td colSpan={5} className="py-2 text-neutral-500">Сырьё в ТЗ ещё не списано</td></tr>
                    )}
                    <tr className="row-total align-top">
                      <td className="py-1.5 pl-1.5 pr-2 text-left"><TotalLabel unit="₽" note="с работой, 4% и расходами" /></td>
                      <td className={TD}><Dash /></td>
                      <td className={TD + BL}><CostTwo on={met.total.on} off={met.total.off} /></td>
                      <td className={TD}><Dash /></td>
                      <td className={TD + BL}><CostTwo on={met.unit?.on ?? null} off={met.unit?.off ?? null} /></td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
                <div>
                  <div className="text-xs text-neutral-500">Работа</div>
                  <div className="font-medium tabular-nums">{met.work > 0 ? <Money incl={met.work.toFixed(2)} excl={met.work.toFixed(2)} /> : "—"}</div>
                  <div className="text-[11px] text-neutral-500">без 4%, НДС не начисляется</div>
                </div>
                <div>
                  <div className="text-xs text-neutral-500">Добавляют 4%</div>
                  <div className="font-medium tabular-nums">{met.extra4 > 0.5 ? formatMoney(met.extra4.toFixed(0)) : "—"}</div>
                  <div className="text-[11px] text-neutral-500">с НДС</div>
                </div>
              </div>
              <div className="flex flex-wrap items-baseline gap-x-3 text-xs text-neutral-500">
                <span>НДС в списаниях (с 4%):</span>
                {met.vatRows.length === 0 ? <span>—</span> : met.vatRows.map((r) => (
                  <span key={r.rate} className="tabular-nums">НДС {r.rate}%: <b className="font-medium text-neutral-700">{formatMoney(r.vat.toFixed(0))}</b> из {formatMoney(r.incl.toFixed(0))}</span>
                ))}
                <Src href="/lots" title="Ставка НДС берётся из лота (закупки); в ТЗ её можно изменить по строке" />
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2" className="flex items-center gap-1 text-base">Реквизиты и цена</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ArticleForm
            mode="edit"
            action={saveArticleForm.bind(null, id)}
            categories={categoryOptions}
            canCreateCategory={hasRole(session.user.role, ACCESS.categories)}
            canEdit={canEdit}
            initial={{
              name: model.name,
              salesCode: model.salesCode ?? "",
              salesName: model.salesName ?? "",
              aliases: model.aliases.join(", "),
              category: model.category ?? "",
              categoryRefId: model.categoryRefId,
              sellingPrice: model.sellingPrice ? model.sellingPrice.toString() : "",
              description: model.description ?? "",
              isActive: model.isActive,
            }}
          />
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 border-t border-neutral-100 pt-3 text-sm">
            <dt className="text-neutral-500">Категория → группа</dt>
            <dd>{model.category?.trim() || "—"}{group !== NO_GROUP ? <span className="ml-2 text-neutral-500">группа «{group}»</span> : null}<Src href="/settings/categories" title="Справочник категорий и групп" /></dd>
            <dt className="text-neutral-500">Мех (по ТЗ)</dt>
            <dd>{met.furNames.length ? met.furNames.join(", ") : "—"}<Src href="/settings/furs" title="Справочник видов меха" /></dd>
            <dt className="text-neutral-500">Цвет (по ТЗ)</dt>
            <dd>{colors.length ? colors.join(", ") : "—"}<Src href="/settings/colors" title="Справочник цветов" /></dd>
            <dt className="text-neutral-500">НДС в списаниях</dt>
            <dd>{met.vatRates.length ? met.vatRates.map((v) => `${v}%`).join(", ") : "—"}<span className="ml-2 text-xs text-neutral-400">задаётся в ТЗ (по умолчанию — ставка лота)</span></dd>
            <dt className="text-neutral-500">Цена в ценообразовании</dt>
            <dd>{price ? `${formatMoney(price.toFixed(2))} (с НДС)` : "не задана"}<Src href="/analytics/pricing" title="Ценообразование: какую цену заводить для нужной наценки" /></dd>
            <dt className="text-neutral-500">Создан / изменён</dt>
            <dd className="tabular-nums">{formatDate(model.createdAt)} / {formatDate(model.updatedAt)}</dd>
          </dl>
        </CardContent>
      </Card>

      <OrdersTree
        orders={drill}
        c4={c4}
        id="model-tree"
        title="ТЗ артикула и их состав"
        modes={[{ id: "order", label: "ТЗ", dims: ["order"] }]}
        hint={<p>Каждое ТЗ раскрывается до строк списания: мех и подкладка по лотам (со ссылками на лот и закупку), шкуры подрядчика, расходы, работа. Номер ТЗ ведёт в его карточку.</p>}
        empty="ТЗ по этому артикулу нет."
      />
      {cancelled.length > 0 && (
        <p className="text-xs text-neutral-500">
          Отменённые ТЗ в расчёты не входят:{" "}
          {cancelled.map((o, i) => (
            <span key={o.id}>{i > 0 ? ", " : ""}<Link href={`/production/${o.id}`} className="text-blue-700 hover:underline">{orderLabel(o)}</Link></span>
          ))}
        </p>
      )}

      <details id="stock" className="rounded-xl border border-neutral-200 bg-white px-4 py-3" open={stocks.length > 0 || movements.length > 0}>
        <summary className="cursor-pointer text-sm font-medium">Остаток и движения ({movementsCount})</summary>
        <div className="mt-2 flex flex-col gap-3">
          {stocks.length === 0 ? (
            <p className="text-sm text-neutral-500">На складе нет</p>
          ) : (
            <Table>
              <Thead><Tr><Th className="text-right">Остаток, шт.</Th><Th className="text-right">Учётная себестоимость за ед., ₽</Th></Tr></Thead>
              <Tbody>
                <Tr>
                  <Td className="text-right tabular-nums">{stockQty > 0 ? formatQty(String(stockQty)) : <Dash />}</Td>
                  <Td className="text-right tabular-nums">{stockQty > 0 && legacy > 0 ? formatMoney((legacy / stockQty).toFixed(2)) : <Dash />}</Td>
                </Tr>
              </Tbody>
            </Table>
          )}
          {movements.length > 0 && (
            <Table>
              <Thead><Tr><Th>Дата</Th><Th>Операция</Th><Th className="text-right">Шт.</Th><Th>ТЗ</Th><Th>Примечание</Th></Tr></Thead>
              <Tbody>
                {movements.map((m) => (
                  <Tr key={m.id}>
                    <Td>{formatDate(m.date)}</Td>
                    <Td>{MOVE_LABEL[m.type] ?? m.type}</Td>
                    <Td className="text-right tabular-nums">{formatQty(m.quantity.toString())}</Td>
                    <Td>{m.productionOrder ? <Link href={`/production/${m.productionOrder.id}`} className="text-blue-700 hover:underline">{orderLabel(m.productionOrder)}</Link> : "—"}</Td>
                    <Td className="text-neutral-600">{m.notes ? truncate(m.notes, 80) : "—"}</Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          )}
        </div>
      </details>

      <details className="rounded-xl border border-neutral-200 bg-white px-4 py-3" open={shipments.length > 0}>
        <summary className="cursor-pointer text-sm font-medium">Отгрузки ({shipments.length})</summary>
        <div className="mt-2">
          {shipments.length === 0 ? (
            <p className="text-sm text-neutral-500">Отгрузок пока нет</p>
          ) : (
            <ul className="flex flex-col divide-y divide-neutral-100">
              {shipments.map((sh) => {
                const lines = sh.lines.filter((l) => l.productionOrder.productModelId === id);
                return (
                  <li key={sh.id}>
                    <Link href={`/shipments/${sh.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm hover:bg-neutral-50">
                      <span className="whitespace-nowrap font-medium">{sh.status === "SHIPPED" && sh.shippedDate ? `отгружена ${formatDate(sh.shippedDate)}` : `план ${formatDate(sh.plannedDate)}`}</span>
                      <Badge variant={SHIPMENT_STATUS[sh.status].variant}>{SHIPMENT_STATUS[sh.status].label}</Badge>
                      <span className="min-w-0 text-neutral-600">{summarizeLines(lines).join("; ")}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </details>

      <details id="docs" className="rounded-xl border border-neutral-200 bg-white px-4 py-3" open={docs.length > 0}>
        <summary className="cursor-pointer text-sm font-medium">Документы ТЗ артикула ({docs.length})</summary>
        <div className="mt-2">
          {docs.length === 0 ? (
            <p className="text-sm text-neutral-500">Документов, привязанных к ТЗ этого артикула, пока нет</p>
          ) : (
            <Table>
              <Thead><Tr><Th>Документ</Th><Th>Тип</Th><Th>Дата</Th><Th>ТЗ</Th></Tr></Thead>
              <Tbody>
                {docs.map((d) => {
                  const o = d.productionOrderId ? orderById.get(d.productionOrderId) : undefined;
                  return (
                    <Tr key={d.id}>
                      <Td>
                        {d.storagePath ? <a href={`/api/drive-docs/${d.id}`} className="text-blue-700 hover:underline">{d.title}</a> : d.title}
                        {d.docNumber ? <span className="ml-1 text-neutral-500">№{d.docNumber}</span> : null}
                      </Td>
                      <Td className="text-neutral-600">{DRIVE_DOC_TYPE_LABELS[d.docType as DriveDocTypeKey] ?? d.docType}</Td>
                      <Td>{d.docDate ? formatDate(d.docDate) : "—"}</Td>
                      <Td>{o ? <Link href={`/production/${o.id}#drive`} className="text-blue-700 hover:underline">{orderLabel(o)}</Link> : "—"}</Td>
                    </Tr>
                  );
                })}
              </Tbody>
            </Table>
          )}
        </div>
      </details>

      <details className="rounded-xl border border-neutral-200 bg-white px-4 py-3" open={fittings.length > 0}>
        <summary className="cursor-pointer text-sm font-medium">Примерки ({fittings.length})</summary>
        <div className="mt-2">
          {fittings.length === 0 ? (
            <p className="text-sm text-neutral-500">Примерок по этому артикулу пока нет</p>
          ) : (
            <ul className="flex flex-col divide-y divide-neutral-100">
              {fittings.map((f) => {
                const st = FITTING_STATUS[f.status];
                return (
                  <li key={f.id}>
                    <Link href={`/fittings/${f.id}`} className="flex flex-wrap items-center gap-3 py-2 text-sm hover:bg-neutral-50">
                      <span className="whitespace-nowrap font-medium">{formatDate(f.fittingDate)}</span>
                      <span className="whitespace-nowrap">{orderLabel(f.productionOrder)}</span>
                      <Badge variant={st.variant}>{st.label}</Badge>
                      <span className="min-w-0 flex-1 text-neutral-600">{truncate(f.comment, 100)}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </details>

      <details className="rounded-xl border border-neutral-200 bg-white px-4 py-3" open={model.materials.length > 0}>
        <summary className="cursor-pointer text-sm font-medium">
          Норма расхода сырья на 1 изделие ({model.materials.length})
          <InfoHint label="Зачем норма расхода">Необязательно. Себестоимость берётся из фактических ТЗ, нормы её не меняют.</InfoHint>
        </summary>
        <div className="mt-2 flex flex-col gap-4">
          {model.materials.length === 0 ? (
            <p className="text-sm text-neutral-500">Норма не задана.</p>
          ) : (
            <Table>
              <Thead>
                <Tr>
                  <Th>Материал</Th>
                  <Th className="text-right">Норма на 1 изделие</Th>
                  <Th></Th>
                </Tr>
              </Thead>
              <Tbody>
                {model.materials.map((line) => (
                  <Tr key={line.id}>
                    <Td>{line.rawMaterial.name}</Td>
                    <Td className="text-right tabular-nums">
                      {formatQty(line.quantityPerUnit.toString())} {UNIT_LABELS[line.rawMaterial.unit]}
                    </Td>
                    <Td>{canEdit ? <BomRemoveButton modelId={id} lineId={line.id} name={line.rawMaterial.name} /> : null}</Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          )}
          {canEdit && <BomAddForm productModelId={id} materials={materials} />}
        </div>
      </details>

      <RecordHistory model="ProductModel" recordId={model.id} />
      <RecordComments entityType="ProductModel" entityId={model.id} />
    </div>
  );
}
