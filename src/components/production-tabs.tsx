import Link from "next/link";

const TABS = [
  { key: "orders", href: "/production", label: "ТЗ" },
  { key: "batches", href: "/production/batches", label: "Партии" },
  { key: "shipments", href: "/shipments", label: "Отгрузки" },
  { key: "fittings", href: "/fittings", label: "Примерки" },
  { key: "plan", href: "/plan", label: "План заказа" },
  { key: "calendar", href: "/calendar", label: "Календарь" },
] as const;

export type ProductionTab = (typeof TABS)[number]["key"];

/** Вкладки раздела «ТЗ»: сами ТЗ, партии, отгрузки, примерки. */
export function ProductionTabs({ active }: { active: ProductionTab }) {
  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-neutral-200 whitespace-nowrap">
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          className={
            t.key === active
              ? "-mb-px rounded-t-md border border-b-white border-neutral-200 bg-white px-3 py-1.5 text-sm font-medium"
              : "px-3 py-1.5 text-sm text-neutral-500 hover:text-neutral-900"
          }
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
