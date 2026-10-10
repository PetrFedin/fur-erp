import type { ReactNode } from "react";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { ACCESS, hasRole } from "@/lib/access";
import { loadAuctionPanels } from "@/lib/auction-doc-checklist";
import { DocsPayPanel } from "@/components/docs-pay-panel";
import { loadPaymentVerify } from "../verify/verify-block";

/**
 * Блок «Документы и оплата» для аукциона (по одному на каждое подходящее название) или для одной закупки.
 * names — режим «Аукцион» в «Сырьё»; purchaseId — карточка закупки (её аукцион либо сама закупка вне аукциона).
 */
export async function AuctionDocsPay({ organizationId, names, purchaseId, paymentActions }: { organizationId: string; names?: string[]; purchaseId?: string; paymentActions?: Record<string, ReactNode> }) {
  const session = await requireSession();
  const panels = await loadAuctionPanels(prisma, organizationId, {
    names,
    purchaseId,
    canUpload: hasRole(session.user.role, ACCESS.purchases),
    canMark: hasRole(session.user.role, ACCESS.supplierPayments),
  });
  if (panels.length === 0) return null;
  const { verify, canVerify } = await loadPaymentVerify("payment");
  return (
    <>
      {panels.map((p) => (
        <DocsPayPanel key={p.panel.id} panel={p.panel} compact={panels.length > 1} verify={verify} canVerify={canVerify} paymentActions={paymentActions} />
      ))}
    </>
  );
}
