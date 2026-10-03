import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { Card } from "@/components/ui/card";
import {
  computeAttention,
  countAttention,
  KIND_LABELS,
  KIND_ORDER,
  SECTION_LABELS,
  type AttentionEntity,
  type AttentionPriority,
  type AttentionSection,
} from "@/lib/attention";
import { cn } from "@/lib/utils";

export const metadata = { title: "Что не заведено" };

const SECTIONS: AttentionSection[] = ["purchases", "production", "data"];
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
  const sectionParam = typeof sp.section === "string" ? sp.section : "";
  const section = (SECTIONS as string[]).includes(sectionParam) ? (sectionParam as AttentionSection) : null;
  const hideGray = sp.gray === "hide";

  const all = await computeAttention(prisma, session.user.organizationId);
  const totals = countAttention(all);
  const bySection = (s: AttentionSection) => countAttention(all.filter((e) => e.section === s));

  const qs = (next: { section?: AttentionSection | null; gray?: boolean }) => {
    const p = new URLSearchParams();
    const sec = next.section === undefined ? section : next.section;
    const hg = next.gray === undefined ? hideGray : next.gray;
    if (sec) p.set("section", sec);
    if (hg) p.set("gray", "hide");
    const s = p.toString();
    return s ? `/attention?${s}` : "/attention";
  };

  // Серые проблемы можно скрыть: сущность, у которой остались только серые, пропадает целиком.
  const visible = all
    .filter((e) => !section || e.section === section)
    .map((e) => (hideGray ? { ...e, problems: e.problems.filter((p) => p.priority !== "gray") } : e))
    .filter((e) => e.problems.length > 0);
  const kinds = KIND_ORDER.filter((k) => visible.some((e) => e.kind === k));

  const chip = (active: boolean) =>
    cn(
      "rounded-full border px-3 py-1 text-sm",
      active ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100"
    );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="max-w-3xl">
          <h1 className="text-xl font-semibold">Что не заведено</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Пробелы в данных, посчитанные по базе прямо сейчас: даты, привязки, оплаты. Каждая закупка, ТЗ, партия и оплата показана один раз, а её
            проблемы — бейджами. Исправили запись — она исчезает из списка.
          </p>
        </div>
        <Link href="/documents" className="inline-flex h-9 items-center rounded-md border border-neutral-300 bg-white px-3 text-sm hover:bg-neutral-100">
          Пробелы документов → /documents
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-2" aria-label="Фильтры">
        <Link href={qs({ section: null })} className={chip(!section)}>
          Все · {totals.main}
          {!hideGray && totals.gray > 0 && <span className="ml-1 opacity-70">+{totals.gray} серых</span>}
        </Link>
        {SECTIONS.map((s) => {
          const c = bySection(s);
          return (
            <Link key={s} href={qs({ section: s })} className={chip(section === s)}>
              {SECTION_LABELS[s]} · {c.main}
              {!hideGray && c.gray > 0 && <span className="ml-1 opacity-70">+{c.gray} серых</span>}
            </Link>
          );
        })}
        <Link href={qs({ gray: !hideGray })} className="ml-auto text-sm text-neutral-600 underline">
          {hideGray ? `Показать серые (${totals.gray})` : `Скрыть серые (${totals.gray})`}
        </Link>
      </div>

      {kinds.length === 0 ? (
        <Card className="p-8 text-center text-neutral-600">Всё заведено ✓</Card>
      ) : (
        SECTIONS.filter((s) => kinds.some((k) => visible.some((e) => e.kind === k && e.section === s))).map((s) => (
          <section key={s} className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">{SECTION_LABELS[s]}</h2>
            {kinds
              .filter((k) => visible.some((e) => e.kind === k && e.section === s))
              .map((k) => {
                const rows = visible.filter((e) => e.kind === k);
                const top: AttentionPriority = rows.some((e) => e.priority === "red") ? "red" : rows.some((e) => e.priority === "yellow") ? "yellow" : "gray";
                const shown = rows.slice(0, MAX_ROWS);
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
                        {shown.map((e) => (
                          <EntityRow key={e.id} e={e} />
                        ))}
                        {rows.length > shown.length && (
                          <li className="px-3 py-2 text-xs text-neutral-500">Ещё записей: {rows.length - shown.length}. Исправьте показанные — список обновится.</li>
                        )}
                      </ul>
                    </details>
                  </Card>
                );
              })}
          </section>
        ))
      )}

      <p className="text-xs text-neutral-400">
        <span className="mr-3"><span className="mr-1 inline-block h-2 w-2 rounded-full bg-red-500" />срочно: влияет на деньги или остатки</span>
        <span className="mr-3"><span className="mr-1 inline-block h-2 w-2 rounded-full bg-amber-400" />проверить: пробел в датах и привязках</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-neutral-300" />справочно: может быть нормой</span>
      </p>
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
