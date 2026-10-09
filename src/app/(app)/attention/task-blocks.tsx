import Link from "next/link";
import { Card } from "@/components/ui/card";
import { InfoHint } from "@/components/info-hint";
import { cn, formatMoney } from "@/lib/utils";
import type { DecisionView, DocTaskView, TaskBlocks } from "@/lib/task-docs";
import { DOC_KIND_LABEL, OWNER_HINT, OWNER_LABEL, OWNER_ORDER, buildLetter, type TaskOwner } from "@/lib/task-docs-catalog";
import { decideAction, reopenDecisionAction } from "./actions";
import { LetterButtons } from "./letter-buttons";

const DOT = { red: "bg-red-500", yellow: "bg-amber-400", gray: "bg-neutral-300" } as const;
const BADGE = { red: "bg-red-100 text-red-700", yellow: "bg-amber-100 text-amber-800", gray: "bg-neutral-100 text-neutral-600" } as const;
const money = (n: number) => formatMoney(n.toFixed(2));
const ruDate = (iso: string) => iso.slice(0, 10).split("-").reverse().join(".");

const rank = { red: 0, yellow: 1, gray: 2 } as const;
const sortTasks = (a: DocTaskView, b: DocTaskView) =>
  rank[a.priority] - rank[b.priority] || (b.overdueDays ?? 0) - (a.overdueDays ?? 0) || (b.amount ?? 0) - (a.amount ?? 0);

export function DecisionsBlock({ decisions, canDecide }: { decisions: DecisionView[]; canDecide: boolean }) {
  const open = decisions.filter((d) => d.open).sort((a, b) => (b.decision.amount ?? -1) - (a.decision.amount ?? -1));
  const done = decisions.filter((d) => !d.open);
  const TOP = 5;
  return (
    <section id="owner-decisions" aria-label="Решения владельца" className="flex scroll-mt-4 flex-col gap-2">
      <h2 className="flex items-center gap-2 text-base font-semibold">
        Решения владельца: <span className="text-neutral-900">{open.length}</span>
        <InfoHint wide label="Что это">
          <p>Вопросы из списков «Не решено» (аудит расчётов, расшифровка долга). Выберите вариант и нажмите — решение запишется с вашим именем и датой, правка видна в «Истории». Сами данные кнопка не меняет: под вариантом написано, что сделать дальше.</p>
        </InfoHint>
      </h2>
      {open.slice(0, TOP).map((d) => <DecisionCard key={d.decision.id} v={d} canDecide={canDecide} />)}
      {open.length > TOP && (
        <details className="rounded-lg border border-neutral-200 bg-white">
          <summary className="cursor-pointer list-none p-3 text-sm font-medium hover:bg-neutral-50">Ещё вопросов: {open.length - TOP}</summary>
          <div className="flex flex-col gap-2 border-t border-neutral-100 p-2">
            {open.slice(TOP).map((d) => <DecisionCard key={d.decision.id} v={d} canDecide={canDecide} />)}
          </div>
        </details>
      )}
      {open.length === 0 && <Card className="p-3 text-sm text-neutral-600">Открытых вопросов нет ✓</Card>}
      {done.length > 0 && (
        <details className="rounded-lg border border-neutral-200 bg-white">
          <summary className="cursor-pointer list-none p-3 text-sm font-medium hover:bg-neutral-50">Решено ({done.length})</summary>
          <div className="flex flex-col gap-2 border-t border-neutral-100 p-2">
            {done.map((d) => <DecisionCard key={d.decision.id} v={d} canDecide={canDecide} />)}
          </div>
        </details>
      )}
    </section>
  );
}

function DecisionCard({ v, canDecide }: { v: DecisionView; canDecide: boolean }) {
  const d = v.decision;
  const chosen = v.choice ? d.options.find((o) => o.key === v.choice!.key) : null;
  return (
    <Card className="p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-neutral-900">
            {d.title}
            <span className="ml-1.5 align-middle">
              <InfoHint wide label={`Подробности: ${d.title}`}>
                <p>{d.why}</p>
                <p className="mt-2">
                  {d.refs.map((r, i) => (
                    <span key={r.href + r.label}>{i > 0 && " · "}<Link href={r.href} className="text-blue-700 hover:underline">{r.label}</Link></span>
                  ))}
                </p>
                <p className="mt-2 text-neutral-500">Источник: {d.source}</p>
              </InfoHint>
            </span>
          </div>
        </div>
        {d.amount != null && <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold tabular-nums text-amber-800">{money(d.amount)}</span>}
      </div>
      {v.choice ? (
        <div className="mt-2 rounded-md bg-emerald-50 p-2 text-xs text-emerald-900">
          <b>Решено: {v.choice.label}</b>
          <div className="text-emerald-800">{v.choice.byName ?? "—"} · {v.choice.at ? ruDate(v.choice.at) : ""}{v.choice.note ? ` · ${v.choice.note}` : ""}</div>
          {chosen?.then && <div className="mt-1">Дальше: {chosen.then}</div>}
          {canDecide && (
            <form action={reopenDecisionAction} className="mt-1">
              <input type="hidden" name="id" value={d.id} />
              <button className="underline hover:no-underline">Вернуть в открытые</button>
            </form>
          )}
        </div>
      ) : canDecide ? (
        <form action={decideAction} className="mt-2 flex flex-col gap-2">
          <input type="hidden" name="id" value={d.id} />
          <input name="note" maxLength={500} placeholder="Заметка (необязательно)" aria-label="Заметка к решению" className="h-8 max-w-sm rounded-md border border-neutral-300 px-2 text-xs" />
          <div className="flex flex-wrap gap-2">
            {d.options.map((o) => (
              <button key={o.key} name="choice" value={o.key} title={o.then} className="min-h-8 rounded-md border border-neutral-300 bg-white px-3 py-1 text-left text-xs hover:bg-neutral-100">
                Решено: {o.label}
              </button>
            ))}
          </div>
        </form>
      ) : (
        <p className="mt-2 text-xs text-neutral-500">Решение записывает владелец или администратор.</p>
      )}
    </Card>
  );
}

export function DocTasksBlock({ blocks }: { blocks: TaskBlocks }) {
  const today = new Date().toISOString().slice(0, 10);
  const open = blocks.docTasks.filter((v) => v.open);
  const closed = blocks.docTasks.filter((v) => !v.open);
  const letterTasks = (owner: "mm" | "vellmex") =>
    open.filter((v) => v.task.owner === owner).sort(sortTasks).map((v) => ({
      title: v.task.title, record: v.task.record, amount: v.amount, kind: v.task.kind, dueText: v.dueText, checked: v.task.checked, later: !!v.task.later,
    }));
  return (
    <section id="doc-tasks" aria-label="Документы для поиска и загрузки" className="flex scroll-mt-4 flex-col gap-2">
      <h2 className="flex items-center gap-2 text-base font-semibold">
        Документы для поиска и загрузки: <span className="text-neutral-900">{blocks.openDocs}</span>
        {blocks.urgentDocs > 0 && <span className="text-red-600 normal-case">срочных {blocks.urgentDocs}</span>}
        <InfoHint wide label="Как это работает">
          <p>По расшифровке долга поставщику (docs-inventory/debt-trace) — какие документы не нашлись в Drive «мех» и у кого их просить. Задача закрывается сама: когда к записи загружен документ нужного типа или оплата подтверждена. Вручную закрыть нельзя.</p>
          <p className="mt-2">«После поставки» ({blocks.laterDocs}) в число не входят. Оплаты, описанные здесь, не считаются повторно в «Нет платёжек».</p>
        </InfoHint>
      </h2>
      <p className="text-xs text-neutral-500">
        Под вопросом: <b className="tabular-nums text-neutral-800">{money(blocks.openAmount)}</b>
        <InfoHint label="Про долг">
          <p>Долг поставщику сейчас: <b className="tabular-nums">{formatMoney(blocks.debtRub)}</b>. Расчёт долга задачи не меняют.</p>
        </InfoHint>
      </p>
      {OWNER_ORDER.map((owner) => {
        const items = open.filter((v) => v.task.owner === owner).sort(sortTasks);
        if (items.length === 0) return null;
        const counted = items.filter((v) => v.counts).length;
        return (
          <Card key={owner} className="overflow-hidden">
            <details open={counted > 0 && owner === OWNER_ORDER.find((o) => open.some((v) => v.task.owner === o && v.counts))} className="group">
              <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 p-3 hover:bg-neutral-50">
                <span className="min-w-0 flex-1 text-sm font-medium text-neutral-900">
                  {OWNER_LABEL[owner]}
                  <span className="ml-1.5 align-middle">
                    <InfoHint wide label={`У кого: ${OWNER_LABEL[owner]}`}>
                      <p>{OWNER_HINT[owner]}</p>
                    </InfoHint>
                  </span>
                </span>
                <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">{counted}</span>
                <span className="shrink-0 text-neutral-500 transition-transform group-open:rotate-90" aria-hidden>›</span>
              </summary>
              {(owner === "mm" || owner === "vellmex") && (
                <div className="border-t border-neutral-100 p-3">
                  <LetterButtons
                    label={owner === "mm" ? "Письмо для бухгалтерии" : "Письмо для Веллмех"}
                    filename={owner === "mm" ? `pismo-buhgalteria-${today}.md` : `pismo-vellmeh-${today}.md`}
                    text={buildLetter(owner, letterTasks(owner), today)}
                  />
                </div>
              )}
              <ul className="divide-y divide-neutral-100 border-t border-neutral-100">
                {items.slice(0, 5).map((v) => <DocTaskRow key={v.task.id} v={v} />)}
                {items.length > 5 && (
                  <li>
                    <details>
                      <summary className="cursor-pointer list-none px-3 py-2 text-xs text-blue-700 hover:underline">Ещё {items.length - 5}</summary>
                      <ul className="divide-y divide-neutral-100">{items.slice(5).map((v) => <DocTaskRow key={v.task.id} v={v} />)}</ul>
                    </details>
                  </li>
                )}
              </ul>
            </details>
          </Card>
        );
      })}
      {closed.length > 0 && (
        <details className="rounded-lg border border-neutral-200 bg-white">
          <summary className="cursor-pointer list-none p-3 text-sm font-medium hover:bg-neutral-50">Закрыто автоматически ({closed.length})</summary>
          <ul className="divide-y divide-neutral-100 border-t border-neutral-100">
            {closed.map((v) => (
              <li key={v.task.id} className="px-3 py-2 text-xs text-neutral-600">
                ✓ {v.task.title} — {v.closedBy}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function DocTaskRow({ v }: { v: DocTaskView }) {
  const t = v.task;
  return (
    <li className={cn("flex flex-col gap-2 px-3 py-2 text-sm", t.later && "opacity-70")}>
      <div className="flex flex-wrap items-start gap-2">
        <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", DOT[v.priority])} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="font-medium text-neutral-900">{t.title}</div>
          <div className="text-xs text-neutral-500">
            {DOC_KIND_LABEL[t.kind]} · <Link href={v.recordHref} className="text-blue-700 hover:underline">{t.record}</Link>
            <span className="ml-1.5 align-middle">
              <InfoHint wide label="Подробности по задаче">
                {t.viaStatement && <p>Закрывается выпиской р/с за период.</p>}
                <p>Проверено: {t.checked}</p>
                {v.dueText && <p>Срок: {v.dueText}</p>}
                {v.missing && <p>{v.missing}: проверьте запись.</p>}
                {v.need > 1 && <p>Загружено {v.have} из {v.need}</p>}
              </InfoHint>
            </span>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {v.amount != null && <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums", BADGE[v.priority])}>{money(v.amount)}</span>}
          {v.overdueDays != null && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">просрочено {v.overdueDays} дн.</span>}
          {t.later && <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600">после поставки</span>}
          <Link href={v.uploadHref} className="inline-flex h-8 items-center rounded-md border border-neutral-300 bg-white px-3 text-xs hover:bg-neutral-100">Открыть →</Link>
        </div>
      </div>
    </li>
  );
}
