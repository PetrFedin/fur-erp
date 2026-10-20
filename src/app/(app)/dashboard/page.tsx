import Link from "next/link";
import { IntegrityBanner } from "@/components/integrity-banner";
import { requireSession } from "@/lib/session";
import { getCommission4Mode } from "@/lib/commission4-mode";
import { getYearFilter, yearLabel } from "@/lib/year-filter";
import { loadDashboard } from "@/lib/dashboard-data";
import { parseDashFilters } from "@/lib/dashboard-calc";
import { buildStrip } from "@/lib/main-strip";
import { loadPaymentsOverview } from "@/lib/payments-overview";
import { buildCashflow, aggregateSales, monthsOf } from "@/lib/cashflow";
import { loadSalesLines } from "@/lib/cashflow-server";
import { DashboardSummary, type SummaryProps } from "./summary";
import { PrintButton } from "./print-button";
import { PageModes, type ModeInfo } from "./mode-line";

export const metadata = { title: "Главная" };

const PRINT_CSS = `
@media print {
  @page { size: A4 landscape; margin: 8mm; }
  html { font-size: 10px; }
  html, body { background: #fff !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .h-screen { height: auto !important; }
  .overflow-hidden, main { overflow: visible !important; }
  nav, aside, header, body > .fixed, body > div.fixed, button.fixed, [data-nextjs-dev-tools-button], nextjs-portal { display: none !important; }
  main { padding: 0 !important; }
  [class*="overflow-x-auto"], [class*="overflow-auto"], .table-scroll { overflow: visible !important; max-height: none !important; }
  table { font-size: 9px !important; min-width: 0 !important; width: 100% !important; }
  th, td { white-space: normal !important; }
  tr { break-inside: avoid; }
  section { break-inside: avoid-page; }
  [data-print-date] { display: block !important; }
}`;

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const session = await requireSession();
  const c4Mode = await getCommission4Mode();
  const sp = await searchParams;
  const forbidden = sp.error === "forbidden";
  const organizationId = session.user.organizationId;
  const year = await getYearFilter();
  const f = parseDashFilters(sp);

  const d = await loadDashboard(organizationId, year, f, c4Mode);
  const yl = yearLabel(year);
  const FILTER_NAMES: [string, string][] = [["auction", "аукцион / закупка"], ["fur", "вид меха"], ["color", "цвет"], ["attr", "признак меха"], ["batch", "партия пр-ва"], ["catgroup", "группа категорий"], ["kind", "тип"]];
  const activeFilters = FILTER_NAMES.filter(([k]) => ((f as Record<string, string[] | undefined>)[k]?.length ?? 0) > 0).map(([k, n]) => `${n} ×${(f as Record<string, string[] | undefined>)[k]?.length ?? 0}`).join(", ");
  const info: ModeInfo = { year: yl, filters: activeFilters || null };
  const strip = buildStrip(d, c4Mode);
  const period = year === "all" ? "all" : String(year);
  const [rows, lines] = await Promise.all([loadPaymentsOverview(organizationId), loadSalesLines(organizationId)]);
  const months = monthsOf(period);
  const cf = buildCashflow(rows, period);
  const sales = aggregateSales(lines, months);
  const cumRev: number[] = []; sales.revIncl.reduce((a, v, i) => (cumRev[i] = a + v), 0);
  // «Предоплачено, ждём поставку»: заказанное, но не принятое (закупки в статусе «Черновик»); суммы — из БД через loadDashboard.
  const ordLots = d.syntheticLots.filter((l) => l.id.startsWith("ordered:"));
  const un = { paid: ordLots.reduce((a, l) => a + (l.paid ?? 0), 0), due: ordLots.reduce((a, l) => a + (l.due ?? 0), 0) };
  const decisions: SummaryProps["decisions"] = [];
  if ((d.control?.urgent ?? 0) > 0) decisions.push({ label: "Срочные задачи Контроля", href: "/attention", count: d.control!.urgent });
  if (d.advance > 0.5) decisions.push({ label: "Неразнесённый аванс подрядчику", href: "/payments", sum: d.advance });
  if (d.ordered.incl > 0.5 && un.due > 0.5) decisions.push({ label: "Предоплачено, ждём поставку: остаток к оплате", href: "/lots", sum: un.due });
  const summary: SummaryProps = {
    spent: strip.total.paid,
    received: sales.available ? sales.revIncl.reduce((a, v) => a + v, 0) : null,
    dueRaw: strip.supplier.debt, workRest: strip.work.left, advance: d.advance,
    stockQty: d.raw.fur.incl.remQty + d.raw.lining.incl.remQty, stockValue: d.raw.fur.incl.remValue + d.raw.lining.incl.remValue,
    inProdQty: strip.prod.qty, inProdOrders: strip.prod.orders, prodAvg: strip.prod.avg ? strip.prod.avg.incl : null,
    prepaid: { qty: d.ordered.qty, ordered: d.ordered.incl, paid: un.paid, due: un.due },
    decisions,
    chart: { months, spent: cf.cumulative, received: sales.available ? cumRev : null },
  };

  return (
    <div className="flex flex-col gap-5">
      <style>{PRINT_CSS}</style>
      <IntegrityBanner />
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* Режимы и «i» — рядом с заголовком, а не внутри: иначе имя заголовка читается как «Сводка · все годы · с НДС … i». */}
        <div className="flex flex-wrap items-center">
          <h1 className="text-xl font-semibold">Главная</h1>
          <PageModes info={info} c4={c4Mode} />
        </div>
        <div className="flex items-center gap-2">
          <span className="relative inline-flex print:hidden" data-scheme-btn>
            <span aria-hidden className="absolute inset-0 animate-ping rounded-md bg-orange-400/60 motion-reduce:animate-none" />
            <Link href="/scheme" className="relative rounded-md border border-orange-500 bg-orange-500 px-3 py-1 text-xs font-medium text-white shadow-sm hover:bg-orange-600">Схема</Link>
          </span>
          <PrintButton />
        </div>
      </div>
      <p data-print-date className="hidden text-xs text-neutral-600">
        Напечатано: {new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow", dateStyle: "long", timeStyle: "short" })} (МСК) · {yl}{activeFilters ? ` · фильтры: ${activeFilters}` : ""}
      </p>
      {forbidden && (
        <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          Недостаточно прав для этого действия
        </div>
      )}

      <DashboardSummary {...summary} />
    </div>
  );
}
