import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { ACCESS, hasRole } from "@/lib/access";
import { getCommission4Mode } from "@/lib/commission4-mode";
import { loadMarginInput, loadReportSizes, loadModelPhotos } from "@/lib/margin-server";
import { loadRetailPricesState } from "@/lib/import-keys";
import { serializeInput, type RetailRow } from "@/lib/margin";
import { normCode } from "@/lib/sales-receipts-core";
import { MarginView } from "./margin-view";
import type { PriceModel } from "./prices-block";

export const metadata = { title: "Маржа и наценка" };

export default async function MarginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const initialCat = sp.cat === "clothes" || sp.cat === "acc" ? sp.cat : "all";
  // Внешний поставщик (SUPPLIER) сюда не попадает: requireSession без allowSupplier.
  const session = await requireSession();
  const org = session.user.organizationId;
  const [input, sizes, photos, state, models] = await Promise.all([
    loadMarginInput(org, await getCommission4Mode()), loadReportSizes(org), loadModelPhotos(org),
    loadRetailPricesState(org),
    prisma.productModel.findMany({ where: { organizationId: org }, select: { id: true, name: true, sellingPrice: true } }),
  ]);
  const rows = ((state?.value as { rows?: RetailRow[] } | null)?.rows ?? []).filter((r) => r && typeof r.price === "number");
  const byCode = new Map(models.map((m) => [normCode(m.name), m]));
  // Реальные цены из продаж: (Retail RUR + Discount RUR) ÷ проданные штуки по артикулу и цвету (только строки со штуками > 0; возвраты не в счёт). Нет продаж — цены нет.
  const key = (v: string | null | undefined) => (v ?? "").toUpperCase().replace(/[^A-ZА-Я0-9]/g, "");
  const sold = new Map<string, { pcs: number; gross: number; disc: number }>();
  for (const l of input?.lines ?? []) {
    if (l.kind !== "SALE" || !(l.pcs > 0)) continue;
    const k = key(l.article) + "|" + key(l.colorId);
    const x = sold.get(k) ?? { pcs: 0, gross: 0, disc: 0 };
    x.pcs += l.pcs; x.gross += l.retailRub + l.discountRub; x.disc += l.discountRub;
    sold.set(k, x);
  }
  const priceModels: PriceModel[] = [];
  for (const code of new Set(rows.map((r) => r.modelCode))) {
    const m = byCode.get(code);
    if (!m) continue;
    priceModels.push({ id: m.id, name: m.name, current: m.sellingPrice ? m.sellingPrice.toNumber() : null, rows: rows.filter((r) => r.modelCode === code).map((r) => ({ acode: r.acode, color: r.color, size: r.size, price: r.price })),
      real: [...new Set(rows.filter((r) => r.modelCode === code).map((r) => r.acode + "\u0000" + r.color))].flatMap((k2) => {
        const [acode, color] = k2.split("\u0000");
        const x = sold.get(key(acode) + "|" + key(color));
        return x && x.pcs > 0 && x.gross > 0 ? [{ acode, color, pcs: x.pcs, price: x.gross / x.pcs, discPct: x.gross > 0 ? (x.disc / x.gross) * 100 : 0 }] : [];
      }) });
  }
  priceModels.sort((a, b) => a.name.localeCompare(b.name, "ru", { numeric: true }));
  return <MarginView input={input ? serializeInput(input) : null} sizes={sizes} photos={photos} priceModels={priceModels} canEdit={hasRole(session.user.role, ACCESS.models)} initialCat={initialCat} initialTree={sp.tree === "b" ? "b" : "a"} initialCur={sp.cur === "eur" ? "eur" : "rub"} initialVat={sp.vat === "in" ? "in" : "ex"} />;
}
