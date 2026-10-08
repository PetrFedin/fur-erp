import { cookies } from "next/headers";
import { requireSession } from "@/lib/session";
import { Suspense } from "react";
import { CommentWidget } from "@/components/comments/comment-widget";
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
      <div className="flex h-screen w-full overflow-hidden print:block print:h-auto print:overflow-visible">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col print:block">
          <Topbar
            organizationName={session.user.organizationName}
            userName={session.user.name}
            role={session.user.role}
          />
          <main className="relative flex-1 overflow-y-auto p-3 pb-16 md:p-6 md:pb-16 print:overflow-visible print:p-0">{children}</main>
        </div>
      </div>
      <div className="print:hidden">
        <Suspense fallback={null}>
          <CommentWidget />
        </Suspense>
      </div>
      </YearDisplayProvider>
    </Commission4DisplayProvider>
    </VatDisplayProvider>
  );
}
