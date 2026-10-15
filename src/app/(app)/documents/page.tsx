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
import {
  SECTION_ORDER,
  SECTION_TITLES,
  computeDocCoverage,
  summarize,
  filterCovRows,
  parseCovFilters,
  type CovFilters,
  type CovRow,
  type SectionKey,
  type SectionStat,
} from "@/lib/doc-coverage";
import {
  DOC_LINK_LABELS,
  DOC_PAGE_SIZE,
  filterDocList,
  groupDocList,
  type DocGroup,
  loadDocList,
  parseDocListFilters,
} from "@/lib/drive-doc-list";
import { DRIVE_DOC_TYPES, DRIVE_DOC_TYPE_LABELS } from "@/lib/drive-docs";
import { registryCoverage, type RegStat } from "@/lib/registry-coverage";
import { formatDate, formatMoney, formatPercent } from "@/lib/utils";
import { RELIABILITY_NOTE } from "@/lib/reliability-note";
import { InfoHint } from "@/components/info-hint";
import { getYearFilter } from "@/lib/year-filter";
import { cn } from "@/lib/utils";
import { TodoSummary } from "./todo-summary";
import { AnalysisSection } from "./analysis-section";
import { BulkUpload } from "./bulk-upload";
import { ACCESS, hasRole } from "@/lib/access";
import { TILE_BOX, TileHead } from "@/app/(app)/dashboard/tile";
import { FilterBar } from "@/components/filters/filter-bar";
import { defineFilters, filterHref, parseFilters, pick, stateParam } from "@/lib/filters";
import { LazyDetails } from "../lots/lazy-details";
import { loadDocGroup } from "./group-actions";
import { loadCovVer, type VerMap } from "./ver-status";
import { GroupCards, GroupTableRows, MatrixRow, MobileCard, OrigCell, RegGroupCell, sectionLayout, sortGroupRows } from "./matrix-rows";

export const metadata = { title: "Документы" };

type SP = Record<string, string | string[] | undefined>;

// Один язык фильтров: поиск `q` (прежнее `dq`) общий для матрицы и списка документов; страница списка — `page` (прежнее `dpage`).
const DOC_FILTERS = defineFilters({
  ...pick(["q", "auction", "sort"], { auction: { label: "Аукцион / закупка", aliases: [] }, sort: { role: "filter", label: "Сортировка", allowed: ["gaps"] } }),
  section: { kind: "multi", label: "Раздел", allowed: SECTION_ORDER },
  gaps: { kind: "multi", label: "Нужен файл", allowed: ["1"] },
  ver: { kind: "multi", label: "Подтверждение", allowed: ["yes", "no"] },
  dtype: { kind: "multi", label: "Тип документа" },
  dlink: { kind: "multi", label: "Привязан к" },
  page: stateParam("Страница", { aliases: ["dpage"], pattern: /^\d{1,6}$/ }),
});
const MULTI_KEYS = new Set(["section", "auction", "gaps", "ver", "dtype", "dlink"]);

const pctTone = (p: number | null) =>
  p === null ? "text-neutral-500" : p >= 90 ? "text-emerald-700" : p >= 60 ? "text-amber-700" : "text-red-600";
const barTone = (p: number | null) => (p === null ? "bg-neutral-300" : p >= 90 ? "bg-emerald-500" : p >= 60 ? "bg-amber-400" : "bg-red-500");

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
                <p>Какие документы нужны по правилам, какие уже есть и чего не хватает: по закупкам, ТЗ, партиям, оплатам и договорам. Считается по базе прямо сейчас — загрузили файл или добавили ссылку на карточке, и пробел исчезает.</p>
                <p>
                  <b>Процент</b> — «документы привязаны»: сколько обязательных документов уже есть из тех, что нужны по правилам (правила заданы в программе). «100 %» ставится только при нуле пробелов. <b>Оригинал</b> — лежит ли сам файл в приложении, а не только запись без файла: сейчас {withOriginal} из {docList.length} документов.
                </p>
                <p>У записи две независимые отметки: <b>подтверждена</b> (данные проверены, файл для этого не нужен) и <b>нужен файл</b> (обязательного документа ещё нет). Фильтры «Нужен файл» и «Подтверждение» над таблицей. Нажмите на запись — откроется её карточка с документами.</p>
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
            { type: "multi", name: "gaps", label: "Нужен файл", single: true, options: [{ value: "1", label: "Только где нужен файл" }], allLabel: "Все записи" },
            { type: "multi", name: "ver", label: "Подтверждение", options: [{ value: "yes", label: "Подтверждена" }, { value: "no", label: "Не подтверждена" }], allLabel: "Любое" },
            { type: "multi", name: "sort", label: "Сортировка", more: true, single: true, options: [{ value: "gaps", label: "По числу пробелов" }], allLabel: "По порядку" },
          ]}
        />
      </div>

      {/* ---------- сводка */}
      <WidgetRow id="docs-coverage" title="Покрытие документами">
      <section aria-label="Сводка покрытия" className="grid grid-cols-2 items-stretch gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
        <SummaryTile title="Всего, шт." stat={sum.total} href={buildHref({ section: null, gaps: "1", dpage: null })} strong />
        {sum.sections.map((s) => (
          <SummaryTile key={s.key} title={SECTION_TITLES[s.key]} stat={s} href={buildHref({ section: s.key, gaps: "1", dpage: null })} />
        ))}
      </section>
      </WidgetRow>

      <TodoSummary organizationId={orgId} year={yf} />

      <AnalysisSection organizationId={orgId} year={yf} />

      {hasRole(session.user.role, ACCESS.purchases) && (
        <details className="rounded-lg border border-neutral-200 bg-white" open={false}>
          <summary className="cursor-pointer list-none px-3 py-2 text-sm font-medium hover:bg-neutral-50">Массовая загрузка документов <span className="font-normal text-neutral-500">— выбрать или перетащить несколько файлов, привязка предлагается сама</span></summary>
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
              {docsFiltered.length} файлов · не привязаны: <strong className={unlinked > 0 ? "text-amber-700" : ""}>{unlinked}</strong>
            </span>
            <InfoHint wide label="Что в списке документов">
              Все документы (файлы и записи без файла) вместе: {allGroups} файлов ({docList.length} привязок). Одинаковый файл, привязанный к нескольким записям, показан одной строкой «×N». Не привязаны ни к чему: {unlinked}. Год — из шапки.
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
                      <Th {...dth("orig")} className="w-[9%] px-3 py-2 font-medium">Оригинал</Th>
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
                        <td className="break-words px-3 py-2 tabular-nums text-neutral-600">{d.number ?? "—"}</td>
                        <td className="px-3 py-2 tabular-nums text-neutral-600">{d.date ? formatDate(d.date) : (d.year ?? "—")}</td>
                        <td className="px-3 py-2">
                          <GroupLinks d={d} />
                        </td>
                        <td className="px-3 py-2">{d.hasOriginal ? <span className="text-emerald-700">✓ в приложении</span> : <span className="text-neutral-500">файл не загружен</span>}</td>
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
                badge={d.hasOriginal ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700">файл</span> : <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-500">ссылка</span>}
                fields={[
                  { label: "№", value: d.number ?? "—" },
                  { label: "Дата", value: d.date ? formatDate(d.date) : (d.year ?? "—") },
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

function GroupLinks({ d, mobile }: { d: DocGroup; mobile?: boolean }) {
  if (d.links.length === 0) return <span className={mobile ? "text-xs text-amber-700" : "text-amber-700"}>не привязан</span>;
  const cls = mobile ? "inline-block py-1 text-xs underline" : "text-neutral-700 underline hover:text-neutral-900";
  const list = (
    <span className="flex flex-wrap gap-x-3 gap-y-0.5">
      {d.links.map((l, i) => (
        <Link key={i} href={l.href} className={cls}>
          {l.label}
        </Link>
      ))}
    </span>
  );
  if (d.count === 1 && d.links.length <= 3) return list;
  return (
    <details>
      <summary className={cn("cursor-pointer text-neutral-700", mobile && "py-1 text-xs")}>
        {d.links.length} {plural(d.links.length, "привязка", "привязки", "привязок")}
        {d.unlinked > 0 ? <span className="ml-1 text-amber-700">· без привязки: {d.unlinked}</span> : null}
      </summary>
      <div className="mt-1">{list}</div>
    </details>
  );
}

const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10;
  const m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
};

function SummaryTile({ title, stat, href, strong }: { title: string; stat: SectionStat; href: string; strong?: boolean }) {
  return (
    <Link
      href={href}
      title="Показать записи этого раздела с пробелами"
      className={cn(TILE_BOX, "shadow-sm tile-click print:shadow-none", strong && "border-neutral-400")}
    >
      <TileHead>{title}</TileHead>
      <div className={cn("mt-1 text-2xl font-semibold leading-9 tabular-nums", pctTone(stat.percent))}>{stat.percent === null ? "—" : formatPercent(stat.percent)}</div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-neutral-100">
        <div className={cn("h-full rounded-full", barTone(stat.percent))} style={{ width: `${stat.percent ?? 0}%` }} />
      </div>
      <div className="mt-1 text-xs text-neutral-500">
        документы привязаны: {stat.have} из {stat.required} документов
      </div>
      <div className={cn("text-xs", stat.rowsWithGaps > 0 ? "text-red-600" : "text-emerald-700")}>
        {stat.rowsWithGaps > 0 ? `нужен файл: ${stat.rowsWithGaps} из ${stat.rows} записей` : `без пробелов (${stat.rows} записей)`}
      </div>
    </Link>
  );
}

function Legend({ totalGaps }: { totalGaps: number }) {
  return (
    <p className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
      <span>Всего, записей с пробелами: <b>{totalGaps}</b></span>
      <InfoHint wide label="Условные обозначения таблиц">
        <ul className="space-y-1">
          <li><b className="text-emerald-700">✓ 2</b> — документ есть (сколько штук).</li>
          <li><b className="text-red-600">нет</b> — нужен по правилам, но не приложен.</li>
          <li><b>необяз.</b> — желателен, в пробелы не входит.</li>
          <li><b>не треб.</b> — по правилам не нужен.</li>
          <li>Колонка «Реестр»: <b className="text-emerald-700">✓ лист, строка</b> — запись найдена в едином реестре; <b className="text-red-700">нет в реестре</b>; серое — позже даты реестра; бледно-серое — в реестре не ведётся.</li>
        </ul>
      </InfoHint>
    </p>
  );
}

// ------------------------------------------------------------------ матрица

type Group = { key: string; title: string; sort: number; rows: CovRow[] };

function SectionMatrix({ section, rows, f, ver, verFilter }: { section: SectionKey; rows: CovRow[]; f: CovFilters; ver: VerMap; verFilter: boolean }) {
  const { cols, withReg, template } = sectionLayout(rows);

  const groupMap = new Map<string, Group>();
  for (const r of rows) {
    const g = groupMap.get(r.groupKey) ?? { key: r.groupKey, title: r.groupTitle, sort: r.groupSort, rows: [] };
    g.rows.push(r);
    groupMap.set(r.groupKey, g);
  }
  const groups = [...groupMap.values()];
  const gapsOf = (g: Group) => g.rows.reduce((s, r) => s + r.gaps.length, 0);
  if (f.sort === "gaps") groups.sort((a, b) => gapsOf(b) - gapsOf(a));
  else if (section === "purchases") groups.sort((a, b) => b.sort - a.sort || a.title.localeCompare(b.title, "ru"));
  else if (section === "tz") groups.sort((a, b) => b.sort - a.sort);
  for (const g of groups) g.rows = sortGroupRows(section, g.rows, f);
  const grouped = groups.length > 1 || (groups.length === 1 && (section === "purchases" || section === "tz"));
  const openAll = !!f.gaps || !!f.q || verFilter || groups.length === 1;

  const header = (
    <div className="grid items-end gap-1 border-b border-neutral-200 bg-neutral-50 px-3 py-2 text-[11px] font-medium leading-tight text-neutral-500" style={{ gridTemplateColumns: template }}>
      <span>Запись</span>
      {cols.map((c) => (
        <span key={c.key} className="text-center" title={c.attach}>
          {c.label}
        </span>
      ))}
      {withReg ? <span className="text-center" title="Есть ли запись в едином реестре (xlsx): лист и строка. Сверка от даты, указанной в блоке «Покрытие реестром»">Реестр</span> : null}
      <span className="text-center">Оригинал</span>
    </div>
  );

  const table = (
    <Card className="overflow-hidden">
      {header}
      {grouped
        ? groups.map((g) => (
            <LazyDetails
              key={g.key}
              defaultOpen={openAll}
              load={openAll ? undefined : loadDocGroup.bind(null, section, g.key, "table", f.auction, f.gaps ? "1" : "", f.q, f.sort)}
              className="group border-b border-neutral-100 last:border-b-0"
              summary={<summary className="grid cursor-pointer list-none items-center gap-1 bg-white px-3 py-2 hover:bg-neutral-50" style={{ gridTemplateColumns: template }}>
                <span className="flex min-w-0 items-center gap-2">
                  <span className="text-neutral-500 transition-transform group-open:rotate-90" aria-hidden>›</span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium" title={g.title}>{g.title}</span>
                    <span className="block text-xs text-neutral-500">
                      {g.rows.length} зап. ·{" "}
                      <span className={gapsOf(g) > 0 ? "text-red-600" : "text-emerald-700"}>{gapsOf(g) > 0 ? `нужен файл: ${gapsOf(g)}` : "без пробелов"}</span>
                    </span>
                  </span>
                </span>
                {cols.map((c) => {
                  const need = g.rows.filter((r) => r.cells[c.key].need === "required");
                  const ok = need.filter((r) => r.cells[c.key].ok).length;
                  return (
                    <span key={c.key} className={cn("text-center text-xs tabular-nums", need.length === 0 ? "text-neutral-300" : ok === need.length ? "text-emerald-700" : ok === 0 ? "text-red-600" : "text-amber-700")}>
                      {need.length === 0 ? "" : `${ok}/${need.length}`}
                    </span>
                  );
                })}
                {withReg ? <RegGroupCell rows={g.rows} /> : null}
                <OrigCell have={g.rows.reduce((s, r) => s + r.origHave, 0)} total={g.rows.reduce((s, r) => s + r.origTotal, 0)} />
              </summary>}
            >
              {openAll ? <GroupTableRows rows={g.rows} cols={cols.map((c) => c.key)} template={template} withReg={withReg} ver={ver} /> : null}
            </LazyDetails>
          ))
        : (
          <div className="divide-y divide-neutral-100">
            {groups.flatMap((g) => g.rows).map((r) => (
              <MatrixRow key={r.id} r={r} cols={cols.map((c) => c.key)} template={template} withReg={withReg} ver={ver} />
            ))}
          </div>
        )}
    </Card>
  );

  const cards = grouped ? (
    groups.map((g) => (
      <LazyDetails
        key={g.key}
        defaultOpen={openAll}
        load={openAll ? undefined : loadDocGroup.bind(null, section, g.key, "cards", f.auction, f.gaps ? "1" : "", f.q, f.sort)}
        className="rounded-lg border border-neutral-200 bg-white"
        summary={
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 p-3 text-sm">
            <span className="min-w-0 break-words font-medium">{g.title}</span>
            <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-medium", gapsOf(g) > 0 ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700")}>
              {gapsOf(g) > 0 ? gapsOf(g) : "✓"}
            </span>
          </summary>
        }
      >
        {openAll ? <GroupCards rows={g.rows} ver={ver} /> : null}
      </LazyDetails>
    ))
  ) : (
    groups.flatMap((g) => g.rows).map((r) => <MobileCard key={r.id} r={r} ver={ver} />)
  );

  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h2 className="block-title">{SECTION_TITLES[section]}</h2>
        {/* Процент — только в плитках сверху; здесь число пробелов. */}
        {(() => {
          const n = rows.filter((r) => r.gaps.length > 0).length;
          return n > 0 ? (
            <span className="text-sm font-medium tabular-nums text-red-600">
              {n} {plural(n, "пробел", "пробела", "пробелов")}
            </span>
          ) : (
            <span className="text-sm text-emerald-700">без пробелов</span>
          );
        })()}
      </div>
      <ResponsiveRows table={table}>{cards}</ResponsiveRows>
    </section>
  );
}

// ------------------------------------------------------------------ реестр

const fmtPct = (p: number) => formatPercent(p);
const regDate = (iso: string) => formatDate(new Date(iso));

function RegStatTile({ s }: { s: RegStat }) {
  return (
    <div className={TILE_BOX + " shadow-sm print:shadow-none"} title={s.what}>
      <TileHead>{s.label}</TileHead>
      <div className={cn("mt-1 text-2xl font-semibold leading-9 tabular-nums", pctTone(s.percent))}>{fmtPct(s.percent)}</div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-neutral-100">
        <div className={cn("h-full rounded-full", barTone(s.percent))} style={{ width: `${s.percent}%` }} />
      </div>
      <div className="mt-1 text-xs text-neutral-500">{s.have}</div>
    </div>
  );
}

function RegistryBlock() {
  const r = registryCoverage;
  return (
    <details aria-label="Покрытие реестром" className="group rounded-lg border border-neutral-200 bg-neutral-50 p-3">
      <summary className="flex cursor-pointer list-none flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="flex items-center gap-2 block-title">
          Покрытие реестром
          <InfoHint wide label="Что такое покрытие реестром и как обновить сверку">
            <div className="space-y-2">
              <p>Сколько записей единого реестра (xlsx) нашлось в базе: лоты, остатки, закупки, ТЗ, оплаты. Сверка от {regDate(r.checkedAt)} (реестр — от {regDate(r.registryDate)}).</p>
              <p><b>Как обновить сверку.</b> Сверка делается вне приложения: реестр из таблицы сравнивается с базой. После новой сверки попросите разработчика обновить данные этой страницы.</p>
              <p>Обновление не меняет данные в базе.</p>
            </div>
          </InfoHint>
        </h2>
        <span className="text-xs text-neutral-500">сверка от {regDate(r.checkedAt)} · в реестре, но не в базе: {r.registryOnly.length} · <span className="text-blue-700">показать ›</span></span>
      </summary>
      <div className="mt-3 flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {r.coverage.map((s) => (
          <RegStatTile key={s.key} s={s} />
        ))}
      </div>
      <h3 className="text-sm font-medium">Обратное покрытие: что из базы подтверждено реестром</h3>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {r.backCoverage.map((s) => (
          <RegStatTile key={s.key} s={s} />
        ))}
      </div>

      <h3 className="text-sm font-medium">Есть в реестре, но нет в базе ({r.registryOnly.length})</h3>
      <ul className="flex flex-col gap-2">
        {r.registryOnly.map((it, i) => (
          <li key={i} className="rounded-md border border-amber-200 bg-amber-50 p-2 text-sm">
            <div className="break-words font-medium text-neutral-900">{it.title}</div>
            <div className="mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-neutral-600">
              {it.qty !== null ? <span>{it.qty} шт</span> : null}
              {it.amount !== null ? <span className="tabular-nums">{formatMoney(String(it.amount))}</span> : null}
              <span>
                лист «{it.sheet}», {it.rows.includes("–") || it.rows.includes(",") ? "строки" : "строка"} {it.rows}
              </span>
              {it.note ? <span className="text-amber-700">{it.note}</span> : null}
              {it.kind === "purchase" ? (
                <Link href="/purchases/batch" className="underline hover:text-neutral-900">
                  Как добавить
                </Link>
              ) : (
                <Link href="/purchases?q=%D0%97-2026-0058" className="underline hover:text-neutral-900">
                  Открыть закупку
                </Link>
              )}
            </div>
          </li>
        ))}
      </ul>
      <p className="flex items-center gap-2 text-xs text-neutral-500">
        Как добавить недостающие записи
        <InfoHint wide label="Как добавить запись из реестра">
          «Как добавить»: откройте «Закупки → Новая закупка», внесите поставщика, лоты и сумму по строкам реестра;  Если закупка не ваша — отметьте строки отчёта у владельца как «не наша».
        </InfoHint>
      </p>
      </div>
    </details>
  );
}
