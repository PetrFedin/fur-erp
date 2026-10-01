import { signOut } from "@/auth";
import { Button } from "@/components/ui/button";
import { MobileNav } from "@/components/mobile-nav";
import { TopbarModes } from "@/components/topbar-modes";

const ROLE_LABELS: Record<string, string> = {
  OWNER: "Владелец",
  ADMIN: "Администратор",
  PURCHASER: "Закупщик",
  WAREHOUSE: "Кладовщик",
  TECHNOLOGIST: "Технолог",
  ACCOUNTANT: "Бухгалтер",
  VIEWER: "Наблюдатель",
};

export function Topbar({
  organizationName,
  userName,
  role,
}: {
  organizationName: string;
  userName: string;
  role: string;
}) {
  return (
    <header className="flex min-h-14 shrink-0 items-center justify-between gap-2 border-b border-neutral-200 bg-white px-3 py-2 md:px-4">
      <div className="flex min-w-0 items-center gap-2">
        <MobileNav />
        <div className="truncate text-sm font-medium text-neutral-700">{organizationName}</div>
      </div>
      <div className="flex shrink-0 items-center gap-2 md:gap-3">
        <TopbarModes />
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
