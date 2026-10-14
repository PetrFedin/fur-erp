import Link from "next/link";
import { HIDDEN_MODULES } from "@/lib/hidden-modules";

const TABS = [
  { key: "orders", href: "/production", label: "ТЗ" },
  { key: "batches", href: "/production/batches", label: "Партии пошива" },
  { key: "fittings", href: "/fittings", label: "Примерки" },
  { key: "plan", href: "/plan", label: "План заказа" },
  { key: "supply", href: "/supply-plan", label: "План поставок" },
] as const;

const HIDDEN_TABS: Record<string, boolean> = {
  fittings: HIDDEN_MODULES.fittings,
  plan: HIDDEN_MODULES.orderPlan,
  supply: HIDDEN_MODULES.supplyPlan,
};

export type ProductionTab = (typeof TABS)[number]["key"];

/** Вкладки раздела «ТЗ»: сами ТЗ, партии, примерки, план заказа, план поставок. */
export function ProductionTabs({ active }: { active: ProductionTab }) {
  return (
    <nav aria-label="Разделы ТЗ" className="flex gap-1 overflow-x-auto whitespace-nowrap border-b border-neutral-200 pb-2">
      {TABS.filter((t) => !HIDDEN_TABS[t.key]).map((t) => (
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
