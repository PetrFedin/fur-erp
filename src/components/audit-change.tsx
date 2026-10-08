import { actorText, ACTION_LABEL, detailLines, fmtAt, summaryLines, snapshotText, type LogRow } from "@/lib/audit-query";
import { MODEL_TITLES } from "@/lib/audit-core";
import { Badge } from "@/components/ui/badge";

const VARIANT = { create: "success", update: "info", delete: "danger" } as const;

export function ActionBadge({ action }: { action: string }) {
  return <Badge variant={VARIANT[action as keyof typeof VARIANT] ?? "default"}>{ACTION_LABEL[action] ?? action}</Badge>;
}

/** Краткое изменение с раскрывающимися подробностями; для create/delete — снимок записи. */
export function ChangeCell({ row, compact }: { row: LogRow; compact?: boolean }) {
  const lines = summaryLines(row);
  const details = detailLines(row);
  const shown = lines.slice(0, 3);
  return (
    <div className="flex flex-col gap-1 text-xs text-neutral-700">
      {shown.map((l, i) => (
        <span key={i}>{l}</span>
      ))}
      {lines.length > shown.length && <span className="text-neutral-500">и ещё {lines.length - shown.length}…</span>}
      {row.action === "update" && details.length > shown.length && (
        <details>
          <summary className="cursor-pointer text-neutral-500">все изменения ({details.length})</summary>
          <ul className="mt-1 list-disc pl-4">
            {details.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        </details>
      )}
      {row.action !== "update" && (
        <details>
          <summary className="cursor-pointer text-neutral-500">{row.action === "delete" ? "Показать снимок" : "Показать данные"}</summary>
          <pre className="mt-1 max-h-72 max-w-xl overflow-auto whitespace-pre-wrap break-words rounded bg-neutral-50 p-2 text-[11px] leading-snug">{snapshotText(row.changes)}</pre>
          {row.action === "delete" && !compact && <p className="mt-1 text-[11px] text-neutral-500">Снимок для ручного восстановления; автоматически запись не возвращается.</p>}
        </details>
      )}
    </div>
  );
}

export function entityTitle(model: string) {
  return MODEL_TITLES[model] ?? model;
}
export { actorText, fmtAt };
