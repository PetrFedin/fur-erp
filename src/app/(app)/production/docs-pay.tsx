import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { canEditProduction } from "@/lib/production-access";
import { getCommission4Mode } from "@/lib/commission4-mode";
import { loadBatchPanels, loadOrderPanel } from "@/lib/production-doc-checklist";
import { CollapsibleBlock } from "@/components/collapsible-block";
import { DocsPayPanel } from "@/components/docs-pay-panel";
import { loadPaymentVerify } from "../verify/verify-block";

async function ctx() {
  const session = await requireSession();
  const can = canEditProduction(session.user.role);
  return { orgId: session.user.organizationId, c: { c4Mode: await getCommission4Mode(), canUpload: can, canMark: can } };
}

/** «Документы и оплата» партии производства. */
export async function BatchDocsPay({ batchNumber }: { batchNumber: number }) {
  const { orgId, c } = await ctx();
  const [b] = await loadBatchPanels(prisma, orgId, c, [batchNumber]);
  if (!b) return null;
  const { verify, canVerify } = await loadPaymentVerify("prodPayment");
  return <DocsPayPanel panel={b.panel} verify={verify} canVerify={canVerify} />;
}

/** «Документы и оплата» одного ТЗ (оплата — по партии, если ТЗ в партии). */
export async function OrderDocsPay({ orderId }: { orderId: string }) {
  const { orgId, c } = await ctx();
  const o = await loadOrderPanel(prisma, orgId, orderId, c);
  if (!o) return null;
  const { verify, canVerify } = await loadPaymentVerify("prodPayment");
  const pn = o.panel;
  const required = pn.items.filter((i) => i.need === "required");
  const have = required.filter((i) => i.ok).length;
  const missing = required.length - have;
  const problem = Boolean(pn.alert) || pn.pay.tone === "bad";
  const pay = pn.pay.state === "NOBASE" ? pn.pay.label : `${pn.pay.paidText} из ${pn.pay.totalText}`;
  return (
    <CollapsibleBlock
      title="Документы и оплата"
      problem={problem}
      summary={
        <>
          Документы: есть {have}, не хватает {missing}
          {pn.proofMissing > 0 && ` · без платёжки: ${pn.proofMissing}`} · Оплата: {pay}
        </>
      }
    >
      <DocsPayPanel panel={pn} verify={verify} canVerify={canVerify} />
    </CollapsibleBlock>
  );
}
