import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { ACCESS, hasRole } from "@/lib/access";
import { getCommission4Mode } from "@/lib/commission4-mode";
import { loadMarginInput, loadReportSizes, loadModelPhotos } from "@/lib/margin-server";
import { RETAIL_PRICES_KEY, serializeInput, type RetailRow } from "@/lib/margin";
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
    prisma.systemState.findUnique({ where: { organizationId_key: { organizationId: org, key: RETAIL_PRICES_KEY } }, select: { value: true } }),
    prisma.productModel.findMany({ where: { organizationId: org }, select: { id: true, name: true, sellingPrice: true } }),
  ]);
  const rows = ((state?.value as { rows?: RetailRow[] } | null)?.rows ?? []).filter((r) => r && typeof r.price === "number");
  const byCode = new Map(models.map((m) => [normCode(m.name), m]));
  const priceModels: PriceModel[] = [];
  for (const code of new Set(rows.map((r) => r.modelCode))) {
    const m = byCode.get(code);
    if (!m) continue;
    priceModels.push({ id: m.id, name: m.name, current: m.sellingPrice ? m.sellingPrice.toNumber() : null, rows: rows.filter((r) => r.modelCode === code).map((r) => ({ acode: r.acode, color: r.color, size: r.size, price: r.price })) });
  }
  priceModels.sort((a, b) => a.name.localeCompare(b.name, "ru", { numeric: true }));
  return <MarginView input={input ? serializeInput(input) : null} sizes={sizes} photos={photos} priceModels={priceModels} canEdit={hasRole(session.user.role, ACCESS.models)} initialCat={initialCat} initialTree={sp.tree === "b" ? "b" : "a"} initialCur={sp.cur === "eur" ? "eur" : "rub"} initialVat={sp.vat === "in" ? "in" : "ex"} />;
}
