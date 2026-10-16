import { readSort, sortRows, thSort } from "@/lib/table-sort";
import Link from "next/link";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { ControlTabs } from "@/components/control-tabs";
import { Clamp } from "@/components/clamp";
import { InfoHint } from "@/components/info-hint";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { ACCESS } from "@/lib/access";
import { INBOX_STATUS_LABEL, shortInboxTitle } from "@/lib/supplier-inbox-consts";
import { cn, formatDate } from "@/lib/utils";

export const metadata = { title: "Входящие" };

const FILTERS = [
  { key: "SENT", label: "На проверке" },
  { key: "ACCEPTED", label: "Принято" },
  { key: "REJECTED", label: "Отклонено" },
  { key: "all", label: "Все" },
] as const;
const KIND_LABEL: Record<string, string> = { AUCTION_CALC: "Расчёт аукциона", TZ: "ТЗ", DOCUMENT: "Документ" };

export default async function InboxPage({ searchParams }: PageProps<"/inbox">) {
  const s = await requireRole(...ACCESS.inbox);
  const sp = await searchParams;
  const st = FILTERS.some((f) => f.key === sp.status) ? String(sp.status) : "SENT";
  const q = (typeof sp.q === "string" ? sp.q : "").trim().slice(0, 100);
  const orgId = s.user.organizationId;
  // Черновики поставщика (DRAFT) сюда не попадают: пока он не нажал «Отправить нам», это его личное.
  const where = {
    organizationId: orgId,
    status: st === "all" ? { in: ["SENT", "ACCEPTED", "REJECTED"] as ("SENT" | "ACCEPTED" | "REJECTED")[] } : (st as "SENT" | "ACCEPTED" | "REJECTED"),
    ...(q ? { OR: [{ title: { contains: q, mode: "insensitive" as const } }, { supplier: { name: { contains: q, mode: "insensitive" as const } } }] } : {}),
  };
  const [rows0, counts] = await Promise.all([
    prisma.supplierInbox.findMany({
      where, orderBy: [{ sentAt: "desc" }, { updatedAt: "desc" }], take: 300,
      select: { id: true, kind: true, title: true, status: true, sentAt: true, decidedAt: true, payload: true, supplier: { select: { name: true } } },
    }),
    prisma.supplierInbox.groupBy({ by: ["status"], where: { organizationId: orgId }, _count: true }),
  ]);
  const sort = readSort(sp, ["title", "kind", "supplier", "qty", "status", "sent"]);
  const rows = sortRows(rows0, sort, {
    title: (r) => r.title, kind: (r) => KIND_LABEL[r.kind], supplier: (r) => r.supplier.name,
    qty: (r) => (r.payload as { totals?: { qty?: number } })?.totals?.qty ?? null, status: (r) => INBOX_STATUS_LABEL[r.status], sent: (r) => r.sentAt ?? r.decidedAt,
  });
  const th = (k: string) => thSort("/inbox", sp, k, sort);
  const cnt = (k: string) => (k === "all" ? counts.filter((c) => c.status !== "DRAFT").reduce((a, c) => a + c._count, 0) : (counts.find((c) => c.status === k)?._count ?? 0));
  const href = (status: string) => `/inbox?status=${status}${q ? `&q=${encodeURIComponent(q)}` : ""}`;

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: "Контроль", href: "/attention" }, { label: "Входящие" }]} />
      <ControlTabs active="inbox" />
      <h1 className="text-xl font-semibold">Входящие</h1>
      <p className="flex items-center gap-1.5 text-sm text-neutral-600">
        Присланное подрядчиком — в учёт после проверки.
        <InfoHint label="Как проверять">Расчёты аукционов и ТЗ попадают в учёт только после вашей проверки: «Принять» создаёт закупку-черновик или ТЗ, «Отклонить» возвращает подрядчику с комментарием.</InfoHint>
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={href(f.key)}
            aria-current={st === f.key ? "page" : undefined}
            className={cn("rounded-full border px-3 py-1 text-sm max-md:inline-flex max-md:min-h-11 max-md:items-center", st === f.key ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 hover:bg-neutral-100")}
          >
            {f.label} <span className="tabular-nums opacity-70">{cnt(f.key)}</span>
          </Link>
        ))}
        <form action="/inbox" className="ml-auto flex items-center gap-2">
          <input type="hidden" name="status" value={st} />
          <input name="q" defaultValue={q} placeholder="Номер, аукцион, подрядчик" className="h-9 w-64 rounded-md border border-neutral-300 px-3 text-sm" />
          <button className="h-9 rounded-md border border-neutral-300 px-3 text-sm hover:bg-neutral-100">Найти</button>
        </form>
      </div>
      <Table className="min-w-[720px]">
        <Thead><Tr><Th {...th("title")}>Что прислали</Th><Th {...th("kind")}>Тип</Th><Th {...th("supplier")}>Подрядчик</Th><Th {...th("qty")}>Объём</Th><Th {...th("status")}>Статус</Th><Th {...th("sent")}>Отправлено</Th></Tr></Thead>
        <Tbody>
          {rows.map((r) => {
            const tot = (r.payload as { totals?: { qty?: number } })?.totals?.qty;
            return (
              <Tr key={r.id}>
                <Td className="max-w-[22rem]"><Clamp><Link className="font-medium underline" title={r.title} href={`/inbox/${r.id}`}>{shortInboxTitle(r.title)}</Link></Clamp></Td>
                <Td>{KIND_LABEL[r.kind]}</Td>
                <Td>{r.supplier.name}</Td>
                <Td className="tabular-nums">{tot != null ? `${tot} шт.` : "—"}</Td>
                <Td>
                  <span className={cn("rounded-full px-2 py-0.5 text-xs", r.status === "SENT" ? "bg-amber-100 text-amber-900" : r.status === "ACCEPTED" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-700")}>
                    {r.status === "ACCEPTED" ? "Принято" : INBOX_STATUS_LABEL[r.status]}
                  </span>
                </Td>
                <Td className="tabular-nums">{formatDate(r.sentAt ?? r.decidedAt ?? new Date())}</Td>
              </Tr>
            );
          })}
          {rows.length === 0 && <Tr><Td colSpan={6} className="py-8 text-center text-neutral-500">{q ? "Нет результатов" : st === "SENT" ? "Нет присланного" : "Нет записей"}</Td></Tr>}
        </Tbody>
      </Table>
    </div>
  );
}
