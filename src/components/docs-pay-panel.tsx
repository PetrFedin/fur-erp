"use client";

import { tidyDocRef } from "@/lib/pay-ref";
import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { InfoHint } from "@/components/info-hint";
import { cn } from "@/lib/utils";
import type { MarkTarget, Panel, PanelItem, PanelPayment, PanelMention } from "@/lib/doc-panel";
import { addDriveDocument } from "@/app/(app)/drive-actions";
import { deleteAuctionPayment } from "@/app/(app)/payments/actions";
import { removePurchasePayment } from "@/app/(app)/purchases/actions";
import { removeProductionPayment } from "@/app/(app)/production/actions";
import { VerifyControl, type VerifyView } from "@/components/verify-control";
import { PaymentFormButton, type PaymentPreset } from "@/components/payment-form";
import { useConfirm } from "@/components/confirm-dialog";

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

function Msg({ msg, pending }: { msg: { error?: string; ok?: string }; pending?: boolean }) {
  return (
    <>
      {pending && <span className="text-xs text-neutral-500">Выполняем…</span>}
      {msg.error && <span role="alert" className="w-full text-xs text-red-600">{msg.error}</span>}
      {msg.ok && <span className="text-xs text-emerald-700">{msg.ok}</span>}
    </>
  );
}

function AttachMention({ m }: { m: PanelMention }) {
  const { pending, msg, run } = useRun();
  const a = m.attach;
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-neutral-700">
      <span className="min-w-0 break-words">{m.text}</span>
      {a && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          title="Привязать этот документ к карточке: сопоставление делаете вы"
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
  const markCls = it.ok ? "text-emerald-700" : it.need === "required" ? "text-red-600" : "text-neutral-500";
  const shownDocs = it.docs.slice(0, 3);
  if (it.ok && it.mentions.length === 0) {
    // Документ есть — одна строка; файлы — внутрь.
    return (
      <li className={cn("rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm", it.need === "na" && "opacity-60")}>
        <details>
          <summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className={cn("text-base font-bold leading-none", markCls)} aria-hidden>{mark}</span>
            <span className="font-medium">{it.label}</span>
            {it.docs.length > 0 && <span className="text-xs text-emerald-700">есть: {it.docs.length}</span>}
            {it.note && <InfoHint wide label={`Пояснение: ${it.label}`}><p>{it.note}</p></InfoHint>}
            <span className="ml-auto text-xs text-neutral-500">файлы ›</span>
          </summary>
          <ul className="mt-2 flex flex-col gap-1">
            {it.docs.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                <span className="min-w-0 break-words font-medium text-neutral-800">{d.title}</span>
                <InfoHint label="Подробности файла"><p>{d.meta}</p></InfoHint>
                {d.href && (
                  <>
                    <a href={d.href} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">Открыть</a>
                    <a href={`${d.href}${d.href.includes("?") ? "&" : "?"}download=1`} className="text-blue-600 hover:underline">Скачать</a>
                  </>
                )}
              </li>
            ))}
          </ul>
        </details>
      </li>
    );
  }
  return (
    <li className={cn("flex flex-col gap-1.5 rounded-md border px-3 py-2 text-sm", bad ? "border-red-300 bg-red-50" : "border-neutral-200 bg-white", it.need === "na" && "opacity-60")}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className={cn("text-base font-bold leading-none", markCls)} aria-hidden>
          {mark}
        </span>
        <span className="font-medium">{it.label}</span>
        {it.need === "optional" && <span className="text-xs text-neutral-500">желательно</span>}
        {it.note && <InfoHint wide label={`Пояснение: ${it.label}`}><p>{it.note}</p></InfoHint>}
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
          <p className="text-xs font-medium text-neutral-600">Упомянуто в документах, но не привязано здесь:</p>
          <ul className="mt-1 flex flex-col gap-1">
            {it.mentions.map((m, i) => (canUpload ? <AttachMention key={i} m={m} /> : <li key={i} className="text-xs text-neutral-700">{m.text}</li>))}
          </ul>
        </div>
      )}
    </li>
  );
}

function PaymentLine({ p, canMark, v, canVerify, actions }: { p: PanelPayment; canMark: boolean; v?: VerifyView; canVerify?: boolean; actions?: ReactNode }) {
  const { pending, msg, run } = useRun();
  const { ask, node: confirmNode } = useConfirm();
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
        {p.docRef && <span className="text-neutral-600">{tidyDocRef(p.docRef, p.dateText)}</span>}
        {p.hasProof ? (
          <span className="text-emerald-700">
            {/сч[её]т|invoice|УПД/i.test(p.proofTitle ?? "") ? "основание: счёт (платёжки нет)" : "платёжка есть"}
            {p.proofTitle ? `: ${p.proofTitle}` : ""}
          </span>
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
        {confirmNode}
        {canMark && rb && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={pending}
            className="text-red-700 max-md:h-9"
            onClick={async () => {
              if (!(await ask(`Откатить отметку об оплате ${p.amountText} от ${p.dateText}? Запись будет удалена, остаток и долг пересчитаются.`, { ok: "Откатить", danger: true }))) return;
              run(
                () => (rb.action === "auction" ? deleteAuctionPayment(rb.id) : rb.action === "purchase" ? removePurchasePayment(rb.ownerId ?? "", rb.id) : removeProductionPayment(rb.ownerId ?? "", rb.id)),
                "Откатено",
              );
            }}
          >
            Откатить
          </Button>
        )}
        {actions}
        <Msg msg={msg} pending={pending} />
      </div>
      {v && !p.planned && (
        <details className="text-xs">
          <summary className="cursor-pointer list-none text-neutral-500 hover:text-neutral-800">
            {v.verified ? "✓ подтверждена" : "ждёт проверки"} · подробнее ›
          </summary>
          <div className="mt-1.5"><VerifyControl v={v} canEdit={!!canVerify} compact /></div>
        </details>
      )}
    </li>
  );
}

/** Цель единой формы оплаты по цели панели. */
function presetOf(m: MarkTarget): PaymentPreset {
  if (m.kind === "auction") return { side: "supplier", auction: m.name };
  if (m.kind === "purchase") return { side: "supplier", purchaseId: m.id };
  if (m.kind === "batch") return { side: "work", batchId: m.id };
  return { side: "work", orderIds: [m.id] };
}

/**
 * Панель «Документы и оплата»: чек-лист обязательных документов (есть / НЕТ — подгрузить), оплаты (статус, платёжки),
 * кнопка «Отметить оплату». Данные готовят src/lib/auction-doc-checklist.ts и src/lib/production-doc-checklist.ts.
 * Чтение — всем; загрузка и отметка — по правам (panel.canUpload / panel.canMark).
 */
export function DocsPayPanel({ panel, compact = false, verify, canVerify, paymentActions }: { panel: Panel; compact?: boolean; verify?: Record<string, VerifyView>; canVerify?: boolean; paymentActions?: Record<string, ReactNode> }) {
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
        <span className="ml-auto flex flex-wrap items-center gap-2">
          <span className="text-xs text-neutral-500">документов: {have} из {required.length}</span>
          {panel.canMark && panel.mark && canRemain && (
            <PaymentFormButton label="Отметить оплату" variant="default" size="default" preset={presetOf(panel.mark)} />
          )}
        </span>
      </div>

      {panel.alert && (
        <p role="status" className="rounded-md border border-red-400 bg-red-100 px-3 py-2 text-sm font-semibold text-red-800">
          {panel.alert}
        </p>
      )}

      <div className={cn("flex flex-col gap-2 rounded-md border px-3 py-2", TONE_BOX[p.tone])}>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-sm font-bold">
            {p.label}
            {p.note && <span className="ml-1.5 align-middle font-normal"><InfoHint wide label="Пояснение к оплате"><p>{p.note}</p></InfoHint></span>}
          </span>
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
              <PaymentLine key={x.id} p={x} canMark={panel.canMark} v={verify?.[x.id]} canVerify={canVerify} actions={paymentActions?.[x.id]} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-neutral-500">Оплат в учёте нет.</p>
        )}
        {panel.mentionedPayments.length > 0 && (
          <details className="rounded-md border border-dashed border-neutral-300 px-3 py-2 text-xs text-neutral-700">
            <summary className="cursor-pointer font-medium text-neutral-600">Оплаты, упомянутые в документах ({panel.mentionedPayments.length}) — это не учёт, а справка</summary>
            <ul className="mt-1.5 flex list-disc flex-col gap-1 pl-4">
              {panel.mentionedPayments.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          </details>
        )}
      </div>

      {panel.markBlocked && <p className="text-xs text-neutral-500">Отметить оплату здесь нельзя: {panel.markBlocked}.</p>}
      {!panel.canMark && !panel.canUpload && <p className="text-xs text-neutral-500">Отметка оплаты доступна ролям, которые ведут закупки и производство.</p>}
    </section>
  );
}
