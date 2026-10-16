import { DriveDocList } from "@/components/drive-documents";
import { DocFileButtons } from "@/components/doc-preview";
import { ConfirmSubmitButton } from "./documents-form";
import { DOC_KIND_LABELS } from "@/lib/purchase-files";
import { formatDate } from "@/lib/utils";
import { storedFileExists } from "@/lib/stored-file-check";
import { deletePurchaseDocument } from "../doc-actions";
import type { DriveDocView } from "@/lib/drive-docs";
import { copiesLabel, docGroupKey, groupBy, matchDriveToFiles } from "@/lib/drive-docs-group";

export type FileDocRow = {
  id: string;
  title: string;
  kind: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: Date;
  batch: boolean;
  /** Путь файла в хранилище: по нему определяем, лежит ли файл на диске. */
  storagePath?: string;
  /** Документ прикреплён к лоту — управляется в карточке лота (первоисточник). */
  lotId?: string | null;
};
export type DriveDocRow = { view: DriveDocView; fileId: string; createdAt: Date };

type Entry =
  | { type: "file"; key: string; sort: number; title: string; d: FileDocRow }
  | { type: "drive"; key: string; sort: number; title: string; d: DriveDocRow }
  | { type: "pair"; key: string; sort: number; title: string; d: FileDocRow; drives: DriveDocRow[] };

/**
 * Записи документов закупки в группы: пара «прикреплённый файл + запись документа» одного файла — одна строка,
 * повторы (название без «(1)»/«копия»/расширения + тип + размер) — одной группой «×N».
 */
export function buildDocGroups(files: FileDocRow[], drives: DriveDocRow[]): Entry[][] {
  const matched = matchDriveToFiles(
    files.map((f) => ({ names: [f.originalName, f.title], size: f.sizeBytes })),
    drives.map((d) => ({ titles: [d.view.title, d.view.storedName ?? ""], size: d.view.storedSize })),
  );
  const usedDrive = new Set<number>();
  const entries: Entry[] = [];
  files.forEach((f, fi) => {
    const mine = matched[fi].map((i) => drives[i]);
    matched[fi].forEach((i) => usedDrive.add(i));
    const key = docGroupKey(f.originalName || f.title, f.kind, f.sizeBytes);
    if (mine.length > 0) {
      entries.push({ type: "pair", key: `p|${key}`, sort: f.createdAt.getTime(), title: f.title, d: f, drives: mine });
    } else {
      entries.push({ type: "file", key: `f|${key}`, sort: f.createdAt.getTime(), title: f.title, d: f });
    }
  });
  drives.forEach((d, i) => {
    if (usedDrive.has(i)) return;
    entries.push({
      type: "drive",
      key: `d|${docGroupKey(d.view.title, d.view.docType, d.view.storedSize)}`,
      sort: d.view.docDate ? Date.parse(d.view.docDate) : d.createdAt.getTime(),
      title: d.view.title,
      d,
    });
  });
  return groupBy(entries, (e) => e.key).sort((x, y) => x[0].sort - y[0].sort);
}

const entryId = (e: Entry) => (e.type === "drive" ? e.d.view.id : e.d.id);

/** Один блок «Документы»: файлы закупки/партии и привязанные документы вместе, повторы — одной строкой «×N». */
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
  const list = buildDocGroups(files, drives);

  function fileRow(d: FileDocRow, drive?: DriveDocRow[]) {
    const stored = d.storagePath === undefined || storedFileExists(d.storagePath);
    return (
      <div key={d.id} className="flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <div className="min-w-0">
          {stored ? (
            <a href={`/api/purchase-docs/${d.id}`} target="_blank" rel="noreferrer" className="break-words font-medium hover:underline">
              {d.title}
            </a>
          ) : (
            <span className="break-words font-medium">{d.title}</span>
          )}
          <span className="ml-2 text-xs text-neutral-500">
            {DOC_KIND_LABELS[d.kind as keyof typeof DOC_KIND_LABELS]}
            {d.batch ? ` · вся партия ${batchName}` : d.lotId ? "" : " · эта закупка"} · {formatDate(d.createdAt)}
            {d.lotId ? <> · <a href={`/analytics/raw/lot/${d.lotId}`} className="text-blue-700 hover:underline">документ лота — править в карточке лота</a></> : null}
          </span>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {stored ? <DocFileButtons href={`/api/purchase-docs/${d.id}`} mime={d.mimeType} title={d.title} /> : <span className="text-xs text-neutral-500">Не прикреплён</span>}
          {canEdit && !d.lotId && (
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
  const body = (e: Entry) =>
    e.type === "file" ? (
      fileRow(e.d)
    ) : e.type === "pair" ? (
      <div className="flex flex-col gap-1">
        {fileRow(e.d, e.drives)}
        {canEdit && e.drives.some((x) => x.view.canRemove !== false) && (
          <details className="text-xs text-neutral-500">
            <summary className="cursor-pointer">Повторные записи документа (убрать)</summary>
            <div className="mt-1">
              <DriveDocList docs={e.drives.map((x) => x.view)} canEdit={canEdit} />
            </div>
          </details>
        )}
      </div>
    ) : (
      <DriveDocList key={e.d.view.id} docs={[e.d.view]} canEdit={canEdit} />
    );

  if (list.length === 0) return <p className="text-sm text-neutral-500">Документов пока нет</p>;
  return (
    <div className="flex flex-col gap-3">
      {list.map((g) =>
        g.length === 1 ? (
          <div key={entryId(g[0])}>{body(g[0])}</div>
        ) : (
          <details key={g[0].key} className="rounded-md border border-neutral-200 px-3 py-2">
            <summary className="cursor-pointer text-sm">
              <span className="font-medium">{g[0].title}</span>{" "}
              <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-600">{copiesLabel(g.length)}</span>
              <span className="ml-2 text-xs text-neutral-500">один и тот же файл — показать все привязки</span>
            </summary>
            <div className="mt-3 flex flex-col gap-3">
              {g.map((e) => (
                <div key={entryId(e)}>{body(e)}</div>
              ))}
            </div>
          </details>
        ),
      )}
    </div>
  );
}
