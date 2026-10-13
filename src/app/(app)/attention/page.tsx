import { Breadcrumbs } from "@/components/breadcrumbs";
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
import { loadVerifyModel, type VerifyRow } from "@/lib/verification";
import { loadControlCounts } from "@/lib/control-counts";
import { buildTaskCategories, TASK_LABELS, type TaskCategory, type TaskCategoryId } from "@/lib/task-center";
import { ControlTabs } from "@/components/control-tabs";
import { stripCoveredPayments } from "@/lib/task-docs";
import { ACCESS, hasRole } from "@/lib/access";
import { DecisionsBlock, DocTasksBlock } from "./task-blocks";
import { UnallocatedAdvancesBlock } from "./unallocated-block";
import { formatMoney, cn } from "@/lib/utils";

export const metadata = { title: "Что требует внимания" };

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

  // Числа считаем свежо и кладём в кэш: вкладки и Сводка показывают то же, что этот экран.
  const counts = await loadControlCounts(session.user.organizationId, year, { fresh: true });
  const taskBlocks = counts.blocks!;
  const all = stripCoveredPayments(await computeAttention(prisma, session.user.organizationId, year), taskBlocks.coveredPaymentIds);
  // Единый центр задач: те же данные, что у «Подтвердить» (замечания строк), «Документов» и «Что не заведено», сложенные по категориям.
  const model = await loadVerifyModel(prisma, session.user.organizationId, { userId: session.user.id as string, c4Mode: "off", canUpload: false, canMark: false });
  const inYear = (r: VerifyRow) => year === "all" || r.year === Number(year);
  const center = buildTaskCategories(model.rows.filter(inYear));
  const blocks = buildAttentionBlocks(all);
  const totals = countAttentionBlocks(blocks);
  // «Нет платёжек» — одна сводная строка в центре задач со ссылкой на «Подтвердить»; поимённый список остаётся в «Показать всё».
  const receiptBlock = blocks.find((b) => b.id === "no-receipt") ?? null;
  const decisions = blocks.filter((b) => b.meta.kind !== "info" && b.id !== "no-receipt");
  const infos = blocks.filter((b) => b.meta.kind === "info");

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: "Контроль", href: "/attention" }, { label: "Что требует внимания" }]} />
      <ControlTabs active="tasks" />
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2"><h1 className="flex items-center gap-2 text-xl font-semibold">Что требует внимания</h1><InfoHint wide label="Как считается число">
              <p>
                Единый список «что требует действия»: нет документа, нет платёжки, расхождение суммы, ждёт подтверждения, нет даты, цены или состава.
                Живые проверки по базе: исправили запись — она исчезает.
              </p>
              <p className="mt-2">
                <b>Как считаем число.</b> Запись для решения — оплата, закупка, ТЗ или аукцион, по которым нужен ваш документ или решение.
                Однотипные пробелы, которых в документах Drive по природе нет (даты ТЗ 1–96, даты выпуска, партии без оплат заказчика), —
                это <b>одна запись на группу</b>: их не исправить без новых документов. Справочное (ожидаемые поставки, справочники) в число не входит.
              </p>
              <p className="mt-2">Один факт — одно место: «нет документа» и «нет платёжки» здесь одной строкой со ссылкой, подробности — во вкладках «Документы» и «Подтвердить». Полный список по сущностям — «Показать всё».</p>
            </InfoHint></div>
          <p className="mt-1 text-sm text-neutral-500">
            Открыто: <b className="text-neutral-900">{counts.tasks}</b>
            {counts.urgent > 0 && <> · срочно: <b className="text-red-600">{counts.urgent}</b></>}
            {year !== "all" && <> · {yearLabel(year)}</>}
            <InfoHint wide label="Из чего складывается число">
              <p>По данным {totals.main} · документы {counts.docTasks} · решения {counts.decisions}{totals.info > 0 && <> · справочно (в число не входит) {totals.info}</>}.</p>
              <p className="mt-2">Цвет точки: <span className="text-red-600">красный</span> — срочно, жёлтый — проверить, серый — справочно.</p>
            </InfoHint>
          </p>
        </div>
        <Link href={showAll ? "/attention" : "/attention?all=1"} className="inline-flex h-9 items-center rounded-md border border-neutral-300 bg-white px-3 text-sm hover:bg-neutral-100">
          {showAll ? "По категориям" : "Показать всё"}
        </Link>
      </div>

      {!showAll && <DecisionsBlock decisions={taskBlocks.decisions} canDecide={hasRole(session.user.role, ACCESS.taskDecisions)} />}
      {!showAll && <DocTasksBlock blocks={taskBlocks} />}
      {!showAll && <UnallocatedAdvancesBlock orgId={session.user.organizationId} />}

      {!showAll && (
        <section aria-label="Что требует действия" className="flex flex-col gap-2">
          {center.lists.find((c) => c.id === "sum") && <TaskCard cat={center.lists.find((c) => c.id === "sum")!} />}
          {receiptBlock && (
            <SummaryRow id="receipt" count={receiptBlock.entities.length} text={blockSummary(receiptBlock)} href="/verify?tab=payments&verified=blocked" tone="red" />
          )}
          {counts.docGaps > 0 && <SummaryRow id="doc" count={counts.docGaps} text={`${counts.docGaps} записей без обязательных документов`} href="/documents?gaps=1" tone="yellow" />}
          {center.ready > 0 && <SummaryRow id="confirm" count={center.ready} text={`${center.ready} готовы к подтверждению`} href="/verify?verified=ready" tone="gray" />}
          {(["date", "price", "composition", "other"] as const).map((id) => {
            const c = center.lists.find((x) => x.id === id);
            return c ? <TaskCard key={id} cat={c} /> : null;
          })}
        </section>
      )}

      {!showAll && decisions.length + infos.length > 0 && (
        <h2 className="text-base font-semibold">Пробелы в данных</h2>
      )}

      {all.length === 0 ? (
        <Card className="p-8 text-center text-neutral-600">Задач нет ✓</Card>
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
            <details className="rounded-lg border border-neutral-200 bg-white">
              <summary className="cursor-pointer list-none p-3 text-sm font-medium text-neutral-600 hover:bg-neutral-50">Справочно ({infos.length}) — в число не входит</summary>
              <div className="flex flex-col gap-2 border-t border-neutral-100 p-2">
                {infos.map((b) => (
                  <BlockCard key={b.id} b={b} />
                ))}
              </div>
            </details>
          )}
        </>
      )}

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
          <span className="shrink-0 text-neutral-500 transition-transform group-open:rotate-90" aria-hidden>›</span>
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
                <span className="shrink-0 text-neutral-500 transition-transform group-open:rotate-90" aria-hidden>›</span>
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

/** Сводная строка категории: один факт — одна строка и ссылка туда, где запись правится. */
function SummaryRow({ id, count, text, href, tone }: { id: TaskCategoryId; count: number; text: string; href: string; tone: AttentionPriority }) {
  const t = TASK_LABELS[id];
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-3 p-3">
        <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", DOT[tone])} aria-hidden />
        <span className="min-w-0 flex-1 text-sm font-medium text-neutral-900">
          {t.label}
          <span className="ml-1.5 align-middle">
            <InfoHint wide label={`Пояснение: ${t.label}`}>
              <p>{t.hint}</p>
            </InfoHint>
          </span>
          <span className="block text-xs font-normal text-neutral-500">{text}</span>
        </span>
        <Link href={href} className="inline-flex h-8 shrink-0 items-center rounded-md border border-neutral-300 bg-white px-3 text-xs hover:bg-neutral-100">
          {t.action} →
        </Link>
        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold", BADGE[tone])}>{count}</span>
      </div>
    </Card>
  );
}

/** Категория со списком: каждая строка — ссылка на запись и одно действие. */
function TaskCard({ cat }: { cat: TaskCategory }) {
  const t = TASK_LABELS[cat.id];
  const tone: AttentionPriority = cat.id === "sum" ? "red" : "yellow";
  return (
    <Card className="overflow-hidden">
      <details open={cat.id === "sum" && cat.count <= 8} className="group">
        <summary className="flex cursor-pointer list-none items-center gap-3 p-3 hover:bg-neutral-50">
          <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", DOT[tone])} aria-hidden />
          <span className="min-w-0 flex-1 text-sm font-medium text-neutral-900">
            {t.label}
            <span className="ml-1.5 align-middle">
              <InfoHint wide label={`Пояснение: ${t.label}`}>
                <p>{t.hint}</p>
              </InfoHint>
            </span>
          </span>
          <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold", BADGE[tone])}>{cat.count}</span>
          <span className="shrink-0 text-neutral-500 transition-transform group-open:rotate-90" aria-hidden>›</span>
        </summary>
        <ul className="divide-y divide-neutral-100 border-t border-neutral-100">
          {cat.items.map((e) => (
            <li key={e.key} className="flex flex-col gap-1 px-3 py-2 text-sm sm:flex-row sm:items-center sm:gap-3">
              <span className="min-w-0 sm:w-64 lg:w-80">
                <Link href={e.href} className="block break-words font-medium text-neutral-900 hover:underline">{e.title}</Link>
                {e.sub && <span className="block break-words text-xs text-neutral-500">{e.sub}</span>}
              </span>
              <span className="min-w-0 flex-1 text-xs text-neutral-600">{e.text}</span>
              <Link href={e.actionHref} className="inline-flex h-8 shrink-0 items-center self-start rounded-md border border-neutral-300 bg-white px-3 text-xs hover:bg-neutral-100 sm:self-auto">
                {t.action} →
              </Link>
            </li>
          ))}
          {cat.count > cat.items.length && (
            <li className="px-3 py-2 text-xs">
              <Link href={cat.seeAllHref} className="text-blue-700 hover:underline">Все {cat.count} → «Подтвердить»</Link>
            </li>
          )}
        </ul>
      </details>
    </Card>
  );
}
