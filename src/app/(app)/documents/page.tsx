import { readSort, sortRows, thSort } from "@/lib/table-sort";
import { Th } from "@/components/ui/table";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { auctionLabeler } from "@/lib/filter-options";
import { WidgetRow } from "@/components/widget-row";
import Link from "next/link";
import { ControlTabs } from "@/components/control-tabs";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { Card } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { ResponsiveRows, RowCard } from "@/components/responsive-rows";
import { SECTION_ORDER, SECTION_TITLES, computeDocCoverage, summarize, filterCovRows, parseCovFilters } from "@/lib/doc-coverage";
import { DOC_LINK_LABELS, DOC_PAGE_SIZE, filterDocList, groupDocList, loadDocList, parseDocListFilters } from "@/lib/drive-doc-list";
import { DRIVE_DOC_TYPES, DRIVE_DOC_TYPE_LABELS } from "@/lib/drive-docs";
import { formatDate } from "@/lib/utils";
import { RELIABILITY_NOTE } from "@/lib/reliability-note";
import { InfoHint } from "@/components/info-hint";
import { getYearFilter } from "@/lib/year-filter";

import { TodoSummary } from "./todo-summary";
import { AnalysisSection } from "./analysis-section";
import { BulkUpload } from "./bulk-upload";
import { ACCESS, hasRole } from "@/lib/access";

import { FilterBar } from "@/components/filters/filter-bar";
import { defineFilters, filterHref, parseFilters, pick, stateParam } from "@/lib/filters";

import { loadCovVer } from "./ver-status";

import { GroupLinks } from "./_page/group-links";
import { Legend, SummaryTile } from "./_page/summary-tiles";
import { SectionMatrix } from "./_page/section-matrix";
import { RegistryBlock } from "./_page/registry-block";

export const metadata = { title: "Документы" };

type SP = Record<string, string | string[] | undefined>;

// Один язык фильтров: поиск `q` (прежнее `dq`) общий для матрицы и списка документов; страница списка — `page` (прежнее `dpage`).
const DOC_FILTERS = defineFilters({
  ...pick(["q", "auction", "sort"], { auction: { label: "Аукцион / закупка", aliases: [] }, sort: { role: "filter", label: "Сортировка", allowed: ["gaps"] } }),
  section: { kind: "multi", label: "Раздел", allowed: SECTION_ORDER },
  gaps: { kind: "multi", label: "Не прикреплено", allowed: ["1"] },
  ver: { kind: "multi", label: "Подтверждение", allowed: ["yes", "no"] },
  dtype: { kind: "multi", label: "Тип документа" },
  dlink: { kind: "multi", label: "Привязан к" },
  page: stateParam("Страница", { aliases: ["dpage"], pattern: /^\d{1,6}$/ }),
});
const MULTI_KEYS = new Set(["section", "auction", "gaps", "ver", "dtype", "dlink"]);

export default async function DocumentsPage({ searchParams }: PageProps<"/documents">) {
  const session = await requireSession(); // чтение — всем ролям
  const sp: SP = await searchParams;
  // Год — общий фильтр из шапки (Все / 2025 / 2026): он применяется и к матрице, и к списку документов.
  const yf = await getYearFilter();
  const yNum = yf === "all" ? null : Number(yf);
  const f = { ...parseCovFilters(sp), year: yNum };
  const df = { ...parseDocListFilters(sp), year: yNum };
  const pf = parseFilters(DOC_FILTERS, sp);
  const orgId = session.user.organizationId;

  const [cov, docList] = await Promise.all([computeDocCoverage(prisma, orgId), loadDocList(prisma, orgId)]);

  // ---------- ссылки с сохранением обеих групп параметров
  // Патч значений (строка или null) → ссылка с сохранением всех остальных фильтров. dpage — прежнее имя page.
  const buildHref = (patch: Partial<Record<string, string | null>>, hash = "") => {
    const over: Record<string, string | string[]> = {};
    for (const [k0, v] of Object.entries(patch)) {
      const k = k0 === "dpage" ? "page" : k0 === "dq" ? "q" : k0;
      if (k === "year" || k === "dyear") continue;
      over[k] = MULTI_KEYS.has(k) ? (v ? [v] : []) : (v ?? "");
    }
    return filterHref(DOC_FILTERS, "/documents", pf, over as never, { hash });
  };

  // ---------- матрица
  const yearRows = yNum === null ? cov.rows : cov.rows.filter((r) => r.section === "contracts" || r.year === yNum);
  const sum = yNum === null ? { sections: cov.sections, total: cov.total } : summarize(yearRows);
  const aucOf = await auctionLabeler(orgId);
  const auctions = [...new Set(cov.rows.map((r) => r.auction).filter((a): a is string => !!a))].sort();
  const verMap = await loadCovVer(orgId, cov.rows);
  const verSel = pf.ver;
  const visible = filterCovRows(cov.rows, f).filter((r) => {
    if (verSel.length !== 1) return true;
    const v = verMap.get(r.id);
    return verSel[0] === "yes" ? v === true : v === false;
  });
  const exportQs = new URLSearchParams();
  for (const v of f.section) exportQs.append("section", v);
  for (const v of f.auction) exportQs.append("auction", v);
  if (f.q) exportQs.set("q", f.q);
  const totalGaps = yearRows.filter((r) => r.gaps.length > 0).length;

  // ---------- Drive-блок
  // Одинаковые файлы (название + тип + размер) схлопнуты в одну строку «×N»; привязки — в раскрывающемся списке.
  // Таблица документов Drive сортируется по клику на заголовок (?dsort=…&ddir=…); по умолчанию — по названию.
  const dSort = readSort(sp, ["title", "type", "number", "date", "links", "orig"], null, "d");
  const docsFiltered = sortRows(groupDocList(filterDocList(docList, df)).sort((a, b) => a.title.localeCompare(b.title, "ru")), dSort, {
    title: (d) => d.title,
    type: (d) => DRIVE_DOC_TYPE_LABELS[d.docType],
    number: (d) => d.number,
    date: (d) => (d.date ? new Date(d.date) : d.year ? new Date(Date.UTC(Number(d.year), 0, 1)) : null),
    links: (d) => d.links.length,
    orig: (d) => (d.hasOriginal ? 1 : 0),
  });
  const dth = (k: string) => thSort("/documents", sp, k, dSort, "d");
  const typeCounts = new Map<string, number>();
  for (const d of groupDocList(filterDocList(docList, df, "type"))) typeCounts.set(d.docType, (typeCounts.get(d.docType) ?? 0) + 1);
  const pages = Math.max(1, Math.ceil(docsFiltered.length / DOC_PAGE_SIZE));
  const page = Math.min(df.page, pages);
  const pageDocs = docsFiltered.slice((page - 1) * DOC_PAGE_SIZE, page * DOC_PAGE_SIZE);
  const unlinked = docList.filter((d) => d.links.length === 0).length;
  const withOriginal = docList.filter((d) => d.hasOriginal).length;
  const allGroups = groupDocList(docList).length;

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: "Контроль", href: "/attention" }, { label: "Документы" }]} />
      <ControlTabs active="documents" />
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="max-w-3xl">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold">Документы</h1>
            <span className="rounded-full bg-neutral-900 px-2.5 py-0.5 text-xs font-medium text-white">Год: {yf === "all" ? "все" : yf}</span>
            <InfoHint wide label="Что показывает страница и как считается процент">
              <div className="space-y-2">
                <p>Какие документы нужны по правилам, какие уже есть и чего не хватает: по закупкам, ТЗ, партиям, оплатам и договорам. Считается по базе прямо сейчас — прикрепили файл на карточке, и пробел исчезает.</p>
                <p>
                  <b>Процент</b> — «документы привязаны»: сколько обязательных документов уже есть из тех, что нужны по правилам (правила заданы в программе). «100 %» ставится только при нуле пробелов. Документ считается, только если к нему прикреплён файл; запись без файла — «не прикреплён»: сейчас файл прикреплён у {withOriginal} из {docList.length} записей.
                </p>
                <p>У записи две независимые отметки: <b>подтверждена</b> (данные проверены, файл для этого не нужен) и <b>не прикреплено</b> (обязательного документа ещё нет). Фильтры «Не прикреплено» и «Подтверждение» над таблицей. Нажмите на запись — откроется её карточка с документами.</p>
                <p>{RELIABILITY_NOTE}</p>
                <p>
                  <b>Год</b> берётся из шапки (Все / 2025 / 2026): закупка — по дате закупки, ТЗ — по году партии или даты ТЗ, оплата — по дате оплаты, документ — по дате документа. Плитки сверху и таблицы пересчитываются.
                </p>
              </div>
            </InfoHint>
          </div>
        </div>
        <a
          href={`/documents/export${exportQs.toString() ? `?${exportQs}` : ""}`}
          className={buttonVariants({ variant: "outline" })}
        >
          Скачать список недостающих (CSV)
        </a>
      </div>

      {/* ---------- фильтры матрицы (над виджетами, как на Главной) */}
      <div className="print:hidden">
        <FilterBar
          title="Фильтры документов"
          oneRow
          hideChips
          controls={[
            { type: "text", name: "q", label: "Поиск", aliases: ["dq"], placeholder: "номер, название…" },
            { type: "multi", name: "section", label: "Раздел", options: SECTION_ORDER.map((k) => ({ value: k, label: SECTION_TITLES[k] })), allLabel: "Все разделы" },
            { type: "multi", name: "auction", label: "Аукцион / закупка", options: auctions.map((a) => ({ value: a, label: aucOf(a).label, title: aucOf(a).title })), allLabel: "Все партии" },
            { type: "multi", name: "gaps", label: "Не прикреплено", single: true, options: [{ value: "1", label: "Только где не прикреплено" }], allLabel: "Все записи" },
            { type: "multi", name: "ver", label: "Подтверждение", options: [{ value: "yes", label: "Подтверждена" }, { value: "no", label: "Не подтверждена" }], allLabel: "Любое" },
            { type: "multi", name: "sort", label: "Сортировка", more: true, single: true, options: [{ value: "gaps", label: "По числу пробелов" }], allLabel: "По порядку" },
          ]}
        />
      </div>

      {/* ---------- сводка */}
      <WidgetRow id="docs-coverage" title="Покрытие документами">
      <section aria-label="Сводка покрытия" className="grid grid-cols-2 max-sm:grid-cols-2! items-stretch gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
        <SummaryTile title="Всего" stat={sum.total} href={buildHref({ section: null, gaps: "1", dpage: null })} strong />
        {sum.sections.map((s) => (
          <SummaryTile key={s.key} title={SECTION_TITLES[s.key]} stat={s} href={buildHref({ section: s.key, gaps: "1", dpage: null })} />
        ))}
      </section>
      </WidgetRow>

      <TodoSummary organizationId={orgId} year={yf} />

      <AnalysisSection organizationId={orgId} year={yf} />

      {hasRole(session.user.role, ACCESS.purchases) && (
        <details className="rounded-lg border border-neutral-200 bg-white" open={false}>
          <summary className="cursor-pointer list-none px-3 py-2 text-sm font-medium hover:bg-neutral-50">Массовая загрузка документов <span className="font-normal text-neutral-500">— привязка предлагается сама</span></summary>
          <div className="border-t border-neutral-100 p-3"><BulkUpload /></div>
        </details>
      )}

      <RegistryBlock />

      {/* ---------- матрица */}
      {visible.length === 0 ? (
        <Card className="p-8 text-center text-neutral-600">
          {f.gaps && cov.rows.length > 0 ? "По этим фильтрам пробелов нет ✓" : "Записей по этим фильтрам нет."}
        </Card>
      ) : (
        SECTION_ORDER.filter((k) => visible.some((r) => r.section === k)).map((k) => (
          <SectionMatrix key={k} section={k} rows={visible.filter((r) => r.section === k)} f={f} ver={verMap} verFilter={verSel.length === 1} />
        ))
      )}
      <Legend totalGaps={totalGaps} />

      {/* ---------- Все документы */}
      <section id="drive" className="flex scroll-mt-4 flex-col gap-3">
        <div>
          <h2 className="flex items-center gap-2 block-title">
            Все документы
            <span className="text-sm font-normal text-neutral-500">
              {docsFiltered.length} документов · с файлом: {docsFiltered.filter((d) => d.hasOriginal).length} · не привязаны: <strong className={unlinked > 0 ? "text-amber-700" : ""}>{unlinked}</strong>
            </span>
            <InfoHint wide label="Что в списке документов">
              Все документы вместе (с прикреплённым файлом и без него): {allGroups} документов ({docList.length} привязок), файл прикреплён у {withOriginal}. Одинаковый файл, привязанный к нескольким записям, показан одной строкой «×N». Не привязаны ни к чему: {unlinked}. Год — из шапки.
            </InfoHint>
          </h2>
        </div>

        <div className="print:hidden">
          <FilterBar
            title="Фильтры документов"
            oneRow
            hideChips
            controls={[
              { type: "text", name: "q", label: "Поиск по названию / номеру", aliases: ["dq"], placeholder: "например, УПД 109" },
              { type: "multi", name: "dtype", label: "Тип документа", options: DRIVE_DOC_TYPES.filter((t) => typeCounts.get(t) || df.type.includes(t)).map((t) => ({ value: t, label: DRIVE_DOC_TYPE_LABELS[t], count: typeCounts.get(t) ?? 0 })), allLabel: "Все типы" },
              { type: "multi", name: "dlink", label: "Привязан к", options: [...Object.entries(DOC_LINK_LABELS).map(([value, label]) => ({ value, label })), { value: "none", label: "Не привязан" }], allLabel: "Любая привязка" },
            ]}
          />
        </div>

        {pageDocs.length === 0 ? (
          <Card className="p-6 text-center text-neutral-600">Документов по этим условиям нет.</Card>
        ) : (
          <ResponsiveRows
            table={
              <Card className="overflow-hidden">
                <table className="w-full table-fixed text-sm">
                  <thead className="bg-neutral-50 text-left text-xs text-neutral-500">
                    <tr>
                      <Th {...dth("title")} className="w-[34%] px-3 py-2 font-medium">Название</Th>
                      <Th {...dth("type")} className="w-[12%] px-3 py-2 font-medium">Тип</Th>
                      <Th {...dth("number")} className="w-[10%] px-3 py-2 font-medium">№</Th>
                      <Th {...dth("date")} className="w-[9%] px-3 py-2 font-medium">Дата</Th>
                      <Th {...dth("links")} className="px-3 py-2 font-medium">Привязан к</Th>
                      <Th {...dth("orig")} className="w-[12%] px-3 py-2 font-medium">Файл</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {pageDocs.map((d) => (
                      <tr key={d.key} className="align-top">
                        <td className="break-words px-3 py-2">
                          {d.openHref ? (
                            <a href={d.openHref} target="_blank" rel="noreferrer" className="hover:underline">
                              {d.title}
                            </a>
                          ) : (
                            d.title
                          )}
                          {d.count > 1 && <span className="ml-1.5 whitespace-nowrap rounded-full bg-neutral-100 px-1.5 py-0.5 text-xs font-medium text-neutral-600">×{d.count}</span>}
                        </td>
                        <td className="px-3 py-2 text-neutral-600">{DRIVE_DOC_TYPE_LABELS[d.docType]}</td>
                        <td className="break-words px-3 py-2 tabular-nums text-neutral-600">{d.number ?? "–"}</td>
                        <td className="px-3 py-2 tabular-nums text-neutral-600">{d.date ? formatDate(d.date) : (d.year ?? "–")}</td>
                        <td className="px-3 py-2">
                          <GroupLinks d={d} />
                        </td>
                        <td className="px-3 py-2">{d.hasOriginal ? <span className="text-emerald-700">✓ прикреплён</span> : <span className="text-neutral-500">не прикреплён</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            }
          >
            {pageDocs.map((d) => (
              <RowCard
                key={d.key}
                title={<>{d.openHref ? <a href={d.openHref} target="_blank" rel="noreferrer" className="inline-block py-1.5 hover:underline">{d.title}</a> : d.title}{d.count > 1 ? <span className="ml-1.5 whitespace-nowrap text-xs font-medium text-neutral-500">×{d.count}</span> : null}</>}
                subtitle={DRIVE_DOC_TYPE_LABELS[d.docType]}
                badge={d.hasOriginal ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700">прикреплён</span> : <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-500">не прикреплён</span>}
                fields={[
                  { label: "№", value: d.number ?? "–" },
                  { label: "Дата", value: d.date ? formatDate(d.date) : (d.year ?? "–") },
                ]}
                extra={<GroupLinks d={d} mobile />}
              />
            ))}
          </ResponsiveRows>
        )}

        <div className="flex items-center justify-between text-sm text-neutral-600">
          <span>
            {docsFiltered.length === 0 ? 0 : (page - 1) * DOC_PAGE_SIZE + 1}–{Math.min(page * DOC_PAGE_SIZE, docsFiltered.length)} из {docsFiltered.length}
          </span>
          <span className="flex items-center gap-3">
            {page > 1 ? (
              <Link href={buildHref({ dpage: page - 1 > 1 ? String(page - 1) : null }, "#drive")} className="rounded-md border border-neutral-300 px-3 py-1.5 hover:bg-neutral-100">
                ← Назад
              </Link>
            ) : null}
            <span>
              стр. {page} / {pages}
            </span>
            {page < pages ? (
              <Link href={buildHref({ dpage: String(page + 1) }, "#drive")} className="rounded-md border border-neutral-300 px-3 py-1.5 hover:bg-neutral-100">
                Вперёд →
              </Link>
            ) : null}
          </span>
        </div>
      </section>
    </div>
  );
}
