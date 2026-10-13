import { Breadcrumbs } from "@/components/breadcrumbs";
import Link from "next/link";
import { InfoHint } from "@/components/info-hint";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { ACCESS, hasRole } from "@/lib/access";
import { ArticlesRefTable, type ArticleRow } from "./articles-table";
import { ImportPanel } from "./import-panel";
import { getCategoryOptions } from "@/lib/categories";
import { orderUnits } from "@/lib/production-totals";
import { defineFilters, parseFilters, pick } from "@/lib/filters";

const ARTICLE_FILTERS = defineFilters({ ...pick(["q", "status"], { q: { label: "Поиск" }, status: { allowed: ["active"] } }), sales: { kind: "single", label: "Код продаж", allowed: ["none"] } });

export const metadata = { title: "Справочник артикулов" };

export default async function ArticlesRefPage({ searchParams }: PageProps<"/settings/articles-ref">) {
  const session = await requireSession();
  const orgId = session.user.organizationId;
  const f = parseFilters(ARTICLE_FILTERS, await searchParams);
  const canEdit = hasRole(session.user.role, ACCESS.models);

  const categories = await getCategoryOptions(orgId);
  const [models, grouped, producedGrouped, seasonRows] = await Promise.all([
    prisma.productModel.findMany({ where: { organizationId: orgId }, orderBy: { name: "asc" } }),
    prisma.productionOrder.groupBy({
      by: ["productModelId"],
      where: { organizationId: orgId, status: { not: "CANCELLED" } },
      _count: { _all: true },
    }),
    prisma.productionOrder.findMany({
      where: { organizationId: orgId, status: { not: "CANCELLED" } },
      select: { productModelId: true, status: true, plannedQuantity: true, producedQuantity: true },
    }),
    prisma.productionOrder.findMany({
      where: { organizationId: orgId, status: { not: "CANCELLED" }, seasonId: { not: null } },
      distinct: ["productModelId", "seasonId"],
      select: { productModelId: true, season: { select: { code: true } } },
    }),
  ]);
  const stat = new Map(grouped.map((g) => [g.productModelId, g]));
  // «Произведено» — все ТЗ без отменённых (production-totals.ts): выпуск завершённых + план ТЗ в работе.
  const producedBy = new Map<string, number>();
  for (const o of producedGrouped) producedBy.set(o.productModelId, (producedBy.get(o.productModelId) ?? 0) + orderUnits(o));
  const seasons = new Map<string, string[]>();
  for (const s of seasonRows) {
    const code = s.season?.code;
    if (code) seasons.set(s.productModelId, [...(seasons.get(s.productModelId) ?? []), code]);
  }
  const rows: ArticleRow[] = models.map((m) => ({
    id: m.id,
    name: m.name,
    sku: m.sku,
    category: m.category,
    categoryRefId: m.categoryRefId,
    salesCode: m.salesCode,
    salesName: m.salesName,
    aliases: m.aliases,
    lengthClass: m.lengthClass,
    isActive: m.isActive,
    sellingPrice: m.sellingPrice ? Number(m.sellingPrice) : null,
    seasons: Array.from(new Set(seasons.get(m.id) ?? [])).sort(),
    tzCount: stat.get(m.id)?._count._all ?? 0,
    produced: producedBy.get(m.id) ?? 0,
  }));

  const withSales = rows.filter((r) => r.salesCode?.trim()).length;
  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: "Настройки", href: "/settings" }, { label: "Артикулы" }]} />
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold">Справочник артикулов</h1><InfoHint label="О справочнике" wide>
        Один артикул — одна запись. У нас он ведётся под кодом <b>M…</b>, в системе продаж — под своим кодом и названием: впишите их рядом, чтобы
        артикул находился по любому написанию во всех формах выбора. Сопоставлено с системой продаж: <b>{withSales}</b> из <b>{rows.length}</b>.
      </InfoHint></div>
        <div className="flex gap-3 text-sm">
          <Link href="/settings" className="text-neutral-500 hover:underline">← Настройки</Link>
          <Link href="/articles" className="text-neutral-500 hover:underline">Изделия (себестоимость, остаток)</Link>
        </div>
      </div>
      <ArticlesRefTable rows={rows} canEdit={canEdit} categories={categories} canCreateCategory={hasRole(session.user.role, ACCESS.categories)} initial={{ q: f.q, noSales: f.sales === "none", onlyActive: f.status.includes("active") }} />
      {canEdit && <ImportPanel />}
    </div>
  );
}
