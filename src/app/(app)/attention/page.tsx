import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { Card } from "@/components/ui/card";
import {
  computeAttention,
  countAttention,
  SECTION_LABELS,
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
  yellow: "bg-amber-100 text-amber-700",
  gray: "bg-neutral-100 text-neutral-600",
};
/** Страница не должна подвисать на сотнях строк: остальное — счётчиком. */
const MAX_ROWS = 150;

export default async function AttentionPage({ searchParams }: PageProps<"/attention">) {
  const session = await requireSession(); // доступ — чтение всем ролям
  const sp = await searchParams;
  const sectionParam = typeof sp.section === "string" ? sp.section : "";
  const section = (SECTIONS as string[]).includes(sectionParam) ? (sectionParam as AttentionSection) : null;
  const hideGray = sp.gray === "hide";

  const all = await computeAttention(prisma, session.user.organizationId);
  const totals = countAttention(all);
  const bySection = (s: AttentionSection) => countAttention(all.filter((c) => c.section === s));

  const qs = (next: { section?: AttentionSection | null; gray?: boolean }) => {
    const p = new URLSearchParams();
    const sec = next.section === undefined ? section : next.section;
    const hg = next.gray === undefined ? hideGray : next.gray;
    if (sec) p.set("section", sec);
    if (hg) p.set("gray", "hide");
    const s = p.toString();
    return s ? `/attention?${s}` : "/attention";
  };

  const visibleChecks = all
    .filter((c) => !section || c.section === section)
    .map((c) => ({ ...c, items: hideGray ? c.items.filter((i) => i.priority !== "gray") : c.items }))
    .filter((c) => c.items.length > 0);

  const chip = (active: boolean) =>
    cn(
      "rounded-full border px-3 py-1 text-sm",
      active ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100"
    );

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">Что не заведено</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Пробелы в данных, посчитанные по базе прямо сейчас: не хватает документа, даты, привязки. Исправили запись — она исчезает из списка.
        </p>
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

      {visibleChecks.length === 0 ? (
        <Card className="p-8 text-center text-neutral-600">Всё заведено ✓</Card>
      ) : (
        SECTIONS.filter((s) => visibleChecks.some((c) => c.section === s)).map((s) => (
          <section key={s} className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">{SECTION_LABELS[s]}</h2>
            {visibleChecks
              .filter((c) => c.section === s)
              .map((c) => {
                const top: AttentionPriority = c.items.some((i) => i.priority === "red")
                  ? "red"
                  : c.items.some((i) => i.priority === "yellow")
                    ? "yellow"
                    : "gray";
                const shown = c.items.slice(0, MAX_ROWS);
                return (
                  <Card key={c.key} className="overflow-hidden">
                    <details open={top === "red"} className="group">
                      <summary className="flex cursor-pointer list-none items-start gap-3 p-3 hover:bg-neutral-50 sm:items-center">
                        <span className={cn("mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full sm:mt-0", DOT[top])} aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-neutral-900">{c.title}</span>
                          <span className="block text-xs text-neutral-500">{c.why}</span>
                        </span>
                        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold", BADGE[top])}>{c.items.length}</span>
                        <span className="shrink-0 text-neutral-400 transition-transform group-open:rotate-90" aria-hidden>›</span>
                      </summary>
                      <ul className="divide-y divide-neutral-100 border-t border-neutral-100">
                        {shown.map((i) => (
                          <li key={i.id} className="flex flex-col gap-1 px-3 py-2 text-sm sm:flex-row sm:items-center sm:gap-3">
                            <span className="flex min-w-0 flex-1 items-start gap-2">
                              <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", DOT[i.priority])} title={PRIORITY_LABEL[i.priority]} />
                              <span className="min-w-0 break-words text-neutral-800">{i.text}</span>
                            </span>
                            <Link href={i.href} className="shrink-0 pl-4 text-sm text-neutral-700 underline hover:text-neutral-900 sm:pl-0">
                              {i.linkLabel ?? "Открыть"} →
                            </Link>
                          </li>
                        ))}
                        {c.items.length > shown.length && (
                          <li className="px-3 py-2 text-xs text-neutral-500">Ещё записей: {c.items.length - shown.length}. Исправьте показанные — список обновится.</li>
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
        <span className="mr-3"><span className="mr-1 inline-block h-2 w-2 rounded-full bg-amber-400" />проверить: пробел в датах и документах</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-neutral-300" />справочно: может быть нормой</span>
      </p>
    </div>
  );
}
