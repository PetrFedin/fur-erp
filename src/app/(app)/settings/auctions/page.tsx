import { Breadcrumbs } from "@/components/breadcrumbs";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { ACCESS, hasRole } from "@/lib/access";
import { AUCTION_V, rowVersion } from "@/lib/concurrency";
import { loadAuctionOptions } from "@/lib/auction-ref";
import { auctionKey } from "@/lib/auction-key";
import { findAuctionIn } from "@/lib/auction-ref-core";
import { AuctionsTable, type AuctionRowData } from "./auctions-table";

export const metadata = { title: "Справочник аукционов" };

export default async function AuctionsPage() {
  const session = await requireSession();
  const orgId = session.user.organizationId;
  const canEdit = hasRole(session.user.role, ACCESS.auctions);

  const [options, purchases, unlinked] = await Promise.all([
    loadAuctionOptions(orgId),
    prisma.purchase.findMany({ where: { organizationId: orgId, auctionId: { not: null } }, select: { id: true, number: true, status: true, auctionId: true }, orderBy: { number: "asc" } }),
    prisma.purchase.findMany({ where: { organizationId: orgId, auctionId: null, auctionSession: { not: null } }, select: { id: true, number: true, auctionSession: true } }),
  ]);

  const byAuction = new Map<string, AuctionRowData["purchases"]>();
  for (const p of purchases) {
    const l = byAuction.get(p.auctionId!) ?? [];
    l.push({ id: p.id, number: p.number, status: p.status });
    byAuction.set(p.auctionId!, l);
  }
  const rows: AuctionRowData[] = options.map((a) => ({
    id: a.id, name: a.name, fullName: a.fullName, house: a.house, kind: a.kind, year: a.year, month: a.month, currency: a.currency,
    auctionDate: a.auctionDate ? a.auctionDate.toISOString().slice(0, 10) : null, aliases: a.aliases, isService: a.isService, confirmed: a.confirmed,
    note: a.note, purchaseCount: a.purchaseCount, total: a.total, version: rowVersion(a, AUCTION_V), purchases: byAuction.get(a.id) ?? [],
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
          <p className="mt-1 text-xs text-neutral-600">Добавьте такой аукцион кнопкой «Добавить аукцион» (или впишите это название в «раньше» нужного аукциона).</p>
        </div>
      )}
    </div>
  );
}
