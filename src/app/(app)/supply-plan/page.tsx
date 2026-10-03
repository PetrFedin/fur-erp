import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { ACCESS, hasRole } from "@/lib/access";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatQty, formatDate } from "@/lib/utils";
import { compareModelNames, normalizeModelCode } from "@/lib/model-code";
import { AddSupplyPlanForm } from "./add-form";
import { EntryRowForm } from "./entry-row-form";
import { getYearFilter } from "@/lib/year-filter";
import { YearNote, emptyForYear } from "@/components/year-note";
import { InfoHint } from "@/components/info-hint";
import { STATUS_LABELS, STATUS_BADGE_VARIANT, type SupplyPlanStatusValue } from "./status";

const MONTH_NAMES = [
  "янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек",
];

function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function EntryReadOnly({ status, eventDate, notes }: { status: SupplyPlanStatusValue; eventDate: Date | null; notes: string | null }) {
  return (
    <div className="text-xs text-neutral-600">
      {STATUS_LABELS[status]}
      {eventDate ? `, ${formatDate(eventDate)}` : ""}
      {notes ? ` — ${notes}` : ""}
    </div>
  );
}

export default async function SupplyPlanPage() {
  const session = await requireSession();
  const canEdit = hasRole(session.user.role, ACCESS.supplyPlan);
  const organizationId = session.user.organizationId;
  const year = await getYearFilter();

  const [entries, allModels] = await Promise.all([
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

  type Row = { modelId: string; modelName: string; cells: Map<string, typeof entries> };
  const rows = new Map<string, Row>();
  for (const e of shownEntries) {
    // Группировка по нормализованному названию: «M012» и «М012» — одна строка плана.
    const key = normalizeModelCode(e.productModel.name).trim().toLowerCase();
    if (!rows.has(key)) rows.set(key, { modelId: key, modelName: e.productModel.name, cells: new Map() });
    const row = rows.get(key)!;
    const mk = monthKey(new Date(e.month));
    if (!row.cells.has(mk)) row.cells.set(mk, []);
    row.cells.get(mk)!.push(e);
  }
  const rowList = Array.from(rows.values()).sort((a, b) => compareModelNames(a.modelName, b.modelName));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">
          План поставки
          <YearNote year={year} />
          <InfoHint label="О плане поставки" wide>
            <p>Артикулы по строкам, месяцы по столбцам. В ячейке — количество (шт.), статус, дата события и заметка.</p>
            <p className="mt-1">
              Год ({year === "all" ? "все годы" : year}): по месяцу плана. {year === "all" ? `Таблица показывает период с ${MONTH_NAMES[windowStart.getMonth()]} ${windowStart.getFullYear()} по ${MONTH_NAMES[windowEnd.getMonth()]} ${windowEnd.getFullYear()}; остальные записи — отдельным списком.` : `Таблица показывает январь–декабрь ${year}.`}
            </p>
            <p className="mt-1">В плане только количество, стоимости нет — переключатель «С 4%» на эту страницу не влияет.</p>
          </InfoHint>
        </h1>
      </div>

      {canEdit && (
        <Card>
          <CardHeader>
            <CardTitle>Добавить запись в план</CardTitle>
          </CardHeader>
          <CardContent>
            <AddSupplyPlanForm models={allModels} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Статусы</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {(Object.keys(STATUS_LABELS) as SupplyPlanStatusValue[]).map((s) => (
            <Badge key={s} variant={STATUS_BADGE_VARIANT[s]}>
              {STATUS_LABELS[s]}
            </Badge>
          ))}
        </CardContent>
      </Card>

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
                  {e.productModel.name} — {MONTH_NAMES[new Date(e.month).getMonth()]} {new Date(e.month).getFullYear()},{" "}
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
                  <EntryReadOnly status={e.status as SupplyPlanStatusValue} eventDate={e.eventDate} notes={e.notes} />
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="table-scroll overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-neutral-200 bg-neutral-50">
              <th className="sticky left-0 z-10 bg-neutral-50 px-3 py-2 text-left font-medium text-neutral-600">
                Артикул
              </th>
              {months.map((m) => (
                <th key={m.key} className="min-w-[220px] border-l border-neutral-200 px-3 py-2 text-left font-medium text-neutral-600">
                  {m.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rowList.map((row) => (
              <tr key={row.modelId} className="border-b border-neutral-100 align-top">
                <td className="sticky left-0 z-10 bg-white px-3 py-2 font-medium">{row.modelName}</td>
                {months.map((m) => {
                  const cellEntries = row.cells.get(m.key) ?? [];
                  return (
                    <td key={m.key} className="border-l border-neutral-100 px-3 py-2">
                      <div className="flex flex-col gap-1">
                        {cellEntries.map((e) => (
                          <div key={e.id} className="flex flex-col gap-0.5">
                            <div className="flex items-center gap-1 text-xs text-neutral-500">
                              <Badge variant={STATUS_BADGE_VARIANT[e.status as SupplyPlanStatusValue]}>
                                {formatQty(e.quantity.toString())} шт.
                              </Badge>
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
                              <EntryReadOnly status={e.status as SupplyPlanStatusValue} eventDate={null} notes={e.notes} />
                            )}
                          </div>
                        ))}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
            {rowList.length === 0 && (
              <tr>
                <td colSpan={months.length + 1} className="px-3 py-8 text-center text-neutral-400">
                  {year === "all" ? `План пуст${canEdit ? " — добавьте первую запись выше" : ""}` : emptyForYear(year, "записей плана", "")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
