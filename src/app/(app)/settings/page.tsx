import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

const SETTINGS_LINKS = [
  { href: "/materials", title: "Сырьё", description: "Справочник материалов, категории, единицы измерения" },
  { href: "/warehouses", title: "Склады", description: "Места хранения сырья и готовой продукции" },
  { href: "/expense-categories", title: "Статьи расходов", description: "Категории доп. расходов по закупкам и производству" },
  { href: "/users", title: "Пользователи", description: "Сотрудники компании и их роли" },
];

export default function SettingsPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Настройки</h1>
      <div className="grid grid-cols-2 gap-4">
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
