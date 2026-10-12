import Link from "next/link";
import { WidgetRow } from "@/components/widget-row";
import { ControlTabs } from "@/components/control-tabs";
import { requireSession } from "@/lib/session";
import { Card } from "@/components/ui/card";
import { TILE_BOX } from "@/app/(app)/dashboard/tile";
import { InfoHint } from "@/components/info-hint";
import { cn } from "@/lib/utils";
import { getYearFilter, yearLabel } from "@/lib/year-filter";
import data from "@/data/reconciliation.json";
import { loadLive, type Live } from "./live";
import { prisma } from "@/lib/prisma";
import { loadVerifyFlags, type VerifyFlags } from "@/lib/verification";
import { LazyDetails } from "../lots/lazy-details";
import { loadReconGroup } from "./group-action";

import {
  ALL_INVOICES,
  RECHECK,
  SUPERSEDED,
  calcInvoice,
  groupInvoices,
  totalsOf,
  visibleFor,
  type Group,
  type InvCalc,
  type RecStatus,
  type Totals,
} from "./model";
import { ConfirmLine, CountsLine, INV_TONE, Progress, money } from "./parts";

export const metadata = { title: "Сверка" };
export const dynamic = "force-dynamic"; // цифры «в базе» читаются из БД при каждом заходе

const STATUS: Record<RecStatus, { label: string; hint: string; cls: string }> = {
  ok: { label: "Сходится на 100%", hint: "документы = база = оплата", cls: "bg-emerald-50 text-emerald-800 border-emerald-200" },
  docs: { label: "По документам сходится", hint: "в базе копейки или оплата не привязана", cls: "bg-lime-50 text-lime-800 border-lime-200" },
  unpaid: { label: "Нет подтверждения оплаты", hint: "стоимость сходится, оплату нечем подтвердить", cls: "bg-amber-50 text-amber-800 border-amber-200" },
  review: { label: "Ручная проверка", hint: "арифметика понятна, но нужен первичный документ или решение человека", cls: "bg-orange-50 text-orange-900 border-orange-300" },
  conflict: { label: "Не сходится", hint: "документы противоречат базе или друг другу", cls: "bg-red-50 text-red-800 border-red-200" },
  empty: { label: "Нет данных", hint: "в папке и в базе пусто", cls: "bg-neutral-100 text-neutral-600 border-neutral-200" },
};

function groupTone(list: InvCalc[]): keyof typeof INV_TONE | null {
  if (!list.length) return null;
  if (list.every((c) => c.status === "closed")) return "closed";
  if (list.some((c) => c.status === "partial" || c.status === "closed")) return "partial";
  if (list.some((c) => c.status === "approved")) return "approved";
  return "unpaid";
}

function HowToRead() {
  return (
    <InfoHint wide label="Как читать реестр: статусы и «закрыто %»" className="ml-1.5">
      <div className="space-y-2">
        <div className="font-semibold text-neutral-900">Как читать статусы счёта</div>
        <ul className="list-disc space-y-1 pl-4">
          <li><b>ЗАКРЫТ</b> — по документам оплачено всё, остаток не превышает 3,96 ₽ (согласованный допуск на округление).</li>
          <li><b>ЧАСТИЧНО (N %)</b> — часть оплачена подтверждённо; N — доля оплаченного от суммы счёта.</li>
          <li><b>ТОЛЬКО СОГЛАСОВАН</b> — в переписке написано «согласовано / ок», но факта оплаты (платёжки, баланса, письма «оплачено») нет. Это не оплата.</li>
          <li><b>НЕ ОПЛАЧЕН</b> — ни оплаты, ни согласования в документах нет.</li>
        </ul>
        <div className="font-semibold text-neutral-900">Чем подтверждена оплата</div>
        <ul className="list-disc space-y-1 pl-4">
          <li><b>документами</b> — номер п/п (из УПД и единого реестра), баланс 040226, УПД, расчёт fin с отметкой «оплачено».</li>
          <li><b>только письмом</b> — в письме Веллмех/Меркури Мода сказано «оплачено», но без даты и п/п.</li>
          <li><b>только согласовано</b> — только «согласовано» (не деньги).</li>
          <li><b>нет подтверждения</b> — вообще ничего. Банковских выписок и платёжек Меркури Мода в папке «мех» нет, поэтому «документами» — это косвенное подтверждение; полное — только выпиской.</li>
        </ul>
        <div className="font-semibold text-neutral-900">Как считается «закрыто %»</div>
        <p>
          Закрыто % = оплачено по документам ÷ сумма счетов × 100. Считаются только счета Веллмех (платим только посреднику ООО «Веллмех»).
          Для группы (аукцион или партия) — сумма по её счетам; для общего счёта на несколько групп берётся доля группы (по УПД). Полоса: зелёная — оплачено, голубая — только согласовано, серая — остаток.
        </p>
        <div className="font-semibold text-neutral-900">«В базе»</div>
        <p>
          Живой расчёт при каждом заходе: платежи Payment / ProductionPayment из базы, привязанные к группе (по закупкам, аукциону, ТЗ партии) и к счёту (по ссылке «счёт №N» в платеже).
          Если оплата есть в документах, а в базе её нет — пометка «нет в базе».
        </p>
        <div className="font-semibold text-neutral-900">Год</div>
        <p>
          Фильтр года берётся из шапки (Все / 2025 / 2026). Счёт относится к году по дате счёта (счёт без даты — по году письма); группа видна, если в ней есть счёт этого года; группа без счетов — по году аукциона или партии. Итоги пересчитываются.
        </p>
      </div>
    </InfoHint>
  );
}

/** Отметка «подтверждено вами / авто / ждёт проверки» для группы (аукцион — по его закупкам, партия — по самой партии). */
function verifyMark(g: Group, vf: VerifyFlags): { text: string; cls: string } | null {
  const flags = g.section === "production" ? (g.dbLink.batch != null && vf.batchByNumber.get(g.dbLink.batch) ? [vf.batchByNumber.get(g.dbLink.batch)!] : []) : (g.dbLink.purchases ?? []).map((n) => vf.purchaseByNumber.get(n)).filter((x): x is NonNullable<typeof x> => !!x);
  if (flags.length === 0) return null;
  const ok = flags.filter((f) => f.verified);
  if (ok.length === flags.length) {
    const auto = ok.every((f) => f.auto);
    const manual = ok.every((f) => !f.auto);
    return { text: `Подтверждено ✓ ${auto ? "авто по документам" : manual ? "вами" : "вами и авто"}`, cls: "border-emerald-300 bg-emerald-50 text-emerald-800" };
  }
  if (ok.length > 0) return { text: `Подтверждено ${ok.length} из ${flags.length}`, cls: "border-amber-300 bg-amber-50 text-amber-900" };
  return { text: "Ждёт проверки", cls: "border-amber-300 bg-amber-50 text-amber-900" };
}

function GroupBlock({ g, ids, live, ver }: { g: Group; ids: Set<string>; live: Live; ver: { text: string; cls: string } | null }) {
  const list = groupInvoices(g, ids);
  const t = totalsOf(list);
  const db = live.group.get(g.id);
  const tone = groupTone(list);
  const st = STATUS[g.status];
  const dbShare = db && t.amount > 0 ? Math.min(100, (db.paid / t.amount) * 100) : 0;
  return (
    <LazyDetails
      className="group rounded-lg border border-neutral-200 bg-white"
      id={g.id}
      load={loadReconGroup.bind(null, g.id)}
      summary={
      <summary className="flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5 text-sm [&::-webkit-details-marker]:hidden">
        <span className={cn("inline-block size-2.5 shrink-0 rounded-full", tone ? INV_TONE[tone].dot : "bg-neutral-400")} />
        <span className="min-w-0 flex-1 basis-56 font-medium">
          {db?.title ?? g.title}
          {db?.auctions?.length && !db.auctions.some((a) => (db.title ?? g.title).startsWith(a)) ? (
            <span className="ml-2 rounded bg-sky-50 px-1.5 text-xs font-normal text-sky-700" title="Короткое имя аукциона в справочнике (Настройки → Аукционы)">{db.auctions.join(", ")}</span>
          ) : null}
          <span className="ml-2 text-xs font-normal text-neutral-500">{g.house}</span>
          {g.year ? <span className="ml-2 rounded bg-neutral-100 px-1.5 text-xs font-normal text-neutral-600">{g.year}</span> : null}
        </span>
        {list.length > 0 ? (
          <span className="basis-64 min-w-0 flex-1">
            <Progress t={t} db={db ? { paid: db.paid, pct: dbShare } : null} />
          </span>
        ) : (
          <span className="text-xs text-neutral-500">счетов Веллмех нет</span>
        )}
        <span className="text-xs text-neutral-600">
          {list.length > 0 ? `${list.length} сч.: ✓${t.closed} · ½${t.partial} · согл.${t.approved} · ✗${t.unpaid}` : ""}
        </span>
        <span className={cn("rounded-full border px-2 py-0.5 text-xs", st.cls)} title={st.hint}>Сверка: {st.label.toLowerCase()}</span>
        {ver && (
          <Link href="/verify" className={cn("rounded-full border px-2 py-0.5 text-xs", ver.cls)} title="Подтверждение строки: откройте «Ждёт проверки»">
            {ver.text}
          </Link>
        )}
      </summary>
      }
    />
  );
}

function SummaryCard({ title, t, hint }: { title: string; t: Totals; hint?: React.ReactNode }) {
  return (
    <div className={TILE_BOX + " gap-2 shadow-sm print:shadow-none"}>
      <div className="flex items-center gap-1 text-sm font-medium">
        {title}
        {hint}
      </div>
      {t.count > 0 ? (
        <>
          <Progress t={t} />
          <CountsLine t={t} />
          <ConfirmLine t={t} />
        </>
      ) : (
        <p className="text-sm text-neutral-500">Нет счетов за выбранный год.</p>
      )}
    </div>
  );
}

export default async function ReconciliationPage() {
  const session = await requireSession(); // чтение — всем ролям
  const year = await getYearFilter();
  const live = await loadLive(session.user.organizationId);
  const { invs, ids, groups } = visibleFor(year);
  const vf = await loadVerifyFlags(prisma, session.user.organizationId);

  const sections = [
    { key: "purchase", title: "Закупка меха и сырья ↔ счета ↔ оплата" },
    { key: "production", title: "Производство ↔ счета (аванс / доплата) ↔ оплата" },
  ] as const;

  const calcAll = invs.map((i) => calcInvoice(i));
  const totalAll = totalsOf(calcAll);

  // «есть в документах, нет в базе»
  const missingInDb = invs
    .map((i) => {
      const docs = i.paid.filter((p) => p.evidence === "fact").reduce((a, p) => a + p.amountRub, 0);
      const dbPaid = live.inv.get(i.id)?.paid ?? 0;
      return { i, miss: docs - dbPaid };
    })
    .filter((x) => x.miss > 1);
  const missingRub = missingInDb.reduce((a, x) => a + x.miss, 0);

  return (
    <div className="space-y-6">
      <ControlTabs active="reconciliation" />
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold">Сверка</h1>
          <span className="rounded-full bg-neutral-900 px-2.5 py-0.5 text-xs font-medium text-white" data-testid="year-badge">
            Год: {year === "all" ? "все" : year}
          </span>
          <HowToRead />
        </div>
        <p className="mt-1 text-sm text-neutral-600">
          Счета Веллмех и оплата по документам · сверено {data.checkedAt}
          <InfoHint wide label="О сверке">
            <p>Каждый счёт Веллмех — с оплатой по документам, остатком и тем, что записано в базе. База читается при каждом заходе ({yearLabel(year)}).</p>
            <p className="mt-2 text-neutral-500">Строки документов собраны скриптом <code>npx tsx scripts/build-reconciliation.ts</code> (src/data/reconciliation.json + docs-inventory/reconciliation-extra.json). Счетов в реестре: {ALL_INVOICES.length}.</p>
          </InfoHint>
        </p>
      </div>

      {RECHECK ? (
        <Card className="border-blue-200 bg-blue-50/60 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold text-blue-950">Перепроверка по актуальной структуре Google Drive · {RECHECK.date}</div>
              <div className="mt-1 text-xs text-blue-900/80">
                Подтверждено: {RECHECK.found.length} · не найдено: {RECHECK.notFound.length} · решений владельца: {RECHECK.ownerDecisions.length}
                {RECHECK.notFound.length > 0 && (
                  <InfoHint wide label="Что не найдено">
                    <ul className="space-y-1">{RECHECK.notFound.map((x, i) => <li key={i}>• {x}</li>)}</ul>
                  </InfoHint>
                )}
              </div>
            </div>
            <Link href="/documents?gaps=1" className="rounded-md border border-blue-300 bg-white px-3 py-1.5 text-xs font-medium text-blue-900 hover:bg-blue-100">
              Показать пробелы документов →
            </Link>
          </div>
        </Card>
      ) : null}

      <section className="space-y-2" aria-label="Итоги">
        <WidgetRow id="recon" title="Сверка — итоги">
          <div className="space-y-2">
            <SummaryCard title="Всего, ₽ по всему реестру" t={totalAll} />
            <div className="grid gap-2 md:grid-cols-2">
              {sections.map((sec) => {
                const t = totalsOf(calcAll.filter((c) => c.inv.section === sec.key));
                return <SummaryCard key={sec.key} title={sec.title} t={t} />;
              })}
            </div>
          </div>
        </WidgetRow>
        <Card className="flex flex-wrap items-center gap-x-4 gap-y-1 p-3 text-sm">
          <span>
            Есть в документах, нет в базе: <b className="tabular-nums">{money(missingRub)}</b> по {missingInDb.length} счетам
          </span>
          <InfoHint label="Какие платежи не внесены в базу" wide>
            {missingInDb.length === 0 ? (
              "Все платежи по документам отражены в базе."
            ) : (
              <ul className="space-y-0.5">
                {missingInDb.map(({ i, miss }) => (
                  <li key={i.id} className="flex justify-between gap-3">
                    <span>Счёт №{i.no ?? "—"} от {i.date ?? i.year} ({i.purpose.slice(0, 50)})</span>
                    <b className="tabular-nums">{money(miss)}</b>
                  </li>
                ))}
              </ul>
            )}
          </InfoHint>
          {live.orphans.length > 0 ? (
            <span className="text-xs text-amber-700">
              В базе {live.orphans.length} платеж(ей) со ссылкой на счёт, которого нет в реестре
              <InfoHint label="Платежи базы без счёта" className="ml-1">
                <ul>{live.orphans.map((o, i) => <li key={i}>{o.paidAt} · {money(o.amount)} · {o.docRef}</li>)}</ul>
              </InfoHint>
            </span>
          ) : null}
          {RECHECK ? (
            <InfoHint label="Что перепроверено по Drive" wide>
              <div className="space-y-2">
                <div className="font-semibold text-neutral-900">Перепроверка по документам Drive, {RECHECK.date}</div>
                <div>Найдено:</div>
                <ul className="list-disc space-y-1 pl-4">{RECHECK.found.map((x, i) => <li key={i}>{x}</li>)}</ul>
                <div>Не найдено:</div>
                <ul className="list-disc space-y-1 pl-4">{RECHECK.notFound.map((x, i) => <li key={i}>{x}</li>)}</ul>
                <div>Нужно решение владельца:</div>
                <ul className="list-disc space-y-1 pl-4">{RECHECK.ownerDecisions.map((x, i) => <li key={i}>{x}</li>)}</ul>
              </div>
            </InfoHint>
          ) : null}
          {SUPERSEDED.length > 0 ? (
            <InfoHint label="Счета, заменённые новой редакцией" className="ml-auto">
              Не учитываются в итогах: {SUPERSEDED.map((s) => `№${s.no} на ${money(s.amountRub)} (${s.date})`).join("; ")} — заменены новой редакцией и не оплачивались.
            </InfoHint>
          ) : null}
        </Card>
      </section>

      {sections.map((sec) => {
        const list = groups.filter((g) => g.section === sec.key);
        const order = (g: Group) => {
          const l = groupInvoices(g, ids);
          const tone = groupTone(l);
          return tone === "unpaid" ? 0 : tone === "approved" ? 1 : tone === "partial" ? 2 : tone === "closed" ? 3 : 4;
        };
        const sorted = [...list].sort((a, b) => order(a) - order(b));
        return (
          <section key={sec.key} className="space-y-2">
            <h2 className="flex items-center gap-1.5 text-base font-semibold">
              {sec.title}
              <span className="text-sm font-normal text-neutral-500">· {list.length} групп</span>
              <InfoHint label="Что в этом разделе" wide>
                {sec.key === "purchase"
                  ? "Аукционы и закупки меха и сырья (СП — Союзпушнина, РП — Русьпушнина, SAGA, AME, FH и др.). Группа = аукцион; в ней — счета Веллмех (аванс, промежуточные платежи, финал). Общие платежи на два аукциона (аванс 34 825 000 ₽ СП+РП 03.25; 27 912 500 ₽ РП 04-26+СП 05-26; 30 666 300 ₽ СП+РП 05.25) показаны один раз в каждой группе долей и помечены «общий платёж»."
                  : "Партии пошива и авансы подрядчику Веллмех: счета на аванс (70 %) и на доплату за каждую партию. Аванс засчитывается в расчёте партии; сумма счёта на доплату — отдельная строка. Партии без счёта (8, 15, 16) — доплата включена в другой счёт или данных нет."}
              </InfoHint>
            </h2>
            <div className="space-y-2">
              {sorted.length === 0 ? <p className="text-sm text-neutral-500">Нет групп за выбранный год.</p> : sorted.map((g) => <GroupBlock key={g.id} g={g} ids={ids} live={live} ver={verifyMark(g, vf)} />)}
            </div>
          </section>
        );
      })}

    </div>
  );
}
