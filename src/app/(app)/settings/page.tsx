import Link from "next/link";
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

export default function SettingsPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Настройки</h1>
      <div className="grid grid-cols-3 gap-4">
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
