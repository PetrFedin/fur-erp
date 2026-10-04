import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { InfoHint } from "@/components/info-hint";
import { YearNote, emptyForYear } from "@/components/year-note";
import { getYearFilter } from "@/lib/year-filter";
import { countRows, loadVerifyModel, type VerifyKind, type VerifyRow } from "@/lib/verification";
import { cn } from "@/lib/utils";
import { canVerify } from "@/lib/verify-access";
import { BulkVerify, VerifyRowCard } from "./row";

export const metadata = { title: "Ждёт проверки" };
export const dynamic = "force-dynamic";

const TABS: { id: string; label: string; kinds: VerifyKind[]; hint: string }[] = [
  { id: "payments", label: "Платежи", kinds: ["payment", "prodPayment"], hint: "Оплаты поставщикам и оплаты производства (от заказчика). Подтверждена — если есть документ-основание: файл платёжки либо п/п с номером, либо письмо «оплачено» с датой." },
  { id: "purchases", label: "Закупки", kinds: ["purchase"], hint: "Закупки и аукционы. Подтверждена — если все обязательные документы приложены, сумма в базе равна сумме УПД/счёта (±1 ₽), лоты и количество сошлись, оплата завершена и у каждой оплаты есть платёжка." },
  { id: "orders", label: "ТЗ", kinds: ["order"], hint: "Технические задания. Подтверждено — если приложение ТЗ загружено, дата ТЗ настоящая (не шаблонная), заданы партия, заказчик, количество, цена работы и состав материалов, а количество и работа совпали с приложением (реестр сверки)." },
  { id: "batches", label: "Партии", kinds: ["batch"], hint: "Партии производства. Подтверждена — если подтверждены все её ТЗ, есть расчёт и счёт, оплата за работу сопоставлена (оплачено, у каждой оплаты есть платёжка или п/п)." },
];
const FILTERS = [
  { id: "all", label: "Все" },
  { id: "ready", label: "Только готовые к подтверждению" },
  { id: "blocked", label: "Только с блокерами" },
  { id: "done", label: "Подтверждённые" },
];

const MAX_ROWS = 120;

function href(p: Record<string, string | undefined>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `/verify?${s}` : "/verify";
}

export default async function VerifyPage({ searchParams }: PageProps<"/verify">) {
  const session = await requireSession();
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const tabId = TABS.some((t) => t.id === one(sp.tab)) ? (one(sp.tab) as string) : "purchases";
  const filter = FILTERS.some((f) => f.id === one(sp.filter)) ? (one(sp.filter) as string) : "all";
  const q = (one(sp.q) ?? "").trim().toLowerCase();
  const showAll = one(sp.all) === "1";
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
  if (filter === "ready") rows = rows.filter((r) => !r.verified && r.ready);
  else if (filter === "blocked") rows = rows.filter((r) => !r.verified && !r.ready);
  else if (filter === "done") rows = rows.filter((r) => r.verified);
  if (q) rows = rows.filter((r) => `${r.title} ${r.sub ?? ""} ${r.group ?? ""} ${r.blockers.map((b) => b.text).join(" ")}`.toLowerCase().includes(q));
  // сначала ждущие: готовые к подтверждению, затем с блокерами, затем подтверждённые
  const rank = (r: VerifyRow) => (r.verified ? 2 : r.ready ? 0 : 1);
  rows = [...rows].sort((a, b) => rank(a) - rank(b));
  const shown = showAll ? rows : rows.slice(0, MAX_ROWS);

  const bulkItems = inYearRows.filter((r) => !r.verified && r.ready && canVerify(role, r.kind)).map((r) => ({ key: r.key, kind: r.kind, title: `${r.kind === "payment" || r.kind === "prodPayment" ? "Оплата" : r.kind === "purchase" ? "Закупка" : r.kind === "order" ? "ТЗ" : "Партия"}: ${r.title}${r.sub ? ` — ${r.sub.slice(0, 70)}` : ""}` }));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          Ждёт проверки
          <YearNote year={year} />
          <InfoHint wide label="Как работает подтверждение">
            <div className="space-y-2">
              <p>
                <b>«Подтверждено ✓»</b> — вы или система убедились, что сумма корректна, документ загружен и суммы в нём сходятся с базой. Всё, что сопоставилось по документам на 100%, подтверждено автоматически (отметка «авто по документам»).
              </p>
              <p>
                <b>«Ждёт ручной проверки»</b> — чего-то не хватает. В строке написано, чего именно: нужно внести дату/сумму/номер п/п, загрузить документ и нажать «Подтвердить».
              </p>
              <p>
                Подтвердить можно и вопреки замечаниям — только с примечанием (это ваше решение, оно сохраняется). Любая правка суммы, документа или даты <b>сбрасывает</b> подтверждение этой строки и связанных с ней — всё пересчитывается автоматически.
              </p>
              <p>Долг поставщику считается как раньше: оплаты без подтверждения остаются в расчёте, но помечены в подсказке долга.</p>
            </div>
          </InfoHint>
        </h1>
        <p className="mt-1 text-sm text-neutral-500">Что сопоставлено — подтверждено; что под вопросом — ждёт вашей проверки по каждой строке.</p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: "Подтверждено", v: total.verified, sub: total.auto ? `из них авто по документам: ${total.auto}` : null, cls: "border-emerald-200 bg-emerald-50 text-emerald-900" },
          { label: "Ждёт проверки", v: total.waiting, sub: null, cls: "border-amber-300 bg-amber-50 text-amber-900" },
          { label: "Готово к подтверждению", v: total.ready, sub: "без блокеров", cls: "border-blue-200 bg-blue-50 text-blue-900" },
          { label: "Всего строк", v: total.total, sub: null, cls: "border-neutral-200 bg-white text-neutral-900" },
        ].map((c) => (
          <div key={c.label} className={cn("rounded-lg border px-3 py-2", c.cls)}>
            <div className="text-xs">{c.label}</div>
            <div className="text-2xl font-semibold tabular-nums">{c.v}</div>
            {c.sub && <div className="text-xs opacity-80">{c.sub}</div>}
          </div>
        ))}
      </div>

      <BulkVerify items={bulkItems} canEdit />

      <nav className="flex flex-wrap gap-1 border-b border-neutral-200" aria-label="Разделы очереди">
        {TABS.map((t) => {
          const c = countRows(tabRows(t));
          const active = t.id === tabId;
          return (
            <Link
              key={t.id}
              href={href({ tab: t.id, filter: filter === "all" ? undefined : filter, q: q || undefined })}
              className={cn("flex items-center gap-2 rounded-t-md border border-b-0 px-3 py-2 text-sm", active ? "border-neutral-300 bg-white font-semibold" : "border-transparent text-neutral-600 hover:bg-neutral-100")}
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
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <Link
              key={f.id}
              href={href({ tab: tabId, filter: f.id === "all" ? undefined : f.id, q: q || undefined })}
              className={cn("rounded-full border px-2.5 py-1 text-xs", f.id === filter ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100")}
            >
              {f.label}
            </Link>
          ))}
        </div>
        <form action="/verify" className="ml-auto flex items-center gap-2">
          <input type="hidden" name="tab" value={tabId} />
          {filter !== "all" && <input type="hidden" name="filter" value={filter} />}
          <input name="q" defaultValue={q} placeholder="Поиск: номер, аукцион, сумма…" className="h-9 w-56 rounded-md border border-neutral-300 bg-white px-2 text-sm" />
          <button type="submit" className="h-9 rounded-md border border-neutral-300 bg-white px-3 text-sm hover:bg-neutral-100">
            Найти
          </button>
        </form>
      </div>

      {shown.length === 0 ? (
        <p className="rounded-lg border border-dashed border-neutral-300 px-4 py-8 text-center text-sm text-neutral-500">
          {emptyForYear(year, "строк", "Строк нет — измените фильтр или поиск.")}
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
          <Link className="text-blue-700 hover:underline" href={href({ tab: tabId, filter: filter === "all" ? undefined : filter, q: q || undefined, all: "1" })}>
            Показать все
          </Link>
        </p>
      )}
      <p className="text-xs text-neutral-500">
        Связанные страницы: <Link className="text-blue-700 hover:underline" href="/reconciliation">Реестр сверки</Link> · <Link className="text-blue-700 hover:underline" href="/documents">Покрытие документами</Link> · <Link className="text-blue-700 hover:underline" href="/attention">Что не заведено</Link>
      </p>
    </div>
  );
}
