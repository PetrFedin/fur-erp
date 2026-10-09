import Link from "next/link";
import { stripServiceTags } from "@/lib/note-tags";
import { InfoHint } from "@/components/info-hint";
import { cn } from "@/lib/utils";
import type { Live } from "./live";
import { groupInvoices, totalsOf, TOL, type Group } from "./model";
import { GroupDbLine, InvoiceHeader, InvoiceRow, money } from "./parts";

/** Документы и оплата по группе — те же панели и статусы, что в карточках аукциона/партии и на «Документах». */
export type DocInfo = { href: string; label: string; missing: number; proofMissing: number; dot: string };


function EvidenceStep({
  n,
  title,
  value,
  detail,
  tone = "neutral",
}: {
  n: number;
  title: string;
  value: React.ReactNode;
  detail?: React.ReactNode;
  tone?: "ok" | "warn" | "bad" | "neutral";
}) {
  const cls =
    tone === "ok"
      ? "border-emerald-200 bg-emerald-50/70"
      : tone === "warn"
        ? "border-amber-200 bg-amber-50/70"
        : tone === "bad"
          ? "border-red-200 bg-red-50/70"
          : "border-neutral-200 bg-white";
  const dot =
    tone === "ok" ? "bg-emerald-600" : tone === "warn" ? "bg-amber-500" : tone === "bad" ? "bg-red-600" : "bg-neutral-400";
  return (
    <div className={cn("min-w-0 rounded-lg border p-2.5", cls)}>
      <div className="flex items-center gap-2 text-xs text-neutral-500">
        <span className={cn("flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] text-white", dot)}>{n}</span>
        {title}
      </div>
      <div className="mt-1.5 break-words text-sm font-medium text-neutral-900">{value}</div>
      {detail ? <div className="mt-1 break-words text-xs leading-relaxed text-neutral-600">{detail}</div> : null}
    </div>
  );
}

function closeActions(g: Group, remaining: number, proofMissing: number) {
  if (g.manualReview?.length) return g.manualReview;
  const out: string[] = [];
  for (const d of g.diffs) {
    const text = `${d.why ?? ""}`.trim();
    if (/нужн|подтверд|плат[её]жк|выписк|уточн|исправ|найти|решени/i.test(text)) out.push(text);
  }
  if (remaining > TOL && proofMissing > 0) out.unshift("Получить банковское подтверждение оплаты или оставить счёт в статусе «не подтверждено». ");
  if (out.length === 0 && g.status !== "ok" && g.status !== "docs") out.push("Проверить отмеченные расхождения и найти первичный документ, который закрывает разницу.");
  return [...new Set(out)].slice(0, 4);
}

function Mark({ ok }: { ok: boolean | null }) {
  if (ok === null) return <span className="text-neutral-500">нет данных</span>;
  return ok ? <span className="text-emerald-700">✓</span> : <span className="text-red-600">✗</span>;
}

/** Раскрытое содержимое группы реестра: счета, строка «в базе», проверки и расхождения, документы. Грузится при раскрытии. */
export function GroupBody({ g, ids, live, doc }: { g: Group; ids: Set<string>; live: Live; doc: DocInfo | null }) {
  const list = groupInvoices(g, ids);
  const t = totalsOf(list);
  const db = live.group.get(g.id);
  const failedChecks = g.checks.filter((c) => c.ok === false).length;
  const actions = closeActions(g, t.noneRub, doc?.proofMissing ?? 0);
  const paymentTone = t.noneRub <= TOL ? "ok" : t.approvedRub > TOL ? "warn" : "bad";
  const reconTone = g.status === "ok" || g.status === "docs" ? "ok" : g.status === "conflict" ? "bad" : "warn";
  return (
      <div className="border-t border-neutral-100">
        {list.length > 0 ? (
          <>
            <InvoiceHeader />
            {list.map((c) => (
              <InvoiceRow key={c.inv.id} c={c} db={live.inv.get(c.inv.id)} groupId={g.id} />
            ))}
          </>
        ) : (
          <p className="px-3 py-2 text-xs text-neutral-500">Счетов Веллмех по этой группе в документах нет.</p>
        )}

        {g.status !== "ok" ? (
          <div className="border-t border-neutral-100 bg-neutral-50/60 px-3 py-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-xs text-neutral-500">Цепочка доказательств</div>
                <div className="text-sm font-medium text-neutral-900">Что уже доказано → где разрыв → чем закрыть</div>
              </div>
              <span className={cn(
                "rounded-full border px-2 py-0.5 text-xs font-medium",
                g.status === "conflict" ? "border-red-200 bg-red-50 text-red-800" : g.status === "review" ? "border-orange-200 bg-orange-50 text-orange-800" : "border-amber-200 bg-amber-50 text-amber-800",
              )}>
                {g.status === "conflict" ? "есть конфликт цифр" : g.status === "review" ? "нужно решение" : "не хватает подтверждения"}
              </span>
            </div>
            <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-6">
              <EvidenceStep
                n={1}
                title="Первичка / ТЗ"
                value={`${g.files.length} файлов`}
                detail={g.folderPath ? g.folderPath : g.files.length ? g.files.slice(0, 2).map((f) => f.title).join(" · ") : "Файлы не привязаны"}
                tone={g.files.length > 0 ? "ok" : "bad"}
              />
              <EvidenceStep
                n={2}
                title="Сверка"
                value={g.diffs.length ? `${g.diffs.length} расхожд.` : "расхождений нет"}
                detail={failedChecks ? `Не прошли проверок: ${failedChecks}` : "Контрольные проверки пройдены"}
                tone={reconTone}
              />
              <EvidenceStep
                n={3}
                title="Счета"
                value={list.length ? `${list.length} · ${money(t.amount)}` : "счёта нет"}
                detail={list.length ? `закрыто ${money(t.paid)} · остаток ${money(t.amount - t.paid)}` : "Нужно определить, какой счёт закрывает обязательство"}
                tone={list.length ? (t.amount - t.paid <= TOL ? "ok" : "warn") : "bad"}
              />
              <EvidenceStep
                n={4}
                title="Оплата"
                value={t.noneRub <= TOL ? "подтверждена" : `не подтверждено ${money(t.noneRub)}`}
                detail={t.approvedRub > TOL ? `только согласовано: ${money(t.approvedRub)}` : doc?.proofMissing ? `нет подтверждений: ${doc.proofMissing}` : "по текущим evidence"}
                tone={paymentTone}
              />
              <EvidenceStep
                n={5}
                title="ERP"
                value={db ? money(db.paid) : "нет live-строки"}
                detail={db?.cost != null ? `стоимость в базе ${money(db.cost)}` : db?.note ?? "Проверяем связь с базой"}
                tone={db ? (Math.abs((db.paid ?? 0) - t.paid) <= TOL ? "ok" : "warn") : "warn"}
              />
              <EvidenceStep
                n={6}
                title="Чтобы закрыть"
                value={actions.length ? `${actions.length} действ.` : "ничего не требуется"}
                detail={actions[0] ?? "Цепочка доказательств закрыта"}
                tone={actions.length ? (g.status === "conflict" ? "bad" : "warn") : "ok"}
              />
            </div>
            {actions.length > 0 ? (
              <div className="mt-2 rounded-lg border border-neutral-200 bg-white p-2.5">
                <div className="text-xs font-medium text-neutral-900">Что сделать для закрытия статуса</div>
                <ol className="mt-1 list-decimal space-y-1 pl-5 text-xs leading-relaxed text-neutral-700">
                  {actions.map((a, i) => <li key={i}>{a}</li>)}
                </ol>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-neutral-100 bg-neutral-50 px-3 py-2 text-xs text-neutral-700">
          <GroupDbLine db={db} t={t} />
          {db?.note ? <span className="text-neutral-500">{db.note}</span> : null}
          {g.manualReview?.length ? (
            <div className="w-full rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-orange-950">
              <div className="font-medium">Ручная проверка</div>
              <ul className="mt-1 list-disc space-y-1 pl-4">
                {g.manualReview.map((x, i) => <li key={i}>{x}</li>)}
              </ul>
            </div>
          ) : null}
          {g.folderPath ? <InfoHint label="Исходная папка документов"><span className="break-all">{g.folderPath}</span></InfoHint> : null}
          <span>
            Документы: стоимость <b className="tabular-nums">{money(g.doc.costRub)}</b>, оплачено <b className="tabular-nums">{money(g.doc.paidRub)}</b>
          </span>
          <InfoHint label="Проверки и расхождения" wide>
            <div className="space-y-2">
              <div className="font-medium text-neutral-900">Проверки</div>
              <ul className="space-y-0.5">
                {g.checks.map((c) => (
                  <li key={c.label} className="flex justify-between gap-3">
                    <span>{c.label}</span>
                    <Mark ok={c.ok} />
                  </li>
                ))}
              </ul>
              <dl className="space-y-0.5 tabular-nums">
                <div className="flex justify-between gap-3"><dt>Счета по документам</dt><dd>{money(g.doc.invoicesRub)}</dd></div>
                <div className="flex justify-between gap-3"><dt>Снимок базы: стоимость</dt><dd>{money(g.db.costRub)}</dd></div>
                <div className="flex justify-between gap-3"><dt>Снимок базы: оплачено</dt><dd>{money(g.db.paidRub)}</dd></div>
                <div className="flex justify-between gap-3"><dt>Снимок базы: остаток</dt><dd>{money(g.db.remainingRub)}</dd></div>
              </dl>
              {g.db.refs ? <p className="text-neutral-500">{g.db.refs}</p> : null}
              {g.diffs.length > 0 && (
                <>
                  <div className="font-medium text-neutral-900">Расхождения ({g.diffs.length})</div>
                  <ul className="space-y-2">
                    {g.diffs.map((d, i) => (
                      <li key={i} className="rounded bg-neutral-50 p-2">
                        <div className="font-medium">{d.what}</div>
                        {d.doc && <div>Документ: {d.doc}</div>}
                        {d.db && <div>База: {d.db}</div>}
                        {d.why && <div className="text-neutral-500">Почему: {d.why}</div>}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {g.notes.length > 0 && (
                <>
                  <div className="font-medium text-neutral-900">Заметки</div>
                  <ul className="list-disc space-y-1 pl-4">
                    {g.notes.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </InfoHint>
          {g.agreements && g.agreements.length > 0 ? (
            <InfoHint label="Согласования по группе" wide>
              <ul className="space-y-1">
                {g.agreements.map((a, i) => (
                  <li key={i}>{a.date ?? "—"} · {a.by || "—"} — {a.note}</li>
                ))}
              </ul>
            </InfoHint>
          ) : null}
          {doc ? (
            <Link href={doc.href} className="inline-flex flex-wrap items-center gap-1.5 hover:underline" title="Чек-лист документов, загрузка и отметка оплаты — в карточке">
              <span aria-hidden className={cn("inline-block size-2.5 rounded-full", doc.dot)} />
              <span>
                Документы и оплата: <b>{doc.label}</b>
                {doc.missing > 0 ? <span className="font-semibold text-red-700"> · нет документов: {doc.missing}</span> : null}
                {doc.proofMissing > 0 ? <span className="text-amber-700"> · платёжек нет: {doc.proofMissing}</span> : null}
              </span>
              <span className="text-blue-600">→</span>
            </Link>
          ) : null}
          {g.section === "production" && g.advanceRub ? (
            <span className="text-neutral-600">аванс, засчитанный в расчёте партии: <b className="tabular-nums">{money(g.advanceRub)}</b></span>
          ) : null}
          {g.files.length > 0 && (
            <InfoHint label="Документы группы" wide>
              <ul className="space-y-0.5">
                {g.files.map((f) => (
                  <li key={f.fileId} className="truncate">
                    {stripServiceTags(f.title)}
                  </li>
                ))}
              </ul>
            </InfoHint>
          )}
        </div>
      </div>
  );
}
