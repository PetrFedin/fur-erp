import { InfoHint } from "@/components/info-hint";
import { requireSession } from "@/lib/session";
import { canEditProduction } from "@/lib/production-access";
import { TzImportWizard } from "./wizard";

export const metadata = { title: "Загрузить ТЗ" };

export default async function ImportTzPage() {
  const session = await requireSession();
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold">Загрузить ТЗ</h1><InfoHint label="Как загрузить ТЗ" wide>Файл приложения или расчёта ТЗ (или несколько сразу), вставка таблицы или ручной ввод. Перед созданием всё проверяется и подсвечивается; ТЗ и списания сырья создаются одной операцией — либо все, либо ничего.</InfoHint></div>
      {canEditProduction(session.user.role) ? <TzImportWizard /> : <p className="text-sm text-neutral-600">Недостаточно прав: загружать ТЗ могут владелец, администратор и технолог.</p>}
    </div>
  );
}
