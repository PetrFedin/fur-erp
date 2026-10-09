import { auctionLabeler } from "@/lib/filter-options";
import Link from "next/link";
import { ControlTabs } from "@/components/control-tabs";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { Card } from "@/components/ui/card";
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
import { REGISTRY_UPDATE_CMD, registryCoverage, type RegStat } from "@/lib/registry-coverage";
import { formatDate, formatMoney } from "@/lib/utils";
import { InfoHint } from "@/components/info-hint";
import { getYearFilter } from "@/lib/year-filter";
import { cn } from "@/lib/utils";
import { TodoSummary } from "./todo-summary";
import { FilterBar } from "@/components/filters/filter-bar";
import { defineFilters, filterHref, parseFilters, pick, stateParam } from "@/lib/filters";
import { LazyDetails } from "../lots/lazy-details";
import { loadDocGroup } from "./group-actions";
import { GroupCards, GroupTableRows, MatrixRow, MobileCard, OrigCell, RegGroupCell, sectionLayout, sortGroupRows } from "./matrix-rows";

export const metadata = { title: "Документы" };

type SP = Record<string, string | string[] | undefined>;

// Один язык фильтров: поиск `q` (прежнее `dq`) общий для матрицы и списка документов; страница списка — `page` (прежнее `dpage`).
const DOC_FILTERS = defineFilters({
  ...pick(["q", "auction", "sort"], { auction: { label: "Партия закупки", aliases: [] }, sort: { role: "filter", label: "Сортировка", allowed: ["gaps"] } }),
  section: { kind: "multi", label: "Раздел", allowed: SECTION_ORDER },
  gaps: { kind: "multi", label: "Пробелы", allowed: ["1"] },
  dtype: { kind: "multi", label: "Тип документа" },
  dlink: { kind: "multi", label: "Привязан к" },
  page: stateParam("Страница", { aliases: ["dpage"], pattern: /^\d{1,6}$/ }),
});
const MULTI_KEYS = new Set(["section", "auction", "gaps", "dtype", "dlink"]);

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
  const visible = filterCovRows(cov.rows, f);
  const exportQs = new URLSearchParams();
  for (const v of f.section) exportQs.append("section", v);
  for (const v of f.auction) exportQs.append("auction", v);
  if (f.q) exportQs.set("q", f.q);
  const totalGaps = yearRows.filter((r) => r.gaps.length > 0).length;

  // ---------- Drive-блок
  // Одинаковые файлы (название + тип + размер) схлопнуты в одну строку «×N»; привязки — в раскрывающемся списке.
  const docsFiltered = groupDocList(filterDocList(docList, df)).sort((a, b) => a.title.localeCompare(b.title, "ru"));
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
                  <b>Процент</b> — сколько обязательных документов уже есть из тех, что нужны по правилам (правила — в файле src/lib/doc-coverage.ts). «100 %» ставится только при нуле пробелов. <b>Оригинал</b> — лежит ли сам файл в приложении, а не только запись без файла: сейчас {withOriginal} из {docList.length} документов.
                </p>
                <p>
                  <b>Год</b> берётся из шапки (Все / 2025 / 2026): закупка — по дате закупки, ТЗ — по году партии или даты ТЗ, оплата — по дате оплаты, документ — по дате документа. Плитки сверху и таблицы пересчитываются.
                </p>
              </div>
            </InfoHint>
          </div>
        </div>
        <a
          href={`/documents/export${exportQs.toString() ? `?${exportQs}` : ""}`}
          className="inline-flex h-9 items-center rounded-md border border-neutral-300 bg-white px-3 text-sm hover:bg-neutral-100"
        >
          Скачать список недостающих (CSV)
        </a>
      </div>

      {/* ---------- сводка */}
      <section aria-label="Сводка покрытия" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-7">
        <SummaryTile title="Всего" stat={sum.total} href={buildHref({ section: null, gaps: "1", dpage: null })} strong />
        {sum.sections.map((s) => (
          <SummaryTile key={s.key} title={SECTION_TITLES[s.key]} stat={s} href={buildHref({ section: s.key, gaps: "1", dpage: null })} />
        ))}
      </section>

      <TodoSummary organizationId={orgId} year={yf} />

      <RegistryBlock />

      {/* ---------- фильтры матрицы */}
      <FilterBar
        title="Фильтры анализа документов"
        controls={[
          { type: "text", name: "q", label: "Поиск", aliases: ["dq"], placeholder: "номер, название…" },
          { type: "multi", name: "section", label: "Раздел", options: SECTION_ORDER.map((k) => ({ value: k, label: SECTION_TITLES[k] })), allLabel: "Все разделы" },
          { type: "multi", name: "auction", label: "Партия закупки (аукцион)", options: auctions.map((a) => ({ value: a, label: aucOf(a).label, title: aucOf(a).title })), allLabel: "Все партии" },
          { type: "multi", name: "gaps", label: "Пробелы", single: true, options: [{ value: "1", label: "Только с пробелами" }], allLabel: "Все записи" },
          { type: "multi", name: "sort", label: "Сортировка", single: true, options: [{ value: "gaps", label: "По числу пробелов" }], allLabel: "По порядку" },
        ]}
      />

      {/* ---------- матрица */}
      {visible.length === 0 ? (
        <Card className="p-8 text-center text-neutral-600">
          {f.gaps && cov.rows.length > 0 ? "По этим фильтрам пробелов нет ✓" : "Записей по этим фильтрам нет."}
        </Card>
      ) : (
        SECTION_ORDER.filter((k) => visible.some((r) => r.section === k)).map((k) => (
          <SectionMatrix key={k} section={k} rows={visible.filter((r) => r.section === k)} f={f} />
        ))
      )}
      <Legend totalGaps={totalGaps} />

      {/* ---------- Все документы */}
      <section id="drive" className="flex scroll-mt-4 flex-col gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            Все документы
            <span className="text-sm font-normal text-neutral-500">
              {docsFiltered.length} файлов · не привязаны: <strong className={unlinked > 0 ? "text-amber-700" : ""}>{unlinked}</strong>
            </span>
            <InfoHint wide label="Что в списке документов">
              Все документы (файлы и записи без файла) вместе: {allGroups} файлов ({docList.length} привязок). Одинаковый файл, привязанный к нескольким записям, показан одной строкой «×N». Не привязаны ни к чему: {unlinked}. Год — из шапки.
            </InfoHint>
          </h2>
        </div>

        <FilterBar
          title="Фильтры документов"
          controls={[
            { type: "text", name: "q", label: "Поиск по названию / номеру", aliases: ["dq"], placeholder: "например, УПД 109" },
            { type: "multi", name: "dtype", label: "Тип документа", options: DRIVE_DOC_TYPES.filter((t) => typeCounts.get(t) || df.type.includes(t)).map((t) => ({ value: t, label: DRIVE_DOC_TYPE_LABELS[t], count: typeCounts.get(t) ?? 0 })), allLabel: "Все типы" },
            { type: "multi", name: "dlink", label: "Привязан к", options: [...Object.entries(DOC_LINK_LABELS).map(([value, label]) => ({ value, label })), { value: "none", label: "Не привязан" }], allLabel: "Любая привязка" },
          ]}
        />

        {pageDocs.length === 0 ? (
          <Card className="p-6 text-center text-neutral-600">Документов по этим условиям нет.</Card>
        ) : (
          <ResponsiveRows
            table={
              <Card className="overflow-hidden">
                <table className="w-full table-fixed text-sm">
                  <thead className="bg-neutral-50 text-left text-xs text-neutral-500">
                    <tr>
                      <th className="w-[34%] px-3 py-2 font-medium">Название</th>
                      <th className="w-[12%] px-3 py-2 font-medium">Тип</th>
                      <th className="w-[10%] px-3 py-2 font-medium">№</th>
                      <th className="w-[9%] px-3 py-2 font-medium">Дата</th>
                      <th className="px-3 py-2 font-medium">Привязан к</th>
                      <th className="w-[9%] px-3 py-2 font-medium">Оригинал</th>
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
                        <td className="px-3 py-2">{d.hasOriginal ? <span className="text-emerald-700">✓ в приложении</span> : <span className="text-neutral-500">только ссылка</span>}</td>
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
      className={cn("rounded-lg border bg-white p-3 transition-colors hover:bg-neutral-50", strong ? "border-neutral-400" : "border-neutral-200")}
    >
      <div className="text-xs text-neutral-500">{title}</div>
      <div className={cn("mt-0.5 text-2xl font-semibold tabular-nums", pctTone(stat.percent))}>{stat.percent === null ? "—" : `${stat.percent}%`}</div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-neutral-100">
        <div className={cn("h-full rounded-full", barTone(stat.percent))} style={{ width: `${stat.percent ?? 0}%` }} />
      </div>
      <div className="mt-1 text-xs text-neutral-500">
        есть {stat.have} из {stat.required}
      </div>
      <div className={cn("text-xs", stat.rowsWithGaps > 0 ? "text-red-600" : "text-emerald-700")}>
        {stat.rowsWithGaps > 0 ? `пробелы: ${stat.rowsWithGaps} из ${stat.rows}` : `без пробелов (${stat.rows})`}
      </div>
    </Link>
  );
}

function Legend({ totalGaps }: { totalGaps: number }) {
  return (
    <p className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
      <span>Всего записей с пробелами: <b>{totalGaps}</b></span>
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

function SectionMatrix({ section, rows, f }: { section: SectionKey; rows: CovRow[]; f: CovFilters }) {
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
  const openAll = !!f.gaps || !!f.q || groups.length === 1;

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
                      <span className={gapsOf(g) > 0 ? "text-red-600" : "text-emerald-700"}>{gapsOf(g) > 0 ? `пробелов: ${gapsOf(g)}` : "без пробелов"}</span>
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
              {openAll ? <GroupTableRows rows={g.rows} cols={cols.map((c) => c.key)} template={template} withReg={withReg} /> : null}
            </LazyDetails>
          ))
        : (
          <div className="divide-y divide-neutral-100">
            {groups.flatMap((g) => g.rows).map((r) => (
              <MatrixRow key={r.id} r={r} cols={cols.map((c) => c.key)} template={template} withReg={withReg} />
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
            <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold", gapsOf(g) > 0 ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700")}>
              {gapsOf(g) > 0 ? gapsOf(g) : "✓"}
            </span>
          </summary>
        }
      >
        {openAll ? <GroupCards rows={g.rows} /> : null}
      </LazyDetails>
    ))
  ) : (
    groups.flatMap((g) => g.rows).map((r) => <MobileCard key={r.id} r={r} />)
  );

  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">{SECTION_TITLES[section]}</h2>
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

const fmtPct = (p: number) => `${String(p).replace(".", ",")}%`;
const regDate = (iso: string) => formatDate(new Date(iso));

function RegStatTile({ s }: { s: RegStat }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-3" title={s.what}>
      <div className="text-xs text-neutral-500">{s.label}</div>
      <div className={cn("mt-0.5 text-xl font-semibold tabular-nums", pctTone(s.percent))}>{fmtPct(s.percent)}</div>
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
        <h2 className="flex items-center gap-2 text-base font-semibold">
          Покрытие реестром
          <InfoHint wide label="Что такое покрытие реестром и как обновить сверку">
            <div className="space-y-2">
              <p>Сколько записей единого реестра (xlsx) нашлось в базе: лоты, остатки, закупки, ТЗ, оплаты. Сверка от {regDate(r.checkedAt)} (реестр — от {regDate(r.registryDate)}).</p>
              <p><b>Как обновить сверку.</b> Сверка делается вне приложения (реестр xlsx сравнивается с базой, результат — docs-inventory/coverage-matrix.json). После новой сверки обновите данные страницы командой в корне проекта:</p>
              <p><code className="rounded bg-neutral-100 px-1.5 py-0.5">{REGISTRY_UPDATE_CMD}</code></p>
              <p>Она пересоберёт src/data/registry-coverage.json; затем закоммитьте файл. Запрос к базе она не делает.</p>
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
                <Link href="/purchases/new" className="underline hover:text-neutral-900">
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
