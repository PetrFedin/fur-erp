import { getFreshSession } from "@/lib/session";
import { getYearFilter } from "@/lib/year-filter";
import { buildRecon, loadRawData, lotBalances, ageText } from "@/lib/raw-analytics";

/**
 * CSV «Сверка лотов» (UTF-8 с BOM, разделитель «;»). part=mismatch | dormant | over. Год — общий, из cookie.
 * Имя файла только латиницей.
 */
export async function GET(request: Request) {
  const session = await getFreshSession();
  if (!session?.user) return new Response("Unauthorized", { status: 401 });
  const url = new URL(request.url);
  const part = ["mismatch", "dormant", "over"].includes(url.searchParams.get("part") ?? "") ? (url.searchParams.get("part") as string) : "mismatch";
  const year = await getYearFilter();
  const data = await loadRawData(session.user.organizationId, year);
  const recon = buildRecon(data.lots);

  const cell = (v: string | number | null) => {
    let s = v == null ? "" : typeof v === "number" ? String(v).replace(".", ",") : v;
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const row = (cells: (string | number | null)[]) => cells.map(cell).join(";");
  const unit = (u: string) => (u === "M" ? "м" : "шт");
  const lines: string[] = [];

  if (part === "mismatch") {
    lines.push(row(["Лот", "Тип", "Аукцион", "Год", "Остаток в учете (журнал)", "Остаток по лоту", "Получено минус ТЗ", "Приход по журналу", "Получено по лоту", "Списано в ТЗ по журналу", "Сумма списаний ТЗ", "Что не сходится"]));
    for (const { lot: l, issues } of recon.mismatch) {
      const b = lotBalances(l);
      lines.push(row([l.lotNumber, l.unit === "M" ? `Подкладка (${l.materialName})` : "Мех", l.auction === "__none" ? l.auctionLabel : l.auction, l.year, b.journal.toFixed(3), b.lot.toFixed(3), b.calc.toFixed(3), l.jIn.toFixed(3), l.recv.toFixed(3), l.jProdOut.toFixed(3), l.used.toFixed(3), issues.join("; ")]));
    }
  } else if (part === "dormant") {
    lines.push(row(["Лот", "Тип", "Что", "Аукцион", "Год", "Дата закупки", "Лежит, дней", "Лежит", "Остаток", "Ед.", "Стоимость остатка с НДС", "Стоимость остатка без НДС"]));
    for (const { lot: l, days, remIncl, remExcl } of recon.dormant) {
      lines.push(row([l.lotNumber, l.unit === "M" ? "Подкладка" : "Мех", `${l.unit === "M" ? l.materialName : l.kind} ${l.cat}`, l.auction === "__none" ? l.auctionLabel : l.auction, l.year, l.date.toISOString().slice(0, 10), days, ageText(days), l.rem.toFixed(3), unit(l.unit), remIncl.toFixed(2), remExcl.toFixed(2)]));
    }
  } else {
    lines.push(row(["Лот", "Тип", "Аукцион", "Год", "Получено", "Использовано", "Превышение", "Ед."]));
    for (const { lot: l, excess } of recon.over) {
      lines.push(row([l.lotNumber, l.unit === "M" ? "Подкладка" : "Мех", l.auction === "__none" ? l.auctionLabel : l.auction, l.year, l.recv.toFixed(3), l.used.toFixed(3), excess.toFixed(3), unit(l.unit)]));
    }
  }

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response("﻿" + lines.join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="sverka-lotov-${part}-${year}-${stamp}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
