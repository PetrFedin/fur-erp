import { Breadcrumbs } from "@/components/breadcrumbs";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { ACCESS, hasRole } from "@/lib/access";
import { AUCTION_V, rowVersion } from "@/lib/concurrency";
import { loadAuctionOptions } from "@/lib/auction-ref";
import { auctionKey } from "@/lib/auction-key";
import { findAuctionIn } from "@/lib/auction-ref-core";
import { purchaseTotalInclVat } from "@/lib/purchase-totals";
import { SupplierAuctionsRef } from "../supplier-refs";
import { AuctionsTable, type AuctionRowData } from "./auctions-table";

export const metadata = { title: "Справочник аукционов" };

export default async function AuctionsPage() {
  const session = await requireSession({ allowSupplier: true });
  const orgId = session.user.organizationId;
  const canEdit = hasRole(session.user.role, ACCESS.auctions);
  // Поставщику — только названия: без закупок, сумм и примечаний.
  // Поля перечислены явно: суммы закупок, их число и примечания не должны попасть и в данные страницы (RSC-пейлоад).
  if (session.user.role === "SUPPLIER") {
    const own = (await loadAuctionOptions(orgId)).map((a) => ({ id: a.id, name: a.name, fullName: a.fullName, house: a.house, kind: a.kind, year: a.year, month: a.month, aliases: a.aliases, confirmed: a.confirmed }));
    return <SupplierAuctionsRef rows={own} />;
  }

  const [options, purchases, unlinked, direct] = await Promise.all([
    loadAuctionOptions(orgId),
    prisma.purchase.findMany({ where: { organizationId: orgId, auctionId: { not: null } }, select: { id: true, number: true, status: true, auctionId: true }, orderBy: { number: "asc" } }),
    prisma.purchase.findMany({ where: { organizationId: orgId, auctionId: null, auctionSession: { not: null } }, select: { id: true, number: true, auctionSession: true } }),
    // Закупки вне аукциона (напрямую у поставщика, например Веллмех): ни аукциона, ни текста — это и есть «Без аукциона».
    prisma.purchase.findMany({
      where: { organizationId: orgId, auctionId: null, auctionSession: null },
      select: { id: true, number: true, status: true, exchangeRate: true, items: { select: { subtotal: true, vatRate: true, quantity: true, costPlan: true } }, expenses: { select: { amount: true, vatRate: true } } },
      orderBy: { number: "asc" },
    }),
  ]);

  const byAuction = new Map<string, AuctionRowData["purchases"]>();
  for (const p of purchases) {
    const l = byAuction.get(p.auctionId!) ?? [];
    l.push({ id: p.id, number: p.number, status: p.status });
    byAuction.set(p.auctionId!, l);
  }
  // Служебная строка «Без аукциона»: сумма и состав — закупки вне аукциона, с теми же правилами НДС, что у остальных аукционов.
  const noAuc = options.find((a) => a.isService && auctionKey(a.name) === auctionKey("Без аукциона"));
  const directTotal = direct.filter((p) => p.status !== "CANCELLED").reduce((s, p) => s + Number(purchaseTotalInclVat(p)), 0);
  const rows: AuctionRowData[] = options.map((a) => ({
    id: a.id, name: a.name, fullName: a.fullName, house: a.house, kind: a.kind, year: a.year, month: a.month, currency: a.currency,
    auctionDate: a.auctionDate ? a.auctionDate.toISOString().slice(0, 10) : null, aliases: a.aliases, isService: a.isService, confirmed: a.confirmed,
    note: a.note, version: rowVersion(a, AUCTION_V),
    ...(a === noAuc
      ? { purchaseCount: a.purchaseCount + direct.length, total: a.total + directTotal, purchases: [...(byAuction.get(a.id) ?? []), ...direct.map((p) => ({ id: p.id, number: p.number, status: p.status }))] }
      : { purchaseCount: a.purchaseCount, total: a.total, purchases: byAuction.get(a.id) ?? [] }),
  }));

  // Закупки с названием, которого нет в справочнике (например, заведены вручную после засева).
  const lite = options.map((a) => ({ id: a.id, name: a.name, aliases: a.aliases, isService: a.isService, confirmed: a.confirmed }));
  const orphan = new Map<string, string[]>();
  for (const p of unlinked) {
    if (!auctionKey(p.auctionSession) || findAuctionIn(p.auctionSession, lite)) continue;
    const k = p.auctionSession!.split(/\r?\n/)[0].trim();
    orphan.set(k, [...(orphan.get(k) ?? []), p.number]);
  }

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: "Настройки", href: "/settings" }, { label: "Аукционы" }]} />
      <AuctionsTable rows={rows} canEdit={canEdit} />
      {orphan.size > 0 && (
        <div className="max-w-3xl rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
          <b>Названия закупок, которых нет в справочнике:</b>
          <ul className="mt-1 list-disc pl-5">
            {[...orphan.entries()].map(([t, nums]) => <li key={t}>{t} — {nums.join(", ")}</li>)}
          </ul>
          <p className="mt-1 text-xs text-neutral-600">Добавьте аукцион кнопкой «Добавить аукцион».</p>
        </div>
      )}
    </div>
  );
}
