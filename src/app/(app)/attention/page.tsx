import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { Card } from "@/components/ui/card";
import { InfoHint } from "@/components/info-hint";
import {
  buildAttentionBlocks,
  computeAttention,
  countAttentionBlocks,
  KIND_LABELS,
  KIND_ORDER,
  type AttentionBlock,
  type AttentionEntity,
  type AttentionPriority,
} from "@/lib/attention";
import { getYearFilter, yearLabel } from "@/lib/year-filter";
import { formatMoney, cn } from "@/lib/utils";

export const metadata = { title: "Что не заведено" };

const DOT: Record<AttentionPriority, string> = { red: "bg-red-500", yellow: "bg-amber-400", gray: "bg-neutral-300" };
const PRIORITY_LABEL: Record<AttentionPriority, string> = { red: "Срочно", yellow: "Проверить", gray: "Справочно" };
const BADGE: Record<AttentionPriority, string> = {
  red: "bg-red-100 text-red-700",
  yellow: "bg-amber-100 text-amber-800",
  gray: "bg-neutral-100 text-neutral-600",
};
/** Страница не должна подвисать на сотнях строк: остальное — счётчиком. */
const MAX_ROWS = 250;

export default async function AttentionPage({ searchParams }: PageProps<"/attention">) {
  const session = await requireSession(); // доступ — чтение всем ролям
  const sp = await searchParams;
  const showAll = sp.all === "1";
  const year = await getYearFilter();

  const all = await computeAttention(prisma, session.user.organizationId, year);
  const blocks = buildAttentionBlocks(all);
  const totals = countAttentionBlocks(blocks);
  const decisions = blocks.filter((b) => b.meta.kind !== "info");
  const infos = blocks.filter((b) => b.meta.kind === "info");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            Что не заведено
            <InfoHint wide label="Как считается число">
              <p>
                Живые проверки полноты данных по базе: оплаты, закупки, ТЗ, партии, справочники. Исправили запись — она исчезает.
              </p>
              <p className="mt-2">
                <b>Как считаем число.</b> Запись для решения — оплата, закупка, ТЗ или аукцион, по которым нужен ваш документ или решение.
                Однотипные пробелы, которых в документах Drive по природе нет (даты ТЗ 1–96, даты выпуска, партии без оплат заказчика), —
                это <b>одна запись на группу</b>: их не исправить без новых документов. Справочное (ожидаемые поставки, справочники) в число не входит.
              </p>
              <p className="mt-2">Ничего не удалено из проверок: полный список по сущностям — по ссылке «Показать всё». Пробелы документов — на странице «Документы».</p>
            </InfoHint>
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            Требует решения: <b className="text-neutral-900">{totals.main}</b>
            {totals.red > 0 && <> , из них срочных блоков: <b className="text-red-600">{totals.red}</b></>}
            {totals.info > 0 && <> · справочно: {totals.info}</>}
            {year !== "all" && <> · {yearLabel(year)}</>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/reconciliation" className="inline-flex h-9 items-center rounded-md border border-neutral-300 bg-white px-3 text-sm hover:bg-neutral-100">
            Реестр сверки
          </Link>
          <Link href="/documents" className="inline-flex h-9 items-center rounded-md border border-neutral-300 bg-white px-3 text-sm hover:bg-neutral-100">
            Документы
          </Link>
          <Link href={showAll ? "/attention" : "/attention?all=1"} className="inline-flex h-9 items-center rounded-md border border-neutral-300 bg-white px-3 text-sm hover:bg-neutral-100">
            {showAll ? "По блокам" : "Показать всё"}
          </Link>
        </div>
      </div>

      {all.length === 0 ? (
        <Card className="p-8 text-center text-neutral-600">Всё заведено ✓</Card>
      ) : showAll ? (
        <AllView all={all} />
      ) : (
        <>
          <div className="flex flex-col gap-2">
            {decisions.map((b) => (
              <BlockCard key={b.id} b={b} />
            ))}
          </div>
          {infos.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Справочно — в число не входит</h2>
              {infos.map((b) => (
                <BlockCard key={b.id} b={b} />
              ))}
            </section>
          )}
        </>
      )}

      <p className="text-xs text-neutral-400">
        <span className="mr-3"><span className="mr-1 inline-block h-2 w-2 rounded-full bg-red-500" />срочно</span>
        <span className="mr-3"><span className="mr-1 inline-block h-2 w-2 rounded-full bg-amber-400" />проверить</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-neutral-300" />справочно</span>
      </p>
    </div>
  );
}

function blockSummary(b: AttentionBlock): string {
  const n = b.entities.length;
  if (b.id === "no-receipt") return `${n} ${n === 1 ? "оплата" : n < 5 ? "оплаты" : "оплат"} на ${formatMoney(String(Math.round(b.amount * 100) / 100))}`;
  if (b.id === "advance-unlinked" && b.amount > 0) return `${n} зап. на ${formatMoney(String(Math.round(b.amount * 100) / 100))}`;
  return `${n}`;
}

function BlockCard({ b }: { b: AttentionBlock }) {
  const shown = b.entities.slice(0, MAX_ROWS);
  return (
    <Card className="overflow-hidden">
      <details open={b.meta.kind === "decision" && b.entities.length <= 8} className="group">
        <summary className="flex cursor-pointer list-none items-center gap-3 p-3 hover:bg-neutral-50">
          <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", DOT[b.priority])} aria-hidden />
          <span className="min-w-0 flex-1 text-sm font-medium text-neutral-900">
            {b.meta.title}
            <span className="ml-1.5 align-middle">
              <InfoHint wide label={`Пояснение: ${b.meta.title}`}>
                <p>{b.meta.hint}</p>
                {b.meta.kind === "bulk" && <p className="mt-2 text-neutral-500">В число «Требует внимания» вся группа входит как одна запись.</p>}
              </InfoHint>
            </span>
          </span>
          {b.meta.link && (
            <Link
              href={b.meta.link.href}
              className="hidden shrink-0 text-xs text-neutral-500 underline hover:text-neutral-800 sm:inline"
            >
              {b.meta.link.label}
            </Link>
          )}
          <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold", BADGE[b.priority])}>{blockSummary(b)}</span>
          <span className="shrink-0 text-neutral-400 transition-transform group-open:rotate-90" aria-hidden>›</span>
        </summary>
        <ul className="divide-y divide-neutral-100 border-t border-neutral-100">
          {shown.map((e) => (
            <EntityRow key={e.id} e={e} />
          ))}
          {b.entities.length > shown.length && (
            <li className="px-3 py-2 text-xs text-neutral-500">Ещё записей: {b.entities.length - shown.length}. Полный список — «Показать всё».</li>
          )}
        </ul>
      </details>
    </Card>
  );
}

/** Полный список по сущностям (как раньше): ничего не скрыто. */
function AllView({ all }: { all: AttentionEntity[] }) {
  const kinds = KIND_ORDER.filter((k) => all.some((e) => e.kind === k));
  return (
    <div className="flex flex-col gap-2">
      {kinds.map((k) => {
        const rows = all.filter((e) => e.kind === k);
        const top: AttentionPriority = rows.some((e) => e.priority === "red") ? "red" : rows.some((e) => e.priority === "yellow") ? "yellow" : "gray";
        return (
          <Card key={k} className="overflow-hidden">
            <details open={top === "red" || rows.length <= 12} className="group">
              <summary className="flex cursor-pointer list-none items-center gap-3 p-3 hover:bg-neutral-50">
                <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", DOT[top])} aria-hidden />
                <span className="min-w-0 flex-1 text-sm font-medium text-neutral-900">{KIND_LABELS[k]}</span>
                <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold", BADGE[top])}>{rows.length}</span>
                <span className="shrink-0 text-neutral-400 transition-transform group-open:rotate-90" aria-hidden>›</span>
              </summary>
              <ul className="divide-y divide-neutral-100 border-t border-neutral-100">
                {rows.slice(0, MAX_ROWS).map((e) => (
                  <EntityRow key={e.id} e={e} />
                ))}
                {rows.length > MAX_ROWS && <li className="px-3 py-2 text-xs text-neutral-500">Ещё записей: {rows.length - MAX_ROWS}. Исправьте показанные — список обновится.</li>}
              </ul>
            </details>
          </Card>
        );
      })}
    </div>
  );
}

function EntityRow({ e }: { e: AttentionEntity }) {
  return (
    <li className="flex flex-col gap-1.5 px-3 py-2 text-sm sm:flex-row sm:items-start sm:gap-3">
      <span className="flex min-w-0 shrink-0 items-start gap-2 sm:w-64 lg:w-80">
        <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", DOT[e.priority])} title={PRIORITY_LABEL[e.priority]} />
        <span className="min-w-0">
          <Link href={e.href} className="block break-words font-medium text-neutral-900 hover:underline">
            {e.title}
          </Link>
          {e.sub && <span className="block break-words text-xs text-neutral-500">{e.sub}</span>}
        </span>
      </span>
      <span className="flex min-w-0 flex-1 flex-wrap gap-1.5 pl-4 sm:pl-0">
        {e.problems.map((p, i) => {
          const cls = cn("rounded-md px-2 py-0.5 text-xs leading-snug", BADGE[p.priority], p.href && "underline decoration-dotted underline-offset-2");
          return p.href ? (
            <Link key={i} href={p.href} className={cls} title={p.linkLabel ?? PRIORITY_LABEL[p.priority]}>
              {p.text}
              {p.linkLabel ? ` · ${p.linkLabel} →` : ""}
            </Link>
          ) : (
            <span key={i} className={cls} title={PRIORITY_LABEL[p.priority]}>
              {p.text}
            </span>
          );
        })}
      </span>
    </li>
  );
}
