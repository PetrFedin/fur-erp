import { HIDDEN_MODULES } from "@/lib/hidden-modules";
import { SectionTabs } from "@/components/section-tabs";

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
  return <SectionTabs label="Разделы ТЗ" items={TABS.filter((t) => !HIDDEN_TABS[t.key]).map((t) => ({ key: t.key, href: t.href, label: t.label, on: t.key === active }))} />;
}
