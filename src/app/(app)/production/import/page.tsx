import { requireSession } from "@/lib/session";
import { canEditProduction } from "@/lib/production-access";
import { TzImportWizard } from "./wizard";

export const metadata = { title: "Загрузить ТЗ" };

export default async function ImportTzPage() {
  const session = await requireSession();
  return (
    <div className="flex max-w-5xl flex-col gap-4">
      <h1 className="text-xl font-semibold">Загрузить ТЗ</h1>
      <p className="text-sm text-neutral-600">Файл приложения или расчёта ТЗ (или несколько сразу), вставка таблицы или ручной ввод. Перед созданием всё проверяется и подсвечивается; ТЗ и списания сырья создаются одной операцией — либо все, либо ничего.</p>
      {canEditProduction(session.user.role) ? <TzImportWizard /> : <p className="text-sm text-neutral-600">Недостаточно прав: загружать ТЗ могут владелец, администратор и технолог.</p>}
    </div>
  );
}
