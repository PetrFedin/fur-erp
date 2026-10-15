import "server-only";
import { prisma } from "@/lib/prisma";
import { parseYmd, ymd } from "@/lib/calendar-grid";
import { STAGE_NAME, ruShort, summarizeStages } from "@/lib/raw-stage";
import type { FactItem } from "@/lib/calendar-layers";

/**
 * Слой календаря «Сырьё Веллмеха»: ожидаемая дата прибытия сырья по аукциону и этапы с датами.
 * Только чтение; данные вносит Веллмех на странице аукциона («Где сырьё»).
 */
export async function loadRawFacts(orgId: string, from: string, to: string, supplierId?: string): Promise<FactItem[]> {
  const sup = supplierId ? { supplierId } : {};
  const gte = parseYmd(from), lte = parseYmd(to);
  const inRange = { gte, lte };
  const rows = await prisma.supplierRawStage.findMany({
    where: { organizationId: orgId, ...sup, OR: [{ plannedStart: inRange }, { plannedEnd: inRange }, { factStart: inRange }, { factEnd: inRange }] },
    select: {
      id: true, purchaseId: true, stage: true, status: true, place: true, lotNumber: true, qty: true, plannedStart: true, plannedEnd: true, factStart: true, factEnd: true,
      purchase: { select: { number: true, auctionSession: true, auction: { select: { name: true } } } },
    },
  });
  const name = (p: (typeof rows)[number]["purchase"]) => p.auction?.name ?? p.auctionSession?.split(/\r?\n/)[0].trim() ?? p.number;
  const items: FactItem[] = [];
  for (const r of rows) {
    if (r.stage === "AUCTION_BOUGHT") continue; // «Куплено на аукционе» показывает слой «Аукционы» (дата аукциона), а не этап сырья
    // Ключевая дата этапа: готово — когда закончили; идёт — когда ждём конец; не начат — плановое начало.
    const d = r.status === "DONE" ? r.factEnd ?? r.plannedEnd : r.status === "IN_PROGRESS" ? r.plannedEnd ?? r.factStart : r.plannedStart ?? r.plannedEnd;
    if (!d || d < gte || d > lte) continue;
    const verb = r.status === "DONE" ? "готово" : r.status === "IN_PROGRESS" ? "до" : "начало";
    items.push({
      id: `rs-${r.id}`, kind: "raw", date: ymd(d), title: name(r.purchase), qty: r.qty,
      label: `${STAGE_NAME[r.stage] ?? r.stage}${r.place ? ` · ${r.place}` : ""}${r.lotNumber ? ` · лот ${r.lotNumber}` : ""} (${verb})`, href: `/purchases/${r.purchaseId}`,
    });
  }
  // Ожидаемая дата прибытия по каждому аукциону с неоконченными этапами.
  const ids = [...new Set((await prisma.supplierRawStage.findMany({ where: { organizationId: orgId, ...sup, status: { not: "DONE" }, plannedEnd: { not: null } }, select: { purchaseId: true } })).map((x) => x.purchaseId))];
  if (ids.length) {
    const stages = await prisma.supplierRawStage.findMany({
      where: { organizationId: orgId, ...sup, purchaseId: { in: ids } },
      select: { purchaseId: true, stage: true, status: true, place: true, plannedStart: true, plannedEnd: true, factStart: true, factEnd: true, purchase: { select: { number: true, auctionSession: true, auction: { select: { name: true } } } } },
    });
    const by = new Map<string, typeof stages>();
    for (const s of stages) (by.get(s.purchaseId) ?? by.set(s.purchaseId, []).get(s.purchaseId)!).push(s);
    for (const [pid, list] of by) {
      const sum = summarizeStages(list);
      if (!sum?.eta || sum.eta < gte || sum.eta > lte) continue;
      items.push({ id: `rse-${pid}`, kind: "raw", date: ymd(sum.eta), title: name(list[0].purchase), qty: null, label: `Ждём сырьё к ${ruShort(sum.eta)}`, href: `/purchases/${pid}` });
    }
  }
  return items;
}
