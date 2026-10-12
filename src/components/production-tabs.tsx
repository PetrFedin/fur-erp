import Link from "next/link";
import { isModuleHidden } from "@/lib/hidden-modules";

const TABS = [
  { key: "orders", href: "/production", label: "ТЗ" },
  { key: "batches", href: "/production/batches", label: "Партии пошива" },
  { key: "shipments", module: "shipments", href: "/shipments", label: "Отгрузки" },
  { key: "fittings", module: "fittings", href: "/fittings", label: "Примерки" },
  { key: "plan", module: "plan", href: "/plan", label: "План заказа" },
  { key: "supply", module: "supply-plan", href: "/supply-plan", label: "План поставок" },
] as const;

export type ProductionTab = (typeof TABS)[number]["key"];

/** Вкладки раздела «ТЗ»: сами ТЗ, партии, отгрузки, примерки, план заказа, план поставок. */
export function ProductionTabs({ active }: { active: ProductionTab }) {
  return (
    <nav aria-label="Разделы ТЗ" className="flex gap-1 overflow-x-auto whitespace-nowrap border-b border-neutral-200 pb-2">
      {TABS.filter((t) => !("module" in t) || !isModuleHidden(t.module) || t.key === active).map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={t.key === active ? "page" : undefined}
          className={
            "inline-flex items-center rounded-md px-3 py-1.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900 max-md:min-h-9 " +
            (t.key === active ? "bg-neutral-900 text-white" : "text-neutral-700 hover:bg-neutral-100")
          }
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
