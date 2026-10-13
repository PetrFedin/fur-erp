"use client";

import { UploadTargetButton } from "@/components/source-docs";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Blocker } from "@/lib/verification";
import { remarkOf, STATUS_LABEL, verifiedLabel } from "@/lib/verify-remark";
import { unverifyPurchases, unverifyRow, verifyPurchases, verifyRow, type VerifyState } from "@/app/(app)/verify/actions";

/** Что нужно клиентскому компоненту о строке (сериализуемо). */
export type VerifyView = {
  kind: string;
  id: string;
  verified: boolean;
  auto: boolean;
  stampText: string | null;
  note: string | null;
  ready: boolean;
  blockers: Blocker[];
  /** Основание — письмо «оплачено», а не файл/п/п (см. verification.ts → refEvidence). */
  letter?: boolean;
};

/** Статус одной строкой: «Подтверждено ✓ (дата · кем)» либо «Ждёт ручной проверки». Без действий. */
export function VerifyBadge({ v, className }: { v: Pick<VerifyView, "verified" | "auto" | "stampText" | "ready" | "blockers" | "note" | "letter">; className?: string }) {
  if (v.verified) {
    const remark = remarkOf(v.note);
    const label = verifiedLabel(v);
    return (
      <span
        className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium", remark ? "border-amber-300 bg-amber-50 text-amber-900" : "border-emerald-300 bg-emerald-50 text-emerald-800", className)}
        title={`${v.auto ? "Подтверждено автоматически по документам" : "Подтверждено вручную"}${remark ? `. Замечание: ${remark}` : v.note ? `. ${v.note}` : ""}`}
      >
        <span aria-hidden>✓</span> {label.charAt(0).toUpperCase() + label.slice(1)}{v.stampText ? ` (${v.stampText})` : ""}
      </span>
    );
  }
  const first = v.blockers.slice(0, 3).map((b) => b.text).join("; ");
  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900", className)}
      title={v.ready ? "Замечаний нет — можно подтвердить" : `Не подтверждено: ${first}`}
    >
      {STATUS_LABEL.none.charAt(0).toUpperCase() + STATUS_LABEL.none.slice(1)}{v.ready ? " · можно подтвердить" : ""}
    </span>
  );
}

function useAct() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ error?: string; ok?: string }>({});
  const run = (fn: () => Promise<VerifyState>) => {
    setMsg({});
    start(async () => {
      try {
        const r = await fn();
        if (r.error) setMsg({ error: r.error });
        else {
          setMsg({ ok: r.message ?? "Готово" });
          router.refresh();
        }
      } catch {
        setMsg({ error: "Не удалось выполнить действие: пропала связь или сервер отклонил запрос." });
      }
    });
  };
  return { pending, msg, run };
}

/**
 * «Подтверждено ✓» для строки: статус, что именно не сходится (блокеры со ссылками и кнопками загрузки),
 * кнопка «Подтвердить» (вопреки замечаниям — только с примечанием) и «Снять подтверждение».
 * `purchaseIds` — если подтверждается весь аукцион: кнопка подтверждает все его закупки.
 */
export function VerifyControl({
  v,
  canEdit,
  compact = false,
  purchaseIds,
  label,
}: {
  v: VerifyView;
  canEdit: boolean;
  compact?: boolean;
  purchaseIds?: string[];
  label?: string;
}) {
  const { pending, msg, run } = useAct();
  const [forcing, setForcing] = useState(false);
  const [note, setNote] = useState("");
  const confirmAction = (n?: string) => run(() => (purchaseIds ? verifyPurchases(purchaseIds, n) : verifyRow(v.kind, v.id, n)));

  return (
    <div className={cn("flex flex-col gap-1.5", compact ? "text-xs" : "text-sm")} data-verify={`${v.kind}:${v.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        {label && <span className="font-medium text-neutral-700">{label}</span>}
        <VerifyBadge v={v} />
        {canEdit && v.verified && (
          <Button type="button" size="sm" variant="ghost" disabled={pending} className="max-md:h-9" onClick={() => run(() => (purchaseIds ? unverifyPurchases(purchaseIds) : unverifyRow(v.kind, v.id)))}>
            Снять подтверждение
          </Button>
        )}
        {canEdit && !v.verified && !forcing && (
          <>
            <Button type="button" size="sm" variant={v.ready ? "default" : "outline"} disabled={pending} className="max-md:h-9" onClick={() => (v.ready ? confirmAction() : setForcing(true))}>
              {v.ready ? "Подтвердить" : "Подтвердить с замечанием…"}
            </Button>
          </>
        )}
        {pending && <span className="text-xs text-neutral-500">Выполняем…</span>}
        {msg.ok && <span className="text-xs text-emerald-700">{msg.ok}</span>}
      </div>
      {v.verified && v.note && <p className="text-xs text-neutral-600">{remarkOf(v.note) ? `Замечание: ${remarkOf(v.note)}` : `Примечание: ${v.note}`}</p>}
      {!v.verified && v.blockers.length > 0 && (
        <ul className="flex flex-col gap-1 rounded-md border border-amber-200 bg-amber-50/70 px-3 py-2">
          <li className="text-xs font-semibold text-amber-900">Не подтверждено — что не сходится:</li>
          {v.blockers.map((b, i) => (
            <li key={i} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-amber-950">
              <span aria-hidden>•</span>
              <span className="min-w-0 break-words">{b.text}</span>
              {b.href && (
                <Link href={b.href} className="text-blue-700 hover:underline">
                  открыть
                </Link>
              )}
              {canEdit && b.upload && <UploadTargetButton upload={b.upload} />}
            </li>
          ))}
        </ul>
      )}
      {canEdit && !v.verified && forcing && (
        <div className="flex flex-col gap-2 rounded-md border border-neutral-300 bg-white p-3">
          <label className="flex flex-col gap-1 text-xs text-neutral-600">
            Замечание текстом (обязательно): почему подтверждаете, хотя что-то не сходится
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={400} className="rounded-md border border-neutral-300 px-2 py-1 text-sm" placeholder="напр.: проверил по выписке банка, сумма верна, платёжки пока нет" />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={pending || note.trim().length < 3} onClick={() => confirmAction(note)}>
              Подтвердить
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setForcing(false)}>
              Отмена
            </Button>
          </div>
        </div>
      )}
      {msg.error && (
        <p role="alert" className="text-xs text-red-600">
          {msg.error}
        </p>
      )}
    </div>
  );
}

/** Компактная отметка для списков: «✓ подтверждено» / «не подтверждено»; ведёт в очередь /verify. */
export function VerifyPill({ flag, tab, className }: { flag: { verified: boolean; auto: boolean; letter?: boolean } | undefined; tab: "payments" | "purchases" | "orders" | "batches"; className?: string }) {
  if (!flag) return <span className="text-neutral-500">—</span>;
  return (
    <Link
      href={`/verify?tab=${tab}`}
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium",
        flag.verified ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-amber-300 bg-amber-50 text-amber-900",
        className,
      )}
      title={flag.verified ? (flag.auto ? "Подтверждено автоматически по документам" : "Подтверждено вручную") : "Не подтверждено — откройте очередь «Подтвердить»"}
    >
      {flag.verified ? `✓ ${verifiedLabel({ note: null, letter: flag.letter })}` : `${STATUS_LABEL.none}`}
    </Link>
  );
}
