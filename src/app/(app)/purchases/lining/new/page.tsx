import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { ACCESS, hasRole } from "@/lib/access";
import { InfoHint } from "@/components/info-hint";
import { LiningBuyForm } from "./form";

export const metadata = { title: "Купить подкладку" };

/** «Купить подкладку»: вся информация о закупке партии подкладки в одной форме (поставщик, партия, счёт, ткани с метрами, ценой и НДС). */
export default async function BuyLiningPage() {
  const session = await requireSession();
  const orgId = session.user.organizationId;
  const canEdit = hasRole(session.user.role, ACCESS.purchases);
  const [suppliers, materials, last] = await Promise.all([
    prisma.supplier.findMany({ where: { organizationId: orgId, isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.rawMaterial.findMany({ where: { organizationId: orgId, unit: "M" }, select: { id: true, name: true, defaultVatRate: true } }),
    prisma.purchase.findFirst({ where: { organizationId: orgId, items: { some: { rawMaterial: { unit: "M" } } } }, orderBy: { orderDate: "desc" }, select: { supplierId: true } }),
  ]);
  const mats = materials
    .sort((a, b) => a.name.localeCompare(b.name, "ru", { numeric: true }))
    .map((m) => ({ id: m.id, name: m.name, defaultVatRate: m.defaultVatRate != null ? Number(m.defaultVatRate) : null }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/lots?tab=lining" aria-label="Назад в «Сырьё — Подкладка»" title="Назад в «Сырьё — Подкладка»" className="inline-flex size-8 items-center justify-center rounded-lg border border-neutral-300 text-neutral-700 hover:bg-neutral-50">←</Link>
        <h1 className="text-xl font-semibold">Купить подкладку</h1>
        <InfoHint label="О закупке подкладки" wide>
          <p>Одна форма — вся закупка партии подкладки: дата, поставщик, название партии, счёт и ткани (метры, цена за метр, НДС). После сохранения закупка сразу принята: метры попадают на склад (пул ткани), а партия видна в «Сырьё → Подкладка», на Главной, в «Закупках», в «Оплатах» (к оплате) и в выборе ткани в ТЗ. Оплата вносится в «Оплатах».</p>
          <p className="mt-1">НДС по дате документа: до 2026 — 20%, с 2026 — 22% (или ставка по умолчанию у ткани); можно изменить в строке. Цена за метр вводится с НДС или без — в базе хранится без НДС.</p>
        </InfoHint>
      </div>
      {canEdit ? (
        <LiningBuyForm suppliers={suppliers} materials={mats} defaultSupplierId={last?.supplierId ?? suppliers[0]?.id ?? ""} />
      ) : (
        <p className="rounded-lg border border-neutral-200 bg-white p-4 text-sm text-neutral-600">Закупки подкладки оформляют владелец, администратор и закупщик.</p>
      )}
    </div>
  );
}
