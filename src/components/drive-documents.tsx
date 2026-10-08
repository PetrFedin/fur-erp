"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { formatMb } from "@/lib/format-mb";
import { Button } from "@/components/ui/button";
import {
  addDriveDocument,
  removeDriveDocument,
  isDriveFileShared,
  removeDriveDocumentFile,
  uploadDriveDocument,
  uploadDriveDocumentFile,
  updateDriveDocument,
  type DriveDocState,
} from "@/app/(app)/drive-actions";
import { EditDialog, Field } from "@/components/edit-dialog";
import { DocFileButtons } from "@/components/doc-preview";
import { DRIVE_DOC_TYPES, DRIVE_DOC_TYPE_LABELS, guessDocType, safeViewUrl, type DriveDocView } from "@/lib/drive-docs";
import { copiesLabel, countLabel, docGroupKey, groupBy } from "@/lib/drive-docs-group";

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
  const groups = groupDocs(docs);
  return (
    <section className="flex flex-col gap-2" data-drive-docs>
      <h3 className="text-sm font-semibold text-neutral-800">
        {title} <span className="font-normal text-neutral-400">({countLabel(groups.length, docs.length)})</span>
      </h3>
      {docs.length > 0 ? (
        <GroupedItems groups={groups} canEdit={canEdit} />
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

/** «Загрузить файл» / «Заменить файл»: скрытый input type=file, после выбора файл сразу уходит на сервер. */
function FilePicker({ d, label, onError }: { d: DriveDocView; label: string; onError: (m: string | null) => void }) {
  const [pending, start] = useTransition();
  return (
    <label className={`relative overflow-hidden ${smallBtn} ${pending ? "opacity-50" : ""}`}>
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
          const bad = clientFileError(file);
          if (bad) {
            onError(bad);
            input.value = "";
            return;
          }
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

function DocItem({ d, canEdit, copies }: { d: DriveDocView; canEdit: boolean; copies?: DriveDocView[] }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const url = safeViewUrl(d.viewUrl);
  const date = fmtDate(d.docDate);
  // У свёрнутой группы правки — только внутри списка привязок (иначе непонятно, какую копию убираем).
  const editable = canEdit && d.canRemove !== false && !copies;
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
        {d.drivePath && <div className="break-all text-xs text-neutral-400">{d.drivePath}</div>}
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
        {canEdit && d.canRemove === false && (
          <span className="text-xs text-neutral-400">Управляют владелец и администратор</span>
        )}
        {editable && (
          <EditDialog
            title="Изменить документ"
            variant="ghost"
            className="h-8 px-2"
            action={(fd) => updateDriveDocument(d.id, fd)}
            version={d.version}
            hint="Название, тип, номер, дата и примечание. Сам файл заменяется кнопкой «Заменить файл». Подтверждение записи, к которой привязан документ, сбросится."
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
                  : d.hasFile && !url
                    ? `Удалить документ «${d.title}» вместе с загруженным файлом?`
                    : `Убрать ссылку «${d.title}»? Файл в Google Drive не удаляется${d.hasFile ? ", загруженный файл удалится из приложения" : ""}.`;
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
  const [docType, setDocType] = useState<string>("OTHER");
  const [typeTouched, setTypeTouched] = useState(false);
  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const files = fd.getAll("file").filter((f): f is File => f instanceof File && f.name !== "");
    if (files.length === 0) {
      setState({ error: "Выберите файл" });
      return;
    }
    if (files.length > 10) {
      setState({ error: `За один раз можно загрузить не больше 10 файлов (выбрано ${files.length})` });
      return;
    }
    for (const f of files) {
      const bad = clientFileError(f);
      if (bad) {
        setState({ error: bad });
        return;
      }
    }
    const title = String(fd.get("title") ?? "");
    setState({});
    start(async () => {
      const t = targets.find((x) => x.key === targetKey) ?? targets[0];
      const failed: string[] = [];
      let okCount = 0;
      for (const f of files) {
        const one = new FormData();
        one.set("file", f);
        // Название — только для одного файла; тип: выбранный вручную, иначе по имени файла.
        if (files.length === 1 && title) one.set("title", title);
        const type = typeTouched || docType !== "OTHER" ? docType : (guessDocType(f.name) ?? "OTHER");
        one.set("docType", type);
        try {
          const res = await uploadDriveDocument(t.entity, t.id, one);
          if (res?.ok) okCount++;
          else failed.push(`${f.name}: ${res?.error ?? "не загружен"}`);
        } catch {
          failed.push(`${f.name}: сервер отклонил запрос (возможно, файл слишком большой) или пропала связь`);
        }
      }
      if (failed.length === 0) {
        form.reset();
        setDocType("OTHER");
        setTypeTouched(false);
        setState({ ok: true, ...(okCount > 1 ? { count: okCount } : {}) } as DriveDocState);
      } else {
        setState({ error: `${okCount > 0 ? `Загружено ${okCount}, не загружено ${failed.length}: ` : ""}${failed.join("; ")}` });
      }
    });
  }
  return (
    <details className="rounded-md border border-dashed border-neutral-300 bg-neutral-50">
      <summary className="cursor-pointer px-3 py-2 text-sm text-neutral-700">{compact ? "+ Загрузить документ" : "+ Загрузить документ (файл)"}</summary>
      <form onSubmit={onSubmit} className="grid grid-cols-1 gap-2 border-t border-neutral-200 p-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-neutral-500 sm:col-span-2">
          Файлы (PDF, XLSX, DOCX, JPEG, PNG; до 25 МБ каждый, до 10 за раз)
          <input
            type="file"
            name="file"
            multiple
            required
            accept=".pdf,.xlsx,.docx,.jpg,.jpeg,.png"
            className="text-sm"
            onChange={(e) => {
              const fs = Array.from(e.currentTarget.files ?? []);
              if (fs.length === 1 && !typeTouched) setDocType(guessDocType(fs[0].name) ?? "OTHER");
            }}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-neutral-500">
          Название (необязательно — возьмём имя файла)
          <input name="title" maxLength={200} className={field} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-neutral-500">
          Тип
          <select name="docType" value={docType} onChange={(e) => { setDocType(e.target.value); setTypeTouched(true); }} className={field}>
            {DRIVE_DOC_TYPES.map((t) => (
              <option key={t} value={t}>
                {DRIVE_DOC_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
          <span className="text-[11px] text-neutral-400">Определяется по имени файла; для нескольких файлов — у каждого свой, если не выбран вручную</span>
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
          {state.ok && <span className="text-sm text-emerald-600">{(state as { count?: number }).count ? `Загружено файлов: ${(state as { count?: number }).count}` : "Загружено"}</span>}
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
