import Link from "next/link";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { prisma } from "@/lib/prisma";
import { requireInboxViewer } from "@/lib/supplier-inbox";
import { loadSupplierAuction } from "@/lib/supplier-auction";
import { FORMAT_LABEL, calcAll, ensureRowIds } from "@/lib/supplier-calc";
import { formatDate } from "@/lib/utils";
import { AttachDocument } from "../attach";
import { RawStagesBlock } from "@/components/raw-stages";
import { BreakdownTable } from "@/components/breakdown-table";
import { CalcSheetReadonly } from "@/components/calc-sheet-readonly";
import { ChatLink } from "@/components/chat-link";

export const metadata = { title: "Аукцион" };

const num = (n: number) => n.toLocaleString("ru-RU", { maximumFractionDigits: 3 });
const money = (n: number) => n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cell = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "" : n.toLocaleString("ru-RU", { maximumFractionDigits: 4 }));
const cur = (c: string) => (c === "RUB" ? "₽" : c);
const KIND: Record<string, string> = { AUCTION_INVOICE: "Аукционный счёт", PAYMENT_INVOICE: "Счёт", SPECIFICATION: "Спецификация", UPD: "УПД", OTHER: "Документ" };

export default async function SupplierAuctionPage({ params }: PageProps<"/supplier/raw/[purchaseId]">) {
  const { purchaseId } = await params;
  const s = await requireInboxViewer();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(purchaseId)) notFound();
  const isSup = s.user.role === "SUPPLIER";
  // Поставщик — только своя закупка; владелец/админ смотрят глазами поставщика (как в списке «Сырья»).
  let supplierId = s.user.supplierId ?? null;
  if (!isSup) {
    const sup = await prisma.supplier.findFirst({ where: { organizationId: s.user.organizationId, users: { some: { role: "SUPPLIER" } } }, select: { id: true } });
    supplierId = sup?.id ?? null;
  }
  if (!supplierId) notFound();
  const d = await loadSupplierAuction(s.user.organizationId, supplierId, purchaseId);
  if (!d) notFound();
  const { purchase: p, items, calc, docs } = d;
  const stages = await prisma.supplierRawStage.findMany({
    where: { organizationId: s.user.organizationId, supplierId, purchaseId: p.id },
    orderBy: { createdAt: "asc" },
    select: { id: true, stage: true, status: true, place: true, lotNumber: true, qty: true, note: true, plannedStart: true, plannedEnd: true, factStart: true, factEnd: true },
  });
  const qty = items.reduce((a, i) => a + i.qty, 0);
  const sum = items.reduce((a, i) => a + i.subtotal, 0);
  const payload = calc?.payload && calc.payload.v === 1 && Array.isArray(calc.payload.rows) ? ensureRowIds(calc.payload) : null;
  const t = payload ? calcAll(payload) : null;
  const h = payload?.header;
  const head: [string, string][] = [
    ["Продавец / аукционный дом", h?.seller || h?.auction || p.auction],
    ["Валюта", h?.currency || p.currency],
    ["Курс ЦБ", h?.cbRate ? `${h.cbRate}${h.agentPct ? ` + надбавка агента ${h.agentPct}%` : ""}` : p.rate !== 1 ? String(p.rate) : ""],
    ["Куда (завод выделки)", h?.dest ?? ""],
    ["№ брокера", h?.broker ?? ""],
    ["Срок оплаты", h?.dueDate ?? ""],
    ["Формат расчёта", payload ? FORMAT_LABEL[payload.format] : ""],
  ];

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: "Главная" }, { label: "Сырьё", href: "/supplier/raw" }, { label: p.auction || p.number }]} />
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="text-xl font-semibold">{p.auction || p.number}</h1>
        <span className="text-sm text-neutral-600">{p.invoice ? `счёт ${p.invoice}${p.invoiceDate ? ` от ${formatDate(p.invoiceDate)}` : ""}` : p.number}</span>
        <span className={p.received ? "rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-800" : "rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900"}>{p.status}</span>
      </div>
      <p className="text-sm text-neutral-700">
        Дата: <b>{formatDate(p.orderDate)}</b> · курс: <b>{p.rate}</b> · поставщик: <b>{p.supplier}</b> · лотов <b>{items.length}</b> · шкур <b>{num(qty)}</b> · по УПД без НДС: <b>{money(sum)} {cur(p.currency)}</b>
      </p>

      <RawStagesBlock stages={stages} purchaseId={p.id} lots={[...new Set(items.map((i) => i.lot).filter(Boolean))]} editable={isSup} />

      <section className="rounded-md border border-neutral-300 bg-white p-3">
        <h2 className="mb-2 text-sm font-semibold">Данные аукциона</h2>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {head.filter(([, v]) => v).map(([k, v]) => (
            <div key={k} className="flex gap-2"><dt className="text-neutral-500">{k}:</dt><dd>{v}</dd></div>
          ))}
        </dl>
        {!payload && <p className="mt-2 text-xs text-neutral-500">Расчёта аукциона по этой закупке нет — ниже лоты и цены из отчёта. Расчёт можно внести в разделе «Аукционы».</p>}
        {calc && <p className="mt-2 text-sm"><Link href={`/supplier/auction-calcs/${calc.id}`} className="text-blue-700 underline">Открыть расчёт «{calc.title}»</Link>{isSup && <> · <Link href={`/supplier/auction-calcs/new?from=${encodeURIComponent(`calc:${calc.id}`)}`} className="text-blue-700 underline" title="Принятый расчёт не меняется: копия берёт формат, столбцы с формулами и параметры, вы правите лоты и цифры">Новый расчёт на этой основе</Link></>}</p>}
      </section>

      <section>
        <h2 className="mb-1 text-sm font-semibold">Лоты</h2>
        {payload && t ? (
          <CalcSheetReadonly p={payload} t={t} maxHeight="70vh" />
        ) : items.length === 0 ? (
          <p className="rounded-md border border-dashed border-neutral-300 p-4 text-center text-sm text-neutral-500">В закупке пока нет лотов.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-neutral-300 bg-white">
            <Table className="min-w-[760px]">
              <Thead><Tr><Th>Лот</Th><Th>Вид меха</Th><Th>Цвет</Th><Th>Размер / сорт</Th><Th>Кол-во</Th><Th>Цена без НДС</Th><Th>Сумма</Th></Tr></Thead>
              <Tbody>
                {items.map((i) => (
                  <Tr key={i.id}>
                    <Td>{i.lot || "—"}</Td><Td>{i.fur}</Td><Td>{i.color || "—"}</Td><Td>{i.size || "—"}</Td>
                    <Td className="tabular-nums">{num(i.qty)}</Td><Td className="tabular-nums">{money(i.unitPrice)}</Td><Td className="tabular-nums">{money(i.subtotal)}</Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </div>
        )}
      </section>

      {!payload && items.some((i) => i.breakdown.length > 0) && (
        <section>
          <h2 className="mb-1 text-sm font-semibold">Из чего сложилась цена лота</h2>
          <div className="flex flex-col gap-2">
            {items.filter((i) => i.breakdown.length > 0).map((i) => (
              <details key={i.id} className="rounded-md border border-neutral-200 bg-white">
                <summary className="cursor-pointer px-3 py-1.5 text-sm">Лот {i.lot || "без номера"} · {i.fur}{i.color ? `, ${i.color}` : ""} · {num(i.qty)} шт.</summary>
                <div className="border-t border-neutral-100 p-2"><BreakdownTable items={i.breakdown} /></div>
              </details>
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="mb-1 flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-semibold">Документы аукциона</h2>
          {isSup && <AttachDocument purchaseId={p.id} label="Приложить документ" />}
          <ChatLink type="Purchase" id={p.id} role={s.user.role} />
        </div>
        {docs.every((x) => x.files.length === 0) ? (
          <p className="text-sm text-neutral-500">Документов пока нет. Приложите аукционный счёт, свой счёт, спецификацию или УПД.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {docs.flatMap((x) => x.files.map((f) => (
              <li key={f.id}>
                <a href={`/api/supplier/inbox-files/${f.id}`} className="text-blue-700 underline">{f.originalName}</a>
                <span className="text-neutral-500"> · {KIND[f.kind] ?? "Документ"} · {x.title}</span>
              </li>
            )))}
          </ul>
        )}
      </section>
    </div>
  );
}
