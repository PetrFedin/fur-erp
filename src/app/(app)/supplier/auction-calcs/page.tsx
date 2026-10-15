import { Fragment } from "react";
import Link from "next/link";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { buttonVariants } from "@/components/ui/button";
import { prisma } from "@/lib/prisma";
import { requireRawViewer, inboxScope, INBOX_STATUS_LABEL } from "@/lib/supplier-inbox";
import { STAGE_LABEL, calcAll, calcYear, ensureRowIds, type CalcPayload } from "@/lib/supplier-calc";
import { formatDate } from "@/lib/utils";
import { SortTh } from "@/components/sort-th";
import { readSort, sortRows } from "@/lib/table-sort";

const money = (n: number) => n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const metadata = { title: "Расчёты аукционов" };

const yearOfRow = (r: { payload: unknown; updatedAt: Date }) => { const h = (r.payload as CalcPayload)?.header; return (h ? calcYear(h) : null) ?? r.updatedAt.getUTCFullYear(); };

export default async function AuctionCalcsPage({ searchParams }: PageProps<"/supplier/auction-calcs">) {
  const sp = await searchParams;
  const sort = readSort(sp, ["auction", "invoice", "supplier", "qty", "total", "avg", "status", "date"]);
  const s = await requireRawViewer();
  const isSup = s.user.role === "SUPPLIER";
  const rows = await prisma.supplierInbox.findMany({
    where: { kind: "AUCTION_CALC", ...inboxScope(s) },
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true, status: true, reviewNote: true, updatedAt: true, sentAt: true, payload: true, supplier: { select: { name: true } } },
  });
  // годы — заголовками, новые сверху; внутри года — по дате изменения
  rows.sort((a, b) => yearOfRow(b) - yearOfRow(a) || b.updatedAt.getTime() - a.updatedAt.getTime());
  // цифры считаем один раз — по ним же сортируем (при выбранной сортировке годовые заголовки не показываются)
  const metric = new Map<string, { qty: number; total: number }>();
  for (const r of rows) {
    let qty = 0, total = 0;
    try { const t = calcAll(ensureRowIds(r.payload as unknown as CalcPayload)); qty = t.qty; total = t.totalRub; } catch { /* битый черновик — без цифр */ }
    metric.set(r.id, { qty, total });
  }
  const view = sortRows(rows, sort, {
    auction: (r) => (r.payload as unknown as CalcPayload)?.header?.auction || r.title,
    invoice: (r) => (r.payload as unknown as CalcPayload)?.header?.invoice ?? "",
    supplier: (r) => r.supplier.name,
    qty: (r) => metric.get(r.id)?.qty || null,
    total: (r) => metric.get(r.id)?.total || null,
    avg: (r) => { const m = metric.get(r.id); return m?.qty ? m.total / m.qty : null; },
    status: (r) => INBOX_STATUS_LABEL[r.status],
    date: (r) => r.sentAt ?? r.updatedAt,
  });
  const P = "/supplier/auction-calcs";
  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: "Расчёты аукционов" }]} />
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Расчёты аукционов</h1>
        {isSup && <Link href="/supplier/auction-calcs/new" className={buttonVariants({ size: "sm" })}>+ Новый расчёт</Link>}
      </div>
      <p className="text-sm text-neutral-600">Внесите лоты и расходы — итог посчитается сам. Мы получим расчёт черновиком и примем после проверки.</p>
      <Table className="min-w-[720px]">
        <Thead><Tr>
          <SortTh path={P} sp={sp} k="auction" cur={sort} label="Аукцион" />
          <SortTh path={P} sp={sp} k="invoice" cur={sort} label="Счёт" />
          {!isSup && <SortTh path={P} sp={sp} k="supplier" cur={sort} label="Поставщик" />}
          <SortTh path={P} sp={sp} k="qty" cur={sort} label="Шкур" align="right" />
          <SortTh path={P} sp={sp} k="total" cur={sort} label="Итого, ₽" align="right" />
          <SortTh path={P} sp={sp} k="avg" cur={sort} label="Средняя за шкуру, ₽" align="right" />
          <SortTh path={P} sp={sp} k="status" cur={sort} label="Статус" />
          <SortTh path={P} sp={sp} k="date" cur={sort} label="Дата" />
        </Tr></Thead>
        <Tbody>
          {view.map((r, idx) => {
            const pl = r.payload as unknown as CalcPayload;
            const yr = yearOfRow(r);
            const heading = !sort && (idx === 0 || yearOfRow(view[idx - 1]) !== yr);
            const { qty, total } = metric.get(r.id)!;
            const stage = pl?.stage;
            return (
              <Fragment key={r.id}>
              {heading && <Tr><Td colSpan={8} className="bg-neutral-50 py-1.5 text-sm font-semibold">{yr} год</Td></Tr>}
              <Tr>
                <Td><Link className="font-medium underline max-md:inline-block max-md:py-3" href={`/supplier/auction-calcs/${r.id}`}>{pl?.header?.auction || r.title}</Link>{r.status === "REJECTED" && r.reviewNote && <div className="mt-0.5 text-xs text-red-700">Замечание: {r.reviewNote}</div>}</Td>
                <Td>{pl?.header?.invoice || "—"}</Td>
                {!isSup && <Td>{r.supplier.name}</Td>}
                <Td className="text-right tabular-nums">{qty || "—"}</Td>
                <Td className="text-right tabular-nums">{qty ? money(total) : "—"}</Td>
                <Td className="text-right tabular-nums">{qty ? money(total / qty) : "—"}</Td>
                <Td>{INBOX_STATUS_LABEL[r.status]}{stage && <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${stage === "FINAL" ? "bg-green-50 text-green-800" : "bg-blue-50 text-blue-800"}`}>{STAGE_LABEL[stage]}</span>}</Td>
                <Td className="whitespace-nowrap tabular-nums">{formatDate(r.sentAt ?? r.updatedAt)}</Td>
              </Tr>
              </Fragment>
            );
          })}
          {rows.length === 0 && <Tr><Td colSpan={8} className="py-8 text-center text-neutral-500">Расчётов пока нет — нажмите «+ Новый расчёт»</Td></Tr>}
        </Tbody>
      </Table>
    </div>
  );
}
