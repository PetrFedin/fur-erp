import { cookies } from "next/headers";
import { requireSession } from "@/lib/session";
import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";
import { VatDisplayProvider } from "@/lib/vat-display";
import { parseVatModeCookie } from "@/lib/vat-mode";
import { Commission4DisplayProvider } from "@/lib/commission4-display";
import { parseCommission4Cookie } from "@/lib/commission4-mode";
import { YearDisplayProvider } from "@/lib/year-display";
import { parseYearCookie } from "@/lib/year-filter";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const cookieStore = await cookies();
  const vatMode = parseVatModeCookie(cookieStore.get("vatDisplay")?.value);
  const yearFilter = parseYearCookie(cookieStore.get("yearFilter")?.value);
  const c4Mode = parseCommission4Cookie(cookieStore.get("commission4Display")?.value);

  return (
    <VatDisplayProvider initialMode={vatMode}>
      <Commission4DisplayProvider initialMode={c4Mode}>
      <YearDisplayProvider initialYear={yearFilter}>
      <div className="flex h-screen w-full overflow-hidden">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar
            organizationName={session.user.organizationName}
            userName={session.user.name}
            role={session.user.role}
          />
          <main className="relative flex-1 overflow-y-auto p-3 md:p-6">{children}</main>
        </div>
      </div>
      </YearDisplayProvider>
    </Commission4DisplayProvider>
    </VatDisplayProvider>
  );
}
