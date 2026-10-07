import Link from "next/link";
import { requireSession } from "@/lib/session";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

const SETTINGS_LINKS = [
  { href: "/materials", title: "Справочник материалов", description: "Названия, единицы измерения, категории" },
  { href: "/suppliers", title: "Поставщики", description: "Поставщики и их контакты" },
  { href: "/clients", title: "Заказчики", description: "Кому шьём и кто платит" },
  { href: "/settings/colors", title: "Справочник цветов", description: "Единые названия цветов, синонимы, объединение и привязка" },
  { href: "/settings/categories", title: "Справочник категорий", description: "Пальто, полупальто, жакет… единые названия категорий изделий, синонимы, объединение и привязка моделей" },
  { href: "/settings/furs", title: "Справочник меха", description: "Вид меха по-русски и по-английски, синонимы из инвойсов и ТЗ" },
  { href: "/settings/auctions", title: "Справочник аукционов", description: "Короткие имена аукционов, как они видны на платформе; новые аукционы, объединение, подтверждение" },
  { href: "/settings/articles-ref", title: "Справочник артикулов", description: "Наш код и код/название в системе продаж, другие написания, объединение дублей" },
  { href: "/expense-categories", title: "Статьи расходов", description: "Категории дополнительных расходов" },
  { href: "/users", title: "Пользователи", description: "Сотрудники и их роли" },
];

export const metadata = { title: "Настройки" };

export default async function SettingsPage() {
  await requireSession();
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">Настройки</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Справочники и параметры. Оплаты — в разделе «Оплаты», проверка данных — в разделе «Контроль», план поставок — во вкладках «ТЗ».
        </p>
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
