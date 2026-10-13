import { Breadcrumbs } from "@/components/breadcrumbs";
import Link from "next/link";
import { InfoHint } from "@/components/info-hint";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { ACCESS, hasRole } from "@/lib/access";
import { buildFurIndex } from "@/lib/fur-ref";
import { loadFurUsage } from "@/lib/fur-usage";
import { FursTable, type FurRow } from "./furs-table";
import { FilterBar } from "@/components/filters/filter-bar";
import { defineFilters, parseFilters, pick } from "@/lib/filters";

// Фильтры справочника: поиск по русскому и английскому названию, синонимам, примечанию; «используется / не используется».
const FUR_FILTERS = defineFilters({ ...pick(["q", "status"], { q: { label: "Поиск" }, status: { allowed: ["used", "unused"] } }) });

export const metadata = { title: "Справочник меха" };

export default async function FursPage({ searchParams }: PageProps<"/settings/furs">) {
  const session = await requireSession();
  const orgId = session.user.organizationId;
  const f = parseFilters(FUR_FILTERS, await searchParams);
  const canEdit = hasRole(session.user.role, ACCESS.furRefs);
  const refs = await prisma.furRef.findMany({ where: { organizationId: orgId }, orderBy: { name: "asc" } });
  const usage = await loadFurUsage(orgId, refs, buildFurIndex(refs));
  const rows: FurRow[] = refs.map((r) => {
    const u = usage.byRef.get(r.id);
    return { id: r.id, name: r.name, nameEn: r.nameEn, aliases: r.aliases, note: r.note, lots: u?.lots ?? 0, items: u?.items ?? 0, orders: u?.orders ?? 0, seen: u?.seen ?? [] };
  });
  const needle = f.q.trim().toLowerCase();
  const shownRows = rows.filter(
    (r) =>
      (f.status.length === 0 || f.status.includes(r.lots + r.items + r.orders > 0 ? "used" : "unused")) &&
      (!needle || [r.name, r.nameEn ?? "", ...r.aliases, r.note ?? ""].some((x) => x.toLowerCase().includes(needle))),
  );
  const T = usage.totals;
  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: "Настройки", href: "/settings" }, { label: "Мех" }]} />
      <div>
        <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold">Справочник меха</h1><InfoHint label="О справочнике" wide>
        Один вид меха — одна запись: русское название (его видно в аналитике и лотах), английское (из инвойсов и спецификаций — показывается в подсказке) и синонимы.
        В инвойсах мех написан латиницей («sable», «mink», «swakara»), в ТЗ — по-русски («шкура норки», «соболя»): любое из этих написаний приводится к русскому названию.
        Сопоставлено: лотов <b>{T.lotsMatched}</b> из <b>{T.lots}</b>, позиций закупок <b>{T.itemsMatched}</b> из <b>{T.items}</b>, ТЗ <b>{T.ordersMatched}</b> из <b>{T.orders}</b>.
      </InfoHint></div>
      </div>
      <FilterBar
        title="Фильтры меха"
        oneRow
        hideChips
        className="print:hidden"
        controls={[
          { type: "text", name: "q", label: "Поиск", placeholder: "Название, английское, синоним" },
          { type: "multi", name: "status", label: "Использование", options: [{ value: "used", label: "Используется" }, { value: "unused", label: "Не используется" }], allLabel: "Все" },
        ]}
      />
      <FursTable rows={shownRows} allRows={rows} canEdit={canEdit} />

      {(usage.unmatchedMaterials.length > 0 || usage.unmatchedOrders.length > 0) && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm">
          <h2 className="mb-2 block-title">Не сопоставлено с видом меха — ждёт ручного решения</h2>
          {usage.unmatchedMaterials.length > 0 && (
            <p className="mb-2">
              Материалы (не подкладка): {usage.unmatchedMaterials.map((m) => `«${m.name}» (лотов ${m.lots}, позиций ${m.items})`).join("; ")}.
            </p>
          )}
          {usage.unmatchedOrders.length > 0 && (
            <p className="mb-2">
              Описания в ТЗ без названия меха ({usage.unmatchedOrders.reduce((s, x) => s + x.orders, 0)} ТЗ):{" "}
              {usage.unmatchedOrders.slice(0, 25).map((x) => `«${x.text}» ×${x.orders}`).join("; ")}
              {usage.unmatchedOrders.length > 25 ? "…" : ""}.
            </p>
          )}
          <p className="text-neutral-600">Чтобы сопоставить, добавьте нужное написание как синоним подходящего вида меха (кнопка «Изменить») или создайте новый вид.</p>
        </div>
      )}
    </div>
  );
}
