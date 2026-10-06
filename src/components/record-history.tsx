import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getFreshSession } from "@/lib/session";
import { ACCESS, hasRole } from "@/lib/access";
import { actorText, fmtAt, type LogRow } from "@/lib/audit-query";
import { ActionBadge, ChangeCell } from "@/components/audit-change";

/**
 * История изменений одной записи (карточка закупки, ТЗ, партии, модели, панель оплат): последние 20 событий, свёрнуто.
 * Видна тем, кто читает журнал (владелец, администратор, бухгалтер). Включает правки, где запись упомянута в сводных событиях (createMany).
 */
export async function RecordHistory({ model, recordId, extraModels, panelModels }: { model: string; recordId?: string; extraModels?: { model: string; recordId: string }[]; panelModels?: string[] }) {
  const session = await getFreshSession();
  if (!session || !hasRole(session.user.role, ACCESS.history)) return null;
  if (!("auditLog" in prisma)) return null;
  // С recordId — история одной записи; без него (панель оплат) — последние события по перечисленным моделям.
  const keys = recordId ? [{ model, recordId }, ...(extraModels ?? [])] : (panelModels ?? [model]).map((m) => ({ model: m, recordId: "" }));
  const rows = (await prisma.auditLog.findMany({
    where: {
      organizationId: session.user.organizationId,
      OR: keys.map((k) => (k.recordId ? { model: k.model, recordId: k.recordId } : { model: k.model })),
    },
    orderBy: { at: "desc" },
    take: 20,
  })) as LogRow[];
  const q = new URLSearchParams(recordId ? { q: recordId } : { model }).toString();
  return (
    <details className="rounded-md border border-neutral-200 bg-white text-sm" data-record-history>
      <summary className="cursor-pointer select-none px-3 py-2 font-medium text-neutral-700">
        История изменений {rows.length > 0 ? `(${rows.length}${rows.length === 20 ? "+" : ""})` : "— пока пусто"}
      </summary>
      <div className="flex flex-col gap-2 border-t border-neutral-100 px-3 py-2">
        {rows.length === 0 && <p className="text-xs text-neutral-500">Изменений с момента включения журнала не было.</p>}
        {rows.map((r) => (
          <div key={r.id} className="flex flex-col gap-1 border-b border-neutral-100 pb-2 last:border-0">
            <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
              <span>{fmtAt(r.at)}</span>
              <span>{actorText(r)}</span>
              <ActionBadge action={r.action} />
              {r.model !== model && <span className="text-neutral-400">{r.label}</span>}
            </div>
            <ChangeCell row={r} compact />
          </div>
        ))}
        <Link href={`/history?${q}`} className="text-xs text-blue-700 hover:underline">
          вся история
        </Link>
      </div>
    </details>
  );
}
