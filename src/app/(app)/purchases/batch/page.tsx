import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { Card, CardContent } from "@/components/ui/card";
import { loadSupplierDebt } from "@/lib/supplier-debt";
import { loadIntakeRefs } from "@/lib/batch-intake-server";
import { ACCESS, hasRole } from "@/lib/access";
import { BatchWizard } from "./wizard";

export const metadata = { title: "Новая партия закупки" };

export default async function NewBatchPage() {
  const session = await requireSession();
  const orgId = session.user.organizationId;
  const [refs, debt] = await Promise.all([loadIntakeRefs(prisma, orgId), loadSupplierDebt(prisma, orgId)]);
  const role = session.user.role;

  return (
    <div className="flex max-w-5xl flex-col gap-3">
      <div className="text-sm">
        <Link href="/purchases" className="text-neutral-500 hover:underline">← Закупки</Link>
      </div>
      <h1 className="text-xl font-semibold">Новая партия закупки</h1>
      <Card>
        <CardContent className="pt-4 text-sm text-neutral-700">
          <p className="font-medium text-neutral-900">Как завести новую партию</p>
          <ol className="mt-1 list-decimal space-y-0.5 pl-5">
            <li>Выберите аукцион из справочника или создайте новый; укажите поставщика, валюту и курс.</li>
            <li>Загрузите файл с лотами (Excel или CSV), вставьте строки из таблицы или введите лоты вручную; исправьте красные строки.</li>
            <li>Загрузите документы пачкой (счёт, УПД, инвойс, расчёт): тип и номер определятся сами, сумма сверится с лотами.</li>
            <li>Проверьте итоги и нажмите «Создать»: появятся закупки, лоты и приёмка на склад.</li>
          </ol>
          <p className="mt-2 text-neutral-600">
            <span className="font-medium text-neutral-800">Что пересчитается автоматически:</span> остаток меха на складе, себестоимость лотов, долг поставщику, «Закуплено» и «Склад» в Сводке, задачи «что загрузить» и «что оплатить». Черновик сохраняется в этом браузере.
          </p>
        </CardContent>
      </Card>
      <BatchWizard
        userKey={session.user.id}
        refs={{
          auctions: refs.auctions.map((a) => ({ id: a.id, name: a.name, house: a.house, currency: a.currency, aliases: a.aliases })),
          suppliers: refs.suppliers,
          warehouses: refs.warehouses,
          materials: refs.materials.map((m) => ({ id: m.id, name: m.name })),
          furRefs: refs.furRefs,
          colors: refs.colors,
          lotsByAuction: refs.lotsByAuction,
        }}
        debtNow={Number(debt.debt.toFixed(2))}
        can={{ auctions: hasRole(role, ACCESS.auctions), materials: hasRole(role, ACCESS.materials), colors: hasRole(role, ACCESS.colors) }}
      />
    </div>
  );
}
