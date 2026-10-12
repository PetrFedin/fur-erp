import { Breadcrumbs } from "@/components/breadcrumbs";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { ACCESS, hasRole } from "@/lib/access";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatQty, formatDate } from "@/lib/utils";
import { compareModelNames, normalizeModelCode } from "@/lib/model-code";
import { AddSupplyPlanForm } from "./add-form";
import { EntryRowForm } from "./entry-row-form";
import { getYearFilter } from "@/lib/year-filter";
import { YearNote, emptyForYear } from "@/components/year-note";
import { InfoHint } from "@/components/info-hint";
import { ProductionTabs } from "@/components/production-tabs";
import { type SupplyPlanStatusValue } from "./status";
import { FilterBar } from "@/components/filters/filter-bar";
import { defineFilters, parseFilters, pick, yearOptionsFrom } from "@/lib/filters";
import { normalizeModelCode as normCode } from "@/lib/model-code";
import { ArticleName } from "@/components/article-name";
import { articleLabel } from "@/lib/article-label";
import { Dash } from "@/components/tree-table";
import { TotalLabel } from "@/components/total-label";
import { SummaryTiles } from "../production/summary-tiles";

const MONTH_NAMES = [
  "янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек",
];

function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function EntryReadOnly({ eventDate, notes }: { eventDate: Date | null; notes: string | null }) {
  return (
    <div className="text-xs text-neutral-600">
      {eventDate ? formatDate(eventDate) : ""}
      {notes ? `${eventDate ? " — " : ""}${notes}` : ""}
    </div>
  );
}

export const metadata = { title: "План поставок" };

// Фильтры плана: артикул (поиск), год (по месяцу плана; дополнительно к году в шапке).
const SUPPLY_FILTERS = defineFilters({
  ...pick(["q", "year", "model"], { model: { label: "Артикул (точно)" }, q: { label: "Артикул" }, year: { label: "Год плана" } }),
});

export default async function SupplyPlanPage({ searchParams }: PageProps<"/supply-plan">) {
  const session = await requireSession();
  const canEdit = hasRole(session.user.role, ACCESS.supplyPlan);
  const organizationId = session.user.organizationId;
  const year = await getYearFilter();
  const pf = parseFilters(SUPPLY_FILTERS, await searchParams);

  const [allEntries, allModels] = await Promise.all([
    prisma.supplyPlanEntry.findMany({
      where: { organizationId },
      include: { productModel: true },
      orderBy: [{ month: "asc" }, { createdAt: "asc" }],
    }),
    prisma.productModel.findMany({
      where: { organizationId },
      select: { id: true, name: true },
    }),
  ]);
  const yearOptions = yearOptionsFrom(allEntries.map((e) => new Date(Date.UTC(new Date(e.month).getFullYear(), 0, 1))));
  const needle = normCode(pf.q.toLowerCase());
  const entries = allEntries.filter(
    (e) =>
      (pf.model.length === 0 || pf.model.includes(e.productModelId)) &&
      (pf.year.length === 0 || pf.year.includes(String(new Date(e.month).getFullYear()))) &&
      (!needle || normCode(`${e.productModel.name} ${e.notes ?? ""}`.toLowerCase()).includes(needle)),
  );
  const filtered = entries.length !== allEntries.length;
  // Коды моделей записаны то латиницей, то кириллицей (M012 / М012): сортируем по нормализованному коду, данные не трогаем.
  allModels.sort((a, b) => compareModelNames(a.name, b.name));

  const now = new Date();
  now.setDate(1);
  now.setHours(0, 0, 0, 0);
  // Показываем окно месяцев вокруг текущего (не десятки тысяч колонок, даже
  // если в БД попала запись с годом 9999). Записи вне окна — отдельным списком.
  const WINDOW_BACK = 12;
  const WINDOW_FWD = 36;
  const windowStart = new Date(now);
  windowStart.setMonth(windowStart.getMonth() - WINDOW_BACK);
  const windowEnd = new Date(now);
  windowEnd.setMonth(windowEnd.getMonth() + WINDOW_FWD);
  const inWindow = (d: Date) => d >= windowStart && d <= windowEnd;
  // Общий год: по месяцу плана; при выбранном годе таблица — ровно январь–декабрь этого года.
  const yearNum = year === "all" ? null : Number(year);
  const shownEntries = yearNum ? entries.filter((e) => new Date(e.month).getFullYear() === yearNum) : entries.filter((e) => inWindow(new Date(e.month)));
  const hiddenEntries = yearNum ? [] : entries.filter((e) => !inWindow(new Date(e.month)));

  const monthDates = shownEntries.map((e) => new Date(e.month));
  const minMonth = monthDates.length ? new Date(Math.min(now.getTime(), ...monthDates.map((d) => d.getTime()))) : now;
  const maxCandidate = new Date(now);
  maxCandidate.setMonth(maxCandidate.getMonth() + 5);
  const maxMonth = monthDates.length ? new Date(Math.max(maxCandidate.getTime(), ...monthDates.map((d) => d.getTime()))) : maxCandidate;

  const months: { key: string; label: string; date: Date }[] = [];
  const cursor = yearNum ? new Date(yearNum, 0, 1) : new Date(minMonth);
  const lastMonth = yearNum ? new Date(yearNum, 11, 1) : maxMonth;
  while (cursor <= lastMonth && months.length < 60) {
    months.push({ key: monthKey(cursor), label: `${MONTH_NAMES[cursor.getMonth()]} ${cursor.getFullYear()}`, date: new Date(cursor) });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  type Row = { modelId: string; modelName: string; model: (typeof allEntries)[number]["productModel"]; cells: Map<string, typeof entries> };
  const rows = new Map<string, Row>();
  for (const e of shownEntries) {
    // Группировка по нормализованному названию: «M012» и «М012» — одна строка плана.
    const key = normalizeModelCode(e.productModel.name).trim().toLowerCase();
    if (!rows.has(key)) rows.set(key, { modelId: key, modelName: e.productModel.name, model: e.productModel, cells: new Map() });
    const row = rows.get(key)!;
    const mk = monthKey(new Date(e.month));
    if (!row.cells.has(mk)) row.cells.set(mk, []);
    row.cells.get(mk)!.push(e);
  }
  const rowList = Array.from(rows.values()).sort((a, b) => compareModelNames(a.modelName, b.modelName));

  // Итоги плана (по записям в таблице и в списке «вне периода»): штуки по статусам; отменённые в «Всего» не входят.
  const tally = [...shownEntries, ...hiddenEntries];
  const qtyBy = (pred: (st: string) => boolean) => tally.filter((e) => pred(e.status)).reduce((a, e) => a + Number(e.quantity), 0);
  const planQty = qtyBy((st) => st !== "CANCELLED");
  const plannedQty = qtyBy((st) => st === "PLANNED");
  const workQty = qtyBy((st) => st === "LAUNCHED" || st === "WITH_FURRIER" || st === "WITH_TAILOR");
  const doneQty = qtyBy((st) => st === "PRODUCED");
  const cancelledQty = qtyBy((st) => st === "CANCELLED");
  const num = (n: number) => (n ? formatQty(n) : <Dash />);
  const monthTotals = new Map<string, number>();
  for (const e of shownEntries) if (e.status !== "CANCELLED") monthTotals.set(monthKey(new Date(e.month)), (monthTotals.get(monthKey(new Date(e.month))) ?? 0) + Number(e.quantity));
  // Надзаголовки колонок: месяцы сгруппированы по годам.
  const yearGroups: { year: number; span: number }[] = [];
  for (const m of months) {
    const y = m.date.getFullYear();
    const last = yearGroups[yearGroups.length - 1];
    if (last && last.year === y) last.span++;
    else yearGroups.push({ year: y, span: 1 });
  }

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: "ТЗ", href: "/production" }, { label: "План поставок" }]} />
      <ProductionTabs active="supply" />
      <div>
        <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold">План поставок</h1><YearNote year={year} />
          <InfoHint label="О плане поставок" wide>
            <p>Артикулы по строкам, месяцы по столбцам. В ячейке — количество (шт.), дата события и заметка.</p>
            <p className="mt-1">
              Год ({year === "all" ? "все годы" : year}): по месяцу плана. {year === "all" ? `Таблица показывает период с ${MONTH_NAMES[windowStart.getMonth()]} ${windowStart.getFullYear()} по ${MONTH_NAMES[windowEnd.getMonth()]} ${windowEnd.getFullYear()}; остальные записи — отдельным списком.` : `Таблица показывает январь–декабрь ${year}.`}
            </p>
            <p className="mt-1">В плане только количество, стоимости нет — переключатель «С 4%» на эту страницу не влияет.</p>
            <p className="mt-1">Те же даты по дням — в <Link href="/calendar" className="text-blue-700 hover:underline">производственном календаре</Link>, количества по размерам — в <Link href="/plan" className="text-blue-700 hover:underline">плане заказа</Link>.</p>
          </InfoHint></div>
      </div>

      <SummaryTiles
        id="supply"
        title="План поставок — итоги"
        linkHref="/plan"
        linkLabel="→ План заказа"
        tiles={[
          { key: "plan", label: "Всего в плане, шт.", value: num(planQty), caption: cancelledQty ? `без отменённых (${formatQty(cancelledQty)} шт.)` : filtered ? "по выбранным фильтрам" : undefined },
          { key: "planned", label: "Запланировано, шт.", value: num(plannedQty) },
          { key: "work", label: "В работе, шт.", value: num(workQty), caption: "запуск, скорняк, портной" },
          { key: "done", label: "Сдано, шт.", value: num(doneQty) },
        ]}
      />

      {canEdit && (
        <details className="rounded-xl border border-neutral-200 bg-white px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium">+ Добавить запись в план</summary>
          <div className="mt-3">
            <AddSupplyPlanForm models={allModels} />
          </div>
        </details>
      )}

      {hiddenEntries.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Записи вне отображаемого периода ({hiddenEntries.length})</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <div className="flex items-center gap-1 text-sm text-neutral-500">
              Остальные записи
              <InfoHint label="Почему записи здесь">
                Таблица показывает период с {MONTH_NAMES[windowStart.getMonth()]} {windowStart.getFullYear()} по {MONTH_NAMES[windowEnd.getMonth()]} {windowEnd.getFullYear()}. Остальные записи — здесь.
              </InfoHint>
            </div>
            {hiddenEntries.slice(0, 100).map((e) => (
              <div key={e.id} className="flex flex-col gap-1">
                <span className="text-xs text-neutral-600">
                  {articleLabel(e.productModel)} — {MONTH_NAMES[new Date(e.month).getMonth()]} {new Date(e.month).getFullYear()},{" "}
                  {formatQty(e.quantity.toString())} шт.
                </span>
                {canEdit ? (
                  <EntryRowForm
                    entryId={e.id}
                    status={e.status as SupplyPlanStatusValue}
                    quantity={e.quantity.toString()}
                    eventDate={e.eventDate ? new Date(e.eventDate).toISOString().slice(0, 10) : ""}
                    notes={e.notes ?? ""}
                  />
                ) : (
                  <EntryReadOnly eventDate={e.eventDate} notes={e.notes} />
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <FilterBar
        title="Фильтры плана поставок"
        oneRow
        hideChips
        controls={[
          { type: "text", name: "q", label: "Артикул", placeholder: "Артикул или заметка" },
          { type: "multi", name: "model", label: "Артикул (точно)", options: allModels.map((m) => ({ value: m.id, label: m.name })) },
          { type: "multi", name: "year", label: "Год плана", options: yearOptions, hint: "По месяцу плана; дополнительно к году в шапке" },
        ]}
      />

      <div className="table-scroll overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-neutral-100 bg-white">
              <th className="sticky left-0 z-10 bg-white px-3 pt-2 text-left text-[11px] font-semibold uppercase tracking-wide text-neutral-500" />
              {yearGroups.map((g) => (
                <th key={g.year} colSpan={g.span} className="border-l border-neutral-200 px-3 pt-2 text-left text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{g.year}</th>
              ))}
            </tr>
            <tr className="border-b border-neutral-200 bg-white">
              <th className="sticky left-0 z-10 bg-white px-3 py-2 text-left text-xs font-medium text-neutral-500">
                Артикул
              </th>
              {months.map((m) => (
                <th key={m.key} className="min-w-[220px] border-l border-neutral-200 px-3 py-2 text-left text-xs font-medium text-neutral-500">
                  {m.label.split(" ")[0]}, шт.
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rowList.map((row) => (
              <tr key={row.modelId} className="border-b border-neutral-100 align-top">
                <td className="sticky left-0 z-10 bg-white px-3 py-2 font-medium"><ArticleName model={row.model} /></td>
                {months.map((m) => {
                  const cellEntries = row.cells.get(m.key) ?? [];
                  return (
                    <td key={m.key} className="border-l border-neutral-100 px-3 py-2">
                      <div className="flex flex-col gap-1">
                        {cellEntries.map((e) => (
                          <div key={e.id} className="flex flex-col gap-0.5">
                            <div className="flex items-center gap-1 text-xs text-neutral-500">
                              <span className="font-medium text-neutral-800">{formatQty(e.quantity.toString())} шт.</span>
                              {e.eventDate && <span>{formatDate(e.eventDate)}</span>}
                            </div>
                            {canEdit ? (
                              <EntryRowForm
                                entryId={e.id}
                                status={e.status as SupplyPlanStatusValue}
                                quantity={e.quantity.toString()}
                                eventDate={e.eventDate ? new Date(e.eventDate).toISOString().slice(0, 10) : ""}
                                notes={e.notes ?? ""}
                              />
                            ) : (
                              <EntryReadOnly eventDate={null} notes={e.notes} />
                            )}
                          </div>
                        ))}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
            {rowList.length > 0 && (
              <tr className="row-total">
                <td className="sticky left-0 z-10 px-3 py-2"><TotalLabel unit="шт." note="без отменённых" /></td>
                {months.map((m) => (
                  <td key={m.key} className="border-l border-neutral-200 px-3 py-2 text-right tabular-nums">{monthTotals.get(m.key) ? formatQty(monthTotals.get(m.key)!) : <Dash />}</td>
                ))}
              </tr>
            )}
            {rowList.length === 0 && (
              <tr>
                <td colSpan={months.length + 1} className="px-3 py-8 text-center text-neutral-500">
                  {filtered ? "Ничего не найдено" : year === "all" ? `План пуст${canEdit ? " — добавьте первую запись выше" : ""}` : emptyForYear(year, "записей плана", "")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
