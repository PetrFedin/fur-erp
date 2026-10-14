import Link from "next/link";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { buttonVariants } from "@/components/ui/button";
import { prisma } from "@/lib/prisma";
import { requireInboxViewer, INBOX_STATUS_LABEL } from "@/lib/supplier-inbox";
import { supplierRawRows } from "@/lib/supplier-raw";
import { cleanSearch } from "@/lib/input";
import { formatDate } from "@/lib/utils";
import { AttachDocument } from "./attach";

export const metadata = { title: "Сырьё" };

const num = (n: number) => n.toLocaleString("ru-RU", { maximumFractionDigits: 3 });
const money = (n: number) => n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function SupplierRawPage({ searchParams }: PageProps<"/supplier/raw">) {
  const s = await requireInboxViewer();
  const isSup = s.user.role === "SUPPLIER";
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => cleanSearch(Array.isArray(v) ? v[0] : v, 60);
  const fAuction = one(sp.auction), fFur = one(sp.fur), q = one(sp.q).toLowerCase();

  // Поставщик — только свои закупки; владелец/админ смотрят глазами поставщика (по поставщику из ?supplier или первому).
  let supplierId = s.user.supplierId ?? null;
  if (!isSup) {
    const sup = await prisma.supplier.findFirst({ where: { organizationId: s.user.organizationId, users: { some: { role: "SUPPLIER" } } }, select: { id: true } });
    supplierId = sup?.id ?? null;
  }
  const all = supplierId ? await supplierRawRows(s.user.organizationId, supplierId) : [];
  const auctions = Array.from(new Set(all.map((r) => r.auction).filter(Boolean))).sort();
  const furs = Array.from(new Map(all.map((r) => [r.furId, r.fur])).entries()).sort((a, b) => a[1].localeCompare(b[1], "ru"));
  const rows = all.filter((r) => (!fAuction || r.auction === fAuction) && (!fFur || r.furId === fFur) && (!q || r.lotNumber.toLowerCase().includes(q)));
  const qty = rows.reduce((a, r) => a + r.quantity, 0);
  const sum = rows.reduce((a, r) => a + r.subtotal, 0);
  const mixed = new Set(rows.map((r) => r.currency)).size > 1;
  const cur = (c: string) => (c === "RUB" ? "₽" : c);

  const docs = supplierId
    ? await prisma.supplierInbox.findMany({
        where: { kind: "DOCUMENT", organizationId: s.user.organizationId, supplierId },
        orderBy: { createdAt: "desc" }, take: 20,
        select: { id: true, title: true, status: true, reviewNote: true, sentAt: true, createdAt: true },
      })
    : [];

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: "Сырьё" }]} />
      <h1 className="text-xl font-semibold">Сырьё</h1>
      <p className="text-sm text-neutral-600">Мех, который вы купили на аукционах и продали нам. К закупке или лоту можно приложить УПД, спецификацию, счёт или письмо: мы проверим и примем.</p>

      <form className="flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-1">Аукцион
          <select name="auction" defaultValue={fAuction} className="h-9 rounded-md border border-neutral-300 px-2">
            <option value="">Все</option>
            {auctions.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">Вид меха
          <select name="fur" defaultValue={fFur} className="h-9 rounded-md border border-neutral-300 px-2">
            <option value="">Все</option>
            {furs.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">Лот
          <input name="q" defaultValue={one(sp.q)} placeholder="Номер лота" className="h-9 w-36 rounded-md border border-neutral-300 px-2" />
        </label>
        <button type="submit" className={buttonVariants({ size: "sm" })}>Показать</button>
        {(fAuction || fFur || q) && <Link href="/supplier/raw" className={buttonVariants({ size: "sm", variant: "outline" })}>Сбросить</Link>}
      </form>

      <p className="text-sm text-neutral-700">Лотов: <b>{rows.length}</b> · шкур: <b>{num(qty)}</b>{!mixed && rows.length > 0 && <> · сумма по УПД без НДС: <b>{money(sum)} {cur(rows[0].currency)}</b></>}</p>

      <div className="overflow-x-auto">
        <Table className="min-w-[1100px]">
          <Thead>
            <Tr><Th>Аукцион</Th><Th>Закупка / счёт</Th><Th>Лот</Th><Th>Вид меха</Th><Th>Цвет</Th><Th>Размер / сорт</Th><Th>Куплено, шт.</Th><Th>Статус</Th><Th>УПД / спецификация</Th><Th>Цена по УПД без НДС</Th><Th>Сумма</Th><Th /></Tr>
          </Thead>
          <Tbody>
            {rows.map((r) => (
              <Tr key={r.itemId}>
                <Td>{r.auction || "—"}</Td>
                <Td>{r.purchaseNumber}{r.invoice && <div className="text-xs text-neutral-500">счёт {r.invoice}</div>}</Td>
                <Td>{r.lotNumber || "—"}</Td>
                <Td>{r.fur}</Td>
                <Td>{r.color || "—"}</Td>
                <Td>{r.size || "—"}</Td>
                <Td className="tabular-nums">{num(r.quantity)}</Td>
                <Td><span className={r.received ? "rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-800" : "rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900"}>{r.status}</span></Td>
                <Td>{r.doc || <span className="text-neutral-400">нет</span>}</Td>
                <Td className="tabular-nums">{money(r.unitPrice)} {cur(r.currency)}</Td>
                <Td className="tabular-nums">{money(r.subtotal)} {cur(r.currency)}</Td>
                <Td>{isSup && <AttachDocument purchaseId={r.purchaseId} itemId={r.itemId} label="Приложить" />}</Td>
              </Tr>
            ))}
            {rows.length === 0 && <Tr><Td colSpan={12} className="py-8 text-center text-neutral-500">{all.length === 0 ? "Закупок у вас пока нет. Когда мы оформим закупку, лоты появятся здесь." : "По выбранным условиям лотов нет"}</Td></Tr>}
          </Tbody>
        </Table>
      </div>

      <div>
        <h2 className="mb-1 text-sm font-semibold">Отправленные документы</h2>
        {docs.length === 0 ? <p className="text-sm text-neutral-500">Пока ничего не отправлено</p> : (
          <ul className="flex flex-col gap-1 text-sm">
            {docs.map((d) => (
              <li key={d.id}>{d.title} · {INBOX_STATUS_LABEL[d.status]} · {formatDate(d.sentAt ?? d.createdAt)}{d.status === "REJECTED" && d.reviewNote && <span className="text-red-700"> · замечание: {d.reviewNote}</span>}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
