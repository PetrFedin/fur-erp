import { SupplierMarks, type MarkLine } from "./marks-ui";
import { MARKS_TITLE, markOf } from "@/lib/shipment-marks";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { ChatLink, GroupLink } from "@/components/chat-link";
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
  ACCEPTANCE_TITLE, FITTING_TITLE, candidateRows, compareEvents, deliverySummary, fmtWall, groupEventsByDay, intervalNotes, isAcceptanceEvent, lineKey, parseDocLinks, shareOf, shipmentTotals,
  SIDE_LABEL, wallDateIso, wallDateRu, wallNow, wallTimeHm,
} from "@/lib/shipment-calc";
import { HeaderDelete, HeaderEdit } from "./header-ui";
import { TimelineSection } from "./timeline-section";
import { AddLinesButton, LinesTable, type LineRow } from "./lines-ui";
import { STAGE_LABEL } from "@/lib/shipment-stage";
import { loadShipmentPeople } from "@/lib/shipment-data";
import { ZiSupplies } from "./zi-section";
import { loadOrdersDrill } from "@/lib/orders-drill";
import { sumOrders, sumTotal } from "@/lib/orders-sum";
import { loadZi } from "@/lib/shipment-zi-db";
import { matchZi, ziForSupplier, ziStatus, ZI_SOURCE_NOTE, ZI_STAFF_ROLES } from "@/lib/shipment-zi";
import { CreateAcceptanceButton, ClampText, DocRemove, EventActions, NewEventButton, type EventValues } from "./event-ui";

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
  const session = await requireSession({ allowSupplier: true });
  const orgId = session.user.organizationId;
  const canEdit = EDIT_ROLES.includes(session.user.role);
  // Внешний поставщик: только свои отгрузки, свои этапы хронологии, без ссылок на закрытые разделы.
  const isSupplier = session.user.role === "SUPPLIER";
  const canEvents = canEdit || isSupplier;

  const s = await prisma.shipment.findFirst({
    where: { id, organizationId: orgId, ...(isSupplier ? { supplierId: session.user.supplierId ?? "-" } : {}) },
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
      events: { include: { documents: { select: { id: true, title: true, storagePath: true, notes: true } } } },
    },
  });
  if (!s) notFound();
  // Исходные файлы накладных ЦУМ (с ценами) — только нашей стороне.
  if (!ZI_STAFF_ROLES.includes(session.user.role)) for (const e of s.events) e.documents = e.documents.filter((d) => d.notes !== ZI_SOURCE_NOTE);

  const [users, titleGroups, nameGroups, people, batchChoices, suppliers] = await Promise.all([
    prisma.user.findMany({ where: { organizationId: orgId }, select: { id: true, name: true, isActive: true, role: true, supplier: { select: { name: true } } }, orderBy: { name: "asc" } }),
    prisma.shipmentEvent.groupBy({ by: ["title"], where: { shipment: { organizationId: orgId, ...(isSupplier ? { supplierId: s.supplierId } : {}) } }, _count: { _all: true }, orderBy: { _count: { title: "desc" } }, take: 60 }),
    prisma.shipmentEvent.groupBy({ by: ["responsibleName"], where: { shipment: { organizationId: orgId }, responsibleName: { not: null } }, _count: { _all: true }, orderBy: { _count: { responsibleName: "desc" } }, take: 60 }),
    loadShipmentPeople(orgId).then((p) => (isSupplier ? { WELLMEKH: p.WELLMEKH ?? [] } : p)),
    canEdit ? prisma.productionBatch.findMany({ where: { organizationId: orgId }, select: { id: true, number: true, name: true, year: true }, orderBy: { number: "desc" } }) : Promise.resolve([]),
    canEdit ? prisma.supplier.findMany({ where: { organizationId: orgId, isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : Promise.resolve([]),
  ]);
  // Автор-поставщик показывается названием компании («Веллмех»), а не именем служебной учётной записи.
  // Поставщику имена наших сотрудников не показываем: вместо них «ЦУМ».
  const userName = new Map(users.map((u) => [u.id, u.role === "SUPPLIER" ? u.supplier?.name ?? "Подрядчик" : isSupplier ? "ЦУМ" : u.name]));
  // Подсказки названий этапа: «Примерка» и «Приёмка в Коптево» есть всегда, дальше — ранее использованные.
  const titles = [...new Set([FITTING_TITLE, ACCEPTANCE_TITLE, ...titleGroups.map((g) => g.title)])];
  // Подсказки для «Ответственный»: сотрудники приложения и ранее вписанные имена.
  const names = [...new Set([...users.filter((u) => u.isActive && u.role !== "SUPPLIER" && !isSupplier).map((u) => u.name), ...nameGroups.map((g) => g.responsibleName).filter((x): x is string => !!x)])];

  // Строка без ТЗ — «свой» артикул (productionOrder пусто, название в customArticle).
  const orders = [...new Map(s.lines.flatMap((l) => (l.productionOrder ? [[l.productionOrder.id, l.productionOrder] as const] : []))).values()];
  const pos = await loadTzPositions(orgId, orders);
  const labelOf = (l: (typeof s.lines)[number]) => (l.productionOrder ? orderLabel({ workOrderNumber: l.productionOrder.workOrderNumber, number: l.productionOrder.number, ...pos.get(l.productionOrder.id) }) : "без ТЗ");
  const articleOfLine = (l: (typeof s.lines)[number]) => l.productionOrder?.productModel.name ?? l.customArticle ?? "—";

  // «В ТЗ» — сколько штук по этой строке (цвет, размер) записано в самом ТЗ.
  const qtyTz = new Map<string, number>();
  for (const o of orders) {
    for (const r of candidateRows({ ...o, plannedQuantity: Number(o.plannedQuantity) })) qtyTz.set(lineKey(o.id, r.color, r.size), r.qty);
  }

  const markRows = await prisma.shipmentEventLine.findMany({ where: { event: { shipmentId: s.id, title: MARKS_TITLE } }, select: { shipmentLineId: true, accepted: true, rejected: true, comment: true, event: { select: { occurredAt: true, timeKnown: true } } } });
  const markBy = new Map(markRows.map((m) => [m.shipmentLineId, markOf(m)]));
  const markStamp = markRows[0] ? fmtWall(markRows[0].event.occurredAt, markRows[0].event.timeKnown) : "";

  const lines = [...s.lines].sort(
    (a, b) =>
      (a.productionOrder ? orderSortKey(a.productionOrder) : Number.MAX_SAFE_INTEGER) - (b.productionOrder ? orderSortKey(b.productionOrder) : Number.MAX_SAFE_INTEGER) ||
      (a.productionOrder?.number ?? a.customArticle ?? "").localeCompare(b.productionOrder?.number ?? b.customArticle ?? "", "ru", { numeric: true }) ||
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
  const lineText = (l: (typeof lines)[number]) => [labelOf(l), articleOfLine(l), l.color, l.size ? `р. ${l.size}` : ""].filter(Boolean).join(" · ");

  const lineRows: LineRow[] = lines.map((l, i) => ({
    id: l.id,
    n: i + 1,
    orderText: `${labelOf(l)} ${l.productionOrder?.workOrderNumber ?? ""} ${l.productionOrder?.number ?? ""}`,
    articleText: [articleOfLine(l), l.productionOrder?.productModel.salesCode ?? "", l.productionOrder?.productModel.salesName ?? ""].join(" "),
    itemNo: l.itemNo ?? "",
    stage: l.stage,
    stageNote: l.stageChangedAt ? `${STAGE_LABEL[l.stage]}: ${(l.stageChangedBy ? userName.get(l.stageChangedBy) ?? l.stageChangedBy : "—")}, ${stamp(l.stageChangedAt)}` : "",
    reworks: l.reworks.map((r) => ({
      id: r.id, text: r.text, state: r.state, note: r.note ?? "",
      created: `${userName.get(r.createdById) ?? "—"}, ${stamp(r.createdAt)}`,
      updated: r.updatedById ? `${userName.get(r.updatedById) ?? "—"}, ${stamp(r.updatedAt)}` : "",
    })),
    order: l.productionOrder ? (isSupplier ? <span title={orderHint(l.productionOrder)} className="font-medium">{labelOf(l)}</span> : <Link href={`/production/${l.productionOrder.id}`} title={orderHint(l.productionOrder)} className="font-medium hover:underline">{labelOf(l)}</Link>) : <span className="text-neutral-500" title="Этого артикула ещё нет в ТЗ">без ТЗ</span>,
    article: l.productionOrder ? (isSupplier ? <ArticleName model={l.productionOrder.productModel} /> : <Link href={`/models/${l.productionOrder.productModel.id}`} className="hover:underline"><ArticleName model={l.productionOrder.productModel} /></Link>) : <span>{l.customArticle}</span>,
    color: l.color,
    size: l.size,
    furKind: l.furKind,
    inTz: l.productionOrderId ? qtyTz.get(lineKey(l.productionOrderId, l.color, l.size)) ?? null : null,
    quantity: l.quantity,
    accepted: l.acceptedQty,
    returned: l.returnedQty,
    comment: l.comment ?? "",
    label: lineText(l),
    blockedReason: (l.acceptedQty ?? 0) > 0 || (l.returnedQty ?? 0) > 0 ? "Нельзя удалить: по строке есть приёмка" : null,
    title: labelOf(l),
    href: l.productionOrder && !isSupplier ? `/production/${l.productionOrder.id}` : "",
    subtitle: [articleOfLine(l), l.color, l.size ? `р. ${l.size}` : "", l.furKind].filter(Boolean).join(" · "),
  }));

  const sorted = [...s.events].sort(compareEvents);
  const notes = intervalNotes(sorted);
  const fittingDone = sorted.some((e) => /^примерка/i.test(e.title) && !e.expected);
  const dayGroups = groupEventsByDay(sorted, wallDateIso(wallNow()));
  const respText = (e: (typeof sorted)[number]) => (isSupplier && e.side === "CUM" ? "ЦУМ" : (e.responsibleUserId ? userName.get(e.responsibleUserId) : null) ?? e.responsibleName ?? "");

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
  const batchText = s.batch ? `Партия ${s.batch.number}${s.batch.year ? ` · ${s.batch.year}` : ""}${s.batch.name && !isSupplier ? ` · ${s.batch.name}` : ""}` : "";
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
  const status = SHIPMENT_STATUS[s.status];

  // Накладные ЗИ (приёмка в ЦУМ): подрядчику — без бутиков, сумм и расхождений по ценам.
  const ziRaw = await loadZi(orgId, s.id);
  const ziView = ziRaw ? (() => {
    const zi = isSupplier ? ziForSupplier(ziRaw) : ziRaw;
    const m = matchZi(zi.lines, lines.map((l) => ({ id: l.id, code: l.productionOrder?.productModel.salesCode ?? articleOfLine(l), size: l.size, color: l.color, quantity: l.quantity })));
    const rows = lines.map((l) => {
      const f = m.byLine.get(l.id);
      const inZi = f?.qty ?? 0;
      return {
        id: l.id, label: labelOf(l), article: l.productionOrder?.productModel.salesCode ?? articleOfLine(l), color: l.color ?? "", size: l.size ?? "", quantity: l.quantity, inZi,
        status: ziStatus(l.quantity, inZi), supplies: f?.supplies ?? [],
        ...(isSupplier ? {} : { boutiques: f?.boutiques ?? [], sum: f?.sum ?? 0 }),
      };
    });
    for (const r of lineRows) {
      const f = m.byLine.get(r.id);
      if (f) {
        r.supply = f.supplies.join(", ");
        if (!isSupplier) {
          r.boutique = f.boutiques.join(", "); r.sum = Math.round((f.sum + f.vat) * 100) / 100;
          r.sumSrc = {
            label: r.label,
            items: f.items.map((z) => ({ supply: z.supply, boutique: z.boutique, size: z.size, sheet: z.sheet ?? "MVST", row: z.row ?? null, sum: z.sum, vat: z.vat })),
            zi: zi.supplies.filter((sp) => f.supplies.includes(sp.code)).map((sp) => ({ supply: sp.code, numbers: sp.ziNumbers })),
            files: ZI_STAFF_ROLES.includes(session.user.role) ? (zi.files ?? []).filter((x) => f.supplies.includes(x.supply)) : [],
          };
        }
      }
    }
    return { rows, supplies: zi.supplies, unmatched: m.unmatched.length };
  })() : null;

  // Сверка «накладная ↔ ТЗ» (только наша сторона): сумма накладной с НДС по ТЗ против полной себестоимости ТЗ (с работой, с НДС, с 4%) —
  // той же функцией, что «Стоимость производства» и карточка ТЗ (loadOrdersDrill + sumOrders). Допуск 1 ₽.
  if (ziView && !isSupplier && ZI_STAFF_ROLES.includes(session.user.role)) {
    const woOf = (l: (typeof lines)[number]) => l.productionOrder?.workOrderNumber ?? null;
    const drill = await loadOrdersDrill(orgId, "all", "on", { ids: new Set(orders.map((o) => o.id)) });
    const tzCost = new Map<string, number>();
    for (const d of drill) if (d.wo) tzCost.set(d.wo, (tzCost.get(d.wo) ?? 0) + sumTotal(sumOrders([d], "incl")));
    const inv = new Map<string, number>();
    for (const l of lines) { const wo = woOf(l); const r = lineRows.find((x) => x.id === l.id); if (wo && r?.sum) inv.set(wo, (inv.get(wo) ?? 0) + r.sum); }
    const rub = (n: number) => n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const done = new Set<string>();
    for (const l of lines) {
      const wo = woOf(l); const r = lineRows.find((x) => x.id === l.id);
      if (!wo || !r || !r.sum || !inv.has(wo) || !tzCost.has(wo) || done.has(wo)) continue;
      done.add(wo); // пометка один раз на ТЗ — в первой строке группы
      const tz = Math.round(tzCost.get(wo)! * 100) / 100, iv = Math.round(inv.get(wo)! * 100) / 100, diff = Math.round((tz - iv) * 100) / 100;
      const full = `ТЗ ${wo}: ${rub(tz)} ₽, накладные по ТЗ: ${rub(iv)} ₽ (${diff > 0 ? "+" : "−"}${rub(Math.abs(diff))})`;
      r.check = Math.abs(diff) <= 1 ? { ok: true, text: "= ТЗ", full: `ТЗ ${wo}: ${rub(tz)} ₽ — совпало с накладными (допуск 1 ₽)` } : { ok: false, text: `≠ ТЗ ${diff > 0 ? "+" : "−"}${Math.round(Math.abs(diff)).toLocaleString("ru-RU")}`, full };
      if (r.sumSrc) r.sumSrc.check = full;
    }
  }

  // Шаги новой отгрузки: подсказка с кнопками, пока не заведены состав примерки, этапы и приёмка в Коптево.
  const stepDone = [lines.length > 0, s.events.some((e) => !isAcceptanceEvent({ ...e, expected: true }) && !(e.expected && e.title === FITTING_TITLE)), !!s.acceptedAt || s.events.some((e) => isAcceptanceEvent({ ...e, expected: true }))];
  const fittingEvent = sorted.find((e) => e.expected && e.title === FITTING_TITLE) ?? null;
  const showSteps = canEdit && !s.acceptedAt && stepDone.some((d) => !d);
  const steps = [
    { title: "Примерка", text: fittingEvent ? `назначена на ${wallDateRu(fittingEvent.occurredAt)}. Добавьте артикулы, которые будут смотреть: из ТЗ или свой, если его нет в ТЗ.` : "добавьте артикулы, которые будут смотреть: из ТЗ или свой, если его нет в ТЗ. Дату примерки можно задать этапом «Примерка».", action: <AddLinesButton shipmentId={s.id} /> },
    { title: "Этапы", text: "любые события по порядку: примерка, документы, отправка. Укажите, на ком этап (Веллмех или ЦУМ), кто, когда и что произошло.", action: <NewEventButton shipmentId={s.id} titles={titles} people={people} /> },
    { title: "Приёмка в Коптево", text: "список согласованных к отгрузке артикулов; по каждому — принято или не принято.", action: <CreateAcceptanceButton shipmentId={s.id} /> },
  ];

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
          <ChatLink type="Shipment" id={s.id} role={session.user.role} label={isSupplier ? undefined : "Запросить у Веллмеха"} />
          <GroupLink type="Shipment" id={s.id} role={session.user.role} label="Создать группу" />
          {canEdit && (
            <div className="flex flex-wrap items-start gap-2">
              <HeaderEdit
                v={{ id: s.id, name, supplierId: s.supplierId ?? "", batchId: s.batchId ?? "", plannedDate: wallDateIso(s.plannedDate), notes: s.notes ?? "" }}
                suppliers={suppliers}
                batches={batchChoices.map((b) => ({ id: b.id, label: `Партия ${b.number}${b.year ? ` · ${b.year}` : ""}${b.name ? ` · ${b.name}` : ""}` }))}
              />
              <HeaderDelete id={s.id} name={name} blockedReason={s.acceptedAt ? "Приёмка закрыта — удалить нельзя" : null} events={s.events.length} lines={lines.length} />
            </div>
          )}
        </div>
        <dl className="grid grid-cols-[8rem_1fr] gap-y-1 text-sm sm:grid-cols-[10rem_1fr]">
          <dt className="text-neutral-500">Подрядчик</dt>
          <dd>{s.supplier ? (isSupplier ? s.supplier.name : <Link href={`/suppliers/${s.supplier.id}`} className="hover:underline">{s.supplier.name}</Link>) : "—"}</dd>
          <dt className="text-neutral-500">Партия пошива</dt>
          <dd>{s.batch ? (isSupplier ? batchText : <Link href={`/production/batches/${s.batch.number}`} className="hover:underline">{batchText}</Link>) : "—"}</dd>
          <dt className="text-neutral-500">Плановая дата</dt>
          <dd>{formatDate(s.plannedDate)}</dd>
          {!isSupplier && (<><dt className="text-neutral-500">Примечание</dt>
          <dd className="whitespace-pre-wrap">{s.notes ?? "—"}</dd></>)}
        </dl>
      </section>

      {showSteps && (
        <section className="flex flex-col gap-2 rounded-lg border border-dashed border-neutral-300 bg-white p-4" aria-label="Шаги новой отгрузки" data-steps>
          <h2 className="block-title">С чего начать</h2>
          <ol className="flex flex-col gap-2">
            {steps.map((st, i) => (
              <li key={st.title} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span aria-hidden className={"flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold " + (stepDone[i] ? "bg-emerald-600 text-white" : "border border-neutral-300 text-neutral-600")}>{stepDone[i] ? "✓" : i + 1}</span>
                <span className="min-w-0 flex-1"><span className="font-medium">{st.title}</span> — <span className="text-neutral-600">{st.text}</span></span>
                {!stepDone[i] && st.action}
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* б) виджеты и «Примерка» — один сворачиваемый контейнер: «Свернуть» прячет и плитки, и таблицу примерки */}
      <SummaryTiles
        id="shipment"
        title="Отгрузка — итоги"
        tiles={[
          { key: "in", label: "Примерка, ед.", value: formatQty(allQty), caption: `${formatQty(lines.length)} строк${reworkQty ? `; на доработке ${formatQty(reworkQty)} ед.` : ""}${reviewQty ? `; на просмотре ${formatQty(reviewQty)} ед.` : ""}`, hint: <p>Все изделия, показанные на примерке. «Готово к отгрузке» — то, что идёт на приёмку в Коптево.</p> },
          { key: "ship", label: "К отгрузке, ед.", value: formatQty(totals.inShipment), caption: "идёт на приёмку в Коптево", hint: <p>Изделия со статусом «Готов к отгрузке» из всех показанных на примерке.</p> },
          { key: "acc", label: "Принято, ед.", value: formatQty(totals.accepted), caption: sharePct(totals.accepted) ? `${sharePct(totals.accepted)} от «готово к отгрузке»` : undefined, hint: <p>Сумма колонки «Принято» в блоке «Приёмка в Коптево» (сохранённые значения).</p> },
          {
            key: "ret",
            label: "Не принято, ед.",
            value: formatQty(totals.returned),
            caption: [sharePct(totals.returned), `ждёт приёмки ${formatQty(totals.remaining)} ед.`].filter(Boolean).join(" · "),
            hint: <p>Сумма колонки «Возврат»: возвращено подрядчику / не принято. «Ещё ждёт приёмки» — по каждой строке: в отгрузке минус принято и минус возврат, не меньше нуля.</p>,
          },
        ]}
        collapseWith={
          <LinesTable
            defaultOpen={!fittingDone}
            shipmentId={s.id}
            rows={lineRows}
            canEdit={canEdit}
            staff={!isSupplier}
            waiting={{ rework: reworkQty, review: reviewQty }}
            event={acceptEvent ? { id: acceptEvent.id, stamp: fmtWall(acceptEvent.occurredAt, acceptEvent.timeKnown) } : null}
            closed={s.acceptedAt && summary ? `${summary.accepted.stamp}${s.acceptedBy && !isSupplier ? `, принял ${s.acceptedBy}` : ""}` : null}
            closeProps={{ rows: acceptRows, totals, names }}
            createEvent={canEdit ? <CreateAcceptanceButton shipmentId={s.id} /> : null}
            addButton={<AddLinesButton shipmentId={s.id} />}
            hint={<p>Список изделий, показанных на примерке; здесь по каждой строке отмечается просмотр: «Принято» (устраивает полностью) или «На доработку». Строки берутся из позиций загруженных ТЗ: цвет, размер и вид меха — копия на момент добавления. Принятие в Коптево («Принято» / «Не принято» и причина) — в блоке «Приёмка в Коптево» под хронологией, только для строк «Готов к отгрузке».</p>}
          />
        }
      />


      {(isSupplier || markRows.length > 0) && lines.length > 0 && (
        <SupplierMarks shipmentId={s.id} supplier={isSupplier} canConfirm={canEdit} stamp={markStamp}
          lines={lines.map((l, i): MarkLine => ({ id: l.id, n: i + 1, text: [l.itemNo ? `№ ${l.itemNo}` : "", lineText(l)].filter(Boolean).join(" · "), quantity: l.quantity, stage: l.stage, mark: markBy.get(l.id) ?? null }))} />
      )}

      {/* в) хронология */}
      <section className="flex flex-col gap-2" aria-label="Хронология">
        <TimelineSection count={sorted.length} action={canEvents ? <NewEventButton shipmentId={s.id} titles={titles} people={people} supplier={isSupplier} /> : null}>
        {sorted.length === 0 ? (
          <p className="rounded-lg border border-dashed border-neutral-300 bg-white px-4 py-8 text-center text-sm text-neutral-500">
            Этапов пока нет{canEvents ? " — добавьте первый кнопкой «+ Этап»: что произошло, когда и на ком" : ""}.
          </p>
        ) : (
          <div className="relative rounded-lg border border-neutral-200 bg-white py-3 pl-8 pr-3" data-timeline>
            <div aria-hidden className="absolute bottom-4 left-[0.9375rem] top-4 w-px bg-neutral-200" />
            {(() => {
              const firstOpen = dayGroups.findIndex((g) => g.items.some((x) => x.event.expected));
              const cut = firstOpen === -1 ? dayGroups.length - 1 : firstOpen;
              const renderGroup = (g: (typeof dayGroups)[number], gi: number) => (
              <section key={g.day} className="relative" data-day={g.day} data-day-kind={g.kind} aria-label={g.heading}>
                <details open={gi >= cut} className="group/day"><summary className="relative flex cursor-pointer list-none items-center gap-2 py-1.5 text-xs max-md:min-h-11 [&::-webkit-details-marker]:hidden"><span aria-hidden className="text-neutral-400 transition-transform group-open/day:rotate-90">›</span>
                  <span aria-hidden className={"absolute -left-[1.1875rem] top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full " + (g.kind === "today" ? "bg-neutral-800" : "bg-neutral-300")} />
                  <span className={g.kind === "today" ? "font-semibold text-neutral-900" : g.kind === "upcoming" ? "font-medium text-neutral-400" : "font-medium text-neutral-600"}>{g.heading}</span>
                  {g.kind === "today" && <span className="rounded bg-neutral-900 px-1.5 py-0.5 text-[11px] font-medium text-white">сегодня</span>}
                  {g.kind === "upcoming" && <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[11px] font-normal text-neutral-500">ожидается</span>}
                <span className="text-[11px] font-normal text-neutral-400">· этапов: {g.items.length}</span></summary>
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
                            {canEvents && i > 0 && <span className="ml-2"><NewEventButton shipmentId={s.id} titles={titles} people={people} supplier={isSupplier} between={{ date: wallDateIso(sorted[i - 1].occurredAt), label: "+ этап между" }} /></span>}
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
                                {time}
                              </span>
                              <span data-left="who" className="text-[11px] text-neutral-500" title="Автор / ответственный действия">{resp || "—"}</span>
                            </div>
                            <div className="min-w-0 flex-1 border-t border-neutral-200 pt-2 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0" data-event-divider>
                              <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
                                <h4 className={"min-w-[10rem] flex-1 break-words text-sm font-semibold " + (e.expected ? "text-neutral-500" : "text-neutral-900")}>
                                  {e.title}
                                  {e.expected ? <span className="ml-2 rounded bg-orange-50 px-1.5 py-0.5 text-[11px] font-normal text-orange-700">ожидается</span> : <span className="ml-2 text-[11px] font-normal text-emerald-700" data-passed>пройдено</span>}
                                  <span className="ml-1.5 cursor-help rounded-full border border-neutral-300 px-1 text-[11px] font-normal text-neutral-400" title={trail} aria-label={trail} tabIndex={0}>i</span>
                                </h4>
                                {(canEdit || (isSupplier && e.createdById === session.user.id)) && <EventActions v={values(e)} titles={titles} people={people} supplier={isSupplier} canDone={!isAcceptanceEvent(e)} />}
                              </div>
                              {e.details && <ClampText text={e.details} />}
                              {e.place && <p className="mt-0.5 text-[11px] text-neutral-500" data-place>место: {e.place}</p>}
                              {(e.documents.length > 0 || docs.length > 0) && (
                                <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                                  {e.documents.map((d) => (
                                    <li key={d.id} className="flex items-center">
                                      <Clip />
                                      <a href={`/api/drive-docs/${d.id}`} target="_blank" rel="noopener noreferrer" className="ml-1 max-w-[16rem] truncate text-blue-700 hover:underline" title={d.title}>{d.title}</a>
                                      {(canEdit || (isSupplier && e.createdById === session.user.id)) && <DocRemove id={d.id} title={d.title} />}
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
                </details>
              </section>
              );
              return <>{dayGroups.map(renderGroup)}</>;
            })()}
          </div>
        )}
        </TimelineSection>


        {ziView && <ZiSupplies supplies={ziView.supplies} unmatched={ziView.unmatched} />}

      </section>

      <p className="text-xs text-neutral-500">Журнал пути партии, остатки не меняет.</p>
    </div>
  );
}
