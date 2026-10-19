"use server";

import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { getYearFilter } from "@/lib/year-filter";
import { getCommission4Mode } from "@/lib/commission4-mode";
import { loadAuctionPanels } from "@/lib/auction-doc-checklist";
import { loadBatchPanels } from "@/lib/production-doc-checklist";
import { TONE_DOT, overallTone, type Panel } from "@/lib/doc-panel";
import { loadLive } from "./live";
import { loadRegistry } from "@/lib/reconciliation-registry";
import { loadDocCandidates, loadPayCandidates } from "@/lib/reconciliation-outside";
import type { InvEdit } from "./parts";
import { visibleFor } from "./model";
import { GroupBody, type DocInfo } from "./group-body";

/**
 * Раскрытое содержимое одной группы «Реестра сверки» (счета, «в базе», проверки, документы) — подгружается при раскрытии,
 * чтобы страница не тянула все 50+ групп разом. Год — из шапки (cookie), организация — из сессии, а не от клиента.
 */
export async function loadReconGroup(groupId: string) {
  const session = await requireSession();
  const orgId = session.user.organizationId;
  const year = await getYearFilter();
  const reg = await loadRegistry(orgId);
  const { ids, groups } = visibleFor(year, reg);
  const g = groups.find((x) => x.id === String(groupId));
  if (!g) return <p className="px-3 py-2 text-xs text-neutral-500">Группа не найдена — обновите страницу.</p>;

  const live = await loadLive(orgId, reg);
  // Кнопки правки — только ролям с правом ввода и только когда реестр уже перенесён в базу.
  const canEdit = reg.source === "db" && (["OWNER", "ADMIN", "ACCOUNTANT"] as string[]).includes(session.user.role);
  let ed: Map<string, InvEdit> | undefined;
  if (canEdit) {
    const invs = g.invoiceIds.map((id) => reg.invoices.find((i) => i.id === id)).filter((i): i is NonNullable<typeof i> => !!i);
    const [cands, docs, links] = await Promise.all([
      loadPayCandidates(orgId, live, invs, g),
      loadDocCandidates(orgId, invs),
      prisma.reconciliationPaymentLink.findMany({ where: { organizationId: orgId, invoiceId: { in: invs.map((i) => i.dbId!).filter(Boolean) } } }),
    ]);
    const payIds = links.map((l) => l.paymentId).filter((x): x is string => !!x);
    const prodIds = links.map((l) => l.productionPaymentId).filter((x): x is string => !!x);
    const [pp, qq] = await Promise.all([
      prisma.payment.findMany({ where: { id: { in: payIds } }, select: { id: true, amount: true, paidAt: true } }),
      prisma.productionPayment.findMany({ where: { id: { in: prodIds } }, select: { id: true, amount: true, paidAt: true } }),
    ]);
    const lab = new Map<string, string>([...pp, ...qq].map((p) => [p.id, `привязан платёж ${p.paidAt.toISOString().slice(0, 10).split("-").reverse().join(".")} · ${Number(p.amount.toString()).toLocaleString("ru-RU")} ₽`]));
    ed = new Map(invs.map((i) => [i.id, {
      candidates: (cands.get(i.id) ?? []).map((c) => ({ value: c.value, label: c.label })),
      docs: docs.get(i.id) ?? [],
      links: links.filter((l) => l.invoiceId === i.dbId).map((l) => ({ id: l.id, label: lab.get((l.paymentId ?? l.productionPaymentId)!) ?? "привязан платёж" })),
    }]));
  }
  const c4Mode = await getCommission4Mode();
  // Панель «Документы и оплата» нужна только для этой группы: аукцион — по закупкам, партия — по номеру.
  let doc: DocInfo | null = null;
  if (g.section === "production") {
    const hit = (await loadBatchPanels(prisma, orgId, { c4Mode, canUpload: false, canMark: false })).find((b) => b.number === g.dbLink.batch);
    if (hit) doc = toDoc(`/production/batches/${hit.number}`, hit.panel);
  } else {
    const hit = (await loadAuctionPanels(prisma, orgId, { canUpload: false, canMark: false })).find((a) => (g.dbLink.purchases ?? []).some((n) => a.purchaseNumbers.includes(n)));
    if (hit) doc = toDoc(hit.panel.href ?? "/lots", hit.panel);
  }
  return <GroupBody g={g} ids={ids} live={live} doc={doc} reg={reg} ed={ed} />;
}

function toDoc(href: string, p: Panel): DocInfo {
  return { href, label: p.pay.label, missing: p.missingCount, proofMissing: p.proofMissing, dot: TONE_DOT[overallTone(p.missingCount, p.pay, p.proofMissing)] };
}
