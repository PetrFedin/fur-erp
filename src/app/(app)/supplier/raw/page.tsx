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
import { RawChip } from "@/components/raw-stages";
import { summarizeStages } from "@/lib/raw-stage";

export const metadata = { title: "Сырьё" };

const num = (n: number) => n.toLocaleString("ru-RU", { maximumFractionDigits: 3 });
const money = (n: number) => n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function SupplierRawPage({ searchParams }: PageProps<"/supplier/raw">) {
  const s = await requireInboxViewer();
  const isSup = s.user.role === "SUPPLIER";
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => cleanSearch(Array.isArray(v) ? v[0] : v, 60);
  const fAuction = one(sp.auction), fSt = one(sp.st), fFur = one(sp.fur), q = one(sp.q).toLowerCase();

  // Поставщик — только свои закупки; владелец/админ смотрят глазами поставщика (по поставщику из ?supplier или первому).
  let supplierId = s.user.supplierId ?? null;
  if (!isSup) {
    const sup = await prisma.supplier.findFirst({ where: { organizationId: s.user.organizationId, users: { some: { role: "SUPPLIER" } } }, select: { id: true } });
    supplierId = sup?.id ?? null;
  }
  const all = supplierId ? await supplierRawRows(s.user.organizationId, supplierId) : [];
  const auctions = Array.from(new Set(all.map((r) => r.auction).filter(Boolean))).sort();
  const furs = Array.from(new Map(all.map((r) => [r.furId, r.fur])).entries()).sort((a, b) => a[1].localeCompare(b[1], "ru"));
  const rows = all.filter((r) => (!fAuction || r.auction === fAuction) && (!fFur || r.furId === fFur) && (!fSt || (fSt === "received") === r.received) && (!q || r.lotNumber.toLowerCase().includes(q)));
  const groups = new Map<string, typeof rows>();
  for (const r of rows) (groups.get(r.purchaseId) ?? groups.set(r.purchaseId, []).get(r.purchaseId)!).push(r);
  const filtered = !!(fAuction || fFur || fSt || q);
  const qty = rows.reduce((a, r) => a + r.quantity, 0);
  const sum = rows.reduce((a, r) => a + r.subtotal, 0);
  const mixed = new Set(rows.map((r) => r.currency)).size > 1;
  const cur = (c: string) => (c === "RUB" ? "₽" : c);

  const stageRows = supplierId
    ? await prisma.supplierRawStage.findMany({ where: { organizationId: s.user.organizationId, supplierId }, select: { purchaseId: true, stage: true, status: true, place: true, plannedStart: true, plannedEnd: true, factStart: true, factEnd: true } })
    : [];
  const stagesOf = (pid: string) => stageRows.filter((x) => x.purchaseId === pid);

  const docs = supplierId
    ? await prisma.supplierInbox.findMany({
        where: { kind: "DOCUMENT", organizationId: s.user.organizationId, supplierId },
        orderBy: { createdAt: "desc" }, take: 20,
        select: { id: true, title: true, status: true, reviewNote: true, sentAt: true, createdAt: true },
      })
    : [];

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: "Главная" }, { label: "Сырьё" }]} />
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
        <label className="flex flex-col gap-1">Статус
          <select name="st" defaultValue={fSt} className="h-9 rounded-md border border-neutral-300 px-2">
            <option value="">Все</option>
            <option value="transit">в пути / заказано</option>
            <option value="received">принято на склад</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">Лот
          <input name="q" defaultValue={one(sp.q)} placeholder="Номер лота" className="h-9 w-36 rounded-md border border-neutral-300 px-2" />
        </label>
        <button type="submit" className={buttonVariants({ size: "sm" })}>Показать</button>
        {filtered && <Link href="/supplier/raw" className={buttonVariants({ size: "sm", variant: "outline" })}>Сбросить</Link>}
      </form>

      {groups.size > 0 && (
        <section className="flex flex-col gap-1 rounded-md border border-neutral-300 bg-white p-3" aria-label="Где сырьё по аукционам">
          <h2 className="text-sm font-semibold">Где сырьё сейчас — по аукционам</h2>
          <p className="text-xs text-neutral-500">Этап, место и ожидаемая дата по каждому аукциону одним списком. Чтобы обновить, откройте аукцион («Подробно →») и нажмите «+ Этап»: мы сразу увидим.</p>
          <Table className="min-w-[640px]">
            <Thead><Tr><Th>Аукцион</Th><Th>Счёт</Th><Th>Шкур</Th><Th>Сейчас</Th>{isSup && <Th />}</Tr></Thead>
            <Tbody>
              {(() => {
                // один аукцион с несколькими счетами и одинаковым положением — одной строкой
                const out = new Map<string, { name: string; inv: string[]; qty: number; st: ReturnType<typeof stagesOf>; sum: ReturnType<typeof summarizeStages>; received: boolean; pid: string }>();
                for (const g of groups.values()) {
                  const h = g[0];
                  const st = stagesOf(h.purchaseId);
                  const sum = summarizeStages(st);
                  const key = `${h.auction || h.purchaseNumber}|${sum ? `${sum.stage}|${sum.place}|${sum.state}|${sum.eta?.getTime() ?? ""}` : h.received ? "got" : "none"}`;
                  const cur = out.get(key) ?? { name: h.auction || h.purchaseNumber, inv: [], qty: 0, st, sum, received: h.received, pid: h.purchaseId };
                  cur.inv.push(h.invoice || h.purchaseNumber); cur.qty += g.reduce((a, r) => a + r.quantity, 0);
                  out.set(key, cur);
                }
                return [...out.values()].map((x) => (
                  <Tr key={x.name + x.pid}>
                    <Td className="font-medium">{x.name}</Td>
                    <Td>{x.inv.length > 3 ? `${x.inv.slice(0, 3).join(", ")} и ещё ${x.inv.length - 3}` : x.inv.join(", ")}</Td>
                    <Td className="tabular-nums">{num(x.qty)}</Td>
                    <Td>{x.sum ? <span className={x.sum.overdue ? "text-red-800" : ""}><RawChip stages={x.st} /> <span className="text-xs text-neutral-600">{x.sum.place}</span></span> : <span className="text-neutral-500">{x.received ? "принято у нас на склад" : "этапов нет — отметьте, где мех"}</span>}</Td>
                    {isSup && <Td><Link href={`/supplier/raw/${x.pid}`} className="text-sm text-blue-700 underline">{x.sum || x.received ? "Подробно" : "+ Этап"}</Link></Td>}
                  </Tr>
                ));
              })()}
            </Tbody>
          </Table>
        </section>
      )}

      <p className="text-sm text-neutral-700">Лотов: <b>{rows.length}</b> · шкур: <b>{num(qty)}</b>{!mixed && rows.length > 0 && <> · сумма по УПД без НДС: <b>{money(sum)} {cur(rows[0].currency)}</b></>}</p>

      {rows.length === 0 && (
        <p className="rounded-md border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500">{all.length === 0 ? "Закупок у вас пока нет. Внесите расчёт в разделе «Аукционы» — после нашей проверки лоты появятся здесь." : "По выбранным условиям лотов нет — сбросьте фильтры."}</p>
      )}
      <div className="flex flex-col gap-2">
        {Array.from(groups.values()).map((g, gi) => {
          const h = g[0];
          const gq = g.reduce((a, r) => a + r.quantity, 0);
          const gs = g.reduce((a, r) => a + r.subtotal, 0);
          return (
            <details key={h.purchaseId} open={gi === 0 || filtered} className="group rounded-md border border-neutral-300 bg-white">
              <summary className="flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-sm">
                <span className="text-neutral-500 transition-transform group-open:rotate-90">▶</span>
                <b className="text-base">{h.auction || h.purchaseNumber}</b>
                <Link href={`/supplier/raw/${h.purchaseId}`} className="text-sm text-blue-700 underline">Подробно →</Link>
                <span className="text-neutral-600">{h.invoice ? `счёт ${h.invoice}` : h.purchaseNumber}</span>
                <span>лотов {g.length} · шкур {num(gq)}</span>
                <span className={h.received ? "whitespace-nowrap rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-800" : "whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900"}>{h.status}</span>
                <span className="tabular-nums">по УПД без НДС: <b>{money(gs)} {cur(h.currency)}</b></span>
                <RawChip stages={stagesOf(h.purchaseId)} />
                {isSup && <span className="ml-auto"><AttachDocument purchaseId={h.purchaseId} label="Приложить документ" /></span>}
              </summary>
              <div className="overflow-x-auto border-t border-neutral-200">
                <Table className="min-w-[900px]">
                  <Thead><Tr><Th>Лот</Th><Th>Вид меха</Th><Th>Цвет</Th><Th>Размер / сорт</Th><Th>Кол-во</Th><Th>УПД / спецификация</Th><Th>Цена без НДС</Th><Th /></Tr></Thead>
                  <Tbody>
                    {g.map((r) => (
                      <Tr key={r.itemId}>
                        <Td>{r.lotNumber || "—"}</Td><Td>{r.fur}</Td><Td>{r.color || "—"}</Td><Td>{r.size || "—"}</Td>
                        <Td className="tabular-nums">{num(r.quantity)}</Td>
                        <Td>{r.doc || <span className="text-neutral-400">нет — приложите</span>}</Td>
                        <Td className="tabular-nums">{money(r.unitPrice)} {cur(r.currency)}</Td>
                        <Td>{isSup && <AttachDocument purchaseId={r.purchaseId} itemId={r.itemId} label="Приложить" />}</Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
              </div>
            </details>
          );
        })}
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
