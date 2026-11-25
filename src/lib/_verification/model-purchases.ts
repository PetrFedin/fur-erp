import "server-only";
import { auctionName } from "@/lib/auction-payments";
import { isServiceAuction } from "@/lib/auction-names";
import { loadAuctionPanels, type AuctionPanelData } from "@/lib/auction-doc-checklist";
import { purchaseTotalInclVat } from "@/lib/purchase-totals";
import { formatDate } from "@/lib/utils";
import type { Group, Registry } from "@/app/(app)/reconciliation/model";
import { loadLive, type Live } from "@/app/(app)/reconciliation/live";
import { fmtRub, iso, ROUND_TOL_RUB, stampOf } from "./evidence";
import type { Blocker, ModelCtx } from "./types";

// Шаг loadVerifyModel: строки закупок (вынесено из verification.ts без изменений).

const groupOfPurchase = (reg: Registry, number: string): Group | null => {
  for (const g of reg.groups) if (g.section === "purchase" && (g.dbLink.purchases ?? []).includes(number)) return g;
  return null;
};
const GENERIC_RECON = "сверка с документами: итог не сошёлся — причины перечислены выше или документов ещё нет";
const STATUS_BLOCKER: Record<string, string> = {
  docs: "сверка с документами: по документам сходится, но в базе копейки сверх допуска или оплата не привязана",
  unpaid: "сверка с документами: оплату нечем подтвердить (нет платёжки или п/п)",
  conflict: "сверка с документами: документы не сходятся с базой",
  empty: "сверка с документами: данных в документах нет",
};

// ------------------------------------------------------------------------------------------------ закупки
export async function addPurchaseRows({ db, orgId, opts, only, reg0, userId, names, rows, extra }: ModelCtx): Promise<void> {
  const purchases = await db.purchase.findMany({
    where: { organizationId: orgId, status: { not: "CANCELLED" }, ...(only ? { id: only.id } : {}) },
    include: { items: true, expenses: true, supplier: { select: { name: true } } },
    orderBy: [{ orderDate: "asc" }, { number: "asc" }],
  });
  let live: Live | null = null;
  const needLive = purchases.some((p) => groupOfPurchase(reg0, p.number));
  if (needLive) live = await loadLive(orgId, reg0);
  // Панели «документы и оплата»: аукционы — одним вызовом, закупки вне аукциона — по одной.
  const panelOf = new Map<string, AuctionPanelData>();
  const pOpts = { canUpload: !!opts.canUpload, canMark: !!opts.canMark };
  if (only) {
    const ps = await loadAuctionPanels(db, orgId, { purchaseId: only.id, ...pOpts });
    for (const x of ps) for (const id of x.purchaseIds) panelOf.set(id, x);
  } else {
    const ps = await loadAuctionPanels(db, orgId, pOpts);
    // «Нет информации» и прочие заглушки импорта — не один аукцион, а разные закупки: у каждой своя панель.
    for (const x of ps) if (!isServiceAuction(x.key)) for (const id of x.purchaseIds) panelOf.set(id, x);
    for (const p of purchases) {
      if (panelOf.has(p.id)) continue;
      const one = await loadAuctionPanels(db, orgId, { purchaseId: p.id, ...pOpts });
      for (const x of one) for (const id of x.purchaseIds) panelOf.set(id, x);
    }
  }
  for (const p of purchases) {
    const blockers: Blocker[] = [];
    const href = `/purchases/${p.id}`;
    if (p.status !== "RECEIVED") blockers.push({ text: "закупка в черновике: мех не принят, УПД ещё нет", href });
    if (p.items.length === 0) blockers.push({ text: "в закупке нет лотов", href });
    const g = groupOfPurchase(reg0, p.number);
    if (!g) blockers.push({ text: "закупки нет в реестре сверки: сумму проверить не с чем", href: "/reconciliation" });
    else {
      const gHref = `/reconciliation#${encodeURIComponent(g.id)}`;
      const gd = live?.group.get(g.id);
      const docCost = g.doc?.costRub ?? null;
      // Расхождение в копейках-десятках рублей — округление лотов в расчёте себестоимости против УПД, не ошибка.
      const costDiff = docCost != null && gd?.cost != null ? gd.cost - docCost : null;
      const roundingOnly = costDiff != null && Math.abs(costDiff) <= ROUND_TOL_RUB;
      const failed = (g.checks ?? []).filter((c) => !c.ok && !(roundingOnly && /УПД|расч[её]т/i.test(c.label)));
      for (const c of failed) blockers.push({ text: `не сошлось: ${c.label}`, href: gHref });
      if (g.status !== "ok" && failed.length === 0 && !(roundingOnly && g.status === "docs")) blockers.push({ text: STATUS_BLOCKER[g.status] ?? GENERIC_RECON, href: gHref });
      if (docCost == null) blockers.push({ text: "в документах нет итоговой суммы (УПД/счёта) — сравнить не с чем", href: gHref });
      else if (costDiff != null) {
        if (Math.abs(costDiff) > ROUND_TOL_RUB) blockers.push({ text: `сумма в базе ≠ УПД на ${fmtRub(Math.abs(costDiff))} (в базе ${fmtRub(gd!.cost!)}, по документам ${fmtRub(docCost)})`, href });
      }
      const docPaid = g.doc?.paidRub ?? null;
      if (docPaid != null && gd && Math.abs(gd.paid - docPaid) > ROUND_TOL_RUB) blockers.push({ text: `оплата в базе ≠ оплате по документам на ${fmtRub(Math.abs(gd.paid - docPaid))}`, href: gHref });
    }
    const panel = panelOf.get(p.id);
    if (!panel) blockers.push({ text: "нет панели документов и оплаты для закупки", href });
    else {
      for (const it of panel.panel.items) {
        if (it.need === "required" && !it.ok) blockers.push({ text: `нет документа: ${it.label}`, href: panel.panel.href ?? href, upload: it.uploads[0] });
      }
      const pay = panel.panel.pay;
      if (pay.state !== "PAID") blockers.push({ text: `оплата: ${pay.label}`, href: panel.panel.href ?? href });
      if (panel.panel.proofMissing > 0) blockers.push({ text: `оплат без платёжки: ${panel.panel.proofMissing}`, href: panel.panel.href ?? href });
    }
    // общая «не сходится на 100%» — следствие конкретных замечаний (нет УПД, оплата не полная): отдельной строкой не показываем
    const concrete = blockers.some((b) => b.text !== GENERIC_RECON);
    // убрать дубли текста
    const seen = new Set<string>();
    const uniq = blockers.filter((b) => !(concrete && b.text === GENERIC_RECON)).filter((b) => (seen.has(b.text) ? false : (seen.add(b.text), true)));
    const total = purchaseTotalInclVat(p);
    const st = stampOf(p.verifiedAt, p.verifiedBy, userId, names);
    const aName = auctionName(p.auctionSession);
    rows.push({
      key: `purchase:${p.id}`, kind: "purchase", id: p.id,
      title: `Закупка ${p.number}`, sub: `${p.supplier.name}${aName ? ` · ${aName}` : ""} · ${formatDate(p.orderDate)}`,
      href, group: aName ?? p.number, year: p.orderDate.getUTCFullYear(), amountText: fmtRub(total),
      verified: !!p.verifiedAt, auto: !!p.verifiedAt && st.auto, stampText: p.verifiedAt ? st.text : null, note: p.verifyNote,
      ready: uniq.length === 0, blockers: uniq,
      edit: { date: iso(p.orderDate), number: p.invoiceNumber ?? "", ref: p.transferDocument ?? "" },
      registryFact: null, members: [],
    });
    extra.purchaseNumber.set(p.id, p.number);
    extra.purchaseGroupId.set(p.id, g?.id ?? null);
  }
}
