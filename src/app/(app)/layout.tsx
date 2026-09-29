import { cookies } from "next/headers";
import { requireSession } from "@/lib/session";
import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";
import { VatDisplayProvider } from "@/lib/vat-display";
import { parseVatModeCookie } from "@/lib/vat-mode";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const cookieStore = await cookies();
  const vatMode = parseVatModeCookie(cookieStore.get("vatDisplay")?.value);

  return (
    <VatDisplayProvider initialMode={vatMode}>
      <div className="flex h-screen w-full overflow-hidden">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar
            organizationName={session.user.organizationName}
            userName={session.user.name}
            role={session.user.role}
          />
          <main className="flex-1 overflow-y-auto p-6">{children}</main>
        </div>
      </div>
    </VatDisplayProvider>
  );
}
