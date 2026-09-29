import { signOut } from "@/auth";
import { Button } from "@/components/ui/button";
import { VatToggle } from "@/components/vat-toggle";

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
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-neutral-200 bg-white px-4">
      <div className="text-sm font-medium text-neutral-700">{organizationName}</div>
      <div className="flex items-center gap-3">
        <VatToggle />
        <div className="text-right text-sm">
          <div className="font-medium text-neutral-900">{userName}</div>
          <div className="text-xs text-neutral-500">{ROLE_LABELS[role] ?? role}</div>
        </div>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <Button type="submit" variant="outline" size="sm">
            Выйти
          </Button>
        </form>
      </div>
    </header>
  );
}
