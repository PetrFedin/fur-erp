import Link from "next/link";
import { Clamp } from "@/components/clamp";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { prisma } from "@/lib/prisma";
import { requireRawViewer } from "@/lib/supplier-inbox";
import { loadSupplierAuction } from "@/lib/supplier-auction";
import { calcAll, calcVatPct, ensureRowIds } from "@/lib/supplier-calc";
import { buildStatement, groupLines, type Statement } from "@/lib/auction-statement";
import { readSort } from "@/lib/table-sort";
import { formatDate, formatRate } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { AttachDocument } from "../attach";
import { RawStagesBlock } from "@/components/raw-stages";
import { BreakdownTable } from "@/components/breakdown-table";
import { ChatLink } from "@/components/chat-link";
import { LotCompose, LotsTable, StatementBlock, type LotRow } from "@/components/auction-statement";
import { InfoHint } from "@/components/info-hint";
import { paymentDocFlagsFor } from "@/lib/supplier-payment-docs";
import { summarizeStages, summaryLine } from "@/lib/raw-stage";

export const metadata = { title: "Аукцион" };

const num = (n: number) => n.toLocaleString("ru-RU", { maximumFractionDigits: 3 });
const money = (n: number) => n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cur = (c: string) => (c === "RUB" ? "₽" : c === "USD" ? "$" : c);
const KIND: Record<string, string> = { AUCTION_INVOICE: "Аукционный счёт", PAYMENT_INVOICE: "Счёт", SPECIFICATION: "Спецификация", UPD: "УПД", OTHER: "Документ" };
const SORTS = ["invoice", "lot", "fur", "size", "qty", "unit", "total"];

export default async function SupplierAuctionPage({ params, searchParams }: PageProps<"/supplier/raw/[purchaseId]">) {
  const { purchaseId } = await params;
  const sp = await searchParams;
  const s = await requireRawViewer();
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
  const { purchase: p, items, calc, docs, invoices } = d;
  const stages = await prisma.supplierRawStage.findMany({
    where: { organizationId: s.user.organizationId, supplierId, purchaseId: { in: invoices.map((i) => i.id) } },
    orderBy: { createdAt: "asc" },
    select: { id: true, purchaseId: true, stage: true, status: true, place: true, lotNumber: true, qty: true, note: true, plannedStart: true, plannedEnd: true, factStart: true, factEnd: true },
  });
  const myStages = stages.filter((x) => x.purchaseId === p.id);
  const lines = [...new Set(invoices.map((i) => { const sm = summarizeStages(stages.filter((x) => x.purchaseId === i.id)); return sm ? summaryLine(sm) : i.received ? "принято на склад" : ""; }))];
  const nowLine = lines.length === 1 ? lines[0] : lines.length > 1 ? "по счетам по-разному — см. «Этапы сырья» ниже" : "";
  const received = invoices.filter((i) => i.received).length;

  const payload = calc?.payload && calc.payload.v === 1 && Array.isArray(calc.payload.rows) ? ensureRowIds(calc.payload) : null;
  const t = payload ? calcAll(payload) : null;
  const st: Statement | null = payload && t ? buildStatement(payload, t) : null;
  const h = payload?.header;
  const c = cur(p.currency);

  // Лоты: из расчёта (в ₽), если он есть, иначе из закупок (в валюте УПД).
  const lotRows: LotRow[] = st
    ? st.lots.map((l) => ({ id: l.rowId, invoice: l.invoice, lot: l.lot, fur: l.fur, size: l.size, qty: l.qty, unit: l.unit, total: l.total, cur: "₽", parts: Object.fromEntries(groupLines(st.lines).map((g) => [g.key, g.lines.reduce((a, x) => a + (x.perLot[l.index] ?? 0), 0)])) }))
    : items.map((i) => ({ id: i.id, invoice: i.invoice, lot: i.lot, fur: i.fur, size: i.size, qty: i.qty, unit: i.unitPrice, total: i.subtotal, cur: c }));
  const totalQty = lotRows.reduce((a, r) => a + r.qty, 0);
  const totalSum = st ? st.total : lotRows.reduce((a, r) => a + r.total, 0);
  const itemsQty = items.reduce((a, i) => a + i.qty, 0);
  const sort = readSort(sp, SORTS);
  const path = `/supplier/raw/${p.id}`;
  const openId = typeof sp.lot === "string" ? sp.lot : undefined;
  const closeHref = (() => { const q = new URLSearchParams(); for (const [k, v] of Object.entries(sp)) { const val = Array.isArray(v) ? v[0] : v; if (val && k !== "lot") q.set(k, val); } const qs = q.toString(); return `${path}${qs ? `?${qs}` : ""}#lots`; })();

  let panel: React.ReactNode = null;
  if (openId) {
    if (st) {
      const l = st.lots.find((x) => x.rowId === openId);
      if (l) panel = <LotCompose title={`лот ${l.lot || "без №"} · ${l.fur}`} qty={l.qty} unit={l.unit} total={l.total} closeHref={closeHref} lines={st.lines.map((x) => ({ label: x.label, letter: x.letter, perUnit: x.perUnit[l.index] ?? 0, total: x.perLot[l.index] ?? 0 }))} />;
    } else {
      const it = items.find((x) => x.id === openId);
      if (it) panel = (
        <section id="lot-detail" className="flex flex-col gap-2 rounded-md border border-amber-300 bg-amber-50/60 p-3">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="text-sm font-semibold">Из чего сложилась цена: лот {it.lot || "без №"} · {it.fur}</h3>
            <Link href={closeHref} scroll={false} className="ml-auto inline-flex min-h-11 items-center text-sm text-blue-700 underline md:min-h-0">Закрыть</Link>
          </div>
          {it.breakdown.length > 0 ? <BreakdownTable items={it.breakdown} /> : <p className="text-sm text-neutral-600">Разбивки по этому лоту нет: цена по УПД {money(it.unitPrice)} {c} за шкуру без НДС.</p>}
        </section>
      );
    }
  }

  const facts: [string, React.ReactNode][] = [
    ["Аукционный дом", h?.seller || h?.auction || p.auction],
    ["Дата", formatDate(p.orderDate)],
    ["Валюта и курс", (() => {
      // Курс — как у заказчика: курс закупки (по счёту); курс расчёта показываем, если он есть. Разные курсы по счетам — перечисляем.
      const rates = [...new Set(invoices.map((i) => i.rate))].filter((r) => r > 0 && (p.currency !== "RUB" || r !== 1));
      const main = t && t.rate > 0 ? t.rate : rates[0];
      if (p.currency === "RUB" && !(t && t.rate > 0)) return p.currency;
      const differ = rates.length > 1 || (t && t.rate > 0 && rates.some((r) => Math.abs(r - t.rate) > 0.0005));
      return (
        <span key="rate" className="inline-flex flex-wrap items-center gap-1.5">{p.currency}, курс {main ? formatRate(main) : "—"}
          {differ && <span className="text-neutral-600">(по счетам: {invoices.filter((i) => i.rate > 0).map((i) => `${i.invoice || i.number} — ${formatRate(i.rate)}`).join("; ")})</span>}
          {h?.cbRate ? <InfoHint label="Из чего курс">Курс, по которому считается себестоимость. Курс ЦБ на дату: {h.cbRate}{h.agentPct ? `; надбавка агента ${h.agentPct}%` : ""}.</InfoHint> : null}
        </span>
      );
    })()],
    ["Счета", invoices.map((i) => i.invoice || i.number).join(", ")],
    ...(t && payload ? ([
      ["Шкур", num(t.qty)],
      ["Итого", `${money(t.totalRub)} ₽`],
      ["За шкуру", t.qty ? `${money(t.totalRub / t.qty)} ₽` : ""],
      ["НДС", calcVatPct(payload) != null ? `${calcVatPct(payload)}%` : ""],
      ["Расходы", payload.header.extras.filter((e) => e.name.trim() && e.amount.trim()).map((e) => `${e.name}: ${e.amount} ₽${e.mode === "perHide" ? "/шк." : ""}`).join("; ")],
      ["Аванс", t.advance > 0 ? `${money(t.advance)} ₽${payload.header.advanceDate ? ` от ${formatDate(new Date(payload.header.advanceDate))}` : ""}` : ""],
      ["Платёж", t.interim > 0 ? `${money(t.interim)} ₽` : ""],
      ["Остаток", t.advance > 0 || t.interim > 0 ? `${money(t.rest)} ₽` : ""],
    ] as [string, React.ReactNode][]) : []),
    ["Принято на склад", `${received} из ${invoices.length} счетов`],
  ];
  // Только булев признак: есть ли у заказчика загруженный документ по оплате счёта (без сумм, дат и файла).
  const payFlags = await paymentDocFlagsFor(s.user.organizationId, supplierId, invoices.map((i) => ({ id: i.id, invoice: i.invoice, number: i.number })));
  const docFiles = docs.flatMap((x) => x.files.map((f) => ({ ...f, title: x.title })));

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: "Главная" }, { label: "Сырьё", href: "/supplier/raw" }, { label: p.auction || p.number }]} />

      <section className="flex flex-col gap-3 rounded-md border border-neutral-300 bg-white p-3" aria-label="Карточка аукциона">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <h1 className="text-xl font-semibold">{p.auction || p.number}</h1>
          <span className={received === invoices.length ? "rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-800" : "rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900"}>{received === invoices.length ? "принято на склад" : "в пути / заказано"}</span>
          {calc && <Link href={`/supplier/auction-calcs/${calc.id}`} className={`ml-auto ${buttonVariants({ size: "sm" })}`}>Открыть расчёт</Link>}
        </div>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {facts.filter(([, v]) => v).map(([k, v]) => (
            <div key={k} className="flex gap-2"><dt className="shrink-0 text-neutral-500">{k}:</dt><dd className="min-w-0 break-words">{(k === "Счета" || k === "Расходы") && typeof v === "string" ? <Clamp>{v}</Clamp> : v}</dd></div>
          ))}
        </dl>
        {nowLine && <p className="text-sm"><b>Сырьё сейчас:</b> {nowLine}</p>}
        {(!st || Math.abs(itemsQty - totalQty) > 0.0005) && (
          <p className="border-t border-neutral-200 pt-2 text-sm">
            {!st && <>Лотов <b className="tabular-nums">{lotRows.length}</b> · шкур <b className="tabular-nums">{num(totalQty)}</b> · по УПД без НДС: <b className="tabular-nums">{money(totalSum)} {c}</b></>}
            {st && <span className="text-amber-900">В закупках шкур {num(itemsQty)} — не совпадает с расчётом, проверьте.</span>}
          </p>
        )}
      </section>

      {st && <StatementBlock st={st} source={`лист расчёта «${calc?.title ?? ""}»`} />}

      <section id="lots" className="flex flex-col gap-2 scroll-mt-4">
        <h2 className="text-base font-semibold">Лоты</h2>
        {!st && <p className="text-sm text-neutral-600">Нет расчёта{isSup && <> — внесите его в разделе «<Link href="/supplier/auction-calcs" className="text-blue-700 underline max-md:inline-block max-md:py-3">Аукционы</Link>»</>}.</p>}
        {lotRows.length === 0 ? (
          <p className="rounded-md border border-dashed border-neutral-300 p-4 text-center text-sm text-neutral-500">В закупке пока нет лотов.</p>
        ) : (
          <LotsTable rows={lotRows} partCols={st && st.detailed ? groupLines(st.lines).map((g) => ({ key: g.key, title: g.title })) : []} path={path} sp={sp} cur={sort} openId={openId} showInvoice={invoices.length > 1 || lotRows.some((r) => r.invoice)} />
        )}
        {panel}
      </section>

      <details className="group rounded-md border border-neutral-300 bg-white" open={isSup && myStages.length === 0}>
        <summary className="flex min-h-11 cursor-pointer items-center gap-2 px-3 text-sm font-semibold"><span className="text-neutral-500 transition-transform group-open:rotate-90">▶</span>Этапы сырья<span className="font-normal text-neutral-500">{stages.length ? ` · ${stages.length}` : ""}</span></summary>
        <div className="border-t border-neutral-200 p-2">
          <RawStagesBlock stages={myStages} purchaseId={p.id} lots={[...new Set(items.filter((i) => i.purchaseId === p.id).map((i) => i.lot).filter(Boolean))]} siblings={invoices.length - 1} editable={isSup} showNow={false} title="Лента этапов" />
        </div>
      </details>

      <details className="group rounded-md border border-neutral-300 bg-white">
        <summary className="flex min-h-11 cursor-pointer items-center gap-2 px-3 text-sm font-semibold"><span className="text-neutral-500 transition-transform group-open:rotate-90">▶</span>Документы аукциона<span className="font-normal text-neutral-500">{docFiles.length ? ` · ${docFiles.length}` : ""}</span></summary>
        <div className="flex flex-col gap-2 border-t border-neutral-200 p-3">
          <div className="flex flex-wrap items-center gap-3">
            {isSup && <AttachDocument purchaseId={p.id} label="Приложить документ" />}
            <ChatLink type="Purchase" id={p.id} role={s.user.role} />
          </div>
          <div className="flex flex-col gap-1 rounded-md border border-neutral-200 p-2 text-sm" aria-label="Платёжные документы по счетам">
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Платёжный документ
              <InfoHint label="О платёжных документах">Документы по оплате загружает заказчик.</InfoHint>
            </div>
            <ul className="flex flex-col gap-0.5">
              {invoices.map((i) => {
                const has = payFlags.get(i.id) === true;
                return (
                  <li key={i.id} className="flex flex-wrap items-center gap-x-2">
                    <span>Счёт {i.invoice || i.number}:</span>
                    {has
                      ? <span className="font-medium text-green-800"><span aria-hidden>✓</span> есть</span>
                      : <span className="text-neutral-500"><span aria-hidden>—</span> нет</span>}
                  </li>
                );
              })}
            </ul>
          </div>
          {docFiles.length === 0 ? (
            <p className="text-sm text-neutral-500">Документов пока нет: счета, УПД, спецификации, письма.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {docFiles.map((f) => (
                <li key={f.id}><a href={`/api/supplier/inbox-files/${f.id}`} className="inline-block text-blue-700 underline max-md:py-3">{f.originalName}</a><span className="text-neutral-500"> · {f.title || (KIND[f.kind] ?? "Документ")}</span></li>
              ))}
            </ul>
          )}
        </div>
      </details>
    </div>
  );
}
