"use server";

import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { computeDocCoverage, filterCovRows, parseCovFilters, SECTION_ORDER, type SectionKey } from "@/lib/doc-coverage";
import { getYearFilter } from "@/lib/year-filter";
import { GroupCards, GroupTableRows, sectionLayout, sortGroupRows } from "./matrix-rows";

/**
 * Строки одной свёрнутой группы матрицы покрытия — подгружаются при раскрытии, а не рисуются вместе со страницей
 * (иначе «Документы» весили бы мегабайты). Фильтры — те же, что у страницы (раздел/аукцион/«только с пробелами»/поиск/сортировка),
 * год — из шапки (cookie), организация — из сессии, не от клиента.
 */
export async function loadDocGroup(section: string, groupKey: string, variant: "table" | "cards", auction: string[], gaps: string, q: string, sort: string) {
  const session = await requireSession();
  if (!(SECTION_ORDER as string[]).includes(section)) return null;
  const yf = await getYearFilter();
  const f = { ...parseCovFilters({ auction: (Array.isArray(auction) ? auction : []).slice(0, 60).map((a) => String(a).slice(0, 200)), gaps: String(gaps), q: String(q), sort: String(sort) }), year: yf === "all" ? null : Number(yf) };
  const cov = await computeDocCoverage(prisma, session.user.organizationId);
  const sectionRows = filterCovRows(cov.rows, f).filter((r) => r.section === section);
  const rows = sortGroupRows(section as SectionKey, sectionRows.filter((r) => r.groupKey === String(groupKey)), f);
  if (variant === "cards") return <GroupCards rows={rows} />;
  const { cols, template, withReg } = sectionLayout(sectionRows);
  return <GroupTableRows rows={rows} cols={cols.map((c) => c.key)} template={template} withReg={withReg} />;
}
