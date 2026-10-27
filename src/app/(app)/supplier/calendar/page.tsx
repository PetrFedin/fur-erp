import Link from "next/link";
import { ChatLink } from "@/components/chat-link";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { readSort, sortRows, thSort } from "@/lib/table-sort";
import { buttonVariants } from "@/components/ui/button";
import { prisma } from "@/lib/prisma";
import { requireInboxViewer } from "@/lib/supplier-inbox";
import { cleanSearch } from "@/lib/input";
import { SUP_STAGES, supStage, type SupEntry } from "@/lib/supplier-calendar";
import { WEEKDAYS, addDays, fmtRu, monthGridDays, monthTitle, parseMonth, parseYmd, shiftMonth, startOfWeek, todayYmd, ymd } from "@/lib/calendar-grid";
import { LAYER_STYLES } from "@/lib/calendar-actions";
import { SUP_LAYERS, SUP_LAYER_DEFAULT, loadSupplierLayers } from "@/lib/supplier-calendar-layers";
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
  const view = ["month", "week", "list"].includes(one(sp.v, 5)) ? one(sp.v, 5) : "month";
  const wParam = /^\d{4}-\d{2}-\d{2}$/.test(one(sp.w, 10)) && !Number.isNaN(parseYmd(one(sp.w, 10)).getTime()) ? one(sp.w, 10) : "";
  const weekStart = startOfWeek(wParam || (today.startsWith(grid) ? today : `${grid}-01`));
  const lRaw = (Array.isArray(sp.l) ? sp.l : sp.l ? [sp.l] : []).map((x) => cleanSearch(x, 10));
  const layerKeys = sp.lf ? SUP_LAYERS.map((x) => x.key).filter((k) => lRaw.includes(k)) : SUP_LAYER_DEFAULT;
  const layerSet = new Set<string>(layerKeys);

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
  const sort = readSort(sp, ["article", "color", "size", "qty", "stage", "plan", "fact", "notes"]);
  const th = (k: string) => thSort("/supplier/calendar", sp, k, sort);
  const shownAll = entries.filter((e) => (!fMonth || e.planDate.startsWith(fMonth) || e.factDate.startsWith(fMonth)) && (!fArticle || e.articleCode.toLowerCase().includes(fArticle)) && (!fStatus || e.status === fStatus));
  const shown = sortRows(shownAll, sort, { article: (e) => e.articleCode, color: (e) => e.color, size: (e) => e.size, qty: (e) => e.quantity, stage: (e) => SUP_STAGES.findIndex((x) => x.key === e.status), plan: (e) => e.planDate, fact: (e) => e.factDate, notes: (e) => e.notes });

  const days = view === "week" ? Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)) : monthGridDays(grid);
  const facts = supplierId ? await loadSupplierLayers(orgId, supplierId, layerSet, days[0], days[days.length - 1], today) : [];
  // Отметки аукционов на сетке — те же, что список выше (слой «Аукционы» включён), с кнопкой правки только у Веллмеха.
  const factsByDay = new Map<string, typeof facts>();
  for (const f of facts) (factsByDay.get(f.date) ?? factsByDay.set(f.date, []).get(f.date)!).push(f);
  const byDay = new Map<string, SupEntry[]>();
  for (const e of entries) (byDay.get(e.planDate) ?? byDay.set(e.planDate, []).get(e.planDate)!).push(e);
  const q = (patch: Record<string, string>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ g: grid === today.slice(0, 7) ? "" : grid, v: view === "month" ? "" : view, w: view === "week" ? weekStart : "", m: fMonth, q: fArticle, st: fStatus, ...patch })) if (v) p.set(k, v);
    if (sp.lf) { p.set("lf", "1"); for (const k of layerKeys) p.append("l", k); }
    const t = p.toString();
    return `/supplier/calendar${t ? `?${t}` : ""}`;
  };
  const offLayers = SUP_LAYERS.filter((l) => !layerSet.has(l.key));
  const allLayersHref = (() => { const p = new URLSearchParams(); if (grid !== today.slice(0, 7)) p.set("g", grid); p.set("v", "list"); p.set("lf", "1"); for (const l of SUP_LAYERS) p.append("l", l.key); return `/supplier/calendar?${p.toString()}`; })();
  const months = Array.from(new Set(entries.flatMap((e) => [e.planDate.slice(0, 7), e.factDate.slice(0, 7)]).filter(Boolean))).sort();

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: "Главная" }, { label: "Календарь" }]} />
      <h1 className="text-xl font-semibold">Календарь</h1>
      <p className="text-sm text-neutral-600">Записи видны в нашем календаре.</p>

      <section aria-label="Аукционы" className="flex flex-col gap-2">
        <h2 className="font-semibold">Аукционы</h2>
        <p className="text-sm text-neutral-600">{isSup ? "Слой «Аукционы» в общем календаре." : "Даты аукционов, которые внёс Веллмех (в общем календаре — слой «Аукционы»)."}</p>
        {isSup && <details className="rounded-md border border-neutral-300 p-3"><summary className="min-h-11 cursor-pointer py-2 text-sm font-medium">+ Аукцион</summary><div className="mt-2"><AuctionForm houses={houses} /></div></details>}
        {auctions.length > 0 ? <ul className="flex flex-col gap-2">{auctions.map((a) => isSup ? <AuctionRow key={a.id} mark={a} houses={houses} today={today} /> : <li key={a.id} className="rounded-md border border-neutral-200 bg-white p-3 text-sm"><b className="tabular-nums">{fmtRu(a.date)}</b> {[a.name, a.house, a.place].filter(Boolean).join(" · ")}</li>)}</ul> : <p className="text-sm text-neutral-500">Нет отметок.</p>}
      </section>

      {isSup && <EntryForm models={modelNames} />}
      {isSup && <ImportBox />}

      <form className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm" aria-label="Слои календаря">
        <input type="hidden" name="lf" value="1" />
        {view !== "month" && <input type="hidden" name="v" value={view} />}
        {view === "week" && <input type="hidden" name="w" value={weekStart} />}
        {grid !== today.slice(0, 7) && <input type="hidden" name="g" value={grid} />}
        <span className="font-medium">Слои:</span>
        {SUP_LAYERS.map((l) => (
          <label key={l.key} className="inline-flex min-h-11 items-center gap-1.5 max-xl:px-1.5">
            <input type="checkbox" name="l" value={l.key} defaultChecked={layerSet.has(l.key)} className="size-4" />{l.label}
          </label>
        ))}
        <button type="submit" className={buttonVariants({ size: "sm", variant: "outline" })}>Показать</button>
      </form>
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex overflow-hidden rounded-md border border-neutral-300 text-sm" role="group" aria-label="Вид">
          {([["month", "Месяц"], ["week", "Неделя"], ["list", "Список"]] as const).map(([k, l]) => (
            <Link key={k} href={q({ v: k === "month" ? "" : k, w: k === "week" ? weekStart : "" })} aria-current={view === k ? "page" : undefined} className={`inline-flex min-h-11 items-center px-3 ${view === k ? "bg-neutral-900 text-white" : "bg-white hover:bg-neutral-50"}`}>{l}</Link>
          ))}
        </div>
        {view === "week" ? (
          <>
            <Link href={q({ w: addDays(weekStart, -7), g: addDays(weekStart, -7).slice(0, 7) })} className={buttonVariants({ size: "sm", variant: "outline" })} aria-label="Назад">‹</Link>
            <h2 className="min-w-40 text-center font-semibold">{fmtRu(days[0])} — {fmtRu(days[6])}</h2>
            <Link href={q({ w: addDays(weekStart, 7), g: addDays(weekStart, 7).slice(0, 7) })} className={buttonVariants({ size: "sm", variant: "outline" })} aria-label="Вперёд">›</Link>
            <Link href={q({ w: startOfWeek(today), g: "" })} className={buttonVariants({ size: "sm", variant: "outline" })}>Сегодня</Link>
          </>
        ) : (
          <>
            <Link href={q({ g: shiftMonth(grid, -1), w: "" })} className={buttonVariants({ size: "sm", variant: "outline" })} aria-label="Назад">‹</Link>
            <h2 className="min-w-40 text-center font-semibold">{monthTitle(grid)}</h2>
            <Link href={q({ g: shiftMonth(grid, 1), w: "" })} className={buttonVariants({ size: "sm", variant: "outline" })} aria-label="Вперёд">›</Link>
            <Link href={q({ g: "", w: "" })} className={buttonVariants({ size: "sm", variant: "outline" })}>Сегодня</Link>
          </>
        )}
      </div>
      {view === "list" ? (
        <ul className="flex flex-col gap-2" aria-label="Список событий месяца">
          {days.filter((d) => d.slice(0, 7) === grid && ((byDay.get(d)?.length ?? 0) + (factsByDay.get(d)?.length ?? 0)) > 0).map((d) => (
            <li key={d} className="rounded-md border border-neutral-200 bg-white p-3 text-sm">
              <b className="tabular-nums">{fmtRu(d)}</b>
              <div className="mt-1 flex flex-col gap-1">
                {(byDay.get(d) ?? []).map((e) => <div key={e.id} className={`rounded border px-2 py-1 ${supStage(e.status).chip}`}>{e.articleCode} ×{e.quantity} · {supStage(e.status).label}{e.color ? ` · ${e.color}` : ""}</div>)}
                {(factsByDay.get(d) ?? []).map((f) => <Link key={f.id} href={f.href} className={`rounded border px-2 py-1 ${LAYER_STYLES[f.kind].chip}`}><span className="font-medium">{f.kind === "auction" ? "Аукцион · " : ""}{f.title}</span>{f.qty != null ? ` ×${f.qty}` : ""} — {f.label}</Link>)}
              </div>
            </li>
          ))}
          {days.every((d) => d.slice(0, 7) !== grid || ((byDay.get(d)?.length ?? 0) + (factsByDay.get(d)?.length ?? 0)) === 0) && (
            <li className="flex flex-col items-start gap-2 rounded-md border border-dashed border-neutral-300 bg-white p-3 text-sm text-neutral-600">
              <span>В этом месяце ({monthTitle(grid)}) событий нет{offLayers.length > 0 ? `, но слои выключены: ${offLayers.map((l) => `«${l.label}»`).join(", ")}. В них тоже могут быть записи.` : "."}</span>
              {offLayers.length > 0 && <Link href={allLayersHref} className={buttonVariants({ size: "sm", variant: "outline" })}>Включить слои: {offLayers.map((l) => l.label).join(", ")}</Link>}
            </li>
          )}
        </ul>
      ) : (
        <div className="overflow-x-auto">
          <div className="month-grid grid min-w-[720px] grid-cols-7 gap-px rounded-md border border-neutral-200 bg-neutral-200 text-xs">
            {WEEKDAYS.map((w) => <div key={w} className="bg-neutral-50 p-1 text-center font-medium">{w}</div>)}
            {days.map((d) => {
              const list = byDay.get(d) ?? [];
              const fl = factsByDay.get(d) ?? [];
              const lim = view === "week" ? 99 : 4;
              const rest = list.length + fl.length - lim;
              return (
                <div key={d} className={`${view === "week" ? "min-h-40" : "min-h-20"} bg-white p-1 ${view !== "week" && d.slice(0, 7) !== grid ? "opacity-50" : ""} ${d === today ? "ring-2 ring-inset ring-neutral-900" : ""}`}>
                  <div className="text-neutral-500">{Number(d.slice(8))}</div>
                  {fl.filter((f) => f.kind === "auction").map((f) => <Link key={f.id} href={f.href} className={`mt-0.5 block truncate rounded border px-1 font-medium ${LAYER_STYLES.auction.chip}`} title={`Аукцион: ${f.title} — ${f.label}`}>+ Аукцион · {f.title}</Link>)}
                  {[...list.map((e) => ({ e })), ...fl.filter((f) => f.kind !== "auction").map((f) => ({ f }))].slice(0, Math.max(lim - fl.filter((f) => f.kind === "auction").length, 0)).map((it) => "e" in it
                    ? <div key={it.e.id} className={`mt-0.5 truncate rounded border px-1 ${supStage(it.e.status).chip}`} title={`${it.e.articleCode} ${it.e.color} ${it.e.size} ×${it.e.quantity} — ${supStage(it.e.status).label}`}>{it.e.articleCode} ×{it.e.quantity}</div>
                    : <Link key={it.f.id} href={it.f.href} className={`mt-0.5 block truncate rounded border px-1 ${LAYER_STYLES[it.f.kind].chip}`} title={`${it.f.title} — ${it.f.label}`}>{it.f.title} · {it.f.label}</Link>)}
                  {rest > 0 && <div className="text-neutral-500">+ ещё {rest}</div>}
                </div>
              );
            })}
          </div>
        </div>
      )}

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
          <Thead><Tr><Th {...th("article")}>Артикул</Th><Th {...th("color")}>Цвет</Th><Th {...th("size")}>Размер</Th><Th {...th("qty")}>Кол-во</Th><Th {...th("stage")}>Этап</Th><Th {...th("plan")}>План</Th><Th {...th("fact")}>Факт</Th><Th {...th("notes")}>Комментарий</Th>{isSup && <Th />}</Tr></Thead>
          <Tbody>
            {shown.map((e) => (
              <Tr key={e.id}>
                <Td className="font-medium">{e.articleCode}{e.docNote && <div className="text-xs font-normal text-neutral-500">№ {e.docNote}</div>}</Td>
                <Td>{e.color || "–"}</Td><Td>{e.size || "–"}</Td><Td className="tabular-nums">{e.quantity}</Td>
                <Td><StageBadge status={e.status} /></Td>
                <Td className="tabular-nums">{fmtRu(e.planDate)}</Td>
                <Td className="tabular-nums">{e.factDate ? fmtRu(e.factDate) : "–"}</Td>
                <Td className="max-w-64 break-words text-xs">{e.notes || "–"}</Td>
                {isSup && <Td><div className="flex items-center gap-1"><RowActions entry={e} models={modelNames} /><ChatLink type="CalendarEvent" id={e.id} role={s.user.role} label="Написать" className="!py-0.5 text-xs" /></div></Td>}
              </Tr>
            ))}
            {shown.length === 0 && <Tr><Td colSpan={9} className="py-8 text-center text-neutral-500">{entries.length === 0 ? "Нет записей по артикулам." : "Нет записей по выбранным условиям"}</Td></Tr>}
          </Tbody>
        </Table>
      </div>
    </div>
  );
}
