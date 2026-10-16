"use client";

import { useRef, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { formatMb } from "@/lib/format-mb";
import { Button } from "@/components/ui/button";
import {
  removeDriveDocument,
  isDriveFileShared,
  removeDriveDocumentFile,
  updateDriveDocument,
  uploadDriveDocumentFile,
} from "@/app/(app)/drive-actions";
import { EditDialog, Field } from "@/components/edit-dialog";
import { DocFileButtons } from "@/components/doc-preview";
import { DRIVE_DOC_TYPES, DRIVE_DOC_TYPE_LABELS, type DriveDocView } from "@/lib/drive-docs";
import { stripServiceTags } from "@/lib/note-tags";
import { copiesLabel, countLabel, docGroupKey, groupBy } from "@/lib/drive-docs-group";

const field = "h-9 rounded-md border border-neutral-300 bg-white px-2 text-sm shadow-sm";

function fmtDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("ru-RU", { timeZone: "UTC" });
}

/** Список документов. */
export function DriveDocuments({
  docs,
  canEdit,
  title = "Документы",
}: {
  docs: DriveDocView[];
  entity: "purchase" | "order" | "batch";
  entityId: string;
  canEdit: boolean;
  /** Для режима «Аукцион»: на какую закупку вешать ссылку (entityId — значение по умолчанию). */
  options?: { id: string; label: string }[];
  /** Оплаты, к которым тоже можно приложить документ (только для тех, у кого есть право). */
  extraTargets?: { entity: "payment" | "productionPayment"; id: string; label: string }[];
  title?: string;
}) {
  const groups = groupDocs(docs);
  return (
    <section className="flex flex-col gap-2" data-drive-docs>
      <h3 className="block-title">
        {title} <span className="font-normal text-neutral-500">({countLabel(groups.length, docs.length)})</span>
      </h3>
      {docs.length > 0 ? (
        <GroupedItems groups={groups} canEdit={canEdit} />
      ) : (
        <p className="text-sm text-neutral-500">Документов пока нет</p>
      )}
    </section>
  );
}

/** Список документов без формы добавления. canEdit включает «Убрать» (если у документа canRemove не false). */
export function DriveDocList({ docs, canEdit = false }: { docs: DriveDocView[]; canEdit?: boolean }) {
  if (docs.length === 0) return <p className="text-sm text-neutral-500">Документов нет</p>;
  return <GroupedItems groups={groupDocs(docs)} canEdit={canEdit} />;
}

/** Повторы (то же название без «(1)»/«копия»/расширения + тип + размер) — одной группой. */
function groupDocs(docs: DriveDocView[]): DriveDocView[][] {
  return groupBy(docs, (d) => docGroupKey(d.title, d.docType, d.storedSize));
}

function GroupedItems({ groups, canEdit }: { groups: DriveDocView[][]; canEdit: boolean }) {
  return (
    <ul className="flex flex-col divide-y divide-neutral-100 rounded-md border border-neutral-200 bg-white">
      {groups.map((g) => (
        <DocItem key={g[0].id} d={g[0]} canEdit={canEdit} copies={g.length > 1 ? g : undefined} />
      ))}
    </ul>
  );
}

function fmtSize(n: number | null | undefined): string {
  if (!n) return "";
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} МБ` : `${Math.max(1, Math.round(n / 1024))} КБ`;
}

/** Проверка файла до отправки: пустой, больше 25 МБ, HEIC (айфон) — с понятным объяснением, что делать. */
export function clientFileError(file: File): string | null {
  if (/\.(heic|heif)$/i.test(file.name) || /^image\/hei[cf]/i.test(file.type)) {
    return `Файл «${file.name}» в формате HEIC (фото с iPhone) — приложение его не принимает. Сохраните как JPEG (на iPhone: Настройки → Камера → Форматы → «Наиболее совместимый») или отправьте фото как PDF.`;
  }
  if (file.size === 0) return `Файл «${file.name}» пустой (0 байт)`;
  if (file.size > 25 * 1024 * 1024) return `Файл «${file.name}» больше 25 МБ (${formatMb(file.size)} МБ)`;
  return null;
}

const smallBtn =
  "inline-flex h-8 cursor-pointer items-center rounded-md px-2 text-sm text-neutral-600 hover:bg-neutral-100";

function DocItem({ d, canEdit, copies }: { d: DriveDocView; canEdit: boolean; copies?: DriveDocView[] }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Признак нужен для подтверждений: у заранее созданной записи файл можно удалить, запись («не прикреплён») останется.
  const keepsRecord = !!d.keepsRecord;
  const date = fmtDate(d.docDate);
  // У свёрнутой группы правки — только внутри списка привязок (иначе непонятно, какую копию убираем).
  const editable = canEdit && d.canRemove !== false && !copies;
  const fileHref = `/api/drive-docs/${d.id}`;
  return (
    <li className="flex flex-col gap-2 px-3 py-2 text-sm sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium break-words">{stripServiceTags(d.title)}</span>
          <Badge>{DRIVE_DOC_TYPE_LABELS[d.docType]}</Badge>
          {d.hasFile ? <Badge variant="success">Прикреплён</Badge> : <Badge variant="warning">Не прикреплён</Badge>}
          {date && <span className="text-xs text-neutral-500">{date}</span>}
          {d.docNumber && <span className="text-xs text-neutral-500">№ {d.docNumber}</span>}
          {d.scope && !copies && <span className="text-xs text-neutral-500">· {d.scope}</span>}
          {copies && (
            <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-600" title="Один и тот же файл привязан несколько раз">
              {copiesLabel(copies.length)}
            </span>
          )}
        </div>
        {d.hasFile && (d.storedName || d.storedSize) && (
          <div className="break-all text-xs text-neutral-500">
            {d.storedName}
            {d.storedSize ? ` · ${fmtSize(d.storedSize)}` : ""}
          </div>
        )}
        {err && <div className="text-xs text-red-600">{err}</div>}
        {copies && (
          <details className="mt-1">
            <summary className="cursor-pointer text-xs text-neutral-500">Показать все привязки ({copies.length})</summary>
            <ul className="mt-2 flex flex-col divide-y divide-neutral-100 rounded-md border border-neutral-200 bg-white">
              {copies.map((c) => (
                <DocItem key={c.id} d={c} canEdit={canEdit} />
              ))}
            </ul>
          </details>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {d.hasFile ? (
          <>
            <DocFileButtons href={fileHref} mime={d.storedMime} title={d.title} />
            {editable && keepsRecord && (
              <button
                type="button"
                className={smallBtn}
                disabled={pending}
                onClick={() => {
                  if (!window.confirm(`Удалить прикреплённый файл «${stripServiceTags(d.title)}»? Запись документа останется («не прикреплён»).`)) return;
                  start(async () => {
                    const res = await removeDriveDocumentFile(d.id);
                    setErr(res?.error ?? null);
                  });
                }}
              >
                Удалить файл
              </button>
            )}
          </>
        ) : (
          <>
            <span className="text-xs text-neutral-500">Не прикреплён</span>
            {editable && (
              <>
                <input
                  ref={fileRef}
                  type="file"
                  hidden
                  accept=".pdf,.xlsx,.docx,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file) return;
                    const bad = clientFileError(file);
                    if (bad) return void setErr(bad);
                    const fd = new FormData();
                    fd.set("file", file);
                    start(async () => {
                      const res = await uploadDriveDocumentFile(d.id, fd).catch(() => ({ error: "Не удалось прикрепить файл: сервер отклонил запрос или пропала связь" }));
                      setErr(res?.error ?? null);
                    });
                  }}
                />
                <button type="button" className={smallBtn} disabled={pending} onClick={() => fileRef.current?.click()}>
                  Прикрепить
                </button>
              </>
            )}
          </>
        )}
        {canEdit && d.canRemove === false && (
          <span className="text-xs text-neutral-500">Управляют владелец и администратор</span>
        )}
        {editable && (
          <EditDialog
            title="Изменить документ"
            variant="ghost"
            className="h-8 px-2"
            action={(fd) => updateDriveDocument(d.id, fd)}
            version={d.version}
            hint="Название, тип, номер, дата и примечание. Подтверждение записи, к которой привязан документ, сбросится."
          >
            <Field label="Название" wide>
              <input name="title" defaultValue={d.title} maxLength={200} required className={field} />
            </Field>
            <Field label="Тип документа">
              <select name="docType" defaultValue={d.docType} className={field}>
                {DRIVE_DOC_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {DRIVE_DOC_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Номер документа">
              <input name="docNumber" defaultValue={d.docNumber ?? ""} maxLength={100} className={field} />
            </Field>
            <Field label="Дата документа">
              <input name="docDate" type="date" defaultValue={d.docDate ? d.docDate.slice(0, 10) : ""} className={field} />
            </Field>
            <Field label="Примечание" wide>
              <input name="notes" defaultValue={d.notes ?? ""} maxLength={1000} className={field} />
            </Field>
          </EditDialog>
        )}
        {editable && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => {
              start(async () => {
                const shared = d.hasFile ? await isDriveFileShared(d.id).catch(() => false) : false;
                const msg = shared
                  ? "Запись будет удалена; файл останется, пока на него ссылаются другие документы"
                  : d.hasFile
                    ? `Убрать документ «${stripServiceTags(d.title)}» вместе с прикреплённым файлом?`
                    : `Убрать документ «${stripServiceTags(d.title)}»?`;
                if (!window.confirm(msg)) return;
                const res = await removeDriveDocument(d.id);
                setErr(res?.error ?? null);
              });
            }}
          >
            Убрать
          </Button>
        )}
      </div>
    </li>
  );
}
