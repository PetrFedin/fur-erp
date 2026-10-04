import Link from "next/link";
import { InfoHint } from "@/components/info-hint";
import { cn } from "@/lib/utils";
import type { Live } from "./live";
import { groupInvoices, totalsOf, type Group } from "./model";
import { GroupDbLine, InvoiceHeader, InvoiceRow, driveUrl, money } from "./parts";

/** Документы и оплата по группе — те же панели и статусы, что в карточках аукциона/партии и на «Документах». */
export type DocInfo = { href: string; label: string; missing: number; proofMissing: number; dot: string };

function Mark({ ok }: { ok: boolean | null }) {
  if (ok === null) return <span className="text-neutral-400">нет данных</span>;
  return ok ? <span className="text-emerald-600">✓</span> : <span className="text-red-600">✗</span>;
}

/** Раскрытое содержимое группы реестра: счета, строка «в базе», проверки и расхождения, документы. Грузится при раскрытии. */
export function GroupBody({ g, ids, live, doc }: { g: Group; ids: Set<string>; live: Live; doc: DocInfo | null }) {
  const list = groupInvoices(g, ids);
  const t = totalsOf(list);
  const db = live.group.get(g.id);
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

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-neutral-100 bg-neutral-50 px-3 py-2 text-xs text-neutral-700">
          <GroupDbLine db={db} t={t} />
          {db?.note ? <span className="text-neutral-500">{db.note}</span> : null}
          <span>
            Документы: стоимость <b className="tabular-nums">{money(g.doc.costRub)}</b>, оплачено <b className="tabular-nums">{money(g.doc.paidRub)}</b>
          </span>
          <InfoHint label="Проверки и расхождения" wide>
            <div className="space-y-2">
              <div className="font-semibold text-neutral-900">Проверки</div>
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
                  <div className="font-semibold text-neutral-900">Расхождения ({g.diffs.length})</div>
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
                  <div className="font-semibold text-neutral-900">Заметки</div>
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
            <InfoHint label="Документы Drive" wide>
              <ul className="space-y-0.5">
                {g.files.map((f) => (
                  <li key={f.fileId} className="truncate">
                    <a href={driveUrl(f.fileId)} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline">{f.title}</a>
                  </li>
                ))}
              </ul>
            </InfoHint>
          )}
        </div>
      </div>
  );
}
