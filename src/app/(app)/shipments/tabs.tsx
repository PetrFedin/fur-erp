import Link from "next/link";

/** Вкладки раздела «Отгрузки»: приёмки по датам, календарь (аукционы, отгрузки, оплаты, планируемые действия), лист отгрузок и архив. */
const TABS = [
  { k: "feed", label: "Приёмки", href: "/shipments" },
  { k: "calendar", label: "Календарь", href: "/calendar" },
  { k: "sheet", label: "Лист отгрузок", href: "/shipments?tab=sheet" },
  { k: "archive", label: "Архив отгрузок", href: "/shipments?tab=archive" },
] as const;

export function ShipmentsTabs({ active }: { active: (typeof TABS)[number]["k"] }) {
  return (
    <nav aria-label="Разделы отгрузок" className="flex flex-wrap gap-1 print:hidden">
      {TABS.map((t) => (
        <Link key={t.k} href={t.href} aria-current={t.k === active ? "page" : undefined}
          className={"inline-flex min-h-11 items-center rounded-lg border px-3 text-sm " + (t.k === active ? "border-[var(--ui-accent)] bg-white font-medium" : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50")}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
