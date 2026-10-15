import { Breadcrumbs } from "@/components/breadcrumbs";
import Link from "next/link";
import { requireSession } from "@/lib/session";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

const SETTINGS_LINKS = [
  { href: "/materials", title: "Справочник материалов", description: "Названия, единицы измерения, категории" },
  { href: "/suppliers", title: "Поставщики", description: "Поставщики и их контакты" },
  { href: "/settings/contractors", title: "Подрядчики", description: "Реквизиты, договоры, доступ" },
  { href: "/clients", title: "Заказчики", description: "Кому шьём и кто платит" },
  { href: "/settings/colors", title: "Справочник цветов", description: "Названия и синонимы" },
  { href: "/settings/categories", title: "Справочник категорий", description: "Категории изделий и синонимы" },
  { href: "/settings/furs", title: "Справочник меха", description: "Названия и синонимы" },
  { href: "/settings/fur-attrs", title: "Признаки меха", description: "Признаки по описаниям лотов" },
  { href: "/settings/auctions", title: "Справочник аукционов", description: "Короткие имена аукционов" },
  { href: "/settings/articles-ref", title: "Справочник артикулов", description: "Коды и написания" },
  { href: "/warehouses", title: "Склады", description: "Склады сырья и готовой продукции, склад по умолчанию" },
  { href: "/settings/expense-categories", title: "Статьи расходов", description: "Категории дополнительных расходов" },
  { href: "/users", title: "Пользователи", description: "Сотрудники и их роли" },
  { href: "/settings/channels", title: "Каналы: Telegram, WhatsApp", description: "Боты и привязки" },
];

export const metadata = { title: "Настройки" };

// Что из справочников видит внешний поставщик (только просмотр).
const SUPPLIER_LINKS = ["/settings/colors", "/settings/categories", "/settings/furs", "/settings/fur-attrs", "/settings/auctions", "/settings/articles-ref"];

export default async function SettingsPage() {
  const session = await requireSession({ allowSupplier: true });
  const isSup = session.user.role === "SUPPLIER";
  const links = isSup ? SETTINGS_LINKS.filter((l) => SUPPLIER_LINKS.includes(l.href)) : SETTINGS_LINKS;
  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: isSup ? "Справочники" : "Настройки" }]} />
      <div>
        <h1 className="text-xl font-semibold">{isSup ? "Справочники" : "Настройки"}</h1>
        <p className="mt-1 text-sm text-neutral-500">
          {isSup
            ? "Только просмотр. Не хватает — напишите в чате."
            : "Справочники и параметры."}
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {links.map((item) => (
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
