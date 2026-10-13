import { getFreshSession } from "@/lib/session";
import { getYearFilter } from "@/lib/year-filter";
import { getCommission4Mode } from "@/lib/commission4-mode";
import { loadRawWithDashboard } from "@/lib/raw-analytics-dash";
import { applyFilters, aggOf, avgPrice, groupLots, groupUsage, isUsageBy, loadUsageRows, parseFilters, usedPct, GROUPS } from "@/lib/raw-analytics";

/**
 * CSV «Аналитика сырья» (UTF-8 с BOM, разделитель «;» — открывается в Excel).
 * Те же фильтры, что и страница: g, scope, auction, fur, pyear, rest, q, model + общий год из cookie.
 * part=groups — сводная таблица в выбранной группировке; part=lots — плоский список лотов.
 * Цены — с НДС и без НДС отдельными колонками (режим показа не важен для файла).
 */
export async function GET(request: Request) {
  const session = await getFreshSession();
  if (!session?.user) return new Response("Unauthorized", { status: 401 });

  const url = new URL(request.url);
  const spObj: Record<string, string[]> = {};
  for (const k of new Set(url.searchParams.keys())) spObj[k] = url.searchParams.getAll(k);
  const { f, by } = parseFilters(spObj);
  const year = await getYearFilter();
  const { all } = await loadRawWithDashboard(session.user.organizationId, year, await getCommission4Mode());
  const lots = applyFilters(all, f);
  const unit = f.scope === "lining" ? "м" : "шт";

  const cell = (v: string | number | null) => {
    let s = v == null ? "" : typeof v === "number" ? String(v).replace(".", ",") : v;
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const num = (d: { toFixed(n: number): string } | null, n = 2) => (d ? d.toFixed(n) : null);
  const row = (cells: (string | number | null)[]) => cells.map((c) => (typeof c === "string" || c == null ? cell(c) : cell(c))).join(";");
  const lines: string[] = [];

  if (url.searchParams.get("part") === "lots") {
    lines.push(["Лот", "Аукцион", "Год", "Вид", "Сорт / цвет", "Размер", `Куплено, ${unit}`, `Использовано, ${unit}`, `Остаток, ${unit}`, "% использования", "Цена за ед. с НДС", "Цена за ед. без НДС", "Стоимость остатка с НДС", "Стоимость остатка без НДС", "Остаток в учете (журнал)", "ТЗ"].map(cell).join(";"));
    for (const l of lots) {
      const a = aggOf([l]);
      lines.push(row([
        l.lotNumber, l.auction === "__none" ? l.auctionLabel : l.auction, l.year, l.kind, l.cat, l.size,
        num(l.recv, 3), num(l.used, 3), num(l.rem, 3), usedPct(a)?.toFixed(1) ?? null,
        num(l.unitIncl), num(l.unitExcl), num(a.remIncl), num(a.remExcl), num(l.jNet, 3),
        l.usages.map((u) => `${u.label} (${u.qty.toString()})`).join("; "),
      ]));
    }
  } else if (isUsageBy(by)) {
    const ids = new Set(lots.map((l) => l.id));
    const rows = (await loadUsageRows(session.user.organizationId, year)).filter((r) => ids.has(r.lotId));
    lines.push([by === "article" ? "Изделие (артикул)" : "ТЗ", by === "article" ? "Артикул / категория" : "Изделие", "ТЗ", "Лотов", "Произведено, шт", `Списано, ${unit}`, `На 1 изделие, ${unit}`, "Стоимость с НДС", "Стоимость без НДС", "Надбавка 4% с НДС", "Надбавка 4% без НДС"].map(cell).join(";"));
    for (const g of groupUsage(rows, by)) {
      lines.push(row([g.label, g.sub, g.orders, g.lots, num(g.produced, 3), num(g.qty, 3), g.produced.greaterThan(0) ? num(g.qty.div(g.produced), 3) : null, num(g.incl), num(g.excl), num(g.extraIncl), num(g.extraExcl)]));
    }
  } else {
    const label = GROUPS.find((g) => g.key === by)!.label;
    lines.push([label, "Лотов", `Куплено, ${unit}`, `Использовано, ${unit}`, `Остаток, ${unit}`, "% использования", "Ср. цена закупки с НДС", "Ср. цена закупки без НДС", "Стоимость остатка с НДС", "Стоимость остатка без НДС"].map(cell).join(";"));
    const emit = (name: string, a: ReturnType<typeof aggOf>) => {
      const p = avgPrice(a);
      lines.push(row([name, a.lots, num(a.recv, 3), num(a.used, 3), num(a.rem, 3), usedPct(a)?.toFixed(1) ?? null, num(p?.incl ?? null), num(p?.excl ?? null), num(a.remIncl), num(a.remExcl)]));
    };
    for (const g of groupLots(lots, by as Exclude<typeof by, "article" | "order">)) emit(g.title ?? g.label, g.agg);
    emit("Σ Итого", aggOf(lots));
  }

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response("﻿" + lines.join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="analitika-syrya-${url.searchParams.get("part") === "lots" ? "lots" : by}-${year}-${stamp}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
