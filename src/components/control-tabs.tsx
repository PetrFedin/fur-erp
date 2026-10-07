import { Suspense } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { requireSession } from "@/lib/session";
import { getYearFilter } from "@/lib/year-filter";
import { loadControlCounts, type ControlCounts } from "@/lib/control-counts";

const TABS = [
  { key: "tasks", href: "/attention", label: "Задачи", hint: "Что требует действия — единый список" },
  { key: "verify", href: "/verify", label: "Подтвердить", hint: "Подтверждение оплат, закупок, ТЗ и партий" },
  { key: "documents", href: "/documents", label: "Документы", hint: "Каких документов не хватает и что приложить" },
  { key: "reconciliation", href: "/reconciliation", label: "Сверка", hint: "Реестр сверки: что сходится на 100%, что нет" },
  { key: "analysis", href: "/document-analysis", label: "Анализ документов", hint: "Google Drive, спорные долги, расхождения" },
  { key: "history", href: "/history", label: "История", hint: "Кто, когда и что изменил" },
] as const;

export type ControlTab = (typeof TABS)[number]["key"];

function count(key: ControlTab, c: ControlCounts | null): { n: number; tone: string; title: string } | null {
  if (!c) return null;
  if (key === "tasks") return { n: c.tasks, tone: c.urgent > 0 ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-900", title: `задач: ${c.tasks}${c.urgent ? `, срочных блоков: ${c.urgent}` : ""}` };
  if (key === "verify") return { n: c.waiting, tone: "bg-amber-100 text-amber-900", title: "ждёт проверки" };
  if (key === "documents") return { n: c.docGaps, tone: "bg-amber-100 text-amber-900", title: "записей, где не хватает документов" };
  return null;
}

function Bar({ active, counts }: { active: ControlTab; counts: ControlCounts | null }) {
  return (
    <nav aria-label="Контроль" className="flex items-center gap-1 overflow-x-auto border-b border-neutral-200 whitespace-nowrap">
      <span className="mr-2 hidden text-xs font-semibold uppercase tracking-wide text-neutral-400 sm:inline">Контроль</span>
      {TABS.map((t) => {
        const c = count(t.key, counts);
        const on = t.key === active;
        return (
          <Link
            key={t.key}
            href={t.href}
            title={t.hint}
            aria-current={on ? "page" : undefined}
            className={cn(
              "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-1.5 text-sm",
              on ? "border-neutral-900 font-medium text-neutral-900" : "border-transparent text-neutral-500 hover:text-neutral-900",
            )}
          >
            {t.label}
            {c && c.n > 0 && (
              <span className={cn("rounded-full px-1.5 text-xs font-semibold tabular-nums", c.tone)} title={c.title}>
                {c.n}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

async function Loaded({ active }: { active: ControlTab }) {
  const session = await requireSession();
  const year = await getYearFilter();
  const counts = await loadControlCounts(session.user.organizationId, year).catch(() => null);
  return <Bar active={active} counts={counts} />;
}

/**
 * Вкладки раздела «Контроль» (одна панель на шести страницах; адреса страниц прежние).
 * Счётчики подгружаются отдельно: страница не ждёт их, вкладки видны сразу.
 */
export function ControlTabs({ active }: { active: ControlTab }) {
  return (
    <Suspense fallback={<Bar active={active} counts={null} />}>
      <Loaded active={active} />
    </Suspense>
  );
}
