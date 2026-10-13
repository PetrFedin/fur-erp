import Link from "next/link";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { FilterBar } from "@/components/filters/filter-bar";
import { InfoHint } from "@/components/info-hint";
import { TH } from "@/components/table-head";
import { TotalLabel } from "@/components/total-label";
import { PaymentWizardButton } from "@/components/payment-wizard";
import { defineFilters, filterHref, parseFilters, stateParam, activeCount, type SearchParamsLike } from "@/lib/filters";
import { PAY_STATUS_LABEL, loadPaymentsRegistry, type PayStatus, type RegistryRow } from "@/lib/payments-registry";
import { loadDashboard } from "@/lib/dashboard-data";
import { DASH_FILTERS, type DashFilters } from "@/lib/dashboard-calc";
import { getCommission4Mode } from "@/lib/commission4-mode";
import { formatMoney } from "@/lib/utils";
import type { YearFilter } from "@/lib/year-filter";
import { yearLabel } from "@/lib/year-filter";
import { PayTiles } from "../dashboard/pay-tiles";
import { PaymentsNav } from "./payments-nav";

const STATUSES = Object.keys(PAY_STATUS_LABEL) as PayStatus[];

export const REGISTRY_FILTERS = defineFilters({
  dir: { kind: "multi", label: "Направление", allowed: ["out", "in"] },
  cp: { kind: "multi", label: "Контрагент", maxLen: 120 },
  st: { kind: "multi", label: "Статус", allowed: STATUSES },
  from: { kind: "date", label: "Оплата с" },
  to: { kind: "date", label: "Оплата по" },
  q: { kind: "text", label: "Счёт или п/п", maxLen: 40 },
  tab: stateParam("Раздел"),
  sort: stateParam("Сортировка", { allowed: ["asc", "desc"] }),
});

const ruDate = (iso: string) => iso.split("-").reverse().join(".");
const money = (n: number) => formatMoney(n.toFixed(2));
const STATUS_TONE: Record<PayStatus, string> = { verified: "text-emerald-700", docs: "text-amber-700", check: "text-neutral-700", mismatch: "text-red-700" };
const STATUS_MARK: Record<PayStatus, string> = { verified: "✓", docs: "○", check: "○", mismatch: "!" };

/** Реестр платежей: вкладка по умолчанию на /payments. Только чтение; правка — в карточке закупки / ТЗ и мастером оплаты. */
export async function PaymentsRegistry({ sp, orgId, year, canPay, flashError }: { sp: SearchParamsLike; orgId: string; year: YearFilter; canPay: boolean; flashError: string }) {
  const f = parseFilters(REGISTRY_FILTERS, sp);
  const all = (await loadPaymentsRegistry(orgId)).filter((r) => year === "all" || r.year === Number(year));
  const q = f.q.toLowerCase().replace(/^№\s*/, "");
  const rows = all
    .filter((r) => f.dir.length === 0 || f.dir.includes(r.direction))
    .filter((r) => f.cp.length === 0 || f.cp.includes(r.counterparty))
    .filter((r) => f.st.length === 0 || f.st.includes(r.status))
    .filter((r) => !f.from || r.iso >= f.from)
    .filter((r) => !f.to || r.iso <= f.to)
    .filter((r) => !q || `${r.invoice} ${r.pp}`.toLowerCase().includes(q));
  const asc = f.sort === "asc";
  if (asc) rows.reverse();
  const cpOptions = Array.from(new Set(all.map((r) => r.counterparty))).sort((a, b) => a.localeCompare(b, "ru")).map((c) => ({ value: c, label: c }));
  const dash = await loadDashboard(orgId, year, { status: [], ...parseFilters(DASH_FILTERS, {}) } as unknown as DashFilters, await getCommission4Mode());
  const sumOf = (dir: "out" | "in") => rows.filter((r) => r.direction === dir).reduce((a, r) => a + r.amount, 0);
  const cnt = (dir: "out" | "in") => rows.filter((r) => r.direction === dir).length;
  const sortHref = filterHref(REGISTRY_FILTERS, "/payments", f, { sort: asc ? "desc" : "asc" });
  const filtered = activeCount(REGISTRY_FILTERS, f) > 0;
  const waiting = all.filter((r) => r.status !== "verified").length;

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
            { type: "multi", name: "dir", label: "Направление", options: [{ value: "out", label: "Мы платим" }, { value: "in", label: "Нам платят" }], allLabel: "Все" },
            { type: "multi", name: "cp", label: "Контрагент", options: cpOptions, allLabel: "Все контрагенты" },
            { type: "multi", name: "st", label: "Статус", options: STATUSES.map((s) => ({ value: s, label: PAY_STATUS_LABEL[s] })), allLabel: "Все статусы" },
            { type: "date", name: "from", label: "Оплата с" },
            { type: "date", name: "to", label: "Оплата по" },
            { type: "text", name: "q", label: "Счёт или п/п", placeholder: "№ счёта или п/п" },
          ]}
        />
      </div>

      <PayTiles d={dash} c4Mode={await getCommission4Mode()} year={year} headerEnd={<Link href="/dashboard" className="text-xs text-blue-700 hover:underline print:hidden">→ Главная</Link>} />

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-600">
        <span>Оплат в таблице: <b className="tabular-nums">{rows.length}</b>{filtered ? <> из <span className="tabular-nums">{all.length}</span></> : null}</span>
        <span>Ждут документа или проверки: <b className="tabular-nums">{waiting}</b></span>
        <InfoHint wide label="Статусы оплат">
          <p><b>Подтверждена</b> — есть документ-основание, оплата привязана, сумма и дата заданы; подтверждение поставлено.</p>
          <p className="mt-1"><b>Ждёт документа</b> — файл платёжки не загружен. <b>Ждёт проверки</b> — файл есть, подтверждения ещё нет. <b>Расходится</b> — п/п названа в документах сверки, но сумма или дата в базе с ними не совпали.</p>
          <p className="mt-1">«Документ ✓» — только если файл реально лежит в приложении. «○ нужно загрузить» — файла нет.</p>
        </InfoHint>
        <Link href="/payments?tab=all" className="ml-auto text-blue-700 hover:underline">Разбор оплат по статьям →</Link>
      </div>

      <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full min-w-[1180px] text-sm">
          <thead>
            <tr className="border-b border-neutral-200">
              <TH label="Дата" align="left" className="px-3" sort={asc ? "asc" : "desc"} href={sortHref} />
              <TH label="Направление" align="left" className="px-3" />
              <TH label="Контрагент" align="left" className="px-3" />
              <TH label="Сумма" unit="₽" align="right" className="px-3" />
              <TH label="Тип" align="left" className="px-3" />
              <TH label="К чему отнесено" align="left" className="px-3" />
              <TH label="Счёт" align="left" className="px-3" />
              <TH label="П/п" align="left" className="px-3" />
              <TH label="Документ" align="left" className="px-3" />
              <TH label="Статус" align="left" className="px-3" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => <Row key={r.code} r={r} />)}
            {rows.length === 0 ? <tr><td colSpan={10} className="px-3 py-8 text-center text-neutral-500">{filtered ? "По выбранным фильтрам оплат нет" : "Оплат пока нет"}</td></tr> : null}
          </tbody>
          {rows.length > 0 ? (
            <tfoot>
              {(["out", "in"] as const).filter((d) => cnt(d) > 0).map((d) => (
                <tr key={d} className="row-total">
                  <td className="px-3 py-1.5" colSpan={2}><TotalLabel extra={`${d === "out" ? "мы платим" : "нам платят"} · ${cnt(d)}`} /></td>
                  <td />
                  <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{money(sumOf(d))}</td>
                  <td colSpan={6} />
                </tr>
              ))}
            </tfoot>
          ) : null}
        </table>
      </div>
    </div>
  );
}

function Row({ r }: { r: RegistryRow }) {
  const href = `/payments/${r.code}?from=${encodeURIComponent("/payments")}`;
  return (
    <tr className="border-b border-neutral-100 align-top">
      <td className="whitespace-nowrap px-3 py-2"><Link href={href} className="text-blue-700 hover:underline" title="Открыть карточку оплаты">{ruDate(r.iso)} ›</Link></td>
      <td className="whitespace-nowrap px-3 py-2">{r.direction === "out" ? "Мы платим" : "Нам платят"}</td>
      <td className="max-w-[16rem] px-3 py-2">{r.counterparty}</td>
      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{money(r.amount)}</td>
      <td className="whitespace-nowrap px-3 py-2">{r.what}</td>
      <td className="px-3 py-2">
        {r.targets.length === 0 ? <span className="text-amber-700">Не отнесено</span> : (
          <div className="flex flex-col gap-0.5">
            {r.targets.map((t) => <Link key={t.href + t.label} href={t.href} className="text-blue-700 hover:underline">{t.label}</Link>)}
            {r.unallocated > 0.5 ? <span className="text-xs text-amber-700">не разнесено {money(r.unallocated)}</span> : null}
          </div>
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-2">{r.invoice || <span className="text-neutral-400">—</span>}</td>
      <td className="whitespace-nowrap px-3 py-2">{r.pp || <span className="text-neutral-400">—</span>}</td>
      <td className="whitespace-nowrap px-3 py-2">
        {r.fileOk ? <span className="text-emerald-700">✓ файл загружен</span> : <Link href={href + "#docs"} className="text-amber-700 hover:underline">○ нужно загрузить</Link>}
      </td>
      <td className={"whitespace-nowrap px-3 py-2 " + STATUS_TONE[r.status]}>{STATUS_MARK[r.status]} {PAY_STATUS_LABEL[r.status]}</td>
    </tr>
  );
}
