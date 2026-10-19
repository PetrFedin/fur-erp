import { SectionTabs } from "@/components/section-tabs";

export type PaymentsTab = "registry" | "all" | "suppliers" | "clients";

/** Разделы оплат: «Реестр» (по умолчанию) | «За сырьё» | «За работу». Прежний разбор по статьям («Все») — ?tab=all, ссылка в реестре. Cashflow — отдельный пункт меню, во вкладки не дублируется. */
export function PaymentsNav({ tab }: { tab: PaymentsTab }) {
  const items: [string, PaymentsTab, string][] = [["/payments", "registry", "Реестр"], ["/payments?tab=suppliers", "suppliers", "За сырьё"], ["/payments?tab=clients", "clients", "За работу"]];
  return <SectionTabs label="Разделы оплат" items={items.map(([href, k, label]) => ({ key: k, href, label, on: tab === k || (tab === "all" && k === "registry") }))} />;
}
