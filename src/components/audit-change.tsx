import { actorText, ACTION_LABEL, detailEntries, detailLines, fmtAt, summaryLines, hasCollapsed, snapshotText, type LogRow } from "@/lib/audit-query";
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
  const entries = detailEntries(row);
  const shown = lines.slice(0, 3);
  return (
    <div className="flex flex-col gap-1 text-xs text-neutral-700">
      {shown.map((l, i) => (
        <span key={i}>{l}</span>
      ))}
      {lines.length > shown.length && <span className="text-neutral-500">и ещё {lines.length - shown.length}…</span>}
      {row.action === "update" && (details.length > shown.length || hasCollapsed(row)) && (
        <details>
          <summary className="cursor-pointer text-neutral-500">Подробнее ({details.length})</summary>
          <ul className="mt-1 list-disc pl-4">
            {entries.filter((e) => e.kind === "line").map((e, i) => (
              <li key={i}>{e.kind === "line" ? e.text : null}</li>
            ))}
          </ul>
          {entries.map((e, i) => e.kind === "table" ? (
            <div key={i} className="mt-2">
              <div className="font-medium text-neutral-800">{e.field}</div>
              {e.rows.length === 0 ? <div className="text-neutral-500">Видимых отличий нет.</div> : (
                <table className="mt-1 w-full max-w-xl border-collapse text-[11px]">
                  <thead><tr className="text-left text-neutral-500"><th className="py-0.5 pr-2 font-normal">Статья</th><th className="py-0.5 pr-2 font-normal">Было</th><th className="py-0.5 font-normal">Стало</th></tr></thead>
                  <tbody>
                    {e.rows.map((r, j) => (
                      <tr key={j} className="border-t border-neutral-100 align-top"><td className="py-0.5 pr-2">{r.key}</td><td className="py-0.5 pr-2 text-neutral-600">{r.before}</td><td className="py-0.5">{r.after}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
              <details className="mt-1">
                <summary className="cursor-pointer text-neutral-400">Технические данные</summary>
                <pre className="mt-1 max-h-60 max-w-xl overflow-auto whitespace-pre-wrap break-words rounded bg-neutral-50 p-2 text-[11px] leading-snug">{e.raw}</pre>
              </details>
            </div>
          ) : null)}
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
