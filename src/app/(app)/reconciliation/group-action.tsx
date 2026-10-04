"use server";

import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { getYearFilter } from "@/lib/year-filter";
import { getCommission4Mode } from "@/lib/commission4-mode";
import { loadAuctionPanels } from "@/lib/auction-doc-checklist";
import { loadBatchPanels } from "@/lib/production-doc-checklist";
import { TONE_DOT, overallTone, type Panel } from "@/lib/doc-panel";
import { loadLive } from "./live";
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
  const { ids, groups } = visibleFor(year);
  const g = groups.find((x) => x.id === String(groupId));
  if (!g) return <p className="px-3 py-2 text-xs text-neutral-500">Группа не найдена — обновите страницу.</p>;

  const live = await loadLive(orgId);
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
  return <GroupBody g={g} ids={ids} live={live} doc={doc} />;
}

function toDoc(href: string, p: Panel): DocInfo {
  return { href, label: p.pay.label, missing: p.missingCount, proofMissing: p.proofMissing, dot: TONE_DOT[overallTone(p.missingCount, p.pay, p.proofMissing)] };
}
