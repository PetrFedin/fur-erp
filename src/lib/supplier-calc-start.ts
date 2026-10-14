import "server-only";
import { prisma } from "@/lib/prisma";
import { inboxScope, type SupplierSess } from "@/lib/supplier-inbox";
import { emptyPayload, ensureRowIds, newId, type CalcPayload } from "@/lib/supplier-calc";

export type StartOption = { value: string; label: string };

/**
 * «Начать с цифр расчёта»: свои прежние расчёты и аукционы из справочника.
 * Из справочника отдаются только ставки и набор столбцов — без наших цен, сумм и лотов.
 */
export async function startOptions(s: SupplierSess): Promise<{ calcs: StartOption[]; auctions: StartOption[] }> {
  const own = await prisma.supplierInbox.findMany({ where: { kind: "AUCTION_CALC", ...inboxScope(s) }, orderBy: { updatedAt: "desc" }, select: { id: true, title: true, payload: true }, take: 100 });
  const calcs = own.map((r) => {
    const st = (r.payload as { stage?: string })?.stage;
    return { value: `calc:${r.id}`, label: `${r.title}${st === "PRELIM" ? " (предварительный)" : st === "FINAL" ? " (окончательный)" : ""}` };
  });
  const supplierId = s.user.supplierId;
  if (!supplierId) return { calcs, auctions: [] };
  const purchases = await prisma.purchase.findMany({
    where: { organizationId: s.user.organizationId, supplierId, auctionId: { not: null }, auction: { isService: false } },
    orderBy: { orderDate: "desc" }, select: { auctionId: true, auction: { select: { name: true } } }, take: 300,
  });
  const seen = new Set<string>();
  const auctions: StartOption[] = [];
  for (const p of purchases) {
    if (!p.auctionId || seen.has(p.auctionId)) continue;
    seen.add(p.auctionId);
    auctions.push({ value: `auction:${p.auctionId}`, label: p.auction?.name ?? "Аукцион" });
  }
  return { calcs, auctions };
}

const strip = (r: Record<string, string>) => ({ ...r, _id: newId() });

/** Новый предварительный черновик из выбранной основы (ничего не сохраняет). null — основа недоступна. */
export async function payloadFromBase(s: SupplierSess, from: string): Promise<CalcPayload | null> {
  const [kind, id] = from.split(":");
  if (!id || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null;
  if (kind === "calc") {
    const row = await prisma.supplierInbox.findFirst({ where: { id, kind: "AUCTION_CALC", ...inboxScope(s) }, select: { id: true, payload: true } });
    if (!row) return null;
    return copyForNext(ensureRowIds(row.payload as unknown as CalcPayload), row.id, "PRELIM");
  }
  if (kind === "auction") {
    const supplierId = s.user.supplierId;
    if (!supplierId) return null;
    const pu = await prisma.purchase.findFirst({
      where: { organizationId: s.user.organizationId, supplierId, auctionId: id, auction: { isService: false } },
      orderBy: { orderDate: "desc" },
      select: { currency: true, exchangeRate: true, auction: { select: { name: true } }, items: { select: { vatRate: true, costPlan: true }, take: 20 } },
    });
    if (!pu) return null;
    const p = emptyPayload("SP_RP");
    p.stage = "PRELIM";
    p.header.auction = pu.auction?.name ?? "";
    p.header.currency = pu.currency === "EUR" ? "EUR" : "USD";
    if (Number(pu.exchangeRate) > 1) p.header.cbRate = String(Number(pu.exchangeRate));
    const inp = pu.items.map((i) => (i.costPlan as { inputs?: Record<string, number> } | null)?.inputs).find((x) => x && typeof x.feePct === "number");
    const rates: Record<string, string> = {};
    if (inp) {
      const put = (k: string, v: unknown) => { if (typeof v === "number" && Number.isFinite(v) && v !== 0) rates[k] = String(v); };
      put("feePct", inp.feePct); put("brokerPct", inp.brokerPct); put("dressing", inp.dressing); put("transport", inp.transport); put("transit", inp.transit);
    }
    p.header.rates = rates;
    const vat = Number(pu.items[0]?.vatRate);
    if (vat > 0) p.header.vat = String(vat);
    return p;
  }
  return null;
}

/** Копия расчёта для следующего шага: шапка (ставки, курс, формат, «куда») и структура строк; счёт, даты и платежи — заново. */
export function copyForNext(src: CalcPayload, srcId: string, stage: "PRELIM" | "FINAL"): CalcPayload {
  const idMap = new Map<string, string>();
  const rows = src.rows.map((r) => { const n = strip(r); idMap.set(r._id, n._id); return n; });
  const overrides: NonNullable<CalcPayload["overrides"]> = {};
  for (const [rid, o] of Object.entries(src.overrides ?? {})) if (idMap.has(rid)) overrides[idMap.get(rid)!] = { ...o };
  const h = src.header;
  return {
    ...src,
    stage, basedOnId: srcId, rows, overrides,
    header: { ...h, invoice: stage === "FINAL" ? h.invoice : "", invoiceDate: stage === "FINAL" ? h.invoiceDate : "", dueDate: "", advanceDate: "", advance: "", interim: "", extras: h.extras.map((e) => ({ ...e })), rates: { ...(h.rates ?? {}) } },
    customColumns: (src.customColumns ?? []).map((c) => ({ ...c })),
    params: (src.params ?? []).map((c) => ({ ...c })),
  };
}
