import { signOut } from "@/auth";
import { Button } from "@/components/ui/button";
import { MobileNav } from "@/components/mobile-nav";
import type { NavItem } from "@/components/nav-links";
import { TopbarModes } from "@/components/topbar-modes";
import { GlobalSearch } from "@/components/global-search";
import { ThemeToggle } from "@/components/theme-toggle";

const ROLE_LABELS: Record<string, string> = {
  OWNER: "Владелец",
  ADMIN: "Администратор",
  PURCHASER: "Закупщик",
  WAREHOUSE: "Кладовщик",
  TECHNOLOGIST: "Технолог",
  ACCOUNTANT: "Бухгалтер",
  VIEWER: "Наблюдатель",
  SUPPLIER: "Поставщик",
};

export function Topbar({
  organizationName,
  cabinetLabel,
  userName,
  role,
  links,
  badges,
}: {
  organizationName: string;
  /** Подпись кабинета внешнего поставщика/подрядчика (имя контрагента); пусто — «Кабинет Веллмеха» как раньше. */
  cabinetLabel?: string;
  userName: string;
  role: string;
  links: readonly NavItem[];
  badges?: Record<string, number>;
}) {
  const isSupplier = role === "SUPPLIER";
  return (
    <header className="print:hidden flex min-h-14 shrink-0 items-center justify-between gap-2 border-b border-neutral-200 bg-white px-3 py-2 md:px-4">
      <div className="flex min-w-0 items-center gap-2">
        <MobileNav links={links} badges={badges} />
        <div className="truncate text-sm font-medium text-neutral-700 max-md:min-w-[3.25rem]">{organizationName}</div>
        {isSupplier && <span className="shrink-0 rounded-md bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-800">{cabinetLabel ? `Кабинет: ${cabinetLabel}` : "Кабинет Веллмеха"}</span>}
      </div>
      <div className="flex shrink-0 items-center gap-2 md:gap-3">
        {!isSupplier && <GlobalSearch />}
        <ThemeToggle className="hidden xl:flex" />
        <TopbarModes yearOnly={isSupplier} />
        <div className="hidden text-right text-sm sm:block">
          <div className="font-medium text-neutral-900">{userName}</div>
          <div className="text-xs text-neutral-500">{ROLE_LABELS[role] ?? role}</div>
        </div>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <Button type="submit" variant="outline" size="sm" className="min-h-8">
            Выйти
          </Button>
        </form>
      </div>
    </header>
  );
}
