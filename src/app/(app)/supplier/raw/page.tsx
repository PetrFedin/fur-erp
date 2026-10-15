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
import { summarizeStages, summaryLine, sortStages, ruShort, STAGE_NAME, STAGE_STATUS_LABEL, type StageStatusKey } from "@/lib/raw-stage";

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

      <p className="text-sm text-neutral-700">Лотов: <b>{rows.length}</b> · шкур: <b>{num(qty)}</b>{!mixed && rows.length > 0 && <> · сумма по УПД без НДС: <b>{money(sum)} {cur(rows[0].currency)}</b></>}</p>

      {rows.length === 0 && (
        <p className="rounded-md border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500">{all.length === 0 ? "Закупок у вас пока нет. Внесите расчёт в разделе «Аукционы» — после нашей проверки лоты появятся здесь." : "По выбранным условиям лотов нет — сбросьте фильтры."}</p>
      )}
      <div className="flex flex-col gap-3">
        {(() => {
          // аукцион → счета (закупки) → лоты
          const byAuction = new Map<string, typeof rows[]>();
          for (const g of groups.values()) {
            const name = g[0].auction || g[0].purchaseNumber;
            (byAuction.get(name) ?? byAuction.set(name, []).get(name)!).push(g);
          }
          return [...byAuction.entries()].map(([name, invs], ai) => {
            const lots = invs.flat();
            const aq = lots.reduce((a, r) => a + r.quantity, 0);
            const as = lots.reduce((a, r) => a + r.subtotal, 0);
            const allGot = lots.every((r) => r.received);
            const stagesAll = invs.flatMap((g) => stagesOf(g[0].purchaseId));
            // счета с одинаковым положением — одной строкой
            const places = new Map<string, { inv: typeof invs; st: ReturnType<typeof stagesOf> }>();
            for (const g of invs) {
              const st = stagesOf(g[0].purchaseId);
              const sm = summarizeStages(st);
              const key = sm ? sortStages(st).map((x) => `${x.stage}|${x.status}|${x.place ?? ""}|${x.plannedEnd?.getTime() ?? ""}|${x.factEnd?.getTime() ?? ""}`).join(";") : g[0].received ? "got" : "none";
              (places.get(key) ?? places.set(key, { inv: [], st }).get(key)!).inv.push(g);
            }
            const mixedCur = new Set(lots.map((r) => r.currency)).size > 1;
            return (
              <details key={name} open={ai === 0 || filtered} className="group rounded-md border border-neutral-300 bg-white">
                <summary className="flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-sm">
                  <span className="text-neutral-500 transition-transform group-open:rotate-90">▶</span>
                  <b className="text-base">{name}</b>
                  <span className="text-neutral-600">счетов {invs.length} · лотов {lots.length} · шкур {num(aq)}</span>
                  {!mixedCur && <span className="tabular-nums">по УПД без НДС: <b>{money(as)} {cur(lots[0].currency)}</b></span>}
                  {places.size === 1 ? <RawChip stages={stagesAll.length ? [...places.values()][0].st : []} /> : null}
                  {allGot && stagesAll.length === 0 && <span className="whitespace-nowrap rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-800">принято на склад</span>}
                  {places.size > 1 && <span className="whitespace-nowrap rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-700">положение разное по счетам</span>}
                </summary>
                <div className="flex flex-col gap-3 border-t border-neutral-200 p-3">
                  <div className="flex flex-col gap-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Где сырьё сейчас</h3>
                    {[...places.values()].map(({ inv, st }) => {
                      const sm = summarizeStages(st);
                      const ids = inv.map((g) => g[0].invoice || g[0].purchaseNumber);
                      const head = inv[0][0];
                      return (
                        <div key={head.purchaseId} className="rounded-md border border-neutral-200 p-2 text-sm">
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <b>{ids.length > 4 ? `Счета ${ids.slice(0, 4).join(", ")} и ещё ${ids.length - 4}` : `${ids.length > 1 ? "Счета" : "Счёт"} ${ids.join(", ")}`}</b>
                            <span className="text-neutral-600">шкур {num(inv.flat().reduce((a, r) => a + r.quantity, 0))}</span>
                            {sm ? <span className={sm.overdue ? "text-red-800" : "text-neutral-700"}>{summaryLine(sm)}</span> : <span className="text-neutral-500">{head.received ? "принято у нас на склад" : "этапов нет — отметьте, где мех"}</span>}
                            {isSup && <Link href={`/supplier/raw/${head.purchaseId}`} className="ml-auto text-blue-700 underline">{sm ? "Этапы и детали →" : "+ Этап"}</Link>}
                          </div>
                          {st.length > 0 && (
                            <ol className="mt-2 flex flex-col gap-0.5 border-l-2 border-neutral-200 pl-3 text-xs text-neutral-700">
                              {sortStages(st).map((x, i) => (
                                <li key={i}>
                                  <b>{STAGE_NAME[x.stage] ?? x.stage}</b>{x.place ? ` · ${x.place}` : ""} · {STAGE_STATUS_LABEL[x.status as StageStatusKey] ?? x.status}
                                  {(x.factStart ?? x.plannedStart) || (x.factEnd ?? x.plannedEnd) ? ` · ${ruShort(x.factStart ?? x.plannedStart) || "…"} – ${ruShort(x.factEnd ?? x.plannedEnd) || "…"}${x.factEnd || x.factStart ? " (факт)" : " (план)"}` : ""}
                                </li>
                              ))}
                            </ol>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Лоты</h3>
                      {isSup && invs.length === 1 && <AttachDocument purchaseId={invs[0][0].purchaseId} label="Приложить документ" />}
                    </div>
                    <div className="overflow-x-auto rounded-md border border-neutral-200">
                      <Table className="min-w-[820px]">
                        <Thead><Tr><Th>Счёт</Th><Th>Лот</Th><Th>Вид меха</Th><Th>Цвет</Th><Th>Размер / сорт</Th><Th>Кол-во</Th><Th>Цена без НДС</Th><Th>УПД</Th><Th /></Tr></Thead>
                        <Tbody>
                          {lots.map((r) => (
                            <Tr key={r.itemId}>
                              <Td>{r.invoice || r.purchaseNumber}</Td><Td>{r.lotNumber || "—"}</Td><Td>{r.fur}</Td><Td>{r.color || "—"}</Td><Td>{r.size || "—"}</Td>
                              <Td className="tabular-nums">{num(r.quantity)}</Td>
                              <Td className="tabular-nums">{money(r.unitPrice)} {cur(r.currency)}</Td>
                              <Td>{r.doc || <span className="text-neutral-400">нет</span>}</Td>
                              <Td>{isSup && <AttachDocument purchaseId={r.purchaseId} itemId={r.itemId} label="Приложить" />}</Td>
                            </Tr>
                          ))}
                        </Tbody>
                      </Table>
                    </div>
                  </div>
                </div>
              </details>
            );
          });
        })()}
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
