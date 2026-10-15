import { signOut } from "@/auth";
import { Button } from "@/components/ui/button";
import { MobileNav } from "@/components/mobile-nav";
import type { NavItem } from "@/components/nav-links";
import { TopbarModes } from "@/components/topbar-modes";
import { GlobalSearch } from "@/components/global-search";
import { ThemeToggle } from "@/components/theme-toggle";
import { IconSwitch } from "@/components/icons";
import { switchBack, switchToSupplier } from "@/components/role-switch-actions";

// Цель касания 44 px (не меньше), в стиле иконок проекта.
const SWITCH_BTN = "inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-md border border-neutral-200 bg-white text-neutral-700 transition hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900";

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
  switchTargets,
  actingAs,
}: {
  organizationName: string;
  /** Подпись кабинета внешнего поставщика/подрядчика (имя контрагента); пусто — «Кабинет Веллмеха» как раньше. */
  cabinetLabel?: string;
  userName: string;
  role: string;
  links: readonly NavItem[];
  badges?: Record<string, number>;
  /** Владелец/админ при включённом ALLOW_ROLE_SWITCH: поставщики, в чьи кабинеты можно переключиться. */
  switchTargets?: { id: string; name: string }[];
  /** Режим «смотрю как поставщик» (начат владельцем): показываем кнопку возврата. */
  actingAs?: boolean;
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
        {actingAs ? (
          <form action={switchBack}>
            <button type="submit" className={SWITCH_BTN} title="Вернуться в кабинет заказчика" aria-label="Вернуться в кабинет заказчика">
              <IconSwitch className="h-5 w-5" />
            </button>
          </form>
        ) : switchTargets && switchTargets.length === 1 ? (
          <form action={switchToSupplier}>
            <input type="hidden" name="userId" value={switchTargets[0].id} />
            <button type="submit" className={SWITCH_BTN} title="Сменить на кабинет поставщика" aria-label="Сменить на кабинет поставщика">
              <IconSwitch className="h-5 w-5" />
            </button>
          </form>
        ) : switchTargets && switchTargets.length > 1 ? (
          <details className="relative">
            <summary className={SWITCH_BTN + " list-none [&::-webkit-details-marker]:hidden"} title="Сменить на кабинет поставщика" aria-label="Сменить на кабинет поставщика">
              <IconSwitch className="h-5 w-5" />
            </summary>
            <div className="absolute right-0 z-50 mt-1 w-64 rounded-md border border-neutral-200 bg-white p-1 shadow-md">
              {switchTargets.map((t) => (
                <form key={t.id} action={switchToSupplier}>
                  <input type="hidden" name="userId" value={t.id} />
                  <button type="submit" className="flex min-h-11 w-full items-center rounded px-3 text-left text-sm text-neutral-800 hover:bg-neutral-50">
                    {t.name}
                  </button>
                </form>
              ))}
            </div>
          </details>
        ) : null}
      </div>
    </header>
  );
}
