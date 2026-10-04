"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { InfoHint } from "@/components/info-hint";
import { formatMb } from "@/lib/format-mb";
import { cn } from "@/lib/utils";
import type { MarkTarget, Panel, PanelItem, PanelPayment, UploadTarget, PanelMention, PanelDoc } from "@/lib/doc-panel";
import { uploadPurchaseDocuments, replacePurchaseDocument } from "@/app/(app)/purchases/doc-actions";
import { addDriveDocument, uploadDriveDocument, uploadDriveDocumentFile } from "@/app/(app)/drive-actions";
import { markAuctionPayment, markPurchasePayment, attachSupplierPaymentProof } from "@/app/(app)/payments/mark-actions";
import { deleteAuctionPayment } from "@/app/(app)/payments/actions";
import { removePurchasePayment } from "@/app/(app)/purchases/actions";
import { markProductionPayment, attachProductionPaymentProof } from "@/app/(app)/production/mark-actions";
import { removeProductionPayment } from "@/app/(app)/production/actions";

const MAX = 25 * 1024 * 1024;
const field = "h-9 rounded-md border border-neutral-300 bg-white px-2 text-sm shadow-sm";
const ACCEPT = ".pdf,.xlsx,.docx,.jpg,.jpeg,.png";

type Res = { error?: string; ok?: boolean; confirm?: string } | void | undefined;

const TONE_BOX: Record<string, string> = {
  ok: "border-emerald-200 bg-emerald-50 text-emerald-800",
  warn: "border-amber-300 bg-amber-50 text-amber-900",
  bad: "border-red-300 bg-red-50 text-red-800",
  muted: "border-neutral-200 bg-neutral-50 text-neutral-700",
};
const TONE_BAR: Record<string, string> = { ok: "bg-emerald-500", warn: "bg-amber-500", bad: "bg-red-500", muted: "bg-neutral-400" };

/** Выполняет действие с индикатором и сообщением; после успеха обновляет страницу. */
function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ error?: string; ok?: string }>({});
  function run(fn: () => Promise<Res>, okText: string, after?: () => void) {
    setMsg({});
    start(async () => {
      try {
        const r = await fn();
        if (r && r.error) setMsg({ error: r.error });
        else {
          setMsg({ ok: okText });
          after?.();
          router.refresh();
        }
      } catch {
        setMsg({ error: "Не удалось выполнить действие: сервер отклонил запрос (возможно, файл слишком большой) или пропала связь." });
      }
    });
  }
  return { pending, msg, setMsg, run };
}

function checkFile(f: File | undefined): string | null {
  if (!f) return "Файл не выбран";
  if (f.size === 0) return "Файл пустой (0 байт)";
  if (f.size > MAX) return `Файл больше 25 МБ (${formatMb(f.size)} МБ)`;
  return null;
}

function Msg({ msg, pending }: { msg: { error?: string; ok?: string }; pending?: boolean }) {
  return (
    <>
      {pending && <span className="text-xs text-neutral-500">Выполняем…</span>}
      {msg.error && <span role="alert" className="w-full text-xs text-red-600">{msg.error}</span>}
      {msg.ok && <span className="text-xs text-emerald-600">{msg.ok}</span>}
    </>
  );
}

/** Кнопка с выбором файла: после выбора файл сразу уходит на сервер. */
function FileButton({ label, variant = "outline", onFile, disabled, small = true }: { label: string; variant?: "outline" | "default" | "ghost"; onFile: (f: File) => void; disabled?: boolean; small?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept={ACCEPT}
        className="hidden"
        aria-label={label}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) onFile(f);
        }}
      />
      <Button type="button" variant={variant} size={small ? "sm" : "default"} disabled={disabled} onClick={() => ref.current?.click()} className="max-md:h-9">
        {label}
      </Button>
    </>
  );
}

function UploadButton({ t, variant = "outline" }: { t: UploadTarget; variant?: "outline" | "default" }) {
  const { pending, msg, setMsg, run } = useRun();
  return (
    <span className="inline-flex flex-col gap-1">
      <FileButton
        label={t.label}
        variant={variant}
        disabled={pending}
        onFile={(f) => {
          const err = checkFile(f);
          if (err) return setMsg({ error: err });
          const fd = new FormData();
          if (t.action === "purchaseDoc") {
            fd.append("files", f);
            fd.set("kind", t.kind);
            fd.set("scope", t.scope);
            run(() => uploadPurchaseDocuments(t.purchaseId, {}, fd), "Загружено");
          } else if (t.action === "driveDoc") {
            fd.set("file", f);
            fd.set("docType", t.docType);
            run(() => uploadDriveDocument(t.entity, t.id, fd), "Загружено");
          } else {
            fd.set("file", f);
            run(() => (t.target === "supplier" ? attachSupplierPaymentProof(t.paymentId, fd) : attachProductionPaymentProof(t.paymentId, fd)), "Платёжка приложена");
          }
        }}
      />
      <Msg msg={msg} pending={pending} />
    </span>
  );
}

function ReplaceButton({ doc }: { doc: PanelDoc }) {
  const { pending, msg, setMsg, run } = useRun();
  if (!doc.replace) return null;
  const r = doc.replace;
  return (
    <span className="inline-flex flex-col gap-1">
      <FileButton
        label="Заменить"
        variant="ghost"
        disabled={pending}
        onFile={(f) => {
          const err = checkFile(f);
          if (err) return setMsg({ error: err });
          if (!window.confirm(`Заменить файл документа «${doc.title}» на «${f.name}»? Старый файл будет удалён.`)) return;
          const fd = new FormData();
          fd.set("file", f);
          run(() => (r.action === "purchaseDoc" ? replacePurchaseDocument(r.id, fd) : uploadDriveDocumentFile(r.id, fd)), "Файл заменён");
        }}
      />
      <Msg msg={msg} pending={pending} />
    </span>
  );
}

function AttachMention({ m }: { m: PanelMention }) {
  const { pending, msg, run } = useRun();
  const a = m.attach;
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-neutral-700">
      <span className="min-w-0 break-words">{m.text}</span>
      {m.driveUrl && (
        <a href={m.driveUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
          Drive
        </a>
      )}
      {a && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          title="Привязать этот документ с Google Drive к карточке: сопоставление делаете вы, по названию в папке"
          onClick={() => {
            const fd = new FormData();
            fd.set("link", a.fileId);
            fd.set("title", a.title.slice(0, 200));
            fd.set("docType", a.docType);
            if (a.docNumber) fd.set("docNumber", a.docNumber);
            if (a.docDate) fd.set("docDate", a.docDate);
            run(() => addDriveDocument(a.entity, a.id, {}, fd), "Привязано");
          }}
        >
          Привязать
        </Button>
      )}
      <Msg msg={msg} pending={pending} />
    </li>
  );
}

function ItemRow({ it, canUpload }: { it: PanelItem; canUpload: boolean }) {
  const bad = it.need === "required" && !it.ok;
  const mark = it.ok ? "✓" : it.need === "required" ? "✗" : "○";
  const markCls = it.ok ? "text-emerald-600" : it.need === "required" ? "text-red-600" : "text-neutral-400";
  const shownDocs = it.docs.slice(0, 3);
  return (
    <li className={cn("flex flex-col gap-1.5 rounded-md border px-3 py-2 text-sm", bad ? "border-red-300 bg-red-50" : "border-neutral-200 bg-white", it.need === "na" && "opacity-60")}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className={cn("text-base font-bold leading-none", markCls)} aria-hidden>
          {mark}
        </span>
        <span className="font-medium">{it.label}</span>
        {it.need === "optional" && <span className="text-xs text-neutral-500">желательно</span>}
        {it.note && <span className="text-xs text-neutral-500">· {it.note}</span>}
        {it.ok && it.docs.length > 0 && <span className="text-xs text-emerald-700">есть: {it.docs.length}</span>}
      </div>
      {bad && it.missing && <p className="text-sm font-semibold text-red-700">{it.missing}</p>}
      {shownDocs.length > 0 && (
        <ul className="flex flex-col gap-1">
          {shownDocs.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
              <span className="min-w-0 break-words font-medium text-neutral-800">{d.title}</span>
              <span className="text-neutral-500">{d.meta}</span>
              {d.href && (
                <>
                  <a href={d.href} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                    Открыть
                  </a>
                  <a href={`${d.href}${d.href.includes("?") ? "&" : "?"}download=1`} className="text-blue-600 hover:underline">
                    Скачать
                  </a>
                </>
              )}
              {d.driveUrl && (
                <a href={d.driveUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                  Drive
                </a>
              )}
              {canUpload && <ReplaceButton doc={d} />}
            </li>
          ))}
          {it.docs.length > shownDocs.length && (
            <li>
              <details className="text-xs">
                <summary className="cursor-pointer text-neutral-500">ещё документов: {it.docs.length - shownDocs.length}</summary>
                <ul className="mt-1 flex flex-col gap-1">
                  {it.docs.slice(3).map((d) => (
                    <li key={d.id} className="flex flex-wrap gap-x-2">
                      <span className="font-medium">{d.title}</span>
                      <span className="text-neutral-500">{d.meta}</span>
                      {d.href && (
                        <a href={d.href} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                          Открыть
                        </a>
                      )}
                      {d.driveUrl && (
                        <a href={d.driveUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                          Drive
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            </li>
          )}
        </ul>
      )}
      {it.mentions.length > 0 && (
        <div className="rounded border border-dashed border-neutral-300 bg-white/70 px-2 py-1.5">
          <p className="text-xs font-medium text-neutral-600">Названо в папке Drive «мех», но не привязано здесь:</p>
          <ul className="mt-1 flex flex-col gap-1">
            {it.mentions.map((m, i) => (canUpload ? <AttachMention key={i} m={m} /> : <li key={i} className="text-xs text-neutral-700">{m.text}</li>))}
          </ul>
        </div>
      )}
      {canUpload && it.uploads.length > 0 && it.need !== "na" && (
        <div className="flex flex-wrap items-start gap-2">
          {it.uploads.slice(0, bad ? 12 : 2).map((u, i) => (
            <UploadButton key={i} t={u} variant={bad && i === 0 ? "default" : "outline"} />
          ))}
          {it.uploads.length > 12 && bad && <span className="text-xs text-neutral-500">…и ещё {it.uploads.length - 12}</span>}
        </div>
      )}
    </li>
  );
}

function PaymentLine({ p, canUpload, canMark }: { p: PanelPayment; canUpload: boolean; canMark: boolean }) {
  const { pending, msg, run } = useRun();
  const rb = p.rollback;
  return (
    <li className={cn("flex flex-col gap-1 rounded-md border px-3 py-2 text-sm", p.hasProof ? "border-neutral-200" : "border-amber-300 bg-amber-50")}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <span className="font-medium">{p.dateText}</span>
        <span className="font-semibold tabular-nums">{p.amountText}</span>
        <span className="text-xs text-neutral-500">{p.kindText}</span>
        {p.scopeText && <span className="text-xs text-neutral-500">{p.scopeText}</span>}
        {p.planned && <span className="text-xs text-amber-700">запланирована</span>}
        {p.manual && <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-600">отмечено вручную</span>}
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        {p.docRef && <span className="text-neutral-600">п/п / документ: {p.docRef}</span>}
        {p.hasProof ? (
          <span className="text-emerald-700">платёжка есть{p.proofTitle ? `: ${p.proofTitle}` : ""}</span>
        ) : (
          <span className="font-semibold text-amber-800">платёжки нет{p.confirmed ? "" : " (оплата не подтверждена)"}</span>
        )}
        {p.proofHref && (
          <a href={p.proofHref} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
            Открыть
          </a>
        )}
      </div>
      <div className="flex flex-wrap items-start gap-2">
        {canUpload && p.attachProof && <UploadButton t={{ action: "paymentProof", target: p.attachProof, paymentId: p.id, label: "Приложить платёжку" }} />}
        {canMark && rb && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={pending}
            className="text-red-700 max-md:h-9"
            onClick={() => {
              if (!window.confirm(`Откатить отметку об оплате ${p.amountText} от ${p.dateText}? Запись будет удалена, остаток и долг пересчитаются.`)) return;
              run(
                () => (rb.action === "auction" ? deleteAuctionPayment(rb.id) : rb.action === "purchase" ? removePurchasePayment(rb.ownerId ?? "", rb.id) : removeProductionPayment(rb.ownerId ?? "", rb.id)),
                "Откатено",
              );
            }}
          >
            Откатить
          </Button>
        )}
        <Msg msg={msg} pending={pending} />
      </div>
    </li>
  );
}

function MarkForm({ target, remaining, remainingText, onDone }: { target: MarkTarget; remaining: string; remainingText: string; onDone: () => void }) {
  const [mode, setMode] = useState<"full" | "amount" | "percent">("full");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const call = (fd: FormData) => {
    if (target.kind === "auction") return markAuctionPayment(target.name, fd);
    if (target.kind === "purchase") return markPurchasePayment(target.id, fd);
    return markProductionPayment(target.kind, target.id, fd);
  };

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    fd.set("mode", mode);
    const f = fd.get("file");
    if (f instanceof File && f.name !== "") {
      const err = checkFile(f);
      if (err) return setError(err);
    }
    setError(null);
    start(async () => {
      try {
        let res = await call(fd);
        if (res?.confirm) {
          if (!window.confirm(res.confirm)) return;
          fd.set("confirmFuture", "1");
          res = await call(fd);
        }
        if (res?.error) return setError(res.error);
        form.reset();
        onDone();
        router.refresh();
      } catch {
        setError("Не удалось сохранить: сервер отклонил запрос (возможно, файл слишком большой) или пропала связь.");
      }
    });
  }

  const radio = "flex min-h-9 items-center gap-2 text-sm";
  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-md border border-neutral-300 bg-white p-3">
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-xs font-medium text-neutral-500">Что оплачено</legend>
        <label className={radio}>
          <input type="radio" name="m" checked={mode === "full"} onChange={() => setMode("full")} />
          Оплачено полностью — сумма = остаток ({remainingText})
        </label>
        <label className={radio}>
          <input type="radio" name="m" checked={mode === "amount"} onChange={() => setMode("amount")} />
          Частично — указать сумму
        </label>
        <label className={radio}>
          <input type="radio" name="m" checked={mode === "percent"} onChange={() => setMode("percent")} />
          Частично — указать процент
        </label>
      </fieldset>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {mode === "amount" && (
          <label className="flex flex-col gap-1 text-xs text-neutral-500">
            Сумма, ₽ (остаток {remainingText})
            <input name="amount" inputMode="decimal" autoComplete="off" required className={field} placeholder={remaining} />
          </label>
        )}
        {mode === "percent" && (
          <label className="flex flex-col gap-1 text-xs text-neutral-500">
            Процент от суммы к оплате
            <input name="percent" inputMode="decimal" autoComplete="off" required className={field} placeholder="напр. 30" />
          </label>
        )}
        <label className="flex flex-col gap-1 text-xs text-neutral-500">
          Дата оплаты
          <input name="paidAt" type="date" defaultValue={todayStr} required className={field} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-neutral-500 sm:col-span-2">
          Основание: № платёжки или название письма/документа
          <input name="basis" maxLength={300} autoComplete="off" className={field} placeholder="напр. п/п 43831 или письмо «Re оплата» от 12.05.2026" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-neutral-500 sm:col-span-2">
          Платёжка файлом (необязательно; PDF, XLSX, DOCX, JPEG, PNG до 25 МБ) — с файлом оплата сразу «подтверждена»
          <input type="file" name="file" accept={ACCEPT} className="text-sm" />
        </label>
      </div>
      <p className="text-xs text-neutral-500">Нужно основание: либо номер/название документа, либо файл. Без файла оплата будет помечена «не подтверждена» — платёжку можно приложить позже. Запись можно откатить кнопкой «Откатить».</p>
      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Сохраняем…" : "Отметить оплату"}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone} disabled={pending}>
          Отмена
        </Button>
      </div>
    </form>
  );
}

/**
 * Панель «Документы и оплата»: чек-лист обязательных документов (есть / НЕТ — подгрузить), оплаты (статус, платёжки),
 * кнопка «Отметить оплату». Данные готовят src/lib/auction-doc-checklist.ts и src/lib/production-doc-checklist.ts.
 * Чтение — всем; загрузка и отметка — по правам (panel.canUpload / panel.canMark).
 */
export function DocsPayPanel({ panel, compact = false }: { panel: Panel; compact?: boolean }) {
  const [marking, setMarking] = useState(false);
  const p = panel.pay;
  const canRemain = p.state !== "PAID" && p.state !== "OVERPAID" && p.state !== "NOBASE";
  const bar = Math.max(0, Math.min(100, p.percent));
  const required = panel.items.filter((i) => i.need === "required");
  const have = required.filter((i) => i.ok).length;
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-white p-3 sm:p-4" data-docs-pay={panel.id}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 className="text-base font-semibold">
          {compact ? panel.title : "Документы и оплата"}
          {!compact && panel.title && <span className="ml-2 text-sm font-normal text-neutral-500">{panel.title}</span>}
        </h3>
        <InfoHint wide label="Как считается и откуда данные">
          <ul className="flex list-disc flex-col gap-1.5 pl-4">
            {panel.hint.map((h, i) => (
              <li key={i}>{h}</li>
            ))}
          </ul>
        </InfoHint>
        <span className="ml-auto text-xs text-neutral-500">
          обязательных документов: {have} из {required.length}
        </span>
      </div>

      {panel.alert && (
        <p role="status" className="rounded-md border border-red-400 bg-red-100 px-3 py-2 text-sm font-semibold text-red-800">
          {panel.alert}
        </p>
      )}

      <div className={cn("flex flex-col gap-2 rounded-md border px-3 py-2", TONE_BOX[p.tone])}>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-sm font-bold">{p.label}</span>
          {p.state !== "NOBASE" && (
            <span className="text-xs">
              к оплате {p.totalText} · оплачено {p.paidText} · остаток {p.remainingText}
            </span>
          )}
        </div>
        {p.state !== "NOBASE" && (
          <div className="h-2 w-full overflow-hidden rounded-full bg-white/70" aria-hidden>
            <div className={cn("h-full", TONE_BAR[p.tone])} style={{ width: `${bar}%` }} />
          </div>
        )}
        {p.note && <p className="text-xs font-medium">{p.note}</p>}
      </div>

      <ul className="flex flex-col gap-2">
        {panel.items.map((it) => (
          <ItemRow key={it.key} it={it} canUpload={panel.canUpload} />
        ))}
      </ul>

      <div className="flex flex-col gap-2">
        <h4 className="text-sm font-semibold text-neutral-800">
          Оплаты ({panel.payments.length})
          {panel.proofMissing > 0 && <span className="ml-2 text-xs font-medium text-amber-700">без платёжки: {panel.proofMissing}</span>}
        </h4>
        {panel.payments.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {panel.payments.map((x) => (
              <PaymentLine key={x.id} p={x} canUpload={panel.canUpload} canMark={panel.canMark} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-neutral-500">Оплат в учёте нет.</p>
        )}
        {panel.mentionedPayments.length > 0 && (
          <details className="rounded-md border border-dashed border-neutral-300 px-3 py-2 text-xs text-neutral-700">
            <summary className="cursor-pointer font-medium text-neutral-600">Оплаты, упомянутые в документах Drive ({panel.mentionedPayments.length}) — это не учёт, а справка</summary>
            <ul className="mt-1.5 flex list-disc flex-col gap-1 pl-4">
              {panel.mentionedPayments.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          </details>
        )}
      </div>

      {panel.canMark && panel.mark && canRemain && (
        <div className="flex flex-col gap-2 border-t border-neutral-100 pt-3">
          {marking ? (
            <MarkForm target={panel.mark} remaining={p.remaining} remainingText={p.remainingText} onDone={() => setMarking(false)} />
          ) : (
            <div>
              <Button type="button" onClick={() => setMarking(true)} className="max-md:h-10 max-md:w-full">
                Отметить оплату
              </Button>
            </div>
          )}
        </div>
      )}
      {panel.markBlocked && <p className="text-xs text-neutral-500">Отметить оплату здесь нельзя: {panel.markBlocked}.</p>}
      {!panel.canMark && !panel.canUpload && <p className="text-xs text-neutral-400">Загрузка документов и отметка оплаты доступны ролям, которые ведут закупки и производство.</p>}
    </section>
  );
}
