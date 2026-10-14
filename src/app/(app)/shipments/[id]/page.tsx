import { Breadcrumbs } from "@/components/breadcrumbs";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { ArticleName } from "@/components/article-name";
import { Badge } from "@/components/ui/badge";
import { SummaryTiles } from "../../production/summary-tiles";
import { formatDate, formatQty, formatShare } from "@/lib/utils";
import { orderLabel, orderHint } from "@/lib/order-label";
import { loadTzPositions } from "@/lib/order-label-db";
import { ORDER_COLORS_INCLUDE } from "@/lib/order-colors";
import { orderSortKey, SHIPMENT_STATUS } from "@/lib/shipments";
import {
  candidateRows, compareEvents, deliverySummary, fmtWall, groupByOrder, groupEventsByDay, intervalNotes, isAcceptanceEvent, lineKey, parseDocLinks, shareOf, shipmentTotals,
  SIDE_LABEL, wallDateIso, wallDateRu, wallNow, wallTimeHm,
} from "@/lib/shipment-calc";
import { HeaderDelete, HeaderEdit } from "./header-ui";
import { AcceptList, AddLinesButton, LinesTable, type LineRow } from "./lines-ui";
import { STAGE_LABEL } from "@/lib/shipment-stage";
import { loadShipmentPeople } from "@/lib/shipment-data";
import { CreateAcceptanceButton, ClampText, DocRemove, EventActions, NewEventButton, SummaryShell, type EventValues } from "./event-ui";

export const metadata = { title: "Отгрузка" };
const EDIT_ROLES = ["OWNER", "ADMIN", "TECHNOLOGIST"];

const stamp = (d: Date) =>
  d.toLocaleString("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

const Clip = () => (
  <svg aria-hidden viewBox="0 0 16 16" className="inline h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.5 4.5 5.8 9.2a1.6 1.6 0 0 0 2.3 2.3l4.4-4.4a3 3 0 0 0-4.2-4.2L3.8 7.3a4.4 4.4 0 0 0 6.2 6.2l3-3" />
  </svg>
);

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
          reworks: { orderBy: { createdAt: "asc" } },
          productionOrder: {
            select: {
              id: true, number: true, workOrderNumber: true, size: true, color: true, plannedQuantity: true,
              productModel: { select: { id: true, name: true, category: true, salesCode: true, salesName: true } },
              ...ORDER_COLORS_INCLUDE,
            },
          },
        },
      },
      events: { include: { documents: { select: { id: true, title: true, storagePath: true } } } },
    },
  });
  if (!s) notFound();

  const [users, titleGroups, nameGroups, people, batchChoices, suppliers] = await Promise.all([
    prisma.user.findMany({ where: { organizationId: orgId }, select: { id: true, name: true, isActive: true }, orderBy: { name: "asc" } }),
    prisma.shipmentEvent.groupBy({ by: ["title"], where: { shipment: { organizationId: orgId } }, _count: { _all: true }, orderBy: { _count: { title: "desc" } }, take: 60 }),
    prisma.shipmentEvent.groupBy({ by: ["responsibleName"], where: { shipment: { organizationId: orgId }, responsibleName: { not: null } }, _count: { _all: true }, orderBy: { _count: { responsibleName: "desc" } }, take: 60 }),
    loadShipmentPeople(orgId),
    canEdit ? prisma.productionBatch.findMany({ where: { organizationId: orgId }, select: { id: true, number: true, name: true, year: true }, orderBy: { number: "desc" } }) : Promise.resolve([]),
    canEdit ? prisma.supplier.findMany({ where: { organizationId: orgId, isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : Promise.resolve([]),
  ]);
  const userName = new Map(users.map((u) => [u.id, u.name]));
  const titles = titleGroups.map((g) => g.title);
  // Подсказки для «Ответственный»: сотрудники приложения и ранее вписанные имена.
  const names = [...new Set([...users.filter((u) => u.isActive).map((u) => u.name), ...nameGroups.map((g) => g.responsibleName).filter((x): x is string => !!x)])];

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
  // Итоги — только по строкам отгрузки (принято / возврат), этапы в них не участвуют.
  // «К отгрузке» и приёмка — только по строкам «Готов к отгрузке» (список приёмки в Коптево); остальное — на просмотре / доработке.
  const readyLines = lines.filter((l) => l.stage === "READY");
  const totals = shipmentTotals(readyLines);
  const allQty = lines.reduce((t, l) => t + l.quantity, 0);
  const reworkQty = lines.filter((l) => l.stage === "REWORK").reduce((t, l) => t + l.quantity, 0);
  const reviewQty = lines.filter((l) => l.stage === "REVIEW").reduce((t, l) => t + l.quantity, 0);
  const lineText = (l: (typeof lines)[number]) => [labelOf(l), l.productionOrder.productModel.name, l.color, l.size ? `р. ${l.size}` : ""].filter(Boolean).join(" · ");

  const lineRows: LineRow[] = lines.map((l, i) => ({
    id: l.id,
    n: i + 1,
    orderText: `${labelOf(l)} ${l.productionOrder.workOrderNumber ?? ""} ${l.productionOrder.number}`,
    articleText: [l.productionOrder.productModel.name, l.productionOrder.productModel.salesCode ?? "", l.productionOrder.productModel.salesName ?? ""].join(" "),
    itemNo: l.itemNo ?? "",
    stage: l.stage,
    stageNote: l.stageChangedAt ? `${STAGE_LABEL[l.stage]}: ${(l.stageChangedBy ? userName.get(l.stageChangedBy) ?? l.stageChangedBy : "—")}, ${stamp(l.stageChangedAt)}` : "",
    reworks: l.reworks.map((r) => ({
      id: r.id, text: r.text, state: r.state, note: r.note ?? "",
      created: `${userName.get(r.createdById) ?? "—"}, ${stamp(r.createdAt)}`,
      updated: r.updatedById ? `${userName.get(r.updatedById) ?? "—"}, ${stamp(r.updatedAt)}` : "",
    })),
    order: <Link href={`/production/${l.productionOrder.id}`} title={orderHint(l.productionOrder)} className="font-medium hover:underline">{labelOf(l)}</Link>,
    article: <Link href={`/models/${l.productionOrder.productModel.id}`} className="hover:underline"><ArticleName model={l.productionOrder.productModel} /></Link>,
    color: l.color,
    size: l.size,
    furKind: l.furKind,
    inTz: qtyTz.get(lineKey(l.productionOrderId, l.color, l.size)) ?? null,
    quantity: l.quantity,
    accepted: l.acceptedQty,
    returned: l.returnedQty,
    comment: l.comment ?? "",
    label: lineText(l),
    blockedReason: (l.acceptedQty ?? 0) > 0 || (l.returnedQty ?? 0) > 0 ? "Нельзя удалить: по строке есть приёмка" : null,
    title: labelOf(l),
    href: `/production/${l.productionOrder.id}`,
    subtitle: [l.productionOrder.productModel.name, l.color, l.size ? `р. ${l.size}` : "", l.furKind].filter(Boolean).join(" · "),
  }));

  const sorted = [...s.events].sort(compareEvents);
  const notes = intervalNotes(sorted);
  const dayGroups = groupEventsByDay(sorted, wallDateIso(wallNow()));
  const respText = (e: (typeof sorted)[number]) => (e.responsibleUserId ? userName.get(e.responsibleUserId) : null) ?? e.responsibleName ?? "";

  const values = (e: (typeof sorted)[number]): EventValues => ({
    id: e.id,
    title: e.title,
    date: wallDateIso(e.occurredAt),
    time: e.timeKnown ? wallTimeHm(e.occurredAt) : "",
    side: e.side ?? "",
    responsible: respText(e),
    place: e.place ?? "",
    details: e.details ?? "",
    docLinks: e.docLinks ?? "",
    expected: e.expected,
    version: e.updatedAt.toISOString(),
  });

  const name = s.name ?? `Отгрузка на ${formatDate(s.plannedDate)}`;
  const batchText = s.batch ? `Партия ${s.batch.number}${s.batch.year ? ` · ${s.batch.year}` : ""}${s.batch.name ? ` · ${s.batch.name}` : ""}` : "";
  const sharePct = (part: number) => {
    const v = shareOf(part, totals.inShipment);
    return v == null ? undefined : formatShare(v);
  };

  // Приёмка: ожидаемый этап приёмки (по названию / месту), панель с кнопкой «ПРИНЯТО» и итог поставки.
  const acceptEvent = s.acceptedAt ? null : sorted.find((e) => isAcceptanceEvent(e)) ?? null;
  const acceptRows = lineRows.filter((r) => r.stage === "READY").map((r) => ({ label: r.label, quantity: r.quantity, accepted: r.accepted, returned: r.returned, comment: r.comment }));
  const summary = s.acceptedAt
    ? deliverySummary({ plannedDate: s.plannedDate, acceptedAt: s.acceptedAt, acceptEventId: s.acceptEventId, events: s.events })
    : null;
  const groups = summary ? groupByOrder(readyLines.map((l) => ({ orderKey: l.productionOrderId, label: labelOf(l), article: l.productionOrder.productModel.name, quantity: l.quantity, acceptedQty: l.acceptedQty, returnedQty: l.returnedQty, comment: l.comment }))) : [];
  const returnLines = readyLines.filter((l) => (l.returnedQty ?? 0) > 0);
  const reworkedLines = lines.filter((l) => l.reworks.length > 0);
  const accEv = s.acceptEventId ? s.events.find((e) => e.id === s.acceptEventId) : null;
  const status = SHIPMENT_STATUS[s.status];

  return (
    <div className="flex flex-col gap-5">
      <Breadcrumbs items={[{ label: "Отгрузки", href: "/shipments" }, { label: name }]} />

      {/* а) шапка */}
      <section className="flex flex-col gap-3" aria-label="Шапка отгрузки">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold">
            {name}
            {s.status === "ACCEPTED" && status ? <Badge variant={status.variant}>{status.label}</Badge> : null}
          </h1>
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
      </section>

      {/* б) виджеты и «Примерка» — один сворачиваемый контейнер: «Свернуть» прячет и плитки, и таблицу примерки */}
      <SummaryTiles
        id="shipment"
        title="Отгрузка — итоги"
        tiles={[
          { key: "in", label: "К отгрузке, шт.", value: formatQty(totals.inShipment), caption: `${formatQty(readyLines.length)} из ${formatQty(lines.length)} строк · из ${formatQty(allQty)} на примерке${reworkQty ? `; на доработке ${formatQty(reworkQty)}` : ""}${reviewQty ? `; на просмотре ${formatQty(reviewQty)}` : ""}` },
          { key: "acc", label: "Принято, шт.", value: formatQty(totals.accepted), caption: sharePct(totals.accepted) ? `${sharePct(totals.accepted)} от «К отгрузке»` : undefined, hint: <p>Сумма колонки «Принято» в блоке «Приёмка в Коптево» (сохранённые значения).</p> },
          {
            key: "ret",
            label: "Не принято, шт.",
            value: formatQty(totals.returned),
            caption: [sharePct(totals.returned), `ещё ждёт приёмки: ${formatQty(totals.remaining)} шт.`].filter(Boolean).join(" · "),
            hint: <p>Сумма колонки «Возврат»: возвращено поставщику / не принято. «Ещё ждёт приёмки» — по каждой строке: в отгрузке минус принято и минус возврат, не меньше нуля.</p>,
          },
        ]}
        collapseWith={
          <LinesTable
            shipmentId={s.id}
            rows={lineRows}
            canEdit={canEdit}
            addButton={<AddLinesButton shipmentId={s.id} />}
            hint={<p>Список изделий, показанных на примерке; здесь по каждой строке отмечается просмотр: «Принято» (устраивает полностью) или «На доработку». Строки берутся из позиций загруженных ТЗ: цвет, размер и вид меха — копия на момент добавления. Принятие в Коптево («Принято» / «Не принято» и причина) — в блоке «Приёмка в Коптево» под хронологией, только для строк «Готов к отгрузке».</p>}
          />
        }
      />


      {/* в) хронология */}
      <section className="flex flex-col gap-2" aria-label="Хронология">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="block-title">
            Хронология <span className="font-normal text-neutral-500">({sorted.length})</span>
          </h2>
          {canEdit && <NewEventButton shipmentId={s.id} titles={titles} people={people} />}
        </div>
        {sorted.length === 0 ? (
          <p className="rounded-lg border border-dashed border-neutral-300 bg-white px-4 py-8 text-center text-sm text-neutral-500">
            Этапов пока нет{canEdit ? " — добавьте первый кнопкой «+ Этап»: что произошло, когда и на ком" : ""}.
          </p>
        ) : (
          <div className="relative rounded-lg border border-neutral-200 bg-white py-3 pl-8 pr-3" data-timeline>
            <div aria-hidden className="absolute bottom-4 left-[0.9375rem] top-4 w-px bg-neutral-200" />
            {dayGroups.map((g) => (
              <section key={g.day} className="relative" data-day={g.day} data-day-kind={g.kind} aria-label={g.heading}>
                <h3 className="relative flex items-center gap-2 py-1.5 text-xs">
                  <span aria-hidden className={"absolute -left-[1.1875rem] top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full " + (g.kind === "today" ? "bg-neutral-800" : "bg-neutral-300")} />
                  <span className={g.kind === "today" ? "font-semibold text-neutral-900" : g.kind === "upcoming" ? "font-medium text-neutral-400" : "font-medium text-neutral-600"}>{g.heading}</span>
                  {g.kind === "today" && <span className="rounded bg-neutral-900 px-1.5 py-0.5 text-[10px] font-medium text-white">сегодня</span>}
                  {g.kind === "upcoming" && <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-normal text-neutral-500">ожидается</span>}
                </h3>
                <ol className="flex flex-col">
                  {g.items.map(({ event: e, index: i }) => {
                    const note = notes[i];
                    const docs = parseDocLinks(e.docLinks);
                    const resp = respText(e);
                    const side = e.side && SIDE_LABEL[e.side] ? e.side : null;
                    const tone = side === "WELLMEKH" ? { dot: "bg-sky-600 border-sky-600", ring: "border-sky-400", badge: "bg-sky-50 text-sky-800" } : side === "CUM" ? { dot: "bg-emerald-600 border-emerald-600", ring: "border-emerald-400", badge: "bg-emerald-50 text-emerald-800" } : { dot: "bg-neutral-400 border-neutral-400", ring: "border-neutral-300", badge: "bg-neutral-100 text-neutral-500" };
                    const author = userName.get(e.createdById) ?? (e.createdById.startsWith("script:") ? "скрипт (пример)" : "—");
                    const trail = `внёс: ${author}, ${stamp(e.createdAt)}${e.updatedById && e.updatedAt.getTime() - e.createdAt.getTime() > 1000 ? ` · изменил: ${userName.get(e.updatedById) ?? "—"}, ${stamp(e.updatedAt)}` : ""}`;
                    const time = e.timeKnown ? wallTimeHm(e.occurredAt) : null;
                    return (
                      <li key={e.id} data-event={e.id} data-expected={e.expected ? "1" : "0"}>
                        {note && (
                          <div className="py-1.5 text-[11px] leading-tight text-neutral-400" data-interval>
                            {note.text}
                            {note.exact && note.fromTitle ? ` · от «${note.fromTitle}»: ${note.exact}` : ""}
                          </div>
                        )}
                        <div className="relative">
                          {e.expected ? (
                            <span aria-hidden data-marker="expected" className="absolute -left-[1.5rem] top-4 flex h-3.5 w-3.5 items-center justify-center">
                              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-orange-400/60 motion-reduce:animate-none" />
                              <span className="relative inline-flex h-3.5 w-3.5 rounded-full border-2 border-orange-500 bg-white" />
                            </span>
                          ) : (
                            <span aria-hidden data-marker="done" className="absolute -left-[1.5rem] top-4 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-emerald-600">
                              <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 6.5l2.5 2.5 4.5-5" /></svg>
                            </span>
                          )}
                          <div className={"flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:gap-4 " + (e.expected ? "border-dashed border-orange-300 bg-neutral-50/60 text-neutral-400" : "border-neutral-200 bg-white shadow-sm")} title={fmtWall(e.occurredAt, e.timeKnown)}>
                            <div className="flex shrink-0 flex-col items-start gap-0.5 tabular-nums sm:w-28" data-event-side>
                              <span data-left="side" className={"rounded px-1.5 py-0.5 text-[11px] font-medium " + (e.expected ? "bg-neutral-100 text-neutral-400" : tone.badge)}>{side ? SIDE_LABEL[side] : "не указано"}</span>
                              <span data-left="date" className={"text-[11px] " + (e.expected ? "text-neutral-400" : "text-neutral-600")}>{wallDateRu(e.occurredAt)}</span>
                              <span data-left="time" className={"text-lg font-semibold leading-tight " + (e.expected ? "text-neutral-400" : "text-neutral-900")}>
                                {time ?? <span className="text-[10px] font-normal text-neutral-400">время не указано</span>}
                              </span>
                              <span data-left="who" className="text-[11px] text-neutral-500" title="Автор / ответственный действия">{resp || "—"}</span>
                            </div>
                            <div aria-hidden className="h-px w-full shrink-0 bg-neutral-200 sm:h-auto sm:w-px" data-event-divider />
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
                                <h4 className={"min-w-[10rem] flex-1 break-words text-sm font-semibold " + (e.expected ? "text-neutral-500" : "text-neutral-900")}>
                                  {e.title}
                                  {e.expected ? <span className="ml-2 rounded bg-orange-50 px-1.5 py-0.5 text-[11px] font-normal text-orange-700">ожидается</span> : <span className="ml-2 text-[11px] font-normal text-emerald-700" data-passed>пройдено</span>}
                                  <span className="ml-1.5 cursor-help rounded-full border border-neutral-300 px-1 text-[10px] font-normal text-neutral-400" title={trail} aria-label={trail} tabIndex={0}>i</span>
                                </h4>
                                {canEdit && <EventActions v={values(e)} titles={titles} people={people} canDone={!isAcceptanceEvent(e)} />}
                              </div>
                              {e.details && <ClampText text={e.details} />}
                              {e.place && <p className="mt-0.5 text-[11px] text-neutral-500" data-place>место: {e.place}</p>}
                              {(e.documents.length > 0 || docs.length > 0) && (
                                <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                                  {e.documents.map((d) => (
                                    <li key={d.id} className="flex items-center">
                                      <Clip />
                                      <a href={`/api/drive-docs/${d.id}`} target="_blank" rel="noopener noreferrer" className="ml-1 max-w-[16rem] truncate text-blue-700 hover:underline" title={d.title}>{d.title}</a>
                                      {canEdit && <DocRemove id={d.id} title={d.title} />}
                                    </li>
                                  ))}
                                  {docs.map((d, k) => (
                                    <li key={k} className="flex items-center">
                                      <Clip />
                                      {d.href ? <a href={d.href} target="_blank" rel="noopener noreferrer" className="ml-1 max-w-[16rem] truncate text-blue-700 hover:underline">{d.text}</a> : <span className="ml-1">{d.text}</span>}
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </section>
            ))}
          </div>
        )}

        <AcceptList
          shipmentId={s.id}
          rows={lineRows}
          canEdit={canEdit}
          waiting={{ rework: reworkQty, review: reviewQty }}
          event={acceptEvent ? { id: acceptEvent.id, stamp: fmtWall(acceptEvent.occurredAt, acceptEvent.timeKnown) } : null}
          closed={s.acceptedAt && summary ? `${summary.accepted.stamp}${s.acceptedBy ? `, принял ${s.acceptedBy}` : ""}` : null}
          closeProps={{ rows: acceptRows, totals, names }}
          createEvent={canEdit ? <CreateAcceptanceButton shipmentId={s.id} /> : null}
        />

        {s.acceptedAt && summary && (
          <SummaryShell
            shipmentId={s.id}
            canEdit={canEdit}
            subtitle={`${summary.accepted.title} · ${summary.accepted.stamp}${s.acceptedBy ? ` · принял: ${s.acceptedBy}` : ""}${accEv?.side ? ` · на ком: ${SIDE_LABEL[accEv.side] ?? accEv.side}` : ""}`}
          >
            <div>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">Объёмы</h3>
              <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div><dt className="text-xs text-neutral-500">К отгрузке</dt><dd className="text-lg font-semibold tabular-nums">{formatQty(totals.inShipment)} шт.</dd></div>
                <div><dt className="text-xs text-neutral-500">Принято</dt><dd className="text-lg font-semibold tabular-nums">{formatQty(totals.accepted)} шт.<span className="ml-1 text-xs font-normal text-neutral-500">{sharePct(totals.accepted) ?? ""}</span></dd></div>
                <div><dt className="text-xs text-neutral-500">Возврат (не принято)</dt><dd className="text-lg font-semibold tabular-nums">{formatQty(totals.returned)} шт.<span className="ml-1 text-xs font-normal text-neutral-500">{sharePct(totals.returned) ?? ""}</span></dd></div>
                <div><dt className="text-xs text-neutral-500">Ещё ждёт приёмки</dt><dd className="text-lg font-semibold tabular-nums">{formatQty(totals.remaining)} шт.</dd></div>
              </dl>
              {allQty - totals.inShipment > 0 && (
                <p className="mt-2 text-sm text-neutral-700" data-not-in-list>Не вошло в список приёмки (на доработке / просмотре): <span className="font-medium tabular-nums">{formatQty(allQty - totals.inShipment)} шт.</span></p>
              )}
              <div className="mt-3 overflow-x-auto rounded-md border border-neutral-200 bg-white">
                <table className="w-full min-w-[560px] text-xs">
                  <thead className="bg-neutral-50 text-left text-neutral-500">
                    <tr><th className="px-2 py-1.5">ТЗ</th><th className="px-2 py-1.5">Артикул</th><th className="px-2 py-1.5 text-right">К отгрузке</th><th className="px-2 py-1.5 text-right">Принято</th><th className="px-2 py-1.5 text-right">Не принято</th><th className="px-2 py-1.5">Причина</th></tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {groups.map((g) => (
                      <tr key={g.key}>
                        <td className="whitespace-nowrap px-2 py-1.5">{g.label}</td>
                        <td className="px-2 py-1.5">{g.article}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{formatQty(g.quantity)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{formatQty(g.accepted)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{g.returned ? formatQty(g.returned) : "—"}</td>
                        <td className="px-2 py-1.5">{g.reasons.join("; ")}</td>
                      </tr>
                    ))}
                    <tr className="bg-neutral-50 font-medium">
                      <td className="px-2 py-1.5" colSpan={2}>Всего, шт.</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{formatQty(totals.inShipment)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{formatQty(totals.accepted)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{formatQty(totals.returned)}</td>
                      <td />
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {reworkedLines.length > 0 && (
              <p className="text-sm" data-reworked>Прошли доработку: <span className="font-medium">{reworkedLines.length} {reworkedLines.length === 1 ? "строка" : reworkedLines.length % 10 >= 2 && reworkedLines.length % 10 <= 4 && (reworkedLines.length % 100 < 12 || reworkedLines.length % 100 > 14) ? "строки" : "строк"}</span></p>
            )}

            <div>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">Сроки</h3>
              <dl className="grid grid-cols-[10rem_1fr] gap-y-1 text-sm sm:grid-cols-[14rem_1fr]">
                <dt className="text-neutral-500">Первая запись → приёмка</dt>
                <dd>{summary.firstToAccept ? <><span className="font-medium">{summary.firstToAccept}</span> <span className="text-xs text-neutral-500">({summary.first?.title}, {summary.first?.stamp} → {summary.accepted.stamp})</span></> : "—"}</dd>
                <dt className="text-neutral-500">План → факт</dt>
                <dd><span className="tabular-nums">{summary.plan.planned} → {summary.plan.actual}</span> · <span className={"font-medium " + (summary.plan.days > 0 ? "text-red-700" : "text-emerald-800")}>{summary.plan.text}</span></dd>
                {summary.chain.length > 0 && (
                  <>
                    <dt className="text-neutral-500">Ключевые интервалы</dt>
                    <dd>
                      <ul className="flex flex-col gap-0.5">
                        {summary.chain.map((c, k) => (
                          <li key={k}>{c.from} → {c.to}: <span className="font-medium">{c.text}</span></li>
                        ))}
                      </ul>
                    </dd>
                  </>
                )}
              </dl>
            </div>

            <div>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">Следующие действия</h3>
              {returnLines.length === 0 ? (
                <p className="text-sm text-neutral-600">Возвратов нет — действий не требуется.</p>
              ) : (
                <ul className="flex flex-col gap-1 text-sm">
                  {returnLines.map((l) => (
                    <li key={l.id}>
                      <span className="font-medium">{lineText(l)}</span> — {formatQty(l.returnedQty ?? 0)} шт.: {l.comment ? l.comment : <span className="text-neutral-500">причина не указана</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </SummaryShell>
        )}
      </section>

      <p className="text-xs text-neutral-500">Отгрузка — журнал пути партии: она ничего не списывает и не меняет остатки и себестоимость.</p>
    </div>
  );
}
