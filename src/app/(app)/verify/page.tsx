import { RELIABILITY_NOTE } from "@/lib/reliability-note";
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
import { VerifyQueue } from "./verify-bulk";
import { remarkOf } from "@/lib/verify-remark";
import { findDuplicates } from "./duplicates";
import { TILE_BOX, TileCaption, TileHead, TileValue } from "@/app/(app)/dashboard/tile";

export const metadata = { title: "Подтвердить" };
export const dynamic = "force-dynamic";

const TABS: { id: string; label: string; kinds: VerifyKind[]; hint: string }[] = [
  { id: "payments", label: "Платежи", kinds: ["payment", "prodPayment"], hint: "Оплаты поставщикам и оплаты производства (за работу подрядчику). Подтверждена — если есть документ-основание: файл платёжки либо п/п с номером, либо письмо «оплачено» с датой." },
  { id: "purchases", label: "Закупки", kinds: ["purchase"], hint: "Закупки и аукционы. Подтверждена — если все обязательные документы приложены, сумма в базе равна сумме УПД/счёта (±1 ₽), лоты и количество сошлись, оплата завершена и у каждой оплаты есть платёжка." },
  { id: "orders", label: "ТЗ", kinds: ["order"], hint: "Технические задания. Подтверждено — если приложение ТЗ загружено, дата ТЗ настоящая (не шаблонная), заданы партия, заказчик, количество, цена работы и состав материалов, а количество и работа совпали с приложением (реестр сверки)." },
  { id: "batches", label: "Партии", kinds: ["batch"], hint: "Партии производства. Подтверждена — если подтверждены все её ТЗ, есть расчёт и счёт, оплата за работу сопоставлена (оплачено, у каждой оплаты есть платёжка или п/п)." },
];
const FILTERS = [
  { id: "ready", label: "Не подтверждено, можно подтвердить" },
  { id: "blocked", label: "Не подтверждено, есть замечания" },
  { id: "done", label: "Подтверждено документом" },
  { id: "remark", label: "Подтверждена с замечанием" },
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
      (r) => (states.includes("ready") && !r.verified && r.ready) || (states.includes("blocked") && !r.verified && !r.ready) || (states.includes("done") && r.verified) || (states.includes("remark") && r.verified && !!remarkOf(r.note)),
    );
  }
  if (q) rows = rows.filter((r) => `${r.title} ${r.sub ?? ""} ${r.group ?? ""} ${r.blockers.map((b) => b.text).join(" ")}`.toLowerCase().includes(q));
  // сначала ждущие: готовые к подтверждению, затем с блокерами, затем подтверждённые
  const rank = (r: VerifyRow) => (r.verified ? 2 : r.ready ? 0 : 1);
  rows = [...rows].sort((a, b) => rank(a) - rank(b));
  const shown = showAll ? rows : rows.slice(0, MAX_ROWS);

  const dups = findDuplicates(tabRows(tab));
  const remarkCount = tabRows(tab).filter((x) => x.verified && remarkOf(x.note)).length;
  const readyAll = inYearRows.filter((r) => !r.verified && r.ready && canVerify(role, r.kind)).map((r) => ({ key: r.key, row: r }));

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: "Контроль", href: "/attention" }, { label: "Подтвердить" }]} />
      <ControlTabs active="verify" />
      <div>
        <div className="flex flex-wrap items-center gap-2"><h1 className="flex items-center gap-2 text-xl font-semibold">Подтвердить</h1><YearNote year={year} />
          <InfoHint wide label="Как работает подтверждение">
            <div className="space-y-2">
              <p>
                <b>«Подтверждено документом»</b> — вы или система убедились, что сумма корректна, документ загружен и суммы в нём сходятся с базой. Если основание оплаты — только письмо «оплачено» (без файла платёжки и п/п), строка называется <b>«Согласовано письмом»</b>. Всё, что сопоставилось по документам на 100 %, подтверждено автоматически (отметка «авто по документам»).
              </p>
              <p>
                <b>«Не подтверждено»</b> — чего-то не хватает. В строке написано, чего именно: нужно внести дату/сумму/номер п/п, проверить документы и нажать «Подтвердить».
              </p>
              <p>
                Подтвердить можно и с расхождением — только с замечанием текстом: строка станет <b>«Подтверждена с замечанием»</b>, замечание видно в строке (это ваше решение, оно сохраняется). Любая правка суммы, документа или даты <b>сбрасывает</b> подтверждение этой строки и связанных с ней — всё пересчитывается автоматически.
              </p>
              <p>{RELIABILITY_NOTE}</p>
              <p>Долг поставщику считается как раньше: оплаты без подтверждения остаются в расчёте, но помечены в подсказке долга.</p>
            </div>
          </InfoHint></div>
      </div>

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
              <span className="rounded-full bg-amber-100 px-1.5 text-xs text-amber-900" title="не подтверждено">{c.waiting}</span>
              <span className="rounded-full bg-emerald-100 px-1.5 text-xs text-emerald-900" title="подтверждено документом">{c.verified}</span>
            </Link>
          );
        })}
      </nav>

      <div className="print:hidden">
        <FilterBar
          title="Фильтры проверки"
          oneRow
          hideChips
          controls={[
            { type: "text", name: "q", label: "Поиск", aliases: ["dq"], placeholder: "номер, аукцион, сумма…" },
            { type: "multi", name: "verified", label: "Состояние", aliases: ["filter"], options: FILTERS.map((x) => ({ value: x.id, label: x.label })), allLabel: "Все" },
          ]}
        />
      </div>

      <WidgetRow id="verify" title="Итоги">
      <div className="grid grid-cols-2 items-stretch gap-3 lg:grid-cols-4">
        {[
          { label: "Подтверждено", v: total.verified, sub: total.auto ? `авто по документам: ${total.auto}` : null, tone: "text-emerald-700" },
          { label: "Не подтверждено", v: total.waiting, sub: null, tone: total.waiting > 0 ? "text-amber-700" : "" },
          { label: "Готово к подтверждению", v: total.ready, sub: null, tone: "" },
          { label: "Всего", v: total.total, sub: null, tone: "" },
        ].map((c) => (
          <div key={c.label} className={TILE_BOX + " shadow-sm print:shadow-none"}>
            <TileHead>{c.label}</TileHead>
            <TileValue className={c.tone}>{c.v}</TileValue>
            <TileCaption>{c.sub}</TileCaption>
          </div>
        ))}
      </div>
      </WidgetRow>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="text-xs text-neutral-500">
          {tab.label}: подтверждено {tabCounts.verified}{remarkCount ? ` (с замечанием ${remarkCount})` : ""} · не подтверждено {tabCounts.waiting} · готово {tabCounts.ready}
          <InfoHint wide label={`Что значит «подтверждено» у раздела «${tab.label}»`} className="ml-1.5">
            {tab.hint}
          </InfoHint>
        </p>
      </div>

      {dups.length > 0 && (
        <details className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-sm">
          <summary className="cursor-pointer list-none font-medium text-amber-950">
            Возможные повторы: {dups.length} {dups.length === 1 ? "группа" : "групп"} <span className="font-normal text-neutral-600">· показать ›</span>
          </summary>
          <ul className="mt-2 flex flex-col gap-2">
            {dups.slice(0, 20).map((g) => (
              <li key={g.id} className="rounded-md bg-white px-3 py-2">
                <p className="text-xs text-neutral-600">{g.verifiedCase ? "Не повтор" : g.reason}: {g.rows.length} {g.rows.length < 5 ? "записи" : "записей"}</p>
                {g.note && <p className={"text-xs " + (g.verifiedCase ? "text-emerald-800" : "text-amber-900")}>{g.note}</p>}
                <p className="text-xs"><b>Оставить одну:</b> <Link className="text-blue-700 hover:underline" href={g.keep.href}>{g.keep.title}</Link>{g.keep.verified ? " (подтверждена)" : g.keep.ready ? " (готова к подтверждению)" : ""}</p>
                <p className="text-xs text-neutral-600">Остальные проверьте и уберите вручную в карточке:{" "}
                  {g.rows.filter((x) => x.key !== g.keep.key).map((x, i) => (
                    <span key={x.key}>{i > 0 ? ", " : ""}<Link className="text-blue-700 hover:underline" href={x.href}>{x.title}</Link></span>
                  ))}
                </p>
              </li>
            ))}
          </ul>
          {dups.length > 20 && <p className="mt-1 text-xs text-neutral-500">Показаны первые 20 из {dups.length}.</p>}
          <p className="mt-2 text-xs text-neutral-500">Это подсказка: ничего не удаляется и не объединяется само, суммы и долг не меняются.</p>
        </details>
      )}

      {shown.length === 0 ? (
        <p className="rounded-lg border border-dashed border-neutral-300 px-4 py-8 text-center text-sm text-neutral-500">
          {emptyForYear(year, "строк", activeCount(VERIFY_FILTERS, f) > 0 ? "Строк нет — измените фильтр или поиск." : "Строк нет.")}
        </p>
      ) : null}
      <VerifyQueue items={shown.map((r) => ({ row: r, canEdit: canVerify(role, r.kind) }))} readyAll={readyAll} />
      {rows.length > shown.length && (
        <p className="text-sm text-neutral-600">
          Показано {shown.length} из {rows.length}.{" "}
          <Link className="text-blue-700 hover:underline" href={href({ all: "1" })}>
            Показать все
          </Link>
        </p>
      )}
      <p className="text-xs text-neutral-500">
        Что мешает подтвердить: <Link className="text-blue-700 hover:underline" href="/attention">Задачи</Link> · <Link className="text-blue-700 hover:underline" href="/documents">Документы</Link> · <Link className="text-blue-700 hover:underline" href="/reconciliation">Сверка</Link>
      </p>
    </div>
  );
}
