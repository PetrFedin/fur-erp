import Link from "next/link";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { buttonVariants } from "@/components/ui/button";
import { prisma } from "@/lib/prisma";
import { requireRawViewer, INBOX_STATUS_LABEL } from "@/lib/supplier-inbox";
import { supplierRawRows, supplierAcceptedCalcs } from "@/lib/supplier-raw";
import { calcAll, calcVatPct, ensureRowIds, lotKey } from "@/lib/supplier-calc";
import { buildStatement } from "@/lib/auction-statement";
import { InfoHint } from "@/components/info-hint";
import { cleanSearch } from "@/lib/input";
import { Clamp } from "@/components/clamp";
import { SortTh } from "@/components/sort-th";
import { readSort, sortRows } from "@/lib/table-sort";
import { formatDate, formatRate, formatDecimal, formatNum } from "@/lib/utils";
import { AttachDocument } from "./attach";
import { RawChip } from "@/components/raw-stages";
import { loadSupplierPayData, groupPayInfo } from "@/lib/supplier-pay";
import { PayChip } from "@/components/pay-status";
import { TotalLabel } from "@/components/total-label";
import { summarizeStages, summaryLine, sortStages, ruShort, STAGE_NAME, STAGE_STATUS_LABEL, type StageStatusKey } from "@/lib/raw-stage";

export const metadata = { title: "Сырьё" };

const num = (n: number) => formatDecimal(n, 3, { trim: true });
const money = (n: number) => formatNum(n, 1); // без «₽»: единицу пишем рядом

export default async function SupplierRawPage({ searchParams }: PageProps<"/supplier/raw">) {
  const s = await requireRawViewer();
  const isSup = s.user.role === "SUPPLIER";
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => cleanSearch(Array.isArray(v) ? v[0] : v, 60);
  const openName = one(sp.open);
  const sort = readSort(sp, ["invoice", "lot", "fur", "color", "size", "qty", "price", "unit", "total", "doc"]);
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

  // Расчёт аукциона (тот же, что в «Аукционах»): итог, средняя, курс, НДС, аванс, остаток и цена лота в ₽.
  const calcInfo = new Map<string, { id: string; qty: number; total: number; avg: number; rate: number; vat: number | null; advance: number; interim: number; rest: number; pids: string[] }>();
  const lotCalc = new Map<string, { unit: number; total: number }>();
  if (supplierId) {
    for (const c of await supplierAcceptedCalcs(s.user.organizationId, supplierId, all.map((r) => r.purchaseId).filter((v, i, a) => a.indexOf(v) === i))) {
      const pl = ensureRowIds(c.payload);
      const t = calcAll(pl);
      const st = buildStatement(pl, t);
      const info = { id: c.id, qty: t.qty, total: t.totalRub, avg: t.qty ? t.totalRub / t.qty : 0, rate: t.rate, vat: calcVatPct(pl), advance: t.advance, interim: t.interim, rest: t.rest, pids: c.purchaseIds };
      for (const pid of c.purchaseIds) {
        if (!calcInfo.has(pid)) calcInfo.set(pid, info);
        for (const l of st.lots) if (l.lot && st.lots.filter((x) => lotKey(x.lot) === lotKey(l.lot)).length === 1 && !lotCalc.has(`${pid}|${lotKey(l.lot)}`)) lotCalc.set(`${pid}|${lotKey(l.lot)}`, { unit: l.unit, total: l.total });
      }
    }
  }

  // Статус оплаты по проведённым оплатам (supplier-pay.ts): без остатков и платёжных файлов.
  const payData = supplierId ? await loadSupplierPayData(s.user.organizationId, supplierId) : null;
  const payOf = (ids: string[]) => (payData ? groupPayInfo(payData, ids) : null);

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
      <p className="text-sm text-neutral-600">Приложите УПД, спецификацию или счёт.</p>

      <form className="flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-1 max-sm:w-full">Аукцион
          <select name="auction" defaultValue={fAuction} className="h-9 rounded-md border border-neutral-300 px-2 max-sm:w-full">
            <option value="">Все</option>
            {auctions.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 max-sm:w-full">Вид меха
          <select name="fur" defaultValue={fFur} className="h-9 rounded-md border border-neutral-300 px-2 max-sm:w-full">
            <option value="">Все</option>
            {furs.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 max-sm:w-full">Статус
          <select name="st" defaultValue={fSt} className="h-9 rounded-md border border-neutral-300 px-2 max-sm:w-full">
            <option value="">Все</option>
            <option value="transit">в пути / заказано</option>
            <option value="received">принято на склад</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 max-sm:w-full">Лот
          <input name="q" defaultValue={one(sp.q)} placeholder="Номер лота" className="h-9 w-36 max-sm:w-full rounded-md border border-neutral-300 px-2" />
        </label>
        <button type="submit" className={buttonVariants({ size: "sm" })}>Показать</button>
        {filtered && <Link href="/supplier/raw" className={buttonVariants({ size: "sm", variant: "outline" })}>Сбросить</Link>}
      </form>

      <p className="text-sm text-neutral-700">Лотов: <b>{rows.length}</b> · шкур: <b>{num(qty)}</b>{!mixed && rows.length > 0 && <> · сумма по УПД без НДС: <b>{money(sum)} {cur(rows[0].currency)}</b></>}</p>

      {rows.length === 0 && (
        <p className="rounded-md border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500">{all.length === 0 ? "Нет закупок." : "Нет лотов по условиям."}</p>
      )}
      <div className="flex flex-col gap-3">
        {(() => {
          // аукцион → счета (закупки) → лоты
          const byAuction = new Map<string, typeof rows[]>();
          for (const g of groups.values()) {
            const name = g[0].auction || g[0].purchaseNumber;
            (byAuction.get(name) ?? byAuction.set(name, []).get(name)!).push(g);
          }
          const yearOf = (invs: typeof rows[]) => invs[0][0].year;
          const years = [...new Set([...byAuction.values()].map(yearOf))].sort((a, b) => b - a);
          const entries = [...byAuction.entries()].sort((a, b) => yearOf(b[1]) - yearOf(a[1]));
          const cards = entries.map(([name, invs], ai) => {
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
            // Итог «Сумма, ₽» в таблице лотов — только когда расчёт аукциона есть у каждого лота; иначе «—».
            const lotsCalcSum = lots.every((r) => lotCalc.has(`${r.purchaseId}|${lotKey(r.lotNumber)}`)) ? lots.reduce((a, r) => a + lotCalc.get(`${r.purchaseId}|${lotKey(r.lotNumber)}`)!.total, 0) : null;
            const cs = [...new Map(invs.flatMap((g) => { const x = calcInfo.get(g[0].purchaseId); return x ? [[x.id, x] as const] : []; })).values()];
            const cq = cs.reduce((a, x) => a + x.qty, 0), ct = cs.reduce((a, x) => a + x.total, 0);
            return (
              <details key={name} open={ai === 0 || filtered || openName === name} className="group rounded-md border border-neutral-300 bg-white">
                <summary className="flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-sm">
                  <span className="text-neutral-500 transition-transform group-open:rotate-90">▶</span>
                  <b className="text-base">{name}</b>
                  <span className="text-neutral-600">счетов {invs.length} · лотов {lots.length} · шкур {num(aq)}</span>
                  {!mixedCur && <span className="tabular-nums">по УПД без НДС: <b>{money(as)} {cur(lots[0].currency)}</b></span>}
                  {cs.length > 0 && <span className="tabular-nums">себестоимость: <b>{money(ct)} ₽</b>{cq > 0 && <> · за шкуру <b>{money(ct / cq)} ₽</b></>}</span>}
                  {places.size === 1 ? <RawChip stages={stagesAll.length ? [...places.values()][0].st : []} /> : null}
                  <PayChip info={payOf(invs.map((g) => g[0].purchaseId))} compact />
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
                            <Clamp className="max-w-xs font-bold">{`${ids.length > 1 ? "Счета" : "Счёт"} ${ids.join(", ")}`}</Clamp>
                            <span className="text-neutral-600">шкур {num(inv.flat().reduce((a, r) => a + r.quantity, 0))}</span>
                            {sm ? <span className={sm.overdue ? "text-red-800" : "text-neutral-700"}>{summaryLine(sm)}</span> : <span className="text-neutral-500">{head.received ? "принято на склад" : "нет этапов"}</span>}
                            <PayChip info={payOf(inv.map((g) => g[0].purchaseId))} compact />
                            {isSup && <Link href={`/supplier/raw/${head.purchaseId}`} className="ml-auto text-blue-700 underline max-xl:inline-flex max-xl:min-h-11 max-xl:items-center">{sm ? "Этапы и детали →" : "+ Этап"}</Link>}
                          </div>
                          {st.length > 1 && (
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
                  {cs.length > 0 && (
                    <div className="flex flex-col gap-1">
                      <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-500">Расчёт стоимости<InfoHint label="О расчёте">Цифры из расчёта аукциона. Статьи по лотам — в карточке счёта.</InfoHint></h3>
                      {cs.map((x) => (
                        <div key={x.id} className="flex flex-wrap gap-x-4 gap-y-1 rounded-md border border-neutral-200 p-2 text-sm tabular-nums">
                          <span>шкур <b>{num(x.qty)}</b></span>
                          <span>итого <b>{money(x.total)} ₽</b></span>
                          <span>за шкуру <b>{money(x.avg)} ₽</b></span>
                          {x.rate > 0 && <span>курс <b>{formatRate(x.rate)}</b></span>}
                          {x.vat != null && <span>НДС <b>{x.vat} %</b></span>}
                          {x.advance > 0 && <span>аванс <b>{money(x.advance)} ₽</b></span>}
                          {x.interim > 0 && <span>платёж <b>{money(x.interim)} ₽</b></span>}
                          {(x.advance > 0 || x.interim > 0) && <span>остаток <b>{money(x.rest)} ₽</b></span>}
                          <Link href={`/supplier/auction-calcs/${x.id}`} className="text-blue-700 underline max-md:inline-flex max-md:min-h-11 max-md:items-center">Открыть расчёт →</Link>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Лоты</h3>
                      {isSup && invs.length === 1 && <AttachDocument purchaseId={invs[0][0].purchaseId} label="Приложить документ" />}
                    </div>
                    {!(ai === 0 || filtered || openName === name) ? (
                      <Link href={`/supplier/raw?open=${encodeURIComponent(name)}`} className="text-sm text-blue-700 underline max-md:inline-flex max-md:min-h-11 max-md:items-center">Показать лоты ({lots.length}) →</Link>
                    ) : (
                    <div className="overflow-x-auto rounded-md border border-neutral-200">
                      <Table className="min-w-[980px]">
                        <Thead><Tr>
                          <SortTh path="/supplier/raw" sp={sp} k="invoice" cur={sort} label="Счёт" />
                          <SortTh path="/supplier/raw" sp={sp} k="lot" cur={sort} label="Лот" />
                          <SortTh path="/supplier/raw" sp={sp} k="fur" cur={sort} label="Вид меха" />
                          <SortTh path="/supplier/raw" sp={sp} k="color" cur={sort} label="Цвет" />
                          <SortTh path="/supplier/raw" sp={sp} k="size" cur={sort} label="Размер, сорт" />
                          <SortTh path="/supplier/raw" sp={sp} k="qty" cur={sort} label="Кол-во" align="right" />
                          <SortTh path="/supplier/raw" sp={sp} k="price" cur={sort} label="УПД без НДС" align="right" />
                          <SortTh path="/supplier/raw" sp={sp} k="unit" cur={sort} label="За шкуру, ₽" align="right" />
                          <SortTh path="/supplier/raw" sp={sp} k="total" cur={sort} label="Сумма, ₽" align="right" />
                          <SortTh path="/supplier/raw" sp={sp} k="doc" cur={sort} label="УПД" />
                          <Th />
                        </Tr></Thead>
                        <Tbody>
                          {sortRows(lots, sort, { invoice: (r) => r.invoice || r.purchaseNumber, lot: (r) => r.lotNumber, fur: (r) => r.fur, color: (r) => r.color, size: (r) => r.size, qty: (r) => r.quantity, price: (r) => r.unitPrice, unit: (r) => lotCalc.get(`${r.purchaseId}|${lotKey(r.lotNumber)}`)?.unit ?? null, total: (r) => lotCalc.get(`${r.purchaseId}|${lotKey(r.lotNumber)}`)?.total ?? null, doc: (r) => r.doc }).map((r) => (
                            <Tr key={r.itemId}>
                              <Td>{r.invoice || r.purchaseNumber}</Td><Td>{r.lotNumber || "—"}</Td><Td>{r.fur}</Td><Td className="max-w-[10rem]"><Clamp>{r.color || "—"}</Clamp></Td><Td className="max-w-[14rem]"><Clamp>{r.size || "—"}</Clamp></Td>
                              <Td className="text-right tabular-nums">{num(r.quantity)}</Td>
                              <Td className="whitespace-nowrap text-right tabular-nums">{money(r.unitPrice)} {cur(r.currency)}</Td>
                              {(() => { const lc = lotCalc.get(`${r.purchaseId}|${lotKey(r.lotNumber)}`); return <><Td className="whitespace-nowrap text-right tabular-nums">{lc ? money(lc.unit) : "—"}</Td><Td className="whitespace-nowrap text-right tabular-nums">{lc ? money(lc.total) : "—"}</Td></>; })()}
                              <Td className="max-w-[12rem]">{r.doc ? <Clamp>{r.doc}</Clamp> : <span className="text-neutral-500">нет</span>}</Td>
                              <Td>{isSup && <AttachDocument purchaseId={r.purchaseId} itemId={r.itemId} label="Приложить" />}</Td>
                            </Tr>
                          ))}
                        </Tbody>
                        <tfoot>
                          <tr className="row-total">
                            <td colSpan={5} className="px-3 py-1.5"><TotalLabel unit="₽" extra={`· лотов ${lots.length}`} /></td>
                            <td className="px-3 py-1.5 text-right tabular-nums">{num(aq)}</td>
                            <td />
                            <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{lotsCalcSum != null && aq > 0 ? money(lotsCalcSum / aq) : "—"}</td>
                            <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{lotsCalcSum != null ? money(lotsCalcSum) : "—"}</td>
                            <td colSpan={2} />
                          </tr>
                        </tfoot>
                      </Table>
                    </div>
                    )}
                  </div>
                </div>
              </details>
            );
          });
          return years.map((y) => {
            const ys = entries.map((e, i) => ({ e, i })).filter(({ e }) => yearOf(e[1]) === y);
            const yl = ys.flatMap(({ e }) => e[1].flat());
            const ycs = [...new Map(yl.flatMap((r) => { const x = calcInfo.get(r.purchaseId); return x ? [[x.id, x] as const] : []; })).values()];
            const yct = ycs.reduce((a, x) => a + x.total, 0), ycq = ycs.reduce((a, x) => a + x.qty, 0);
            return (
              <section key={y} className="flex flex-col gap-2">
                <h2 className="flex items-baseline gap-3 border-b border-neutral-200 pb-1 text-base font-semibold">{y}<span className="text-xs font-normal text-neutral-500">аукционов {ys.length} · лотов {yl.length} · шкур {num(yl.reduce((a, r) => a + r.quantity, 0))}{ycs.length > 0 && <> · себестоимость {money(yct)} ₽{ycq > 0 && <> · за шкуру {money(yct / ycq)} ₽</>}</>}</span></h2>
                {ys.map(({ i }) => cards[i])}
              </section>
            );
          });
        })()}
      </div>

      <div>
        <h2 className="mb-1 text-sm font-semibold">Отправленные документы</h2>
        {docs.length === 0 ? <p className="text-sm text-neutral-500">Нет документов</p> : (
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
