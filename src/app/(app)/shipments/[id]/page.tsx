import { Breadcrumbs } from "@/components/breadcrumbs";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { ProductionTabs } from "@/components/production-tabs";
import { ArticleName } from "@/components/article-name";
import { ResponsiveRows, RowCard } from "@/components/responsive-rows";
import { Dash } from "@/components/tree-table";
import { TotalLabel } from "@/components/total-label";
import { InfoHint } from "@/components/info-hint";
import { Badge } from "@/components/ui/badge";
import { SummaryTiles } from "../../production/summary-tiles";
import { formatDate, formatQty, formatShare } from "@/lib/utils";
import { orderLabel, orderHint } from "@/lib/order-label";
import { loadTzPositions } from "@/lib/order-label-db";
import { ORDER_COLORS_INCLUDE } from "@/lib/order-colors";
import { orderSortKey } from "@/lib/shipments";
import {
  acceptanceByLine, candidateRows, compareEvents, fmtWall, intervalNotes, lineKey, parseDocLinks, shareOf, shipmentTotals, wallDateIso, wallTimeHm,
} from "@/lib/shipment-calc";
import { HeaderDelete, HeaderEdit } from "./header-ui";
import { AddLinesButton, LineDelete, LineEdit } from "./lines-ui";
import { EventActions, NewEventButton, type EventValues, type LineBrief } from "./event-ui";

export const metadata = { title: "Отгрузка" };
const EDIT_ROLES = ["OWNER", "ADMIN", "TECHNOLOGIST"];

const stamp = (d: Date) =>
  d.toLocaleString("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default async function ShipmentPage({ params }: PageProps<"/shipments/[id]">) {
  const { id } = await params;
  const session = await requireSession();
  const orgId = session.user.organizationId;
  const canEdit = EDIT_ROLES.includes(session.user.role);

  const s = await prisma.shipment.findFirst({
    where: { id, organizationId: orgId },
    include: {
      supplier: { select: { id: true, name: true } },
      batch: { select: { id: true, number: true, name: true, year: true } },
      lines: {
        include: {
          productionOrder: {
            select: {
              id: true, number: true, workOrderNumber: true, size: true, color: true, plannedQuantity: true,
              productModel: { select: { id: true, name: true, category: true, salesCode: true, salesName: true } },
              ...ORDER_COLORS_INCLUDE,
            },
          },
        },
      },
      events: { include: { lines: true } },
    },
  });
  if (!s) notFound();

  const [users, titleGroups, batchChoices, suppliers] = await Promise.all([
    prisma.user.findMany({ where: { organizationId: orgId }, select: { id: true, name: true, isActive: true }, orderBy: { name: "asc" } }),
    prisma.shipmentEvent.groupBy({ by: ["title"], where: { shipment: { organizationId: orgId } }, _count: { _all: true }, orderBy: { _count: { title: "desc" } }, take: 60 }),
    canEdit ? prisma.productionBatch.findMany({ where: { organizationId: orgId }, select: { id: true, number: true, name: true, year: true }, orderBy: { number: "desc" } }) : Promise.resolve([]),
    canEdit ? prisma.supplier.findMany({ where: { organizationId: orgId, isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : Promise.resolve([]),
  ]);
  const userName = new Map(users.map((u) => [u.id, u.name]));
  const pickable = users.filter((u) => u.isActive || s.events.some((e) => e.responsibleUserId === u.id)).map((u) => ({ id: u.id, name: u.name }));
  const titles = titleGroups.map((g) => g.title);

  const pos = await loadTzPositions(orgId, s.lines.map((l) => l.productionOrder));
  const labelOf = (l: (typeof s.lines)[number]) => orderLabel({ workOrderNumber: l.productionOrder.workOrderNumber, number: l.productionOrder.number, ...pos.get(l.productionOrder.id) });

  // «В ТЗ» — сколько штук по этой строке (цвет, размер) записано в самом ТЗ.
  const qtyTz = new Map<string, number>();
  for (const o of new Map(s.lines.map((l) => [l.productionOrderId, l.productionOrder])).values()) {
    for (const r of candidateRows({ ...o, plannedQuantity: Number(o.plannedQuantity) })) qtyTz.set(lineKey(o.id, r.color, r.size), r.qty);
  }

  const lines = [...s.lines].sort(
    (a, b) =>
      orderSortKey(a.productionOrder) - orderSortKey(b.productionOrder) ||
      a.productionOrder.number.localeCompare(b.productionOrder.number, "ru", { numeric: true }) ||
      (a.color ?? "").localeCompare(b.color ?? "", "ru") ||
      (a.size ?? "").localeCompare(b.size ?? "", "ru", { numeric: true }),
  );
  const acc = acceptanceByLine(s.events);
  const totals = shipmentTotals(s.lines, acc);
  const touched = new Set(s.events.flatMap((e) => e.lines.filter((l) => l.accepted != null || l.rejected != null || l.returned != null).map((l) => l.shipmentLineId)));
  const lineText = (l: (typeof lines)[number]) => [labelOf(l), l.productionOrder.productModel.name, l.color, l.size ? `р. ${l.size}` : ""].filter(Boolean).join(" · ");
  const briefs: LineBrief[] = lines.map((l) => ({ id: l.id, label: lineText(l), quantity: l.quantity }));
  const lineById = new Map(lines.map((l) => [l.id, l]));

  const sorted = [...s.events].sort(compareEvents);
  const notes = intervalNotes(sorted);
  const respText = (e: (typeof sorted)[number]) => (e.responsibleUserId ? userName.get(e.responsibleUserId) : e.responsibleName) ?? "";

  const values = (e: (typeof sorted)[number]): EventValues => ({
    id: e.id,
    title: e.title,
    date: wallDateIso(e.occurredAt),
    time: e.timeKnown ? wallTimeHm(e.occurredAt) : "",
    responsible: e.responsibleUserId ?? (e.responsibleName ? "__other" : ""),
    responsibleName: e.responsibleName ?? "",
    place: e.place ?? "",
    details: e.details ?? "",
    docLinks: e.docLinks ?? "",
    expected: e.expected,
    mode: e.lines.length ? "lines" : "all",
    lines: Object.fromEntries(
      e.lines.map((l) => [l.shipmentLineId, { qty: l.qty?.toString() ?? "", accepted: l.accepted?.toString() ?? "", rejected: l.rejected?.toString() ?? "", returned: l.returned?.toString() ?? "", comment: l.comment ?? "" }]),
    ),
    version: e.updatedAt.toISOString(),
  });

  const name = s.name ?? `Отгрузка на ${formatDate(s.plannedDate)}`;
  const batchText = s.batch ? `Партия ${s.batch.number}${s.batch.year ? ` · ${s.batch.year}` : ""}${s.batch.name ? ` · ${s.batch.name}` : ""}` : "";
  const sharePct = (part: number, whole: number) => {
    const v = shareOf(part, whole);
    return v == null ? undefined : formatShare(v);
  };
  const accShare = sharePct(totals.accepted, totals.inShipment);
  const notShare = sharePct(totals.notAccepted, totals.inShipment);
  const remShare = sharePct(totals.remaining, totals.inShipment);

  return (
    <div className="flex flex-col gap-5">
      <Breadcrumbs items={[{ label: "Отгрузки", href: "/shipments" }, { label: name }]} />
      <ProductionTabs active="shipments" />

      {/* а) шапка и итоги */}
      <section className="flex flex-col gap-3" aria-label="Шапка отгрузки">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h1 className="text-xl font-semibold">{name}</h1>
          {canEdit && (
            <div className="flex flex-wrap items-start gap-2">
              <HeaderEdit
                v={{ id: s.id, name, supplierId: s.supplierId ?? "", batchId: s.batchId ?? "", plannedDate: wallDateIso(s.plannedDate), notes: s.notes ?? "" }}
                suppliers={suppliers}
                batches={batchChoices.map((b) => ({ id: b.id, label: `Партия ${b.number}${b.year ? ` · ${b.year}` : ""}${b.name ? ` · ${b.name}` : ""}` }))}
              />
              <HeaderDelete id={s.id} name={name} blockedReason={s.events.length > 0 ? `Есть этапы (${s.events.length}) — сначала удалите их` : null} />
            </div>
          )}
        </div>
        <dl className="grid grid-cols-[8rem_1fr] gap-y-1 text-sm sm:grid-cols-[10rem_1fr]">
          <dt className="text-neutral-500">Поставщик</dt>
          <dd>{s.supplier ? <Link href={`/suppliers/${s.supplier.id}`} className="hover:underline">{s.supplier.name}</Link> : "—"}</dd>
          <dt className="text-neutral-500">Партия пошива</dt>
          <dd>{s.batch ? <Link href={`/production/batches/${s.batch.number}`} className="hover:underline">{batchText}</Link> : "—"}</dd>
          <dt className="text-neutral-500">Плановая дата</dt>
          <dd>{formatDate(s.plannedDate)}</dd>
          <dt className="text-neutral-500">Примечание</dt>
          <dd className="whitespace-pre-wrap">{s.notes ?? "—"}</dd>
        </dl>
        <SummaryTiles
          id="shipment"
          title="Отгрузка — итоги"
          tiles={[
            { key: "in", label: "В отгрузке, шт.", value: formatQty(totals.inShipment), caption: `${formatQty(lines.length)} ${lines.length === 1 ? "строка" : "строк"}` },
            { key: "acc", label: "Принято, шт.", value: formatQty(totals.accepted), caption: accShare ? `${accShare} · по всем этапам приёмки` : "по всем этапам приёмки", hint: <p>Сумма «принято» по всем этапам, где она отмечена по строкам (накопительно). Повторная приёмка тех же изделий суммируется.</p> },
            { key: "ret", label: "Возвращено на переделку / не принято, шт.", value: formatQty(totals.notAccepted), caption: [`возвращено ${formatQty(totals.returned)}`, `не принято ${formatQty(totals.rejected)}`, notShare].filter(Boolean).join(" · ") },
            { key: "rem", label: "Ещё не принято, шт.", value: formatQty(totals.remaining), caption: remShare ? `${remShare} от отгрузки` : undefined, hint: <p>В отгрузке минус принято — по каждой строке отдельно, не меньше нуля.</p> },
          ]}
        />
      </section>

      {/* б) состав */}
      <section className="flex flex-col gap-2" aria-label="Состав отгрузки">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="block-title">
            Состав отгрузки
            <InfoHint label="О составе отгрузки"><p>Строки берутся из позиций загруженных ТЗ: цвет, размер и вид меха — копия на момент добавления. «В ТЗ» — сколько штук по этой строке записано в самом ТЗ.</p></InfoHint>
          </h2>
          {canEdit && <AddLinesButton shipmentId={s.id} />}
        </div>
        <ResponsiveRows
          table={
            <Table className="min-w-[960px]">
              <Thead>
                <Tr>
                  <Th>ТЗ · поз.</Th>
                  <Th>Артикул</Th>
                  <Th>Цвет</Th>
                  <Th>Размер</Th>
                  <Th>Вид меха</Th>
                  <Th className="text-right" unit="шт.">В ТЗ</Th>
                  <Th className="text-right" unit="шт.">В этой отгрузке</Th>
                  <Th className="text-right">Принято / не принято / возвращено</Th>
                  <Th>Комментарий</Th>
                  {canEdit && <Th><span className="sr-only">Действия</span></Th>}
                </Tr>
              </Thead>
              <Tbody>
                {lines.map((l) => {
                  const a = acc.get(l.id);
                  const inTz = qtyTz.get(lineKey(l.productionOrderId, l.color, l.size));
                  return (
                    <Tr key={l.id}>
                      <Td className="whitespace-nowrap">
                        <Link href={`/production/${l.productionOrder.id}`} title={orderHint(l.productionOrder)} className="font-medium hover:underline">{labelOf(l)}</Link>
                      </Td>
                      <Td><Link href={`/models/${l.productionOrder.productModel.id}`} className="hover:underline"><ArticleName model={l.productionOrder.productModel} /></Link></Td>
                      <Td>{l.color ?? <Dash />}</Td>
                      <Td>{l.size ?? <Dash />}</Td>
                      <Td>{l.furKind ?? <Dash />}</Td>
                      <Td className="text-right tabular-nums">{inTz != null ? formatQty(inTz) : <Dash />}</Td>
                      <Td className="text-right font-medium tabular-nums">{formatQty(l.quantity)}</Td>
                      <Td className="whitespace-nowrap text-right tabular-nums">
                        {a ? <>{formatQty(a.accepted)} / {formatQty(a.rejected)} / {formatQty(a.returned)}</> : <Dash />}
                      </Td>
                      <Td className="max-w-56 text-xs text-neutral-600">{l.comment ?? ""}</Td>
                      {canEdit && (
                        <Td className="whitespace-nowrap">
                          <div className="flex items-center gap-1">
                            <LineEdit v={{ id: l.id, label: lineText(l), quantity: l.quantity, size: l.size ?? "", comment: l.comment ?? "" }} />
                            <LineDelete id={l.id} label={lineText(l)} blockedReason={touched.has(l.id) ? "Нельзя удалить: по строке есть приёмка" : null} />
                          </div>
                          {touched.has(l.id) && <div className="text-[11px] text-neutral-500">есть приёмка — удалить нельзя</div>}
                        </Td>
                      )}
                    </Tr>
                  );
                })}
                {lines.length > 0 && (
                  <Tr className="row-total">
                    <Td colSpan={6} className="text-right"><TotalLabel unit="шт." /></Td>
                    <Td className="text-right tabular-nums">{formatQty(totals.inShipment)}</Td>
                    <Td className="whitespace-nowrap text-right tabular-nums">{formatQty(totals.accepted)} / {formatQty(totals.rejected)} / {formatQty(totals.returned)}</Td>
                    <Td colSpan={canEdit ? 2 : 1} />
                  </Tr>
                )}
                {lines.length === 0 && (
                  <Tr>
                    <Td colSpan={canEdit ? 10 : 9} className="py-8 text-center text-neutral-500">Состав пока пуст{canEdit ? " — добавьте позиции кнопкой «+ Добавить из ТЗ»" : ""}</Td>
                  </Tr>
                )}
              </Tbody>
            </Table>
          }
        >
          {lines.map((l) => {
            const a = acc.get(l.id);
            const inTz = qtyTz.get(lineKey(l.productionOrderId, l.color, l.size));
            return (
              <RowCard
                key={l.id}
                title={labelOf(l)}
                href={`/production/${l.productionOrder.id}`}
                subtitle={[l.productionOrder.productModel.name, l.color, l.size ? `р. ${l.size}` : "", l.furKind].filter(Boolean).join(" · ")}
                fields={[
                  { label: "В этой отгрузке, шт.", value: formatQty(l.quantity), strong: true },
                  { label: "В ТЗ, шт.", value: inTz != null ? formatQty(inTz) : "—" },
                  { label: "Принято / не принято / возвращено", value: a ? `${a.accepted} / ${a.rejected} / ${a.returned}` : "—" },
                  { label: "Комментарий", value: l.comment ?? "—" },
                ]}
                extra={
                  canEdit ? (
                    <div className="flex items-center gap-1">
                      <LineEdit v={{ id: l.id, label: lineText(l), quantity: l.quantity, size: l.size ?? "", comment: l.comment ?? "" }} />
                      <LineDelete id={l.id} label={lineText(l)} blockedReason={touched.has(l.id) ? "Нельзя удалить: по строке есть приёмка" : null} />
                      {touched.has(l.id) && <span className="text-[11px] text-neutral-500">есть приёмка</span>}
                    </div>
                  ) : undefined
                }
              />
            );
          })}
          {lines.length === 0 && <p className="py-6 text-center text-sm text-neutral-500">Состав пока пуст</p>}
        </ResponsiveRows>
      </section>

      {/* в) хронология */}
      <section className="flex flex-col gap-2" aria-label="Хронология">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="block-title">
            Хронология <span className="font-normal text-neutral-500">({sorted.length})</span>
          </h2>
          {canEdit && <NewEventButton shipmentId={s.id} lines={briefs} users={pickable} titles={titles} />}
        </div>
        {sorted.length === 0 ? (
          <p className="rounded-lg border border-dashed border-neutral-300 bg-white px-4 py-8 text-center text-sm text-neutral-500">
            Этапов пока нет{canEdit ? " — добавьте первый кнопкой «+ Этап»: что произошло, когда и кто отвечает" : ""}.
          </p>
        ) : (
          <ol className="flex flex-col">
            {sorted.map((e, i) => {
              const note = notes[i];
              const docs = parseDocLinks(e.docLinks);
              const resp = respText(e);
              return (
                <li key={e.id} data-event={e.id}>
                  {note && (
                    <div className="ml-4 border-l-2 border-neutral-200 py-1.5 pl-3 text-xs text-neutral-400" data-interval>
                      {note.text}
                      {note.exact && note.fromTitle ? ` · от этапа «${note.fromTitle}»: ${note.exact}` : ""}
                    </div>
                  )}
                  <article className={"rounded-lg border p-3 text-sm " + (e.expected ? "border-dashed border-neutral-300 bg-neutral-50 text-neutral-500" : "border-neutral-200 bg-white")}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className={"break-words font-semibold " + (e.expected ? "text-neutral-600" : "text-neutral-900")}>
                          {e.title} {e.expected && <Badge variant="default">ожидается</Badge>}
                        </h3>
                        <p className="mt-0.5 text-xs text-neutral-600">
                          <span className="tabular-nums">{fmtWall(e.occurredAt, e.timeKnown)}</span>
                          {!e.timeKnown && <span className="text-neutral-400"> · время не указано</span>}
                          {resp && <> · ответственный: <span className="font-medium">{resp}</span></>}
                          {e.place && <> · {e.place}</>}
                        </p>
                      </div>
                      {canEdit && <EventActions v={values(e)} lines={briefs} users={pickable} titles={titles} />}
                    </div>
                    {e.details && <p className="mt-2 whitespace-pre-wrap">{e.details}</p>}
                    {e.lines.length > 0 && (
                      <div className="mt-2 overflow-x-auto rounded-md border border-neutral-200 bg-white text-neutral-800">
                        <table className="w-full min-w-[520px] text-xs">
                          <thead className="bg-neutral-50 text-left text-neutral-500">
                            <tr>
                              <th className="px-2 py-1.5">Строка</th>
                              <th className="px-2 py-1.5 text-right">По сколько шт.</th>
                              <th className="px-2 py-1.5 text-right">Принято</th>
                              <th className="px-2 py-1.5 text-right">Не принято</th>
                              <th className="px-2 py-1.5 text-right">Возвращено</th>
                              <th className="px-2 py-1.5">Комментарий</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-neutral-100">
                            {e.lines.map((el) => {
                              const l = lineById.get(el.shipmentLineId);
                              return (
                                <tr key={el.id}>
                                  <td className="px-2 py-1.5">{l ? lineText(l) : "—"}</td>
                                  <td className="px-2 py-1.5 text-right tabular-nums">{el.qty ?? "—"}</td>
                                  <td className="px-2 py-1.5 text-right tabular-nums">{el.accepted ?? "—"}</td>
                                  <td className="px-2 py-1.5 text-right tabular-nums">{el.rejected ?? "—"}</td>
                                  <td className="px-2 py-1.5 text-right tabular-nums">{el.returned ?? "—"}</td>
                                  <td className="px-2 py-1.5">{el.comment ?? ""}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {docs.length > 0 && (
                      <ul className="mt-2 flex flex-col gap-0.5 text-xs">
                        {docs.map((d, k) => (
                          <li key={k}>
                            Документ:{" "}
                            {d.href ? <a href={d.href} target="_blank" rel="noopener noreferrer" className="text-blue-700 hover:underline">{d.text}</a> : d.text}
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="mt-2 text-[11px] text-neutral-400">
                      внёс: {userName.get(e.createdById) ?? (e.createdById.startsWith("script:") ? "скрипт (пример)" : "—")}, {stamp(e.createdAt)}
                      {e.updatedById && e.updatedAt.getTime() - e.createdAt.getTime() > 1000 ? ` · изменил: ${userName.get(e.updatedById) ?? "—"}, ${stamp(e.updatedAt)}` : ""}
                    </p>
                  </article>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <p className="text-xs text-neutral-500">Отгрузка — журнал пути партии: она ничего не списывает и не меняет остатки и себестоимость.</p>
    </div>
  );
}
