"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { addDriveDocument, removeDriveDocument, type DriveDocState } from "@/app/(app)/drive-actions";
import { DRIVE_DOC_TYPES, DRIVE_DOC_TYPE_LABELS, safeViewUrl, type DriveDocView } from "@/lib/drive-docs";

const field = "h-9 rounded-md border border-neutral-300 bg-white px-2 text-sm shadow-sm";

function fmtDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("ru-RU", { timeZone: "UTC" });
}

/** Список документов Google Drive (+ форма добавления ссылки, если canEdit). entity/entityId — к чему привязывать. */
export function DriveDocuments({
  docs,
  entity,
  entityId,
  canEdit,
  options,
  title = "Документы Google Drive",
}: {
  docs: DriveDocView[];
  entity: "purchase" | "order" | "batch";
  entityId: string;
  canEdit: boolean;
  /** Для режима «Аукцион»: на какую закупку вешать ссылку (entityId — значение по умолчанию). */
  options?: { id: string; label: string }[];
  title?: string;
}) {
  return (
    <section className="flex flex-col gap-2" data-drive-docs>
      <h3 className="text-sm font-semibold text-neutral-800">
        {title} <span className="font-normal text-neutral-400">({docs.length})</span>
      </h3>
      {docs.length > 0 ? (
        <ul className="flex flex-col divide-y divide-neutral-100 rounded-md border border-neutral-200 bg-white">
          {docs.map((d) => (
            <DocItem key={d.id} d={d} canEdit={canEdit} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-neutral-400">Документов Google Drive пока нет</p>
      )}
      {canEdit && <AddForm entity={entity} entityId={entityId} options={options} />}
    </section>
  );
}

export function DriveDocList({ docs }: { docs: DriveDocView[] }) {
  if (docs.length === 0) return <p className="text-sm text-neutral-400">Документов нет</p>;
  return (
    <ul className="flex flex-col divide-y divide-neutral-100 rounded-md border border-neutral-200 bg-white">
      {docs.map((d) => (
        <DocItem key={d.id} d={d} canEdit={false} />
      ))}
    </ul>
  );
}

function DocItem({ d, canEdit }: { d: DriveDocView; canEdit: boolean }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const url = safeViewUrl(d.viewUrl);
  const date = fmtDate(d.docDate);
  return (
    <li className="flex flex-col gap-1 px-3 py-2 text-sm sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium break-words">{d.title}</span>
          <Badge>{DRIVE_DOC_TYPE_LABELS[d.docType]}</Badge>
          {date && <span className="text-xs text-neutral-500">{date}</span>}
          {d.docNumber && <span className="text-xs text-neutral-500">№ {d.docNumber}</span>}
          {d.scope && <span className="text-xs text-neutral-500">· {d.scope}</span>}
        </div>
        {d.drivePath && <div className="break-all text-xs text-neutral-400">{d.drivePath}</div>}
        {err && <div className="text-xs text-red-600">{err}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {url ? (
          <a href={url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
            Открыть в Drive
          </a>
        ) : (
          <span className="text-xs text-neutral-400">нет ссылки</span>
        )}
        {canEdit && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => {
              if (!window.confirm(`Убрать ссылку «${d.title}»? Файл в Google Drive не удаляется.`)) return;
              start(async () => {
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

function AddForm({
  entity,
  entityId,
  options,
}: {
  entity: "purchase" | "order" | "batch";
  entityId: string;
  options?: { id: string; label: string }[];
}) {
  const [state, setState] = useState<DriveDocState>({});
  const [pending, start] = useTransition();
  const [target, setTarget] = useState(entityId);
  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    setState({});
    start(async () => {
      try {
        const res = await addDriveDocument(entity, target, {}, fd);
        setState(res ?? {});
        if (res?.ok) form.reset();
      } catch {
        setState({ error: "Не удалось сохранить ссылку: ошибка сервера или связи. Попробуйте ещё раз." });
      }
    });
  }
  return (
    <details className="rounded-md border border-dashed border-neutral-300 bg-neutral-50">
      <summary className="cursor-pointer px-3 py-2 text-sm text-neutral-700">+ Добавить ссылку на Drive</summary>
      <form onSubmit={onSubmit} className="grid grid-cols-1 gap-2 border-t border-neutral-200 p-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-neutral-500 sm:col-span-2">
          Ссылка на Drive
          <input name="link" required placeholder="https://drive.google.com/file/d/…" className={field} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-neutral-500">
          Название
          <input name="title" required maxLength={200} className={field} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-neutral-500">
          Тип
          <select name="docType" defaultValue="OTHER" className={field}>
            {DRIVE_DOC_TYPES.map((t) => (
              <option key={t} value={t}>
                {DRIVE_DOC_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-neutral-500">
          Дата документа (необязательно)
          <input type="date" name="docDate" className={field} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-neutral-500">
          Номер (необязательно)
          <input name="docNumber" maxLength={100} className={field} />
        </label>
        {options && options.length > 1 && (
          <label className="flex flex-col gap-1 text-xs text-neutral-500 sm:col-span-2">
            Привязать к закупке
            <select value={target} onChange={(e) => setTarget(e.target.value)} className={field}>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="flex items-center gap-3 sm:col-span-2">
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Сохраняем…" : "Добавить"}
          </Button>
          {state.error && <span className="text-sm text-red-600">{state.error}</span>}
          {state.ok && <span className="text-sm text-emerald-600">Добавлено</span>}
        </div>
      </form>
    </details>
  );
}
