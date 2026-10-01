import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { computeAttention, countAttention } from "@/lib/attention";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

const SETTINGS_LINKS = [
  { href: "/materials", title: "Справочник материалов", description: "Названия, единицы измерения, категории" },
  { href: "/suppliers", title: "Поставщик", description: "Поставщики и их контакты" },
  { href: "/clients", title: "Заказчики", description: "Кому шьём и кто платит" },
  { href: "/payments", title: "Оплаты", description: "Оплаты поставщикам и поступления от заказчиков" },
  { href: "/supply-plan", title: "План поставки", description: "Что и когда должно прийти" },
  { href: "/warehouses", title: "Склады", description: "Места хранения" },
  { href: "/expense-categories", title: "Статьи расходов", description: "Категории дополнительных расходов" },
  { href: "/users", title: "Пользователи", description: "Сотрудники и их роли" },
];

export const metadata = { title: "Настройки" };

export default async function SettingsPage() {
  const session = await requireSession();
  const att = countAttention(await computeAttention(prisma, session.user.organizationId));
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Настройки</h1>
        <Link href="/attention" className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100">
          Что не заведено{att.main > 0 ? ` · ${att.main}` : " ✓"} →
        </Link>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SETTINGS_LINKS.map((item) => (
          <Link key={item.href} href={item.href}>
            <Card className="h-full transition-colors hover:border-neutral-400">
              <CardHeader>
                <CardTitle>{item.title}</CardTitle>
                <CardDescription>{item.description}</CardDescription>
              </CardHeader>
              <CardContent />
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
