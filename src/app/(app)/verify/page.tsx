import { Breadcrumbs } from "@/components/breadcrumbs";
import Link from "next/link";
import { WidgetRow } from "@/components/widget-row";
import { ControlTabs } from "@/components/control-tabs";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { InfoHint } from "@/components/info-hint";
import { YearNote, emptyForYear } from "@/components/year-note";
import { getYearFilter } from "@/lib/year-filter";
import { countRows, loadVerifyModel, type VerifyKind, type VerifyRow } from "@/lib/verification";
import { cn } from "@/lib/utils";
import { FilterBar } from "@/components/filters/filter-bar";
import { activeCount, defineFilters, filterHref, parseFilters, pick, stateParam } from "@/lib/filters";
import { canVerify } from "@/lib/verify-access";
import { BulkVerify, VerifyRowCard } from "./row";
import { TILE_BOX, TileCaption, TileHead, TileValue } from "@/app/(app)/dashboard/tile";

export const metadata = { title: "Подтвердить" };
export const dynamic = "force-dynamic";

const TABS: { id: string; label: string; kinds: VerifyKind[]; hint: string }[] = [
  { id: "payments", label: "Платежи", kinds: ["payment", "prodPayment"], hint: "Оплаты поставщикам и оплаты производства (от заказчика). Подтверждена — если есть документ-основание: файл платёжки либо п/п с номером, либо письмо «оплачено» с датой." },
  { id: "purchases", label: "Закупки", kinds: ["purchase"], hint: "Закупки и аукционы. Подтверждена — если все обязательные документы приложены, сумма в базе равна сумме УПД/счёта (±1 ₽), лоты и количество сошлись, оплата завершена и у каждой оплаты есть платёжка." },
  { id: "orders", label: "ТЗ", kinds: ["order"], hint: "Технические задания. Подтверждено — если приложение ТЗ загружено, дата ТЗ настоящая (не шаблонная), заданы партия, заказчик, количество, цена работы и состав материалов, а количество и работа совпали с приложением (реестр сверки)." },
  { id: "batches", label: "Партии", kinds: ["batch"], hint: "Партии производства. Подтверждена — если подтверждены все её ТЗ, есть расчёт и счёт, оплата за работу сопоставлена (оплачено, у каждой оплаты есть платёжка или п/п)." },
];
const FILTERS = [
  { id: "ready", label: "Готовые к подтверждению" },
  { id: "blocked", label: "С блокерами" },
  { id: "done", label: "Подтверждённые" },
];
const VERIFY_FILTERS = defineFilters({
  ...pick(["verified", "q", "tab"], {
    // `filter` — старое имя; значения: ready / blocked / done (all = без фильтра).
    verified: { allowed: FILTERS.map((x) => x.id), label: "Состояние" },
    tab: { allowed: TABS.map((t) => t.id) },
  }),
  all: stateParam("Показать все"),
});

const MAX_ROWS = 120;

export default async function VerifyPage({ searchParams }: PageProps<"/verify">) {
  const session = await requireSession();
  const sp = await searchParams;
  const f = parseFilters(VERIFY_FILTERS, sp);
  const tabId = f.tab || "purchases";
  const states = f.verified;
  const q = f.q.toLowerCase();
  const showAll = f.all === "1";
  // Ссылка с сохранением состояния и поиска (смена вкладки не сбрасывает их).
  const href = (patch: Partial<typeof f>) => filterHref(VERIFY_FILTERS, "/verify", f, patch);
  const year = await getYearFilter();
  const role = session.user.role;

  const model = await loadVerifyModel(prisma, session.user.organizationId, { userId: session.user.id as string, c4Mode: "off", canUpload: true, canMark: true });
  const byYear = (r: VerifyRow) => year === "all" || r.year === Number(year);
  const inYearRows = model.rows.filter(byYear);
  const tab = TABS.find((t) => t.id === tabId)!;
  const tabRows = (t: (typeof TABS)[number]) => inYearRows.filter((r) => t.kinds.includes(r.kind));
  const total = countRows(inYearRows);

  let rows = tabRows(tab);
  const tabCounts = countRows(rows);
  if (states.length > 0) {
    rows = rows.filter(
      (r) => (states.includes("ready") && !r.verified && r.ready) || (states.includes("blocked") && !r.verified && !r.ready) || (states.includes("done") && r.verified),
    );
  }
  if (q) rows = rows.filter((r) => `${r.title} ${r.sub ?? ""} ${r.group ?? ""} ${r.blockers.map((b) => b.text).join(" ")}`.toLowerCase().includes(q));
  // сначала ждущие: готовые к подтверждению, затем с блокерами, затем подтверждённые
  const rank = (r: VerifyRow) => (r.verified ? 2 : r.ready ? 0 : 1);
  rows = [...rows].sort((a, b) => rank(a) - rank(b));
  const shown = showAll ? rows : rows.slice(0, MAX_ROWS);

  const bulkItems = inYearRows.filter((r) => !r.verified && r.ready && canVerify(role, r.kind)).map((r) => ({ key: r.key, kind: r.kind, title: `${r.kind === "payment" || r.kind === "prodPayment" ? "Оплата" : r.kind === "purchase" ? "Закупка" : r.kind === "order" ? "ТЗ" : "Партия"}: ${r.title}${r.sub ? ` — ${r.sub.slice(0, 70)}` : ""}` }));

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: "Контроль", href: "/attention" }, { label: "Подтверждения" }]} />
      <ControlTabs active="verify" />
      <div>
        <div className="flex flex-wrap items-center gap-2"><h1 className="flex items-center gap-2 text-xl font-semibold">Подтвердить</h1><YearNote year={year} />
          <InfoHint wide label="Как работает подтверждение">
            <div className="space-y-2">
              <p>
                <b>«Подтверждено ✓»</b> — вы или система убедились, что сумма корректна, документ загружен и суммы в нём сходятся с базой. Всё, что сопоставилось по документам на 100%, подтверждено автоматически (отметка «авто по документам»).
              </p>
              <p>
                <b>«Ждёт ручной проверки»</b> — чего-то не хватает. В строке написано, чего именно: нужно внести дату/сумму/номер п/п, проверить документы и нажать «Подтвердить».
              </p>
              <p>
                Подтвердить можно и вопреки замечаниям — только с примечанием (это ваше решение, оно сохраняется). Любая правка суммы, документа или даты <b>сбрасывает</b> подтверждение этой строки и связанных с ней — всё пересчитывается автоматически.
              </p>
              <p>Долг поставщику считается как раньше: оплаты без подтверждения остаются в расчёте, но помечены в подсказке долга.</p>
            </div>
          </InfoHint></div>
      </div>

      <WidgetRow id="verify" title="Очередь проверки — итоги">
      <div className="grid grid-cols-2 items-stretch gap-3 lg:grid-cols-4">
        {[
          { label: "Подтверждено", v: total.verified, sub: total.auto ? `из них авто по документам: ${total.auto}` : null, tone: "text-emerald-700" },
          { label: "Ждёт проверки", v: total.waiting, sub: null, tone: total.waiting > 0 ? "text-amber-700" : "" },
          { label: "Готово к подтверждению", v: total.ready, sub: null, tone: "" },
          { label: "Всего, строк", v: total.total, sub: null, tone: "" },
        ].map((c) => (
          <div key={c.label} className={TILE_BOX + " shadow-sm print:shadow-none"}>
            <TileHead>{c.label}</TileHead>
            <TileValue className={c.tone}>{c.v}</TileValue>
            <TileCaption>{c.sub}</TileCaption>
          </div>
        ))}
      </div>
      </WidgetRow>

      <BulkVerify items={bulkItems} canEdit />

      <nav className="flex flex-wrap gap-1" aria-label="Разделы очереди">
        {TABS.map((t) => {
          const c = countRows(tabRows(t));
          const active = t.id === tabId;
          return (
            <Link
              key={t.id}
              href={href({ tab: t.id, all: "" })}
              aria-current={active ? "page" : undefined}
              className={cn("flex items-center gap-2 rounded-md px-3 py-1.5 text-sm max-md:min-h-9", active ? "bg-neutral-900 text-white" : "text-neutral-700 hover:bg-neutral-100")}
            >
              {t.label}
              <span className="rounded-full bg-amber-100 px-1.5 text-xs text-amber-900" title="ждёт проверки">{c.waiting}</span>
              <span className="rounded-full bg-emerald-100 px-1.5 text-xs text-emerald-900" title="подтверждено">{c.verified}</span>
            </Link>
          );
        })}
      </nav>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="text-xs text-neutral-500">
          {tab.label}: подтверждено {tabCounts.verified}, ждёт {tabCounts.waiting}, готово {tabCounts.ready}
          <InfoHint wide label={`Что значит «подтверждено» у раздела «${tab.label}»`} className="ml-1.5">
            {tab.hint}
          </InfoHint>
        </p>
      </div>

      <FilterBar
        title="Фильтры проверки"
        controls={[
          { type: "text", name: "q", label: "Поиск", aliases: ["dq"], placeholder: "номер, аукцион, сумма…" },
          { type: "multi", name: "verified", label: "Состояние", aliases: ["filter"], options: FILTERS.map((x) => ({ value: x.id, label: x.label })), allLabel: "Все" },
        ]}
      />

      {shown.length === 0 ? (
        <p className="rounded-lg border border-dashed border-neutral-300 px-4 py-8 text-center text-sm text-neutral-500">
          {emptyForYear(year, "строк", activeCount(VERIFY_FILTERS, f) > 0 ? "Строк нет — измените фильтр или поиск." : "Строк нет.")}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.map((r) => (
            <VerifyRowCard key={r.key} row={r} canEdit={canVerify(role, r.kind)} />
          ))}
        </ul>
      )}
      {rows.length > shown.length && (
        <p className="text-sm text-neutral-600">
          Показано {shown.length} из {rows.length}.{" "}
          <Link className="text-blue-700 hover:underline" href={href({ all: "1" })}>
            Показать все
          </Link>
        </p>
      )}
      <p className="text-xs text-neutral-500">
        Что мешает подтвердить — в разделе «Контроль»: <Link className="text-blue-700 hover:underline" href="/attention">Задачи</Link> · <Link className="text-blue-700 hover:underline" href="/documents">Документы</Link> · <Link className="text-blue-700 hover:underline" href="/reconciliation">Сверка</Link>
      </p>
    </div>
  );
}
