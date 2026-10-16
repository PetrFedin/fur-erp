import { orderLabel as tzOrderLabel } from "@/lib/order-label";
import { ChatLink } from "@/components/chat-link";
import { loadTzPositions } from "@/lib/order-label-db";
import { Breadcrumbs } from "@/components/breadcrumbs";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { ACCESS, hasRole } from "@/lib/access";
import { getCategoryOptions } from "@/lib/categories";
import { RecordHistory } from "@/components/record-history";
import { RecordComments } from "@/components/comments/record-comments";
import { TzProfile, hasTzProfile } from "./tz-profile";
import { TzBreakdown, type TzMeta } from "./tz-breakdown";
import { NO_SIZE, sortSizes, type SizeRow } from "./size-chart";
import { WeightedTile } from "./weighted-tile";
import { ArticleParams } from "./article-params";
import { loadAllArticleParams, STANDARD_PARAM_NAMES } from "@/lib/article-params";
import { parseLotSizeGrade } from "@/lib/lot-size";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { ArticleForm } from "../article-form";
import { DeleteEntityButton } from "@/components/delete-entity-button";
import { deleteArticle } from "@/app/(app)/settings/articles-ref/actions";
import { articleDeleteBlocker } from "@/lib/article-save";
import { saveArticleForm } from "../actions";
import { formatMoney, formatDate, formatQty } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { orderLabel, truncate } from "@/lib/fittings";
import { summarizeLines } from "@/lib/shipments";
import { ArticleName } from "@/components/article-name";
import { ProdTiles } from "@/components/prod-tiles";
import { OrdersTree } from "@/components/orders-tree";
import { InfoHint } from "@/components/info-hint";
import { YearNote } from "@/components/year-note";
import { TILE_BOX, TileCaption, TileHead, TileList, TileValue } from "../../dashboard/tile";
import { getCommission4Mode } from "@/lib/commission4-mode";
import { getYearFilter } from "@/lib/year-filter";
import { loadOrdersDrill } from "@/lib/orders-drill";
import { loadOrderRows } from "@/lib/analytics-orders";
import { isRepair, slimForTiles, sumOrders, sumTotal } from "@/lib/orders-sum";
import { articleMetrics } from "@/lib/article-metrics";
import { loadArticleFurTypes } from "@/lib/article-fur-type";
import { groupOf, NO_GROUP } from "@/lib/category-groups";
import { canEditProduction } from "@/lib/production-access";
import { HIDDEN_MODULES } from "@/lib/hidden-modules";
import { PhotoGalleryButton } from "@/components/photo-gallery";
import { galleryExtras, pluOfItem } from "@/lib/article-photo-color";
import { deleteArticlePhoto, deleteAllArticlePhotos } from "../photo-actions";
import { loadArticlePhotos, loadShopLinks } from "@/lib/article-photos";
import { isPluParam } from "@/lib/article-photo-match";
import { CollapsibleBlock } from "@/components/collapsible-block";
import { DRIVE_DOC_TYPE_LABELS, type DriveDocTypeKey } from "@/lib/drive-docs";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession({ allowSupplier: true });
  if (session.user.role === "SUPPLIER") return { title: "Артикул" };
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
  const session = await requireSession({ allowSupplier: true });
  // В карточке артикула цены и себестоимость: поставщику она закрыта.
  if (session.user.role === "SUPPLIER") redirect("/articles");
  const orgId = session.user.organizationId;
  const canEdit = hasRole(session.user.role, ACCESS.models);
  const deleteBlocker = canEdit ? await articleDeleteBlocker(session.user.organizationId, id) : null;
  const [model, fittings, categoryOptions, orders, shipments] = await Promise.all([
    prisma.productModel.findFirst({
      where: { id, organizationId: orgId },
      include: { categoryRef: { select: { group: true } } },
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
  const [drillAll, orderRows, planCount, supplyCount, fittingsCount, shipmentsCount] = await Promise.all([
    loadOrdersDrill(orgId, year, c4),
    loadOrderRows(orgId, year, c4),
    prisma.productionPlan.count({ where: { organizationId: orgId, OR: [{ modelId: id }, { articleCode: { equals: model.name, mode: "insensitive" } }] } }),
    prisma.supplyPlanEntry.count({ where: { organizationId: orgId, productModelId: id } }),
    prisma.fitting.count({ where: { organizationId: orgId, productionOrder: { productModelId: id } } }),
    prisma.shipment.count({ where: { organizationId: orgId, lines: { some: { productionOrder: { productModelId: id } } } } }),
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
  const tzPos = await loadTzPositions(orgId, orders);
  const orderById = new Map(orders.map((o) => [o.id, o]));
  const tzOf = (o: { id: string; number: string; workOrderNumber: string | null }) => tzOrderLabel({ ...o, ...tzPos.get(o.id) });
  const cancelled = orders.filter((o) => o.status === "CANCELLED");
  const batchCount = new Set(orders.filter((o) => o.status !== "CANCELLED" && o.batchId).map((o) => o.batchId)).size;
  const colors = Array.from(new Set(orderRows.filter((r) => r.modelId === id && drill.some((d) => d.id === r.id)).flatMap((r) => r.colors))).sort((a, b) => a.localeCompare(b, "ru"));

  const met = articleMetrics(drill);
  const all = sumOrders(drill, "incl");
  const unit = all.qty > 0 ? sumTotal(all) / all.qty : null;
  const price = model.sellingPrice ? model.sellingPrice.toNumber() : null;
  const markup = price && unit && unit > 0 ? price / unit : null;
  const group = groupOf(model.categoryRef?.group);
  const furType = (await loadArticleFurTypes(orgId)).get(id);
  const newTzHref = `/production/new?article=${id}`;

  // Таблица по ТЗ: подписи, ссылки на карточку и на финальный Word; «последнее ТЗ» — самое новое неотменённое с изделиями.
  const ownDrill = drill.filter((o) => !isRepair(o));
  const tzMeta: Record<string, TzMeta> = Object.fromEntries(orders.map((o) => [o.id, { label: tzOf(o), href: `/production/${o.id}`, wordHref: `/api/production/${o.id}/word` }]));
  const latestId = orders.find((o) => o.status !== "CANCELLED" && ownDrill.some((d) => d.id === o.id && d.qty > 0))?.id ?? null;

  // Шкуры по размерам: размер берётся из лота, из которого списан мех (sizeGrade лота, а если не записан — разбор сорта).
  const furLots = new Map<string, number>();
  for (const o of ownDrill) for (const l of o.lines) if (l.k === "f" && l.lot) furLots.set(l.lot, (furLots.get(l.lot) ?? 0) + l.q);
  const lotRows = furLots.size
    ? await prisma.rawMaterialLot.findMany({ where: { organizationId: orgId, id: { in: Array.from(furLots.keys()) } }, select: { id: true, sizeGrade: true, grade: true, rawMaterial: { select: { name: true } } } })
    : [];
  const bySize = new Map<string, number>();
  for (const lot of lotRows) {
    const size = lot.sizeGrade?.trim() || parseLotSizeGrade(lot.grade, lot.rawMaterial.name) || NO_SIZE;
    bySize.set(size, (bySize.get(size) ?? 0) + (furLots.get(lot.id) ?? 0));
  }
  const sizeRows: SizeRow[] = Array.from(bySize, ([size, q]) => ({ size, q })).filter((r) => r.q > 0).sort((a, b) => sortSizes(a.size, b.size));

  // Свои параметры артикула и подсказки для «+ Добавить параметр».
  const allParams = await loadAllArticleParams(prisma, orgId);
  const ownParams = allParams.get(id) ?? [];
  const valuesByName: Record<string, string[]> = {};
  for (const list of allParams.values()) for (const pr of list) { const v = (valuesByName[pr.name] ??= []); if (!v.includes(pr.value)) v.push(pr.value); }
  const usedNames = Object.keys(valuesByName);
  const paramNames = [...STANDARD_PARAM_NAMES, ...usedNames.filter((n) => !STANDARD_PARAM_NAMES.some((s) => s.toLowerCase() === n.toLowerCase()))];

  // Фото и ссылки «Товар в магазине» — только для сотрудников заказчика (подрядчик сюда не попадает: редирект выше).
  const photos = await loadArticlePhotos(prisma, orgId, id);
  const shopLinks = await loadShopLinks(prisma, orgId, id);
  const pluParams = ownParams.filter((p) => isPluParam(p.name));
  const colorRefs = photos.length ? await prisma.colorRef.findMany({ where: { organizationId: orgId }, select: { id: true, name: true, aliases: true, note: true } }) : [];
  const extras = galleryExtras(photos, shopLinks, colorRefs);
  const groupLabel = new Map(extras.groups.map((g) => [g.key, g.label]));

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: "Изделия", href: "/articles" }, { label: model.name }]} />
      <div className="flex flex-wrap items-center gap-y-2">
        <h1 className="text-xl font-semibold"><ArticleName model={model} /></h1>
        <YearNote year={year} />
        <ChatLink type="ProductModel" id={model.id} role={session.user.role} className="ml-3" />
        <span className="ml-2 inline-flex">
          <InfoHint label="О карточке артикула" wide>
            <p>Всё по артикулу: итоги, показатели, реквизиты и цена, ТЗ с составом по лотам и закупкам, отгрузки, документы ТЗ. Числа — те же ТЗ, что в «В выпуске» на Главной (без отменённых и без ремонта). Год в шапке ограничивает ТЗ и себестоимость.</p>
            <p className="mt-1">Кнопки ниже ведут в разделы с фильтром по этому артикулу; число — сколько записей, «—» — нет.</p>
          </InfoHint>
        </span>
        {canEditProduction(session.user.role) && model.isActive ? (
          <Link href={newTzHref} className={buttonVariants({ size: "sm" }) + " btn-accent ml-auto print:hidden"}>+ Создать ТЗ на этот артикул</Link>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2" aria-label="Фото и магазин">
        {photos.length > 0 ? <PhotoGalleryButton modelId={id} photos={photos.map((p) => ({ id: p.id, variant: p.variant, color: p.color, itemId: p.itemId }))} groups={extras.groups} shops={extras.shops} title={model.name} {...(canEdit ? { onDelete: deleteArticlePhoto, onDeleteAll: deleteAllArticlePhotos } : {})} /> : <span className="text-sm text-neutral-500">Нет фото</span>}
        {shopLinks.map((l) => (
          <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "outline" }) + " min-h-11 sm:min-h-9"} title={`Страница товара в магазине${l.variant ? ` · ${l.variant}` : ""}`}>
            Товар в магазине ↗
            {(shopLinks.length > 1 && (groupLabel.get(l.variant) || l.color)) || pluOfItem(l.itemId) ? (
              <span className="font-normal text-neutral-500">
                {shopLinks.length > 1 ? (groupLabel.get(l.variant) ?? l.color ?? "") : ""}{pluOfItem(l.itemId) ? `${shopLinks.length > 1 ? " · " : ""}PLU ${pluOfItem(l.itemId)}` : ""}
              </span>
            ) : null}
          </a>
        ))}
      </div>

      <nav aria-label="Разделы артикула" className="flex flex-wrap gap-2">
        <SectionLink href={`/production?model=${id}`} label="ТЗ артикула" count={orders.filter((o) => o.status !== "CANCELLED").length} />
        <SectionLink href={`/production/batches?model=${id}`} label="Партии" count={batchCount} />
        {!HIDDEN_MODULES.shipments && <SectionLink href={`/shipments?model=${id}`} label="Отгрузки" count={shipmentsCount} />}
        {!HIDDEN_MODULES.fittings && <SectionLink href={`/fittings?model=${id}`} label="Примерки" count={fittingsCount} />}
        {!HIDDEN_MODULES.orderPlan && <SectionLink href={`/plan?q=${encodeURIComponent(model.name)}`} label="План заказа" count={planCount} />}
        {!HIDDEN_MODULES.supplyPlan && <SectionLink href={`/supply-plan?model=${id}`} label="План поставок" count={supplyCount} />}
        <SectionLink href="#docs" label="Документы" count={docs.length} />
      </nav>

      <ProdTiles
        orders={drill}
        c4={c4}
        treeId="model-tz"
        id="model"
        title="Артикул — итоги"
        headerEnd={<Link href={`/production?model=${id}`} className="text-xs text-blue-700 hover:underline print:hidden">→ ТЗ артикула</Link>}
        extraCount={2}
        extra={
          <>
          <div className="relative">
            <div className={TILE_BOX + " shadow-sm print:shadow-none"}>
              <TileHead>Розница</TileHead>
              <TileValue>{price ? formatMoney(price.toFixed(2)) : "—"}</TileValue>
              <TileCaption>розничная цена, с НДС</TileCaption>
              <TileList items={[
                { k: "Наценка", v: markup ? `×${markup.toFixed(2).replace(".", ",")}` : "—" },
              ]} />
            </div>
            <div className="absolute right-3 top-3">
              <InfoHint label="Как считается наценка" wide align="right">
                <p>Наценка = розничная цена ÷ себестоимость за изделие. Цена задаётся ниже, в «Реквизитах».</p>
              </InfoHint>
            </div>
          </div>
          <WeightedTile met={met} orders={ownDrill} />
          </>
        }
      />

      <CollapsibleBlock title="Реквизиты и цена" summary={`${price ? `розница ${formatMoney(price.toFixed(2))}` : "цена не задана"} · ${model.category?.trim() || "без категории"}`}>
        <div className="flex flex-col gap-4">
          <ArticleForm
            mode="edit"
            action={saveArticleForm.bind(null, id)}
            categories={categoryOptions}
            canCreateCategory={hasRole(session.user.role, ACCESS.categories)}
            canEdit={canEdit}
            extraActions={canEdit ? (
              <DeleteEntityButton
                confirmText={`Удалить артикул ${model.name}? Это нельзя отменить. Нормы расхода артикула удалятся вместе с ним.`}
                blockedReason={deleteBlocker}
                action={deleteArticle.bind(null, id)}
                redirectTo="/settings/articles-ref"
              />
            ) : null}
            initial={{
              name: model.name,
              sku: model.sku ?? "",
              lengthClass: model.lengthClass ?? "",
              salesCode: model.salesCode ?? "",
              salesName: model.salesName ?? "",
              aliases: model.aliases.join(", "),
              category: model.category ?? "",
              categoryRefId: model.categoryRefId,
              sellingPrice: model.sellingPrice ? model.sellingPrice.toString() : "",
              description: model.description ?? "",
              supplierWorkPrice: model.supplierWorkPrice ? String(model.supplierWorkPrice) : "",
              supplierFurPerUnit: model.supplierFurPerUnit ? String(model.supplierFurPerUnit) : "",
              isActive: model.isActive,
            }}
          />
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 border-t border-neutral-100 pt-3 text-sm">
            <dt className="text-neutral-500">Категория → группа</dt>
            <dd>{model.category?.trim() || "—"}{group !== NO_GROUP ? <span className="ml-2 text-neutral-600">· {group}</span> : null}<Src href="/settings/categories" title="Справочник категорий и групп" /></dd>
            <dt className="text-neutral-500">PLU</dt>
            <dd>{pluParams.length ? pluParams.map((p) => (p.name.length > 3 ? `${p.name.slice(3).trim()}: ${p.value}` : p.value)).join("; ") : <span className="text-neutral-500">пока пусто</span>}</dd>
            <dt className="text-neutral-500">Тип меха</dt>
            <dd>{furType ? furType.fur : "—"}<Src href="/settings/furs" title="Справочник видов меха" /></dd>
            <dt className="text-neutral-500">Мех (по ТЗ)</dt>
            <dd>{met.furNames.length ? met.furNames.join(", ") : "—"}<Src href="/settings/furs" title="Справочник видов меха" /></dd>
            <dt className="text-neutral-500">Цвет (по ТЗ)</dt>
            <dd>{colors.length ? colors.join(", ") : "—"}<Src href="/settings/colors" title="Справочник цветов" /></dd>
            <dt className="text-neutral-500">НДС в списаниях</dt>
            <dd>{met.vatRates.length ? met.vatRates.map((v) => `${v}%`).join(", ") : "—"}</dd>
            <dt className="text-neutral-500">Цена в ценообразовании</dt>
            <dd>{price ? formatMoney(price.toFixed(2)) : "не задана"}<Src href="/analytics/pricing" title="Ценообразование: какую цену заводить для нужной наценки" /></dd>
            <dt className="text-neutral-500">Создан / изменён</dt>
            <dd className="tabular-nums">{formatDate(model.createdAt)} / {formatDate(model.updatedAt)}</dd>
          </dl>
          <ArticleParams modelId={id} params={ownParams} nameOptions={paramNames} valuesByName={valuesByName} canEdit={canEdit} />
        </div>
      </CollapsibleBlock>

      {met.qty === 0 ? (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <TzProfile code={model.name} />
          <Card>
            <CardHeader><CardTitle as="h2">Показатели по ТЗ всего</CardTitle></CardHeader>
            <CardContent className="text-sm text-neutral-600">
              По артикулу ещё нет ТЗ{year === "all" ? "" : ` за ${year} год`} — показатели появятся после первого ТЗ. {canEditProduction(session.user.role) && model.isActive ? <Link href={newTzHref} className="text-blue-700 hover:underline">Создать ТЗ →</Link> : null}
            </CardContent>
          </Card>
        </div>
      ) : (
        <TzBreakdown orders={slimForTiles(drill)} meta={tzMeta} latestId={latestId} c4={c4} profile={hasTzProfile(model.name) ? <TzProfile code={model.name} /> : null} furSizes={sizeRows.map((r) => (sizeRows.length > 1 ? `${r.size}: ${formatQty(r.q)}` : r.size)).join("; ")} />
      )}

      <CollapsibleBlock title="Состав ТЗ по лотам и закупкам" summary={`${drill.length} ТЗ`} autoOpen={false}>
        <OrdersTree
          orders={drill}
          c4={c4}
          id="model-tree"
          title="Строки списания по ТЗ"
          modes={[{ id: "order", label: "ТЗ", dims: ["order"] }]}
          hint={<p>Каждое ТЗ раскрывается до строк списания: мех и подкладка по лотам (со ссылками на лот и закупку), шкуры подрядчика, расходы, работа. Номер ТЗ ведёт в его карточку.</p>}
          empty="ТЗ по этому артикулу нет."
        />
      </CollapsibleBlock>
      {cancelled.length > 0 && (
        <p className="text-xs text-neutral-500">
          Отменённые ТЗ в расчёты не входят:{" "}
          {cancelled.map((o, i) => (
            <span key={o.id}>{i > 0 ? ", " : ""}<Link href={`/production/${o.id}`} className="text-blue-700 hover:underline">{tzOf(o)}</Link></span>
          ))}
        </p>
      )}


      {!HIDDEN_MODULES.shipments && (
      <details className="rounded-xl border border-neutral-200 bg-white px-4 py-3">
        <summary className="block-title cursor-pointer">Отгрузки ({shipments.length})</summary>
        <div className="mt-2">
          {shipments.length === 0 ? (
            <p className="text-sm text-neutral-500">Отгрузок нет</p>
          ) : (
            <ul className="flex flex-col divide-y divide-neutral-100">
              {shipments.map((sh) => {
                const lines = sh.lines.flatMap((l) => (l.productionOrder?.productModelId === id ? [{ ...l, productionOrder: l.productionOrder }] : []));
                return (
                  <li key={sh.id}>
                    <Link href={`/shipments/${sh.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm hover:bg-neutral-50">
                      <span className="whitespace-nowrap font-medium">{sh.name ? `${sh.name} · ` : ""}{sh.status === "SHIPPED" && sh.shippedDate ? `отгружена ${formatDate(sh.shippedDate)}` : `план ${formatDate(sh.plannedDate)}`}</span>
                      <span className="min-w-0 text-neutral-600">{summarizeLines(lines).join("; ")}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </details>
      )}

      {!HIDDEN_MODULES.fittings && (
      <details className="rounded-xl border border-neutral-200 bg-white px-4 py-3">
        <summary className="block-title cursor-pointer">Примерки ({fittings.length})</summary>
        <div className="mt-2">
          {fittings.length === 0 ? (
            <p className="text-sm text-neutral-500">Примерок по этому артикулу пока нет</p>
          ) : (
            <ul className="flex flex-col divide-y divide-neutral-100">
              {fittings.map((f) => {
                return (
                  <li key={f.id}>
                    <Link href={`/fittings/${f.id}`} className="flex flex-wrap items-center gap-3 py-2 text-sm hover:bg-neutral-50">
                      <span className="whitespace-nowrap font-medium">{formatDate(f.fittingDate)}</span>
                      <span className="whitespace-nowrap">{orderLabel(f.productionOrder)}</span>
                      <span className="min-w-0 flex-1 text-neutral-600">{truncate(f.comment, 100)}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </details>
      )}

      <details id="docs" className="rounded-xl border border-neutral-200 bg-white px-4 py-3">
        <summary className="block-title cursor-pointer">Документы ТЗ артикула ({docs.length})</summary>
        <div className="mt-2">
          {docs.length === 0 ? (
            <p className="text-sm text-neutral-500">Документов нет</p>
          ) : (
            <Table>
              <Thead><Tr><Th>Документ</Th><Th>Тип</Th><Th>Дата</Th><Th>ТЗ</Th></Tr></Thead>
              <Tbody>
                {docs.map((d) => {
                  const o = d.productionOrderId ? orderById.get(d.productionOrderId) : undefined;
                  return (
                    <Tr key={d.id}>
                      <Td>
                        <span className="inline-block max-w-[28rem] truncate align-bottom" title={d.title}>{d.storagePath ? <a href={`/api/drive-docs/${d.id}`} className="text-blue-700 hover:underline">{d.title}</a> : d.title}</span>
                        {d.docNumber && !d.title.includes(d.docNumber) ? <span className="ml-1 text-neutral-500">№{d.docNumber}</span> : null}
                      </Td>
                      <Td className="text-neutral-600">{DRIVE_DOC_TYPE_LABELS[d.docType as DriveDocTypeKey] ?? d.docType}</Td>
                      <Td>{d.docDate ? formatDate(d.docDate) : "—"}</Td>
                      <Td>{o ? <Link href={`/production/${o.id}#drive`} className="text-blue-700 hover:underline">{tzOf(o)}</Link> : "—"}</Td>
                    </Tr>
                  );
                })}
              </Tbody>
            </Table>
          )}
        </div>
      </details>


      <RecordHistory model="ProductModel" recordId={model.id} />
      <RecordComments entityType="ProductModel" entityId={model.id} />
    </div>
  );
}
