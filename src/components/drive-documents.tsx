"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  addDriveDocument,
  removeDriveDocument,
  removeDriveDocumentFile,
  uploadDriveDocument,
  uploadDriveDocumentFile,
  type DriveDocState,
} from "@/app/(app)/drive-actions";
import { DocFileButtons } from "@/components/doc-preview";
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
  extraTargets,
  title = "Документы Google Drive",
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
      {canEdit && <UploadDocument entity={entity} entityId={entityId} options={options} extraTargets={extraTargets} />}
      {canEdit && <AddForm entity={entity} entityId={entityId} options={options} />}
    </section>
  );
}

/** Список документов без формы добавления. canEdit включает «Загрузить файл» / «Убрать» (если у документа canRemove не false). */
export function DriveDocList({ docs, canEdit = false }: { docs: DriveDocView[]; canEdit?: boolean }) {
  if (docs.length === 0) return <p className="text-sm text-neutral-400">Документов нет</p>;
  return (
    <ul className="flex flex-col divide-y divide-neutral-100 rounded-md border border-neutral-200 bg-white">
      {docs.map((d) => (
        <DocItem key={d.id} d={d} canEdit={canEdit} />
      ))}
    </ul>
  );
}

function fmtSize(n: number | null | undefined): string {
  if (!n) return "";
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} МБ` : `${Math.max(1, Math.round(n / 1024))} КБ`;
}

const smallBtn =
  "inline-flex h-8 cursor-pointer items-center rounded-md px-2 text-sm text-neutral-600 hover:bg-neutral-100";

/** «Загрузить файл» / «Заменить файл»: скрытый input type=file, после выбора файл сразу уходит на сервер. */
function FilePicker({ d, label, onError }: { d: DriveDocView; label: string; onError: (m: string | null) => void }) {
  const [pending, start] = useTransition();
  return (
    <label className={`${smallBtn} ${pending ? "opacity-50" : ""}`}>
      {pending ? "Загружаем…" : label}
      <input
        type="file"
        accept=".pdf,.xlsx,.docx,.jpg,.jpeg,.png"
        className="sr-only"
        disabled={pending}
        onChange={(e) => {
          const input = e.currentTarget;
          const file = input.files?.[0];
          if (!file) return;
          const fd = new FormData();
          fd.set("file", file);
          onError(null);
          start(async () => {
            try {
              const res = await uploadDriveDocumentFile(d.id, fd);
              onError(res?.error ?? null);
            } catch {
              onError("Не удалось загрузить файл: сервер отклонил запрос (возможно, файл слишком большой) или пропала связь.");
            }
            input.value = "";
          });
        }}
      />
    </label>
  );
}

function DocItem({ d, canEdit }: { d: DriveDocView; canEdit: boolean }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const url = safeViewUrl(d.viewUrl);
  const date = fmtDate(d.docDate);
  const editable = canEdit && d.canRemove !== false;
  const fileHref = `/api/drive-docs/${d.id}`;
  return (
    <li className="flex flex-col gap-2 px-3 py-2 text-sm sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium break-words">{d.title}</span>
          <Badge>{DRIVE_DOC_TYPE_LABELS[d.docType]}</Badge>
          {d.hasFile && <Badge variant="success">Файл в приложении</Badge>}
          {date && <span className="text-xs text-neutral-500">{date}</span>}
          {d.docNumber && <span className="text-xs text-neutral-500">№ {d.docNumber}</span>}
          {d.scope && <span className="text-xs text-neutral-500">· {d.scope}</span>}
        </div>
        {d.hasFile && (d.storedName || d.storedSize) && (
          <div className="break-all text-xs text-neutral-500">
            {d.storedName}
            {d.storedSize ? ` · ${fmtSize(d.storedSize)}` : ""}
          </div>
        )}
        {d.drivePath && <div className="break-all text-xs text-neutral-400">{d.drivePath}</div>}
        {err && <div className="text-xs text-red-600">{err}</div>}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {d.hasFile ? (
          <>
            <DocFileButtons href={fileHref} mime={d.storedMime} title={d.title} />
            {url && (
              <a href={url} target="_blank" rel="noreferrer" className="text-xs text-blue-600 hover:underline">
                в Drive
              </a>
            )}
            {editable && <FilePicker d={d} label="Заменить файл" onError={setErr} />}
            {editable && url && (
              <button
                type="button"
                className={smallBtn}
                disabled={pending}
                onClick={() => {
                  if (!window.confirm(`Удалить файл «${d.title}» из приложения? Ссылка на Drive останется.`)) return;
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
            {url ? (
              <a href={url} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center rounded-md bg-neutral-900 px-3 text-sm font-medium text-white hover:bg-neutral-700">
                Открыть в Drive
              </a>
            ) : (
              <span className="text-xs text-neutral-400">нет ссылки</span>
            )}
            {editable && <FilePicker d={d} label="Загрузить файл" onError={setErr} />}
          </>
        )}
        {editable && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => {
              const msg = d.hasFile && !url
                ? `Удалить документ «${d.title}» вместе с загруженным файлом?`
                : `Убрать ссылку «${d.title}»? Файл в Google Drive не удаляется${d.hasFile ? ", загруженный файл удалится из приложения" : ""}.`;
              if (!window.confirm(msg)) return;
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

type UploadEntity = "purchase" | "order" | "batch" | "payment" | "productionPayment";

/** «Загрузить документ»: файл + название + тип, без ссылки на Drive. */
export function UploadDocument({
  entity,
  entityId,
  options,
  extraTargets,
  compact = false,
}: {
  entity: UploadEntity;
  entityId: string;
  /** Для режима «Аукцион»: на какую закупку вешать документ. */
  options?: { id: string; label: string }[];
  /** Другие объекты, к которым можно привязать документ (оплаты). */
  extraTargets?: { entity: UploadEntity; id: string; label: string }[];
  compact?: boolean;
}) {
  const [state, setState] = useState<DriveDocState>({});
  const [pending, start] = useTransition();
  const targets: { key: string; entity: UploadEntity; id: string; label: string }[] = [
    ...(options && options.length > 1
      ? options.map((o) => ({ key: `${entity}:${o.id}`, entity, id: o.id, label: o.label }))
      : [{ key: `${entity}:${entityId}`, entity, id: entityId, label: entity === "purchase" ? "Эта закупка" : entity === "order" ? "Это ТЗ" : entity === "batch" ? "Эта партия" : "Эта оплата" }]),
    ...(extraTargets ?? []).map((t) => ({ key: `${t.entity}:${t.id}`, ...t })),
  ];
  const [targetKey, setTargetKey] = useState(`${entity}:${entityId}`);
  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const f = fd.get("file");
    if (f instanceof File && f.size > 25 * 1024 * 1024) {
      setState({ error: `Файл больше 25 МБ (${(f.size / 1024 / 1024).toFixed(1).replace(".", ",")} МБ)` });
      return;
    }
    setState({});
    start(async () => {
      try {
        const t = targets.find((x) => x.key === targetKey) ?? targets[0];
        const res = await uploadDriveDocument(t.entity, t.id, fd);
        setState(res ?? {});
        if (res?.ok) form.reset();
      } catch {
        setState({ error: "Не удалось загрузить файл: сервер отклонил запрос (возможно, файл слишком большой) или пропала связь." });
      }
    });
  }
  return (
    <details className="rounded-md border border-dashed border-neutral-300 bg-neutral-50">
      <summary className="cursor-pointer px-3 py-2 text-sm text-neutral-700">{compact ? "+ Загрузить документ" : "+ Загрузить документ (файл)"}</summary>
      <form onSubmit={onSubmit} className="grid grid-cols-1 gap-2 border-t border-neutral-200 p-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-neutral-500 sm:col-span-2">
          Файл (PDF, XLSX, DOCX, JPEG, PNG; до 25 МБ)
          <input type="file" name="file" required accept=".pdf,.xlsx,.docx,.jpg,.jpeg,.png" className="text-sm" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-neutral-500">
          Название (необязательно — возьмём имя файла)
          <input name="title" maxLength={200} className={field} />
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
        {targets.length > 1 && (
          <label className="flex flex-col gap-1 text-xs text-neutral-500 sm:col-span-2">
            Привязать к
            <select value={targetKey} onChange={(e) => setTargetKey(e.target.value)} className={field}>
              {targets.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="flex items-center gap-3 sm:col-span-2">
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Загружаем…" : "Загрузить"}
          </Button>
          {state.error && <span className="text-sm text-red-600">{state.error}</span>}
          {state.ok && <span className="text-sm text-emerald-600">Загружено</span>}
        </div>
      </form>
    </details>
  );
}

export function AddForm({
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
