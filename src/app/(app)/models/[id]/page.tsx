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
import { ModelForm } from "../model-form";
import { rowVersion, MODEL_V } from "@/lib/concurrency";
import { updateModel } from "../actions";
import { BomAddForm } from "./bom-add-form";
import { BomRemoveButton } from "./bom-remove-button";
import { formatMoney, formatQty, formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { FITTING_STATUS, orderLabel, truncate } from "@/lib/fittings";
import { SHIPMENT_STATUS, summarizeLines } from "@/lib/shipments";
import { ArticleName } from "@/components/article-name";
import { ArticlePriceForm } from "../../articles/price-form";
import { ProdTiles } from "@/components/prod-tiles";
import { OrdersTree } from "@/components/orders-tree";
import { Money } from "@/components/money";
import { InfoHint } from "@/components/info-hint";
import { YearNote } from "@/components/year-note";
import { TILE_BOX, TileCaption, TileHead, TileList, TileValue } from "../../dashboard/tile";
import { getCommission4Mode } from "@/lib/commission4-mode";
import { getYearFilter } from "@/lib/year-filter";
import { loadOrdersDrill } from "@/lib/orders-drill";
import { sumOrders, sumTotal } from "@/lib/orders-sum";
import { groupOf, NO_GROUP } from "@/lib/category-groups";
import { DRIVE_DOC_TYPE_LABELS, type DriveDocTypeKey } from "@/lib/drive-docs";

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
      select: { id: true, number: true, workOrderNumber: true, status: true },
      orderBy: [{ createdAt: "desc" }],
    }),
    prisma.finishedGoodsStock.findMany({ where: { organizationId: orgId, productModelId: id }, include: { warehouse: { select: { name: true } } } }),
    prisma.finishedGoodsMovement.findMany({
      where: { organizationId: orgId, productModelId: id },
      include: { warehouse: { select: { name: true } }, productionOrder: { select: { id: true, number: true, workOrderNumber: true } } },
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
  const drill = (await loadOrdersDrill(orgId, year, c4)).filter((o) => o.mid === id);
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

  // Склад: остаток × средняя себестоимость завершённых ТЗ (как в списке «Изделия»); ТЗ в работе — отдельно, в «Себестоимости».
  const done = drill.filter((o) => o.st === "COMPLETED");
  const doneQty = done.reduce((a, o) => a + o.qty, 0);
  const sI = sumOrders(done, "incl");
  const sE = sumOrders(done, "excl");
  const stockQty = stocks.reduce((a, s) => a + s.quantity.toNumber(), 0);
  const legacy = stocks.reduce((a, s) => a + s.quantity.toNumber() * s.avgUnitCost.toNumber(), 0);
  const stockIncl = doneQty > 0 ? (stockQty * sumTotal(sI)) / doneQty : legacy;
  const stockExcl = doneQty > 0 ? (stockQty * sumTotal(sE)) / doneQty : legacy;
  const all = sumOrders(drill, "incl");
  const unit = all.qty > 0 ? sumTotal(all) / all.qty : null;
  const price = model.sellingPrice ? model.sellingPrice.toNumber() : null;
  const markup = price && unit && unit > 0 ? price / unit : null;
  const group = groupOf(model.categoryRef?.group);
  const nonEmpty = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href="/articles" className="text-sm text-neutral-500 hover:underline">← Изделия</Link>
        {orders.length > 0 && <Link href={`/production?model=${id}`} className="text-sm text-blue-700 hover:underline">Все ТЗ артикула ({orders.length}) →</Link>}
      </div>
      <div className="flex flex-wrap items-center">
        <h1 className="text-xl font-semibold"><ArticleName model={model} /></h1>
        <YearNote year={year} />
        {!model.isActive && <span className="ml-2"><Badge variant="default">не используется</Badge></span>}
        <span className="ml-2 inline-flex">
          <InfoHint label="О карточке артикула" wide>
            <p>Всё по артикулу: итоги, реквизиты и цена, ТЗ с составом по лотам и закупкам, склад и движения, отгрузки, документы ТЗ. Числа — те же ТЗ, что в «Произведено» на Главной (без отменённых и без ремонта).</p>
            <p className="mt-1">Год в шапке ограничивает ТЗ и себестоимость; склад и движения — текущие.</p>
          </InfoHint>
        </span>
      </div>

      <ProdTiles
        orders={drill}
        c4={c4}
        treeId="model-tree"
        id="model"
        title="Артикул — итоги"
        extraCount={1}
        extra={
          <div className="relative">
            <div className={TILE_BOX + " shadow-sm print:shadow-none"}>
              <TileHead>На складе и розница</TileHead>
              <TileValue>{stockQty > 0 ? `${formatQty(stockQty)} шт.` : "—"}</TileValue>
              <TileCaption>готовая продукция</TileCaption>
              <TileList items={[
                ...(stocks.length > 1 ? stocks.map((s) => ({ k: s.warehouse.name, v: `${formatQty(s.quantity.toString())} шт.`, sub: true })) : []),
                { k: "Стоимость остатка", v: stockQty > 0 ? <Money incl={stockIncl.toFixed(2)} excl={stockExcl.toFixed(2)} /> : "—" },
                { k: "Розничная цена", v: price ? formatMoney(price.toFixed(2)) : "—" },
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
          <CardTitle>Реквизиты</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
            <dt className="text-neutral-500">Категория</dt>
            <dd>{nonEmpty(model.category) ?? "—"}{group !== NO_GROUP ? <span className="ml-2 text-neutral-500">группа «{group}»</span> : null}</dd>
            <dt className="text-neutral-500">Код в продажах</dt>
            <dd>{nonEmpty(model.salesCode) ?? "—"}</dd>
            <dt className="text-neutral-500">Название в продажах</dt>
            <dd>{nonEmpty(model.salesName) ?? "—"}</dd>
            {model.aliases.length > 0 && (
              <>
                <dt className="text-neutral-500">Другие написания</dt>
                <dd>{model.aliases.join(", ")}</dd>
              </>
            )}
            <dt className="text-neutral-500">Розничная цена</dt>
            <dd>
              <ArticlePriceForm modelId={model.id} sellingPrice={model.sellingPrice?.toString() ?? ""} canEdit={canEdit} />
            </dd>
            <dt className="text-neutral-500">Создан / изменён</dt>
            <dd className="tabular-nums">{formatDate(model.createdAt)} / {formatDate(model.updatedAt)}</dd>
          </dl>
          <p className="text-xs text-neutral-500">
            Код и название в продажах, синонимы — в <Link href="/settings/articles-ref" className="text-blue-700 hover:underline">справочнике артикулов</Link>. Цена применяется к ТЗ в плане и в работе; у завершённых не меняется.
          </p>
          <ModelForm
            categories={categoryOptions}
            canCreateCategory={hasRole(session.user.role, ACCESS.categories)}
            action={updateModel.bind(null, id)}
            version={rowVersion(model, MODEL_V)}
            model={{
              id: model.id,
              organizationId: model.organizationId,
              name: model.name,
              sku: model.sku,
              category: model.category,
              categoryRefId: model.categoryRefId,
              sellingPrice: model.sellingPrice?.toString() ?? null,
              description: model.description,
              salesCode: model.salesCode,
              salesName: model.salesName,
              aliases: model.aliases,
              isActive: model.isActive,
              createdAt: model.createdAt,
              updatedAt: model.updatedAt,
            }}
          />
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

      <details className="rounded-xl border border-neutral-200 bg-white px-4 py-3" open={stocks.length > 0 || movements.length > 0}>
        <summary className="cursor-pointer text-sm font-medium">Склад и движения ({movements.length})</summary>
        <div className="mt-2 flex flex-col gap-3">
          {stocks.length === 0 ? (
            <p className="text-sm text-neutral-500">На складе нет</p>
          ) : (
            <Table>
              <Thead><Tr><Th>Склад</Th><Th>Остаток, шт.</Th><Th>Учётная себестоимость за ед.</Th></Tr></Thead>
              <Tbody>
                {stocks.map((s) => (
                  <Tr key={s.id}>
                    <Td>{s.warehouse.name}</Td>
                    <Td>{s.quantity.toNumber() > 0 ? formatQty(s.quantity.toString()) : "—"}</Td>
                    <Td>{s.avgUnitCost.toNumber() > 0 ? formatMoney(s.avgUnitCost.toString()) : "—"}</Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          )}
          {movements.length > 0 && (
            <Table>
              <Thead><Tr><Th>Дата</Th><Th>Операция</Th><Th>Склад</Th><Th>Шт.</Th><Th>ТЗ</Th><Th>Примечание</Th></Tr></Thead>
              <Tbody>
                {movements.map((m) => (
                  <Tr key={m.id}>
                    <Td>{formatDate(m.date)}</Td>
                    <Td>{MOVE_LABEL[m.type] ?? m.type}</Td>
                    <Td>{m.warehouse.name}</Td>
                    <Td>{formatQty(m.quantity.toString())}</Td>
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

      <details className="rounded-xl border border-neutral-200 bg-white px-4 py-3" open={docs.length > 0}>
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
                  <Th>Норма на 1 изделие</Th>
                  <Th></Th>
                </Tr>
              </Thead>
              <Tbody>
                {model.materials.map((line) => (
                  <Tr key={line.id}>
                    <Td>{line.rawMaterial.name}</Td>
                    <Td>
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
