import Link from "next/link";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { FilterBar } from "@/components/filters/filter-bar";
import { InfoHint } from "@/components/info-hint";
import { TH } from "@/components/table-head";
import { Clamp } from "@/components/clamp";
import { TotalLabel } from "@/components/total-label";
import { PaymentWizardButton } from "@/components/payment-wizard";
import { defineFilters, filterHref, parseFilters, stateParam, activeCount, type SearchParamsLike } from "@/lib/filters";
import { PAY_STATUS_LABEL, loadInvoiceLinks, loadPaymentsRegistry, type PayStatus, type RegistryRow } from "@/lib/payments-registry";
import { isCountedPayment } from "@/lib/verification";
import { loadDashboard } from "@/lib/dashboard-data";
import { DASH_FILTERS, type DashFilters } from "@/lib/dashboard-calc";
import { getCommission4Mode } from "@/lib/commission4-mode";
import { formatMoney } from "@/lib/utils";
import type { YearFilter } from "@/lib/year-filter";
import { yearLabel } from "@/lib/year-filter";
import { ResponsiveRows, RowCard } from "@/components/responsive-rows";
import { PayTiles } from "../dashboard/pay-tiles";
import { PaymentsNav } from "./payments-nav";

const STATUSES = Object.keys(PAY_STATUS_LABEL) as PayStatus[];

export const REGISTRY_FILTERS = defineFilters({
  dir: { kind: "multi", label: "Направление", allowed: ["out", "in"] },
  cp: { kind: "multi", label: "Контрагент", maxLen: 120 },
  st: { kind: "multi", label: "Статус", allowed: STATUSES },
  from: { kind: "date", label: "Оплата с" },
  to: { kind: "date", label: "Оплата по" },
  // rq, а не q: общий q на /payments означает «название партии» и уводит на вкладку «За сырьё».
  rq: { kind: "text", label: "Поиск", maxLen: 60 },
  tab: stateParam("Раздел"),
  sort: stateParam("Сортировка", { allowed: ["asc", "desc"] }),
  sk: stateParam("Столбец сортировки", { allowed: ["pp", "inv", "cp", "date", "dir", "what", "sum", "doc", "st"] }),
});

type SortKey = "pp" | "inv" | "cp" | "date" | "dir" | "what" | "sum" | "doc" | "st";
const SORT_VAL: Record<SortKey, (r: RegistryRow) => string | number> = {
  pp: (r) => r.pp, inv: (r) => r.invoice, cp: (r) => r.counterparty, date: (r) => r.iso, dir: (r) => r.direction, what: (r) => r.what,
  sum: (r) => r.amount, doc: (r) => (r.fileOk ? 1 : 0), st: (r) => STATUSES.indexOf(r.status),
};

const ruDate = (iso: string) => iso.split("-").reverse().join(".");
const money = (n: number) => formatMoney(n.toFixed(2));
const STATUS_TONE: Record<PayStatus, string> = { verified: "text-emerald-700", docs: "text-amber-700", check: "text-neutral-700", mismatch: "text-red-700" };
const STATUS_MARK: Record<PayStatus, string> = { verified: "✓", docs: "○", check: "○", mismatch: "!" };

/** Реестр платежей: вкладка по умолчанию на /payments. Только чтение; правка — в карточке закупки / ТЗ и мастером оплаты. */
export async function PaymentsRegistry({ sp, orgId, year, canPay, flashError }: { sp: SearchParamsLike; orgId: string; year: YearFilter; canPay: boolean; flashError: string }) {
  const f = parseFilters(REGISTRY_FILTERS, sp);
  const all = (await loadPaymentsRegistry(orgId)).filter((r) => year === "all" || r.year === Number(year));
  const q = f.rq.toLowerCase().replace(/^№\s*/, "").replace(/ё/g, "е");
  const rows = all
    .filter((r) => f.dir.length === 0 || f.dir.includes(r.direction))
    .filter((r) => f.cp.length === 0 || f.cp.includes(r.counterparty))
    .filter((r) => f.st.length === 0 || f.st.includes(r.status))
    .filter((r) => !f.from || r.iso >= f.from)
    .filter((r) => !f.to || r.iso <= f.to)
    .filter((r) => !q || r.search.replace(/ё/g, "е").includes(q));
  const sk = (f.sk || "date") as SortKey;
  // Дата по умолчанию — от новых к старым; остальные столбцы — по возрастанию, повторный клик меняет направление.
  const asc = f.sort ? f.sort === "asc" : sk !== "date";
  if (f.sk || f.sort) {
    const val = SORT_VAL[sk];
    rows.sort((a, b) => {
      const x = val(a), y = val(b);
      const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "ru", { numeric: true });
      return (asc ? c : -c) || b.iso.localeCompare(a.iso);
    });
  }
  const cpOptions = Array.from(new Set(all.map((r) => r.counterparty))).sort((a, b) => a.localeCompare(b, "ru")).map((c) => ({ value: c, label: c }));
  const invLinks = await loadInvoiceLinks(orgId, rows);
  const dash = await loadDashboard(orgId, year, { status: [], ...parseFilters(DASH_FILTERS, {}) } as unknown as DashFilters, await getCommission4Mode());
  const sumOf = (dir: "out" | "in") => rows.filter((r) => r.direction === dir).reduce((a, r) => a + r.amount, 0);
  const cnt = (dir: "out" | "in") => rows.filter((r) => r.direction === dir).length;
  const th = (k: SortKey, label: string, align: "left" | "right" = "left", unit?: string) => (
    <TH label={label} unit={unit} align={align} className="px-3" sort={sk === k ? (asc ? "asc" : "desc") : "none"}
      href={filterHref(REGISTRY_FILTERS, "/payments", f, { sk: k, sort: sk === k ? (asc ? "desc" : "asc") : k === "date" ? "desc" : "asc" })} />
  );
  const filtered = activeCount(REGISTRY_FILTERS, f) > 0;
  const waiting = all.filter((r) => isCountedPayment(r.amount) && r.status !== "verified").length;

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: "Оплаты" }]} />
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold">Оплаты</h1>
        {year !== "all" && <span className="text-sm font-normal text-neutral-600">· {yearLabel(year)}</span>}
        <InfoHint wide label="О странице оплат">
          <p>Суммы с НДС. Год — из шапки: партия закупки по дате заказа, работа по дате оплаты.</p>
          <p className="mt-1">«Реестр» — одна таблица всех проведённых оплат: поставщику («Мы платим») и от заказчика («Нам платят»). Плитки сверху — общие итоги, как на Главной; таблица ниже учитывает фильтры.</p>
        </InfoHint>
        {canPay && <span className="ml-auto"><PaymentWizardButton label="+ Внести оплату" /></span>}
      </div>
      {flashError && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{flashError}</p>}
      <PaymentsNav tab="registry" />

      <div className="print:hidden">
        <FilterBar
          title="Фильтры реестра"
          oneRow
          hideChips
          controls={[
            { type: "multi", name: "dir", label: "Направление", more: true, options: [{ value: "out", label: "Мы платим" }, { value: "in", label: "Нам платят" }], allLabel: "Все" },
            { type: "multi", name: "cp", label: "Контрагент", options: cpOptions, allLabel: "Все контрагенты" },
            { type: "multi", name: "st", label: "Статус", options: STATUSES.map((s) => ({ value: s, label: PAY_STATUS_LABEL[s] })), allLabel: "Все статусы" },
            { type: "date", name: "from", label: "Оплата с" },
            { type: "date", name: "to", label: "Оплата по" },
            { type: "text", name: "rq", label: "Поиск", placeholder: "№ п/п, счёта, контрагент, закупка, ТЗ" },
          ]}
        />
      </div>

      <PayTiles d={dash} c4Mode={await getCommission4Mode()} year={year} headerEnd={<Link href="/dashboard" className="text-xs text-blue-700 hover:underline print:hidden">→ Главная</Link>} />

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-600">
        <span>Оплат в таблице: <b className="tabular-nums">{rows.length}</b>{filtered ? <> из <span className="tabular-nums">{all.length}</span></> : null}</span>
        <span>Ждут документа или проверки: <b className="tabular-nums">{waiting}</b></span>
        <InfoHint wide label="Статусы оплат">
          <p><b>Подтверждена</b> — есть документ-основание, оплата привязана, сумма и дата заданы; подтверждение поставлено.</p>
          <p className="mt-1"><b>Ждёт документа</b> — файл платёжки не загружен. <b>Не подтверждено</b> — файл есть, подтверждения ещё нет. <b>Расходится</b> — п/п названа в документах сверки, но сумма или дата в базе с ними не совпали.</p>
          <p className="mt-1">«Документ ✓» — только если файл реально лежит в приложении. «○ нужно загрузить» — файла нет.</p>
        </InfoHint>
        <Link href="/payments?tab=all" className="ml-auto text-blue-700 hover:underline">Разбор оплат по статьям →</Link>
      </div>

      <ResponsiveRows table={
      <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full min-w-[1180px] text-sm">
          <thead>
            <tr className="border-b border-neutral-200">
              {th("pp", "П/п №")}
              {th("inv", "Счёт №")}
              {th("cp", "Контрагент")}
              {th("date", "Дата")}
              {th("dir", "Направление")}
              {th("what", "Тип")}
              <TH label="К чему отнесено" align="left" className="px-3" />
              {th("sum", "Сумма", "right", "₽")}
              {th("doc", "Документ")}
              {th("st", "Статус")}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => <Row key={r.code} r={r} invHref={invLinks.get(r.code)} />)}
            {rows.length === 0 ? <tr><td colSpan={10} className="px-3 py-8 text-center text-neutral-500">{filtered ? "По выбранным фильтрам оплат нет" : "Оплат пока нет"}</td></tr> : null}
          </tbody>
          {rows.length > 0 ? (
            <tfoot>
              {(["out", "in"] as const).filter((d) => cnt(d) > 0).map((d) => (
                <tr key={d} className="row-total">
                  <td className="px-3 py-1.5" colSpan={7}><TotalLabel extra={`${d === "out" ? "мы платим" : "нам платят"} · ${cnt(d)}`} /></td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{money(sumOf(d))}</td>
                  <td colSpan={2} />
                </tr>
              ))}
            </tfoot>
          ) : null}
        </table>
      </div>
      }>
        {rows.map((r) => <Card key={r.code} r={r} invHref={invLinks.get(r.code)} />)}
        {rows.length === 0 ? <p className="py-8 text-center text-neutral-500">{filtered ? "По выбранным фильтрам оплат нет" : "Оплат пока нет"}</p> : null}
        {(["out", "in"] as const).filter((d) => cnt(d) > 0).map((d) => (
          <p key={d} className="flex justify-between gap-2 px-1 text-sm font-semibold"><span>Итого, {d === "out" ? "мы платим" : "нам платят"} · {cnt(d)}</span><span className="tabular-nums">{money(sumOf(d))}</span></p>
        ))}
      </ResponsiveRows>
    </div>
  );
}

const cpHref = (r: RegistryRow) => (r.cpId ? `/${r.kind === "raw" ? "suppliers" : "clients"}/${r.cpId}` : null);

function Card({ r, invHref }: { r: RegistryRow; invHref?: string }) {
  const href = `/payments/${r.code}?from=${encodeURIComponent("/payments")}`;
  return (
    <RowCard
      title={`${ruDate(r.iso)} · ${money(r.amount)} ₽`}
      href={href}
      subtitle={<>{r.direction === "out" ? "Мы платим" : "Нам платят"} · {cpHref(r) ? <Link href={cpHref(r)!} className="text-blue-700">{r.counterparty}</Link> : r.counterparty}</>}
      badge={<span className={"text-xs " + STATUS_TONE[r.status]}>{STATUS_MARK[r.status]} {PAY_STATUS_LABEL[r.status]}</span>}
      fields={[
        { label: "Тип", value: r.what },
        { label: "Документ", value: r.fileOk ? <span className="text-emerald-700">✓ файл загружен</span> : <Link href={href + "#docs"} className="text-amber-700">○ нужно загрузить</Link> },
      ]}
      details={[
        { label: "Счёт", value: invHref && r.invoice ? <Link href={invHref} className="text-blue-700">{r.invoice}</Link> : r.invoice },
        { label: "П/п", value: r.pp },
        { label: "К чему отнесено", value: r.targets.length === 0 ? <span className="text-amber-700">Не отнесено</span> : <div className="flex flex-col gap-0.5">{r.targets.map((t) => <Link key={t.href + t.label} href={t.href} className="text-blue-700">{t.label}</Link>)}{r.unallocated > 0.5 ? <span className="text-xs text-amber-700">не разнесено {money(r.unallocated)}</span> : null}</div> },
      ]}
    />
  );
}

const CELL = "px-3 py-2 h-10";
const DASH = <span className="text-neutral-400">—</span>;

function Row({ r, invHref }: { r: RegistryRow; invHref?: string }) {
  const href = `/payments/${r.code}?from=${encodeURIComponent("/payments")}`;
  const tgt = r.targets.map((t, i) => <span key={t.href + t.label}>{i > 0 ? ", " : ""}<Link href={t.href} className="text-blue-700 hover:underline">{t.label}</Link></span>);
  const rest = r.unallocated > 0.5 ? <span className="text-amber-700"> · не разнесено {money(r.unallocated)}</span> : null;
  return (
    <tr className="border-b border-neutral-100">
      <td className={CELL}><Clamp className="max-w-[9rem]"><Link href={href} className="text-blue-700 hover:underline" title="Открыть карточку оплаты">{r.pp ? `№ ${r.pp}` : "—"} ›</Link></Clamp></td>
      <td className={CELL}><Clamp className="max-w-[9rem]">{r.invoice ? (invHref ? <Link href={invHref} className="text-blue-700 hover:underline">{r.invoice}</Link> : r.invoice) : DASH}</Clamp></td>
      <td className={CELL}><Clamp className="max-w-[14rem]">{cpHref(r) ? <Link href={cpHref(r)!} className="text-blue-700 hover:underline">{r.counterparty}</Link> : r.counterparty}</Clamp></td>
      <td className={CELL + " whitespace-nowrap"}>{ruDate(r.iso)}</td>
      <td className={CELL + " whitespace-nowrap"}>{r.direction === "out" ? "Мы платим" : "Нам платят"}</td>
      <td className={CELL + " whitespace-nowrap"}>{r.what}</td>
      <td className={CELL}>
        {r.targets.length === 0 ? <span className="text-amber-700">Не отнесено</span> : (
          <Clamp className="max-w-[22rem]" full={<div className="flex flex-col gap-1">{r.targets.map((t) => <Link key={t.href + t.label} href={t.href} className="text-blue-700 hover:underline">{t.label}</Link>)}{r.unallocated > 0.5 ? <span className="text-amber-700">не разнесено {money(r.unallocated)}</span> : null}</div>}>{tgt}{rest}</Clamp>
        )}
      </td>
      <td className={CELL + " whitespace-nowrap text-right tabular-nums"}>{money(r.amount)}</td>
      <td className={CELL + " whitespace-nowrap"}>
        {r.fileOk ? <span className="text-emerald-700">✓ файл загружен</span> : <Link href={href + "#docs"} className="text-amber-700 hover:underline">○ нужно загрузить</Link>}
      </td>
      <td className={CELL + " whitespace-nowrap " + STATUS_TONE[r.status]}>{STATUS_MARK[r.status]} {PAY_STATUS_LABEL[r.status]}</td>
    </tr>
  );
}
