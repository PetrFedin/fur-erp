import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { canEditProduction } from "@/lib/production-access";
import { getCommission4Mode } from "@/lib/commission4-mode";
import { loadBatchPanels, loadOrderPanel } from "@/lib/production-doc-checklist";
import { CollapsibleBlock } from "@/components/collapsible-block";
import { DocsPayPanel } from "@/components/docs-pay-panel";
import { UploadTargetButton } from "@/components/source-docs";
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
  const pn = b.panel;
  const required = pn.items.filter((i) => i.need === "required");
  const missing = required.length - required.filter((i) => i.ok).length;
  const pay = pn.pay.state === "NOBASE" ? pn.pay.label : `${pn.pay.paidText} из ${pn.pay.totalText}`;
  // Документы и оплата — по клику: в карточке партии по умолчанию развёрнуты только цифры.
  return (
    <CollapsibleBlock
      title="Документы и оплата партии"
      problem={Boolean(pn.alert) || pn.pay.tone === "bad"}
      autoOpen={false}
      summary={<>Документы: не хватает {missing} · Оплата: {pay}</>}
    >
      <DocsPayPanel panel={pn} verify={verify} canVerify={canVerify} />
    </CollapsibleBlock>
  );
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

/** «Документы» партии: только загрузка файлов, без отметок «есть / нет» (пока не показываем, что загружено). */
export async function BatchDocsUpload({ batchNumber }: { batchNumber: number }) {
  const { orgId, c } = await ctx();
  if (!c.canUpload) return null;
  const [b] = await loadBatchPanels(prisma, orgId, c, [batchNumber]);
  if (!b) return null;
  const items = b.panel.items.filter((i) => i.need !== "na" && i.uploads.length > 0);
  if (!items.length) return null;
  return (
    <section aria-label="Документы партии" className="rounded-lg border border-neutral-200 bg-white p-3">
      <h2 className="text-sm font-semibold text-neutral-800">Документы</h2>
      <ul className="mt-2 divide-y divide-neutral-100">
        {items.map((it) => (
          <li key={it.key} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span className="text-sm text-neutral-800">{it.label}</span>
            <span className="flex flex-wrap items-center gap-2">
              {it.uploads.slice(0, 2).map((u, i) => <UploadTargetButton key={i} upload={u} label="Загрузить" />)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
