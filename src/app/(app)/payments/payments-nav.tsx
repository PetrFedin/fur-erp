import Link from "next/link";

export type PaymentsTab = "registry" | "all" | "suppliers" | "clients" | "cashflow";

/** Разделы оплат: «Реестр» (по умолчанию) | «За сырьё» | «За работу». Прежний разбор по статьям («Все») — ?tab=all, ссылка в реестре. */
export function PaymentsNav({ tab }: { tab: PaymentsTab }) {
  const items: [string, PaymentsTab, string][] = [["/payments", "registry", "Реестр"], ["/payments?tab=suppliers", "suppliers", "За сырьё"], ["/payments?tab=clients", "clients", "За работу"], ["/cashflow", "cashflow", "Cashflow"]];
  return (
    <nav aria-label="Разделы оплат" className="inline-flex self-start rounded-lg border border-neutral-300 bg-white p-0.5 text-sm">
      {items.map(([href, k, label]) => {
        const on = tab === k || (tab === "all" && k === "registry");
        return (
          <Link key={k} href={href} aria-current={on ? "page" : undefined}
            className={"inline-flex min-h-10 items-center rounded-md px-3 md:min-h-7 md:py-0.5 " + (on ? "bg-neutral-900 text-white" : "text-neutral-600 hover:text-neutral-900")}>{label}</Link>
        );
      })}
    </nav>
  );
}
