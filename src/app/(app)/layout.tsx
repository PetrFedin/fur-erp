import { cookies } from "next/headers";
import { requireSession } from "@/lib/session";
import { Suspense } from "react";
import { CommentWidget } from "@/components/comments/comment-widget";
import { Sidebar } from "@/components/sidebar";
import { countNewDecisions } from "@/lib/supplier-recent";
import { RECENT_COOKIE } from "@/lib/supplier-recent-const";
import { navLinksFor } from "@/components/nav-links";
import { Topbar } from "@/components/topbar";
import { VatDisplayProvider } from "@/lib/vat-display";
import { parseVatModeCookie } from "@/lib/vat-mode";
import { Commission4DisplayProvider } from "@/lib/commission4-display";
import { parseCommission4Cookie } from "@/lib/commission4-mode";
import { YearDisplayProvider } from "@/lib/year-display";
import { availableYears, parseYearCookie } from "@/lib/year-filter";
import { prisma } from "@/lib/prisma";
import { canUseChat, chatCounts, viewerOf } from "@/lib/chat";
import { BlockHover } from "@/components/block-hover";
import { FromTracker } from "@/components/from-tracker";
import { BackLink } from "@/components/back-link";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession({ allowSupplier: true });
  const isSupplier = session.user.role === "SUPPLIER";
  const cookieStore = await cookies();
  const vatMode = parseVatModeCookie("incl");
  const yearFilter = parseYearCookie(cookieStore.get("yearFilter")?.value);
  // Год из данных: если есть закупки/оплаты позже 2026, переключатель и блоки получают этот год сами.
  const orgId = session.user.organizationId;
  // Поставщику закупки и оплаты не нужны (и не читаются): год — из отгрузок.
  const [pu, pa, pp] = isSupplier
    ? [{ _max: { orderDate: null } }, { _max: { paidAt: null } }, { _max: { paidAt: null } }]
    : await Promise.all([
        prisma.purchase.aggregate({ where: { organizationId: orgId }, _max: { orderDate: true } }),
        prisma.payment.aggregate({ where: { organizationId: orgId }, _max: { paidAt: true } }),
        prisma.productionPayment.aggregate({ where: { organizationId: orgId }, _max: { paidAt: true } }),
      ]);
  const dataMaxYear = Math.max(0, ...[pu._max.orderDate, pa._max.paidAt, pp._max.paidAt].map((d) => (d ? d.getUTCFullYear() : 0)));
  const years = availableYears(dataMaxYear);
  // Непрочитанное в чате — значок у пункта «Чат».
  const chatUnread = canUseChat(session.user.role) ? (await chatCounts(viewerOf(session)).catch(() => ({ unread: 0 }))).unread : 0;
  // Кабинет Веллмеха: «Что ждут» — число новых решений нашей стороны с его последнего просмотра «Недавнего».
  const supNew = session.user.role === "SUPPLIER" && session.user.supplierId
    ? await countNewDecisions(orgId, session.user.supplierId, Number(cookieStore.get(RECENT_COOKIE)?.value) || null).catch(() => 0)
    : 0;
  const badges = { "/chat": chatUnread, "/supplier": supNew };
  const c4Mode = parseCommission4Cookie(cookieStore.get("commission4Display")?.value);

  return (
    <VatDisplayProvider initialMode={vatMode}>
      <Commission4DisplayProvider initialMode={c4Mode}>
      <YearDisplayProvider initialYear={yearFilter} years={years}>
      <div className="flex h-dvh w-full overflow-hidden print:block print:h-auto print:overflow-visible">
        <Sidebar links={navLinksFor(session.user.role)} badges={badges} />
        <div className="flex min-w-0 flex-1 flex-col print:block">
          <Topbar
            organizationName={session.user.organizationName}
            userName={session.user.name}
            role={session.user.role}
            links={navLinksFor(session.user.role)}
            badges={badges}
          />
          <main className="relative flex-1 overflow-y-auto p-3 pb-16 md:p-6 md:pb-16 print:overflow-visible print:p-0">
            <Suspense fallback={null}>
              <BackLink />
            </Suspense>
            {children}
          </main>
        </div>
      </div>
      <BlockHover />
      <FromTracker />
      {!isSupplier && (
        <div className="print:hidden">
          <Suspense fallback={null}>
            <CommentWidget />
          </Suspense>
        </div>
      )}
      </YearDisplayProvider>
    </Commission4DisplayProvider>
    </VatDisplayProvider>
  );
}
