import Link from "next/link";
import { ChatLink } from "@/components/chat-link";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { buttonVariants } from "@/components/ui/button";
import { prisma } from "@/lib/prisma";
import { requireInboxViewer } from "@/lib/supplier-inbox";
import { cleanSearch } from "@/lib/input";
import { SUP_STAGES, supStage, type SupEntry } from "@/lib/supplier-calendar";
import { WEEKDAYS, fmtRu, monthGridDays, monthTitle, parseMonth, shiftMonth, todayYmd, ymd } from "@/lib/calendar-grid";
import { EntryForm, ImportBox, RowActions, StageBadge } from "./calendar-ui";
import { AuctionForm, AuctionRow } from "./auction-ui";
import { AUCTION_ACTION, toAuctionMark } from "@/lib/auction-calendar";

export const metadata = { title: "Календарь" };

export default async function SupplierCalendarPage({ searchParams }: PageProps<"/supplier/calendar">) {
  const s = await requireInboxViewer();
  const isSup = s.user.role === "SUPPLIER";
  const orgId = s.user.organizationId;
  const sp = await searchParams;
  const one = (v: string | string[] | undefined, n = 40) => cleanSearch(Array.isArray(v) ? v[0] : v, n);
  const today = todayYmd();
  const grid = parseMonth(one(sp.g, 7)) ?? today.slice(0, 7);
  const fMonth = parseMonth(one(sp.m, 7)) ?? "";
  const fArticle = one(sp.q, 100).toLowerCase();
  const fStatus = SUP_STAGES.some((x) => x.key === one(sp.st)) ? one(sp.st) : "";

  // Поставщик — только свои записи; владелец/админ — просмотр записей поставщика.
  let supplierId = s.user.supplierId ?? null;
  if (!isSup) supplierId = (await prisma.supplier.findFirst({ where: { organizationId: orgId, users: { some: { role: "SUPPLIER" } } }, select: { id: true } }))?.id ?? null;
  const [allDb, models, houseRows] = await Promise.all([
    supplierId ? prisma.calendarEvent.findMany({ where: { organizationId: orgId, supplierId }, orderBy: [{ date: "asc" }, { articleCode: "asc" }], take: 3000 }) : [],
    prisma.productModel.findMany({ where: { organizationId: orgId, isActive: true }, select: { name: true }, orderBy: { name: "asc" } }),
    prisma.auction.findMany({ where: { organizationId: orgId, isService: false, house: { not: null } }, select: { house: true }, distinct: ["house"], orderBy: { house: "asc" } }),
  ]);
  // Отметки аукционов (action «Аукцион») лежат в той же таблице, но это не изделия — в таблицу «По артикулам» не попадают.
  const rowsDb = allDb.filter((e) => e.action !== AUCTION_ACTION);
  const auctions = allDb.filter((e) => e.action === AUCTION_ACTION).map(toAuctionMark).sort((a, b) => b.date.localeCompare(a.date));
  const houses = houseRows.map((h) => h.house!).filter((h) => h !== "Прочее");
  const entries: SupEntry[] = rowsDb.map((e) => ({
    id: e.id, articleCode: e.articleCode, articleName: e.articleName ?? "", color: e.color ?? "", size: e.size ?? "", quantity: e.quantity,
    status: e.status ?? "launch", planDate: ymd(e.date), factDate: e.factDate ? ymd(e.factDate) : "", notes: e.notes ?? "", docNote: e.docNote ?? "",
  }));
  const modelNames = models.map((m) => m.name);
  const shown = entries.filter((e) => (!fMonth || e.planDate.startsWith(fMonth) || e.factDate.startsWith(fMonth)) && (!fArticle || e.articleCode.toLowerCase().includes(fArticle)) && (!fStatus || e.status === fStatus));

  const days = monthGridDays(grid);
  const byDay = new Map<string, SupEntry[]>();
  for (const e of entries) (byDay.get(e.planDate) ?? byDay.set(e.planDate, []).get(e.planDate)!).push(e);
  const q = (patch: Record<string, string>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ g: grid === today.slice(0, 7) ? "" : grid, m: fMonth, q: fArticle, st: fStatus, ...patch })) if (v) p.set(k, v);
    const t = p.toString();
    return `/supplier/calendar${t ? `?${t}` : ""}`;
  };
  const months = Array.from(new Set(entries.flatMap((e) => [e.planDate.slice(0, 7), e.factDate.slice(0, 7)]).filter(Boolean))).sort();

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: "Главная" }, { label: "Календарь" }]} />
      <h1 className="text-xl font-semibold">Календарь</h1>
      <p className="text-sm text-neutral-600">Ведите изделия по артикулу: цвет, размер, количество, этап, плановая и фактическая даты. Запись сразу видна у нас в производственном календаре. Кнопка «→» переводит на следующий этап и ставит сегодняшнюю фактическую дату.</p>

      <section aria-label="Аукционы" className="flex flex-col gap-2">
        <h2 className="font-semibold">Аукционы</h2>
        <p className="text-sm text-neutral-600">{isSup ? "Отметьте даты аукционов: у нас они видны в общем календаре, слой «Аукционы»." : "Даты аукционов, которые внёс Веллмех (в общем календаре — слой «Аукционы»)."}</p>
        {isSup && <details className="rounded-md border border-neutral-300 p-3"><summary className="min-h-11 cursor-pointer py-2 text-sm font-medium">+ Аукцион</summary><div className="mt-2"><AuctionForm houses={houses} /></div></details>}
        {auctions.length > 0 ? <ul className="flex flex-col gap-2">{auctions.map((a) => isSup ? <AuctionRow key={a.id} mark={a} houses={houses} today={today} /> : <li key={a.id} className="rounded-md border border-neutral-200 bg-white p-3 text-sm"><b className="tabular-nums">{fmtRu(a.date)}</b> {[a.name, a.house, a.place].filter(Boolean).join(" · ")}</li>)}</ul> : <p className="text-sm text-neutral-500">Отметок пока нет.</p>}
      </section>

      {isSup && <EntryForm models={modelNames} />}
      {isSup && <ImportBox />}

      <div className="flex flex-wrap items-center gap-2">
        <Link href={q({ g: shiftMonth(grid, -1) })} className={buttonVariants({ size: "sm", variant: "outline" })} aria-label="Назад">‹</Link>
        <h2 className="min-w-40 text-center font-semibold">{monthTitle(grid)}</h2>
        <Link href={q({ g: shiftMonth(grid, 1) })} className={buttonVariants({ size: "sm", variant: "outline" })} aria-label="Вперёд">›</Link>
        <Link href={q({ g: "" })} className={buttonVariants({ size: "sm", variant: "outline" })}>Сегодня</Link>
      </div>
      <div className="overflow-x-auto">
        <div className="grid min-w-[720px] grid-cols-7 gap-px rounded-md border border-neutral-200 bg-neutral-200 text-xs">
          {WEEKDAYS.map((w) => <div key={w} className="bg-neutral-50 p-1 text-center font-medium">{w}</div>)}
          {days.map((d) => {
            const list = byDay.get(d) ?? [];
            return (
              <div key={d} className={`min-h-20 bg-white p-1 ${d.slice(0, 7) !== grid ? "opacity-50" : ""} ${d === today ? "ring-2 ring-inset ring-neutral-900" : ""}`}>
                <div className="text-neutral-500">{Number(d.slice(8))}</div>
                {list.slice(0, 4).map((e) => (
                  <div key={e.id} className={`mt-0.5 truncate rounded border px-1 ${supStage(e.status).chip}`} title={`${e.articleCode} ${e.color} ${e.size} ×${e.quantity} — ${supStage(e.status).label}`}>{e.articleCode} ×{e.quantity}</div>
                ))}
                {list.length > 4 && <div className="text-neutral-500">+ ещё {list.length - 4}</div>}
              </div>
            );
          })}
        </div>
      </div>

      <h2 className="font-semibold">По артикулам</h2>
      <form className="flex flex-wrap items-end gap-3 text-sm">
        <input type="hidden" name="g" value={grid === today.slice(0, 7) ? "" : grid} />
        <label className="flex flex-col gap-1">Артикул
          <input name="q" defaultValue={one(sp.q, 100)} placeholder="Часть артикула" className="h-9 w-40 rounded-md border border-neutral-300 px-2" />
        </label>
        <label className="flex flex-col gap-1">Этап
          <select name="st" defaultValue={fStatus} className="h-9 rounded-md border border-neutral-300 px-2">
            <option value="">Все</option>
            {SUP_STAGES.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">Месяц
          <select name="m" defaultValue={fMonth} className="h-9 rounded-md border border-neutral-300 px-2">
            <option value="">Все</option>
            {months.map((m) => <option key={m} value={m}>{monthTitle(m)}</option>)}
          </select>
        </label>
        <button type="submit" className={buttonVariants({ size: "sm" })}>Показать</button>
        {(fMonth || fArticle || fStatus) && <Link href={q({ m: "", q: "", st: "" })} className={buttonVariants({ size: "sm", variant: "outline" })}>Сбросить</Link>}
      </form>
      <p className="text-sm text-neutral-700">Записей: <b>{shown.length}</b> · изделий: <b>{shown.reduce((a, e) => a + e.quantity, 0)}</b></p>
      <div className="overflow-x-auto">
        <Table className="min-w-[900px]">
          <Thead><Tr><Th>Артикул</Th><Th>Цвет</Th><Th>Размер</Th><Th>Кол-во</Th><Th>Этап</Th><Th>План</Th><Th>Факт</Th><Th>Комментарий</Th>{isSup && <Th />}</Tr></Thead>
          <Tbody>
            {shown.map((e) => (
              <Tr key={e.id}>
                <Td className="font-medium">{e.articleCode}{e.docNote && <div className="text-xs font-normal text-neutral-500">№ {e.docNote}</div>}</Td>
                <Td>{e.color || "—"}</Td><Td>{e.size || "—"}</Td><Td className="tabular-nums">{e.quantity}</Td>
                <Td><StageBadge status={e.status} /></Td>
                <Td className="tabular-nums">{fmtRu(e.planDate)}</Td>
                <Td className="tabular-nums">{e.factDate ? fmtRu(e.factDate) : "—"}</Td>
                <Td className="max-w-64 break-words text-xs">{e.notes || "—"}</Td>
                {isSup && <Td><div className="flex items-center gap-1"><RowActions entry={e} models={modelNames} /><ChatLink type="CalendarEvent" id={e.id} role={s.user.role} label="Написать" className="!py-0.5 text-xs" /></div></Td>}
              </Tr>
            ))}
            {shown.length === 0 && <Tr><Td colSpan={9} className="py-8 text-center text-neutral-500">{entries.length === 0 ? "Записей пока нет. Добавьте первую выше или загрузите Excel." : "По выбранным условиям записей нет"}</Td></Tr>}
          </Tbody>
        </Table>
      </div>
    </div>
  );
}
