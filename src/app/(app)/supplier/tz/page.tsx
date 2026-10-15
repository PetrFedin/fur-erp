import Link from "next/link";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { buttonVariants } from "@/components/ui/button";
import { prisma } from "@/lib/prisma";
import { requireInboxViewer, inboxScope, INBOX_STATUS_LABEL } from "@/lib/supplier-inbox";
import { TzRowButtons } from "./tz-preview";
import { formatDate } from "@/lib/utils";
import { SortTh } from "@/components/sort-th";
import { readSort, sortRows } from "@/lib/table-sort";
import { tzTotals, type TzPayload } from "@/lib/tz-vendor";

export const metadata = { title: "ТЗ поставщика" };

type Pl = { batch?: string; totals?: { qty?: number } } | null;

/** ТЗ по партиям — как в нашем разделе «ТЗ»: партия сворачивается, внутри список ТЗ с количеством и статусом. */
export default async function SupplierTzPage({ searchParams }: PageProps<"/supplier/tz">) {
  const sp = await searchParams;
  const sort = readSort(sp, ["title", "supplier", "qty", "status", "date"]);
  const s = await requireInboxViewer();
  const isSup = s.user.role === "SUPPLIER";
  const rows = await prisma.supplierInbox.findMany({
    where: { kind: "TZ", ...inboxScope(s) }, orderBy: { updatedAt: "desc" },
    select: { id: true, title: true, status: true, reviewNote: true, updatedAt: true, sentAt: true, payload: true, supplier: { select: { name: true } } },
  });
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const b = String((r.payload as Pl)?.batch ?? "").trim();
    const key = b ? (/^\d+$/.test(b) ? b : b) : "";
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const ordered = [...groups.entries()].sort(([a], [b]) => {
    if (!a) return 1;
    if (!b) return -1;
    const na = Number(a), nb = Number(b);
    return Number.isFinite(na) && Number.isFinite(nb) ? nb - na : b.localeCompare(a, "ru");
  });
  const qty = (r: (typeof rows)[number]) => {
    const pl = r.payload as unknown as TzPayload | null;
    const saved = Number((pl as unknown as Pl)?.totals?.qty ?? 0);
    return saved || (pl && Array.isArray(pl.items) ? tzTotals(pl).qty : 0);
  };
  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: "ТЗ" }]} />
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">ТЗ</h1>
        {isSup && <Link href="/supplier/tz/new" className={buttonVariants({ size: "sm" })}>+ Новое ТЗ</Link>}
      </div>
      <p className="text-sm text-neutral-600">Отправленное приходит к нам на проверку.</p>
      {ordered.length === 0 && <p className="rounded-lg border border-dashed border-neutral-300 bg-white px-4 py-8 text-center text-sm text-neutral-500">ТЗ пока нет{isSup ? " — нажмите «+ Новое ТЗ»" : ""}.</p>}
      {ordered.map(([batch, list], gi) => {
        const total = list.reduce((t, r) => t + qty(r), 0);
        return (
          <details key={batch || "none"} open={gi === 0} className="group rounded-lg border border-neutral-200 bg-white" data-batch={batch || "none"}>
            <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 [&::-webkit-details-marker]:hidden">
              <span aria-hidden className="inline-block w-3 text-neutral-500 transition-transform group-open:rotate-90">›</span>
              <span className="font-semibold">{batch ? `Партия ${batch}` : "Вне партий"}</span>
              <span className="text-xs text-neutral-500">ТЗ: {list.length} · изделий: {total || "—"}</span>
            </summary>
            <div className="overflow-x-auto border-t border-neutral-100">
              <Table className="min-w-[820px]">
                <Thead><Tr>
                  <SortTh path="/supplier/tz" sp={sp} k="title" cur={sort} label="ТЗ" />
                  {!isSup && <SortTh path="/supplier/tz" sp={sp} k="supplier" cur={sort} label="Поставщик" />}
                  <SortTh path="/supplier/tz" sp={sp} k="qty" cur={sort} label="Изделий" align="right" />
                  <SortTh path="/supplier/tz" sp={sp} k="status" cur={sort} label="Статус" />
                  <SortTh path="/supplier/tz" sp={sp} k="date" cur={sort} label="Изменено" />
                  <Th />
                </Tr></Thead>
                <Tbody>
                  {sortRows(list, sort, { title: (r) => r.title, supplier: (r) => r.supplier.name, qty: (r) => qty(r) || null, status: (r) => INBOX_STATUS_LABEL[r.status], date: (r) => r.sentAt ?? r.updatedAt }).map((r) => (
                    <Tr key={r.id}>
                      <Td><Link className="font-medium underline max-md:inline-block max-md:py-3" href={`/supplier/tz/${r.id}`}>{r.title}</Link>{r.status === "REJECTED" && r.reviewNote && <div className="mt-0.5 text-xs text-red-700">Замечание: {r.reviewNote}</div>}</Td>
                      {!isSup && <Td>{r.supplier.name}</Td>}
                      <Td className="text-right tabular-nums">{qty(r) || "—"}</Td>
                      <Td>{INBOX_STATUS_LABEL[r.status]}</Td>
                      <Td className="tabular-nums">{formatDate(r.sentAt ?? r.updatedAt)}</Td>
                      <Td className="whitespace-nowrap"><Link href={`/supplier/tz/${r.id}`} className={buttonVariants({ size: "sm", variant: "outline" })}>Открыть</Link> <TzRowButtons id={r.id} /></Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </div>
          </details>
        );
      })}
    </div>
  );
}
