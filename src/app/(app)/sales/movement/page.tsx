import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getCommission4Mode } from "@/lib/commission4-mode";
import { loadPaymentsOverview } from "@/lib/payments-overview";
import { loadModelPhotos } from "@/lib/margin-server";
import { loadPricing, loadSalesLines } from "@/lib/sales-server";
import { makeCtx } from "@/lib/margin-tree";
import { colorOfLine, furTypeOfFabric, normCode } from "@/lib/sales-receipts-core";
import { movements, type SLine } from "@/lib/sales-section";
import { MovementView, type Card } from "./movement-view";

export const metadata = { title: "Движение по артикулу" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function MovementPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // Внешнего поставщика (SUPPLIER) не пускаем: requireSession без allowSupplier.
  const session = await requireSession();
  const org = session.user.organizationId;
  const sp = await searchParams;
  const article = one(sp.a)?.slice(0, 200), color = one(sp.c)?.slice(0, 80), model = one(sp.m) ? normCode(one(sp.m)!.slice(0, 20)) : undefined;
  if (!article && !model) redirect("/sales");
  const [raw, pricing, photos] = await Promise.all([
    loadSalesLines(org, article ? { article } : { modelCode: model }),
    loadPricing(org, await getCommission4Mode()),
    loadModelPhotos(org),
  ]);
  const lines: SLine[] = color ? raw.filter((l) => colorOfLine(l.colorId) === color) : raw;
  const first = lines[0];
  const code = first?.modelCode ?? model ?? null;
  const ctx = makeCtx({ lines, prices: pricing.prices, modelPrice: pricing.modelPrice, costs: pricing.costs }, "in");
  const prices = [...new Set(lines.map((l) => ctx.unitPrice(l)).filter((p): p is number => p !== null))].sort((a, b) => a - b);
  const modelRef = code ? pricing.models[code] : undefined;
  const cost = code ? pricing.costs.get(code) : undefined;
  const orders = modelRef ? await prisma.productionOrder.findMany({ where: { organizationId: org, productModelId: modelRef.id }, select: { id: true, number: true }, orderBy: { number: "asc" } }) : [];
  const rows = orders.length ? await loadPaymentsOverview(org) : [];
  const paid = new Map<string, number>();
  for (const r of rows) for (const p of r.parts) { const m = /^\/production\/(.+)$/.exec(p.href ?? ""); if (m) paid.set(m[1], (paid.get(m[1]) ?? 0) + p.amount); }
  const cats = first ? [first.level2, first.level3, first.level4, first.level5].filter(Boolean).join(" → ") : "";
  const card: Card = {
    title: article ?? (modelRef?.name ?? code ?? ""), color: color ?? null, modelCode: code, category: cats || null,
    fur: first ? furTypeOfFabric(first.fabric) : null, prices, costIncl: cost?.unitIncl ?? null, costExcl: cost?.unitExcl ?? null,
    modelId: modelRef?.id ?? null, tz: orders.map((o) => ({ id: o.id, number: o.number, paid: paid.get(o.id) ?? 0 })),
    photo: code && photos[code] ? photos[code] : null,
  };
  return <MovementView card={card} rows={movements(lines)} />;
}
