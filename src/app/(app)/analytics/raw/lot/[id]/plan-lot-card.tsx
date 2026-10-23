import { Fragment } from "react";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { formatDate, formatDec1, formatMoney } from "@/lib/utils";
import { rawSheetItems } from "@/lib/lot-sheet";
import { classifyLabel, GROUPS, labelUnit } from "@/lib/cost-breakdown-groups";
import { shortAuctionName } from "@/lib/auction-names";

/**
 * Карточка лота по позиции закупки, когда складского лота ещё нет (мех заказан и оплачен, приёмки не было):
 * показывает ту же детализацию расчёта — из чего сложилась цена за шкуру и за весь лот. Остатки и использование появятся после приёмки.
 */
export async function PlanLotCard({ id, orgId }: { id: string; orgId: string }) {
  const it = await prisma.purchaseItem.findFirst({
    where: { id, purchase: { organizationId: orgId } },
    select: {
      lotNumber: true, quantity: true, grade: true, color: true, costPlan: true,
      rawMaterial: { select: { name: true } },
      purchase: { select: { id: true, number: true, auctionSession: true, orderDate: true, invoiceNumber: true, supplier: { select: { name: true } } } },
    },
  });
  if (!it) return null;
  const qty = Number(it.quantity.toString());
  const plan = it.costPlan as { unitCostInclVat?: string; costBreakdown?: unknown } | null;
  const unit = plan?.unitCostInclVat != null ? Number(plan.unitCostInclVat) : null;
  const items = rawSheetItems(plan?.costBreakdown);
  const auction = it.purchase.auctionSession?.split(/\r?\n/)[0].trim() || null;
  const lotTitle = it.lotNumber ? `Лот № ${it.lotNumber}` : "Лот без номера";
  const groups = GROUPS.map((g) => ({ ...g, rows: items.filter((x) => classifyLabel(x.label) === g.key) })).filter((g) => g.rows.length > 0);
  const num = (v: number) => v.toLocaleString("ru-RU", { maximumFractionDigits: Math.abs(v) < 100 ? 2 : 0 });
  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[
        { label: "Сырьё", href: "/lots" },
        ...(auction ? [{ label: shortAuctionName(auction, 40), href: `/lots?auction=${encodeURIComponent(auction)}` }] : []),
        { label: lotTitle },
      ]} />
      <div>
        <h1 className="text-xl font-semibold">{lotTitle}</h1>
        <p className="mt-0.5 text-sm text-neutral-500">
          {it.rawMaterial.name}{it.grade || it.color ? ` · ${[it.grade, it.color].filter(Boolean).join(" / ")}` : ""} · {formatDate(it.purchase.orderDate)} · {it.purchase.supplier.name}
          {" · "}<Link href={`/purchases/${it.purchase.id}#items`} className="text-blue-700 hover:underline" title="Счёт, документы и оплата">закупка {it.purchase.number}{it.purchase.invoiceNumber ? `, счёт № ${it.purchase.invoiceNumber}` : ""}</Link>
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-neutral-200 bg-white p-3"><div className="text-xs text-neutral-500">Куплено</div><div className="text-xl font-semibold tabular-nums">{formatDec1(String(qty))} шт.</div></div>
        <div className="rounded-lg border border-neutral-200 bg-white p-3"><div className="text-xs text-neutral-500">Цена за шкуру, с НДС</div><div className="text-xl font-semibold tabular-nums">{unit != null ? formatMoney(unit.toFixed(0)) : "—"}</div></div>
        <div className="rounded-lg border border-neutral-200 bg-white p-3"><div className="text-xs text-neutral-500">Сумма лота, с НДС</div><div className="text-xl font-semibold tabular-nums">{unit != null ? formatMoney((unit * qty).toFixed(0)) : "—"}</div></div>
      </div>
      <section aria-label="Из чего состоит цена лота" className="flex flex-col gap-2 rounded-lg border border-neutral-200 bg-white p-3">
        <h2 className="text-base font-semibold">Из чего состоит цена лота</h2>
        {groups.length === 0 ? (
          <p className="text-sm text-neutral-500">Расчёта по лоту нет: цена внесена как есть.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm">
              <thead><tr className="text-left text-xs text-neutral-500"><th scope="col" className="py-1 pr-3 font-medium">Статья</th><th scope="col" className="py-1 pl-3 text-right font-medium">За шкуру</th><th scope="col" className="py-1 pl-3 text-right font-medium">На весь лот, ₽</th></tr></thead>
              <tbody>
                {groups.map((g) => (
                  <Fragment key={g.key}>
                    {g.key !== "other" && g.key !== "totals" ? <tr key={g.key} className="bg-neutral-50"><td colSpan={3} className="py-1 pl-1 text-xs font-semibold uppercase tracking-wide text-neutral-600">{g.title}</td></tr> : null}
                    {g.rows.map((r, i) => {
                      const u = labelUnit(r.label);
                      const total = u === "₽" && g.key !== "totals" ? r.value * qty : null;
                      return (
                        <tr key={g.key + i} className={"border-b border-neutral-100 " + (g.key === "totals" ? "font-semibold" : "")}>
                          <td className="py-1 pl-3 pr-3">{r.label.replace(/,\s*(₽|\$)$/, "")}</td>
                          <td className="py-1 pl-3 text-right tabular-nums whitespace-nowrap">{num(r.value)}{u ? ` ${u}` : ""}</td>
                          <td className="py-1 pl-3 text-right tabular-nums whitespace-nowrap">{total != null ? `${num(total)} ₽` : ""}</td>
                        </tr>
                      );
                    })}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
