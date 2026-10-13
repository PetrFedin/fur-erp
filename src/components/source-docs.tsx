"use client";

import { useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/confirm-dialog";
import { clientFileError } from "@/components/drive-documents";
import { cn } from "@/lib/utils";
import { DRIVE_DOC_TYPES, DRIVE_DOC_TYPE_LABELS, type DriveDocTypeKey } from "@/lib/drive-docs";
import { sourceDocsSummary, type SourceDocFile, type SourceDocRow, type SourceDocsData, type SourceTarget } from "@/lib/source-docs";
import type { UploadTarget } from "@/lib/doc-panel";
import { uploadDriveDocument, uploadDriveDocumentFile, removeDriveDocument, removeDriveDocumentFile } from "@/app/(app)/drive-actions";
import { replacePurchaseDocument, deletePurchaseDocument, uploadPurchaseDocuments } from "@/app/(app)/purchases/doc-actions";

type Res = { error?: string; ok?: boolean } | void | undefined;

/** Общая обвязка действий над файлами: индикатор, сообщение об ошибке, обновление страницы после успеха. */
function useRun() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(fn: () => Promise<Res>) {
    setPending(true);
    setError(null);
    try {
      const r = await fn();
      if (r && r.error) setError(r.error);
      else router.refresh();
    } catch {
      setError("Не удалось выполнить действие: сервер отклонил запрос (возможно, файл слишком большой) или пропала связь.");
    }
    setPending(false);
  }
  return { pending, error, setError, run };
}

const smallBtn = "btn-accent h-8 px-2.5 text-xs";

/** Скрытое поле выбора файла + кнопка, которая его открывает. onFile вызывается после проверки типа и размера. */
function FilePick({
  label,
  disabled,
  onFile,
  onInvalid,
  variant = "outline",
  className,
  title,
}: {
  label: string;
  disabled?: boolean;
  onFile: (f: File) => void;
  onInvalid: (msg: string) => void;
  variant?: "outline" | "ghost" | "default";
  className?: string;
  title?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        hidden
        accept=".pdf,.xlsx,.docx,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          const bad = clientFileError(f);
          if (bad) onInvalid(bad);
          else onFile(f);
        }}
      />
      <Button type="button" size="sm" variant={variant} disabled={disabled} className={cn(smallBtn, className)} title={title} onClick={() => ref.current?.click()}>
        {label}
      </Button>
    </>
  );
}

function FileLine({ f, canEdit, target, onDone }: { f: SourceDocFile; canEdit: boolean; target: SourceTarget; onDone?: () => void }) {
  const { pending, error, setError, run } = useRun();
  const { ask, node } = useConfirm();
  const sep = f.href.includes("?") ? "&" : "?";
  return (
    <li className="flex flex-col gap-1 text-xs">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="min-w-0 break-words font-medium text-neutral-800" title={f.meta}>{f.title}</span>
        <a href={f.href} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline">Открыть</a>
        <a href={`${f.href}${sep}download=1`} download className="text-blue-700 hover:underline">Скачать</a>
        {canEdit && (
          <>
            <FilePick
              label="Заменить"
              variant="ghost"
              disabled={pending}
              className="h-7 px-2"
              onInvalid={setError}
              onFile={async (file) => {
                if (!(await ask(<>Заменить файл «{f.title}» файлом «{file.name}»? Прежний файл будет удалён.</>, { ok: "Заменить", danger: true }))) return;
                const fd = new FormData();
                fd.set("file", file);
                await run(() => (f.src === "drive" ? uploadDriveDocumentFile(f.id, fd) : replacePurchaseDocument(f.id, fd)));
                onDone?.();
              }}
            />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={pending}
              className="h-7 px-2 text-xs text-red-700"
              onClick={async () => {
                const keepsRecord = f.src === "drive" && f.hasLink;
                const msg = keepsRecord
                  ? <>Удалить загруженный файл «{f.title}»? Запись о документе останется, строка снова станет «нужно загрузить».</>
                  : <>Удалить документ «{f.title}» вместе с файлом? Это нельзя отменить.</>;
                if (!(await ask(msg, { ok: "Удалить", danger: true }))) return;
                await run(() => (f.src === "drive" ? (keepsRecord ? removeDriveDocumentFile(f.id) : removeDriveDocument(f.id)) : deletePurchaseDocument(target.id, f.id)));
              }}
            >
              Удалить файл
            </Button>
          </>
        )}
      </div>
      {error && <span role="alert" className="text-xs text-red-600">{error}</span>}
      {node}
    </li>
  );
}

function Row({ row }: { row: SourceDocRow }) {
  const { pending, error, setError, run } = useRun();
  const loaded = row.files.length > 0;
  const mark = loaded ? "✓" : "✗";
  const status = loaded ? "загружен" : row.linkId ? "нужно загрузить файл (запись есть, файла нет)" : row.expected ? "нужно загрузить" : "";
  return (
    <li className={cn("flex flex-col gap-1.5 rounded-md border px-3 py-2 text-sm", loaded || !row.expected ? "border-neutral-200 bg-white" : "border-amber-300 bg-amber-50")}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className={cn("text-base font-bold leading-none", loaded ? "text-emerald-700" : "text-amber-700")} aria-hidden>{row.expected || loaded ? mark : "○"}</span>
        <span className="min-w-0 break-words font-medium">{row.label}</span>
        {status && <span className={cn("text-xs", loaded ? "text-emerald-700" : "font-semibold text-amber-800")}>{status}</span>}
        <span className="basis-full text-xs text-neutral-500 sm:basis-auto">{row.origin}</span>
      </div>
      {loaded && (
        <ul className="flex flex-col gap-1.5 pl-5">
          {row.files.map((f, i) => (
            <FileLine key={`${f.src}:${f.id}:${i}`} f={f} canEdit={row.canUpload} target={row.target} />
          ))}
        </ul>
      )}
      {!loaded && row.expected && row.canUpload && (
        <div className="flex flex-wrap items-center gap-2 pl-5">
          <FilePick
            label="Загрузить документ"
            disabled={pending}
            onInvalid={setError}
            title={`Загрузить файл: ${row.label}`}
            onFile={(file) => {
              const fd = new FormData();
              fd.set("file", file);
              if (row.linkId) return void run(() => uploadDriveDocumentFile(row.linkId!, fd));
              fd.set("title", row.label);
              fd.set("docType", row.docType);
              if (row.number) fd.set("docNumber", row.number);
              if (row.date) fd.set("docDate", row.date);
              void run(() => uploadDriveDocument(row.target.entity, row.target.id, fd));
            }}
          />
          {pending && <span className="text-xs text-neutral-500">Загружаем…</span>}
        </div>
      )}
      {!loaded && row.expected && !row.canUpload && <p className="pl-5 text-xs text-neutral-500">Загружают роли, которые ведут эту запись.</p>}
      {error && <p role="alert" className="pl-5 text-xs text-red-600">{error}</p>}
    </li>
  );
}

/** Загрузка документа «вообще»: тип, необязательный номер — и файл. Привязка — к записи, на которой стоит блок. */
function GeneralUpload({ target }: { target: SourceTarget }) {
  const { pending, error, setError, run } = useRun();
  const [type, setType] = useState<DriveDocTypeKey>("UPD");
  const [number, setNumber] = useState("");
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-dashed border-neutral-300 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-neutral-600">Другой документ:</span>
        <select value={type} onChange={(e) => setType(e.target.value as DriveDocTypeKey)} className="ui-field h-8 rounded-md border border-neutral-300 bg-white px-2 text-xs" aria-label="Тип документа">
          {DRIVE_DOC_TYPES.map((t) => (
            <option key={t} value={t}>{DRIVE_DOC_TYPE_LABELS[t]}</option>
          ))}
        </select>
        <input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="№ (необязательно)" maxLength={100} className="ui-field h-8 w-36 rounded-md border border-neutral-300 bg-white px-2 text-xs" aria-label="Номер документа" />
        <FilePick
          label="Загрузить документ"
          disabled={pending}
          onInvalid={setError}
          onFile={(file) => {
            const fd = new FormData();
            fd.set("file", file);
            fd.set("docType", type);
            if (number.trim()) {
              fd.set("docNumber", number.trim());
              fd.set("title", `${DRIVE_DOC_TYPE_LABELS[type]} №${number.trim()}`);
            }
            void run(async () => {
              const r = await uploadDriveDocument(target.entity, target.id, fd);
              if (!r?.error) setNumber("");
              return r;
            });
          }}
        />
        {pending && <span className="text-xs text-neutral-500">Загружаем…</span>}
      </div>
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

/**
 * «Документы-основания»: свёрнутая строка «Документы-основания · 2 из 3 загружено ›». Внутри — документы, названные в данных
 * (УПД №…, счёт №…, спецификация №…, платёжка…), у каждого: загружен / нужно загрузить, открыть, скачать, заменить, «Загрузить документ».
 * Содержимое документов не показывается. Данные готовят loadPurchaseSourceDocs / loadBatchSourceDocs / loadOrderSourceDocs /
 * loadPaymentsSourceDocs / loadPurchasesSourceDocs из src/lib/source-docs-server.ts.
 */
export function SourceDocs({
  data,
  title = "Документы-основания",
  compact = false,
  popover = "left",
  footer,
}: {
  data: SourceDocsData;
  title?: string;
  /** Для строк таблиц: короткий заголовок «1 из 2 ›» без слов «Документы-основания». */
  compact?: boolean;
  /** Для compact: раскрытый список всплывает над таблицей и выравнивается по левому или правому краю ячейки. */
  popover?: "left" | "right";
  footer?: ReactNode;
}) {
  const s = sourceDocsSummary(data.rows);
  const missing = s.total - s.loaded;
  const nothing = s.total === 0 && s.extra === 0;
  if (compact && nothing && !data.canUpload) return <span className="text-neutral-400">—</span>;
  return (
    <details data-source-docs className={cn("group rounded-lg border bg-white", compact ? "relative border-neutral-200 text-xs" : "border-neutral-200")}>
      <summary className={cn("flex cursor-pointer list-none flex-wrap items-center gap-x-2 gap-y-1 [&::-webkit-details-marker]:hidden", compact ? "px-2 py-1" : "min-h-11 px-3 py-2 text-sm")}>
        <span aria-hidden className="text-neutral-500 transition-transform group-open:rotate-90">›</span>
        {!compact && <span className="font-semibold text-neutral-900">{title}</span>}
        <span className={cn("text-xs", missing > 0 ? "font-medium text-amber-800" : "text-neutral-600")}>
          {s.total > 0 ? `${compact ? "" : "· "}${s.loaded} из ${s.total} загружено` : nothing ? `${compact ? "" : "· "}в данных не названы` : `${compact ? "" : "· "}приложено: ${s.extra}`}
          {s.total > 0 && s.extra > 0 ? ` · прочих: ${s.extra}` : ""}
        </span>
      </summary>
      <div className={cn("flex flex-col gap-2 p-2 sm:p-3", compact ? cn("absolute z-20 mt-1 w-[min(26rem,calc(100vw-2rem))] rounded-lg border border-neutral-200 bg-white shadow-lg", popover === "right" ? "right-0" : "left-0") : "border-t border-neutral-100")}>
        {data.rows.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {data.rows.map((r, i) => (
              <Row key={`${r.key}:${i}`} row={r} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-neutral-500">В данных этой записи не названо ни одного документа (номера УПД, счетов, спецификаций, платёжек).</p>
        )}
        {data.hiddenLinks > 0 && (
          <p className="text-xs text-neutral-500">
            Ещё {data.hiddenLinks} документ(ов) привязаны только ссылкой (файла в приложении нет) — их список в разделе «Документы».
          </p>
        )}
        {data.canUpload && data.target && <GeneralUpload target={data.target} />}
        {footer}
      </div>
    </details>
  );
}

/**
 * Кнопка «Загрузить документ» для чек-листов и списков «Внимание», где написано «нет документа»:
 * тот же механизм, что в блоке выше (UploadTarget готовят auction-doc-checklist / production-doc-checklist).
 */
export function UploadTargetButton({ upload, label = "Загрузить документ", className }: { upload: UploadTarget; label?: string; className?: string }) {
  const { pending, error, setError, run } = useRun();
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-2", className)}>
      <FilePick
        label={label}
        disabled={pending}
        onInvalid={setError}
        title={upload.label}
        onFile={(file) => {
          const fd = new FormData();
          if (upload.action === "purchaseDoc") {
            fd.append("files", file);
            fd.set("kind", upload.kind);
            fd.set("scope", upload.scope);
            void run(() => uploadPurchaseDocuments(upload.purchaseId, {}, fd));
            return;
          }
          fd.set("file", file);
          if (upload.action === "driveDoc") {
            fd.set("docType", upload.docType);
            void run(() => uploadDriveDocument(upload.entity, upload.id, fd));
          } else {
            fd.set("docType", "PAYMENT_PROOF");
            void run(() => uploadDriveDocument(upload.target === "supplier" ? "payment" : "productionPayment", upload.paymentId, fd));
          }
        }}
      />
      {pending && <span className="text-xs text-neutral-500">Загружаем…</span>}
      {error && <span role="alert" className="text-xs text-red-600">{error}</span>}
    </span>
  );
}
