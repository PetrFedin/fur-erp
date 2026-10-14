import Link from "next/link";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { buttonVariants } from "@/components/ui/button";
import { prisma } from "@/lib/prisma";
import { requireInboxViewer, inboxScope, INBOX_STATUS_LABEL } from "@/lib/supplier-inbox";
import { STAGE_LABEL, calcAll, ensureRowIds, type CalcPayload } from "@/lib/supplier-calc";
import { formatDate } from "@/lib/utils";

const money = (n: number) => n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const metadata = { title: "Расчёты аукционов" };

export default async function AuctionCalcsPage() {
  const s = await requireInboxViewer();
  const isSup = s.user.role === "SUPPLIER";
  const rows = await prisma.supplierInbox.findMany({
    where: { kind: "AUCTION_CALC", ...inboxScope(s) },
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true, status: true, reviewNote: true, updatedAt: true, sentAt: true, payload: true, supplier: { select: { name: true } } },
  });
  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: "Расчёты аукционов" }]} />
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Расчёты аукционов</h1>
        {isSup && <Link href="/supplier/auction-calcs/new" className={buttonVariants({ size: "sm" })}>+ Новый расчёт</Link>}
      </div>
      <p className="text-sm text-neutral-600">Внесите лоты и расходы — итог посчитается сам. Мы получим расчёт черновиком и примем после проверки.</p>
      <Table className="min-w-[720px]">
        <Thead><Tr><Th>Аукцион</Th><Th>Счёт</Th>{!isSup && <Th>Поставщик</Th>}<Th className="text-right">Шкур</Th><Th className="text-right">Итого, ₽</Th><Th className="text-right">Средняя за шкуру, ₽</Th><Th>Статус</Th></Tr></Thead>
        <Tbody>
          {rows.map((r) => {
            const pl = r.payload as unknown as CalcPayload;
            let qty = 0, total = 0;
            try { const t = calcAll(ensureRowIds(pl)); qty = t.qty; total = t.totalRub; } catch { /* битый черновик — без цифр */ }
            const stage = pl?.stage;
            return (
              <Tr key={r.id}>
                <Td><Link className="font-medium underline" href={`/supplier/auction-calcs/${r.id}`}>{pl?.header?.auction || r.title}</Link>{r.status === "REJECTED" && r.reviewNote && <div className="mt-0.5 text-xs text-red-700">Замечание: {r.reviewNote}</div>}</Td>
                <Td>{pl?.header?.invoice || "—"}</Td>
                {!isSup && <Td>{r.supplier.name}</Td>}
                <Td className="text-right tabular-nums">{qty || "—"}</Td>
                <Td className="text-right tabular-nums">{qty ? money(total) : "—"}</Td>
                <Td className="text-right tabular-nums">{qty ? money(total / qty) : "—"}</Td>
                <Td>{INBOX_STATUS_LABEL[r.status]}{stage && <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${stage === "FINAL" ? "bg-green-50 text-green-800" : "bg-blue-50 text-blue-800"}`}>{STAGE_LABEL[stage]}</span>}<div className="text-xs text-neutral-500">{formatDate(r.sentAt ?? r.updatedAt)}</div></Td>
              </Tr>
            );
          })}
          {rows.length === 0 && <Tr><Td colSpan={7} className="py-8 text-center text-neutral-500">Расчётов пока нет — нажмите «+ Новый расчёт»</Td></Tr>}
        </Tbody>
      </Table>
    </div>
  );
}
