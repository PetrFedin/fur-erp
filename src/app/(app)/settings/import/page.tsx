import { Breadcrumbs } from "@/components/breadcrumbs";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { ACCESS } from "@/lib/access";
import { listHistory } from "@/lib/import-server";
import { ImportScreen } from "./import-screen";

export const metadata = { title: "Загрузка данных" };

export default async function ImportPage() {
  const session = await requireRole(...ACCESS.dataImport);
  const history = await listHistory(prisma, session.user.organizationId);
  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: "Настройки", href: "/settings" }, { label: "Загрузка данных" }]} />
      <h1 className="text-xl font-semibold">Загрузка данных</h1>
      <ImportScreen history={history} />
    </div>
  );
}
