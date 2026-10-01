import { DriveDocList } from "@/components/drive-documents";
import { DocFileButtons } from "@/components/doc-preview";
import { ConfirmSubmitButton } from "./documents-form";
import { DOC_KIND_LABELS } from "@/lib/purchase-files";
import { formatDate } from "@/lib/utils";
import { deletePurchaseDocument } from "../doc-actions";
import type { DriveDocView } from "@/lib/drive-docs";

export type FileDocRow = {
  id: string;
  title: string;
  kind: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: Date;
  batch: boolean;
};
export type DriveDocRow = { view: DriveDocView; fileId: string; createdAt: Date };

type Entry =
  | { type: "file"; key: string; sort: number; title: string; d: FileDocRow }
  | { type: "drive"; key: string; sort: number; title: string; d: DriveDocRow };

/** Один блок «Документы»: файлы закупки/партии и документы Google Drive вместе, повторы — одной строкой «×N». */
export function PurchaseDocumentsList({
  purchaseId,
  files,
  drives,
  batchName,
  canEdit,
}: {
  purchaseId: string;
  files: FileDocRow[];
  drives: DriveDocRow[];
  batchName: string | null;
  canEdit: boolean;
}) {
  const entries: Entry[] = [
    ...files.map((d): Entry => ({
      type: "file",
      key: `f|${d.title.trim().toLowerCase()}|${d.originalName}|${d.sizeBytes}`,
      sort: d.createdAt.getTime(),
      title: d.title,
      d,
    })),
    ...drives.map((d): Entry => ({
      type: "drive",
      key: `d|${d.view.title.trim().toLowerCase()}|${d.fileId || d.view.drivePath || d.view.viewUrl || d.view.id}`,
      sort: d.view.docDate ? Date.parse(d.view.docDate) : d.createdAt.getTime(),
      title: d.view.title,
      d,
    })),
  ];
  const groups = new Map<string, Entry[]>();
  for (const e of entries) groups.set(e.key, [...(groups.get(e.key) ?? []), e]);
  const list = [...groups.values()].sort((a, b) => a[0].sort - b[0].sort);

  function fileRow(d: FileDocRow) {
    return (
      <div key={d.id} className="flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <div className="min-w-0">
          <a href={`/api/purchase-docs/${d.id}`} target="_blank" rel="noreferrer" className="break-words font-medium hover:underline">
            {d.title}
          </a>
          <span className="ml-2 text-xs text-neutral-500">
            {DOC_KIND_LABELS[d.kind as keyof typeof DOC_KIND_LABELS]}
            {d.batch ? ` · вся партия ${batchName}` : " · эта закупка"} · {formatDate(d.createdAt)}
          </span>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <DocFileButtons href={`/api/purchase-docs/${d.id}`} mime={d.mimeType} title={d.title} />
          {canEdit && (
            <form
              action={async () => {
                "use server";
                await deletePurchaseDocument(purchaseId, d.id);
              }}
            >
              <ConfirmSubmitButton
                message={
                  d.batch
                    ? `Удалить документ «${d.title}»? Он относится ко всей партии ${batchName} и пропадёт на всех её закупках.`
                    : `Удалить документ «${d.title}»?`
                }
              />
            </form>
          )}
        </div>
      </div>
    );
  }
  const body = (e: Entry) => (e.type === "file" ? fileRow(e.d) : <DriveDocList key={e.d.view.id} docs={[e.d.view]} canEdit={canEdit} />);

  if (list.length === 0) return <p className="text-sm text-neutral-400">Документов пока нет</p>;
  return (
    <div className="flex flex-col gap-3">
      {list.map((g) =>
        g.length === 1 ? (
          <div key={g[0].type === "file" ? g[0].d.id : g[0].d.view.id}>{body(g[0])}</div>
        ) : (
          <details key={g[0].key} className="rounded-md border border-neutral-200 px-3 py-2">
            <summary className="cursor-pointer text-sm">
              <span className="font-medium">{g[0].title}</span>{" "}
              <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-600">×{g.length}</span>
              <span className="ml-2 text-xs text-neutral-500">один и тот же файл, показать все</span>
            </summary>
            <div className="mt-3 flex flex-col gap-3">
              {g.map((e) => (
                <div key={e.type === "file" ? e.d.id : e.d.view.id}>{body(e)}</div>
              ))}
            </div>
          </details>
        ),
      )}
    </div>
  );
}
