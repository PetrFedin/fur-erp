import { cookies } from "next/headers";
import { requireSession } from "@/lib/session";
import { Suspense } from "react";
import { CommentWidget } from "@/components/comments/comment-widget";
import { Sidebar } from "@/components/sidebar";
import { countNewDecisions } from "@/lib/supplier-recent";
import { RECENT_COOKIE } from "@/lib/supplier-recent-const";
import { navLinksFor } from "@/components/nav-links";
import { Topbar } from "@/components/topbar";
import { roleSwitchEnabled } from "@/lib/security-env";
import { switchBack } from "@/components/role-switch-actions";
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
  // Кабинет Веллмеха: «Контроль» — число новых решений нашей стороны с его последнего просмотра «Недавнего».
  const supNew = session.user.role === "SUPPLIER" && session.user.supplierId
    ? await countNewDecisions(orgId, session.user.supplierId, Number(cookieStore.get(RECENT_COOKIE)?.value) || null).catch(() => 0)
    : 0;
  const supRow = isSupplier && session.user.supplierId
    ? await prisma.supplier.findFirst({ where: { id: session.user.supplierId, organizationId: orgId }, select: { suppliesRaw: true, name: true } })
    : null;
  const suppliesRaw = supRow?.suppliesRaw ?? true;
  const acting = Boolean(session.user.realUserId);
  const canSwitch = roleSwitchEnabled() && !acting && (session.user.role === "OWNER" || session.user.role === "ADMIN");
  const switchTargets = canSwitch
    ? (await prisma.user.findMany({ where: { organizationId: orgId, role: "SUPPLIER", isActive: true }, select: { id: true, name: true, supplier: { select: { name: true } } }, orderBy: { name: "asc" } }))
        .map((u) => ({ id: u.id, name: u.supplier?.name ?? u.name }))
    : [];
  const navLinks = navLinksFor(session.user.role, { suppliesRaw });
  const badges = { "/chat": chatUnread, "/supplier": supNew };
  const c4Mode = parseCommission4Cookie(cookieStore.get("commission4Display")?.value);

  return (
    <VatDisplayProvider initialMode={vatMode}>
      <Commission4DisplayProvider initialMode={c4Mode}>
      <YearDisplayProvider initialYear={yearFilter} years={years}>
      <div className="flex h-dvh w-full overflow-hidden print:block print:h-auto print:overflow-visible">
        <Sidebar links={navLinks} badges={badges} />
        <div className="flex min-w-0 flex-1 flex-col print:block">
          <Topbar
            organizationName={session.user.organizationName}
            cabinetLabel={supRow && !/в[еэ]лл?м[еэ][хк]/i.test(supRow.name) ? supRow.name : undefined}
            userName={session.user.name}
            role={session.user.role}
            links={navLinks}
            badges={badges}
            switchTargets={canSwitch ? switchTargets : undefined}
            actingAs={acting}
          />
          {acting && (
            <div role="status" className="print:hidden flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-950">
              <span>Вы смотрите как: <b>{supRow?.name ?? session.user.name}</b> (демо-режим). Действия выполняются от имени поставщика.</span>
              <form action={switchBack}><button type="submit" className="min-h-11 cursor-pointer rounded-md border border-amber-700 bg-white px-3 font-medium text-amber-950 hover:bg-amber-100">Вернуться</button></form>
            </div>
          )}
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
