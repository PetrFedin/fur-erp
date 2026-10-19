import { Breadcrumbs } from "@/components/breadcrumbs";
import Link from "next/link";
import { WidgetRow } from "@/components/widget-row";
import { ControlTabs } from "@/components/control-tabs";
import { requireSession } from "@/lib/session";
import { Card } from "@/components/ui/card";
import { TILE_BOX } from "@/app/(app)/dashboard/tile";
import { InfoHint } from "@/components/info-hint";
import { cn } from "@/lib/utils";
import { getYearFilter, yearLabel } from "@/lib/year-filter";
import { loadRegistry } from "@/lib/reconciliation-registry";
import { loadOutsidePurchases } from "@/lib/reconciliation-outside";
import { loadLive, type Live } from "./live";
import { prisma } from "@/lib/prisma";
import { loadVerifyFlags, type VerifyFlags } from "@/lib/verification";
import { LazyDetails } from "../lots/lazy-details";
import { loadReconGroup } from "./group-action";
import { loadReconBridge, type BridgeRow, type ReconBridge } from "./bridge";
import { alignBridge } from "@/lib/recon-bridge-align";

import {
  calcInvoice,
  groupInvoices,
  totalsOf,
  visibleFor,
  isOpenGroup,
  type Group,
  type InvCalc,
  type Registry,
  type RecStatus,
  type Totals,
} from "./model";
import { RELIABILITY_NOTE } from "@/lib/reliability-note";
import { CountsLine, INV_TONE, Progress, money } from "./parts";
import { FromPurchaseButton, GroupFormButton, MarkCheckedButton } from "./recon-forms";
import { IntegritySection } from "./integrity-section";
import { StreamBlock } from "../stream-block";

export const metadata = { title: "Сверка" };
export const dynamic = "force-dynamic"; // цифры «в базе» читаются из БД при каждом заходе

const STATUS: Record<RecStatus, { label: string; hint: string; cls: string }> = {
  ok: { label: "Сходится на 100 %", hint: "документы = база = оплата", cls: "bg-emerald-50 text-emerald-800 border-emerald-200" },
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
    <InfoHint wide label="Как читать реестр: статусы и «подтверждено документами, %»" className="ml-1.5">
      <div className="space-y-2">
        <div className="font-semibold text-neutral-900">Как читать статусы счёта</div>
        <ul className="list-disc space-y-1 pl-4">
          <li><b>ПОДТВЕРЖДЕНО ДОКУМЕНТОМ</b> — по документам оплачено всё, остаток не превышает 3,96 ₽ (согласованный допуск на округление).</li>
          <li><b>ЧАСТИЧНО (N %)</b> — часть оплачена подтверждённо; N — доля оплаченного от суммы счёта.</li>
          <li><b>СОГЛАСОВАНО ПИСЬМОМ</b> — в переписке написано «согласовано / ок», но факта оплаты (платёжки, баланса, письма «оплачено») нет. Это не оплата.</li>
          <li><b>НЕ ПОДТВЕРЖДЕНО</b> — ни оплаты, ни согласования в документах нет.</li>
        </ul>
        <div className="font-semibold text-neutral-900">Чем подтверждена оплата</div>
        <ul className="list-disc space-y-1 pl-4">
          <li><b>подтверждено документом</b> — номер п/п (из УПД и единого реестра), баланс 040226, УПД, расчёт fin с отметкой «оплачено».</li>
          <li><b>согласовано письмом</b> (оплачено) — в письме Веллмех/Меркури Мода сказано «оплачено», но без даты и п/п.</li>
          <li><b>согласовано письмом, не оплата</b> — только «согласовано» (не деньги).</li>
          <li><b>не подтверждено</b> — вообще ничего. Банковских выписок и платёжек Меркури Мода в папке «мех» нет, поэтому «документами» — это косвенное подтверждение; полное — только выпиской.</li>
        </ul>
        <div className="font-semibold text-neutral-900">Как считается «подтверждено документами, %»</div>
        <p>
          Подтверждено документами, % = оплачено по документам ÷ сумма счетов × 100. Считаются только счета Веллмех (платим только посреднику ООО «Веллмех»).
          Для группы (аукцион или партия) — сумма по её счетам; для общего счёта на несколько групп берётся доля группы (по УПД). Полоса: зелёная — оплачено, голубая — только согласовано, серая — остаток.
        </p>
        <p className="text-neutral-600">{RELIABILITY_NOTE}</p>
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

/** Отметка «подтверждено вами / авто / не подтверждено» для группы (аукцион — по его закупкам, партия — по самой партии). */
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
  return { text: "Не подтверждено", cls: "border-amber-300 bg-amber-50 text-amber-900" };
}

function GroupBlock({ g, ids, live, ver, reg }: { g: Group; ids: Set<string>; live: Live; ver: { text: string; cls: string } | null; reg: Registry }) {
  const list = groupInvoices(g, ids, reg);
  const t = totalsOf(list);
  const db = live.group.get(g.id);
  const tone = groupTone(list);
  const st = STATUS[g.status];
  const dbShare = db && t.amount > 0 ? Math.min(100, (db.paid / t.amount) * 100) : 0;
  return (
    <LazyDetails
      className="group rounded-lg border border-neutral-200 bg-white"
      id={g.id}
      refreshKey={`${reg.rev}|${t.amount}|${t.paid}|${db?.paid ?? ""}|${g.status}`}
      load={loadReconGroup.bind(null, g.id)}
      summary={
      <summary className="flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5 text-sm [&::-webkit-details-marker]:hidden">
        <span className={cn("inline-block size-2.5 shrink-0 rounded-full", tone ? INV_TONE[tone].dot : "bg-neutral-400")} />
        <span className="min-w-0 flex-1 basis-56 font-medium">
          {db?.title ?? g.title}
          {db?.auctions?.length && !db.auctions.some((a) => (db.title ?? g.title).startsWith(a)) ? (
            <span className="ml-2 rounded bg-neutral-100 px-1.5 text-xs font-normal text-neutral-600" title="Короткое имя аукциона в справочнике (Настройки → Аукционы)">{db.auctions.join(", ")}</span>
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
          {list.length > 0 ? `${list.length} сч.: ${[t.closed ? `✓${t.closed}` : "", t.partial ? `½${t.partial}` : "", t.approved ? `согл.${t.approved}` : "", t.unpaid ? `✗${t.unpaid}` : ""].filter(Boolean).join(" · ")}` : ""}
        </span>
        <span className={cn("rounded-full border px-2 py-0.5 text-xs", st.cls)} title={st.hint}>{st.label}</span>
        {ver && (
          <Link href="/verify" className={cn("rounded-full border px-2 py-0.5 text-xs", ver.cls)} title="Подтверждение строки: откройте «Не подтверждено»">
            {ver.text}
          </Link>
        )}
      </summary>
      }
    />
  );
}

const ruDate = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split("-").reverse().join(".") : iso);
const signed = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${money(Math.abs(v))}`;

/** Короткий мост «Реестр документов → разница по статьям → Главная» (по всем годам; чтение, данные не меняются). */
function BridgeCard({ b, invCount }: { b: ReconBridge; invCount: number }) {
  // Целые рубли, сходящиеся на экране (src/lib/recon-bridge-align.ts): реестр + разница = Главная ровно.
  const sh = alignBridge(b);
  const rows = (list: BridgeRow[], vals: number[]) => list.map((r, i) => (
    <div key={i} className="flex items-baseline justify-between gap-3 border-t border-neutral-100">
      <div className="min-w-0 flex-1 py-1 pl-4">{r.label}{r.note ? <InfoHint label={r.label} wide>{r.note}</InfoHint> : null}</div>
      <div className="whitespace-nowrap py-1 text-right tabular-nums">{signed(vals[i])}</div>
    </div>
  ));
  const sp = b.purchase.reduce((a, r) => a + r.value, 0), sw = b.production.reduce((a, r) => a + r.value, 0);
  const ok = Math.abs(b.registry.total + sp + sw - b.main.total) < 1;
  return (
    <Card className="p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2 font-semibold">
        Мост: реестр документов → Главная
        <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700")}>{ok ? "сходится до рубля" : "не сходится"}</span>
        <InfoHint label="Откуда две суммы" wide>
          <p><b>Реестр</b> — Σ сумм всех счетов Веллмех из документов (закупки сырья и производство). <b>Главная</b> — «Общая стоимость» = оплачено + к оплате по сырью (мех, подкладка) и по работе: закупки и ТЗ в базе, а не счета.</p>
          <p className="mt-1">Разница — не ошибка расчёта: это разные меры одного и того же. «Есть в документах, нет в базе» ({money(b.missingInDb)}) — про оплаты, а не про суммы счетов, и в этот мост не входит. Мост строится по всем годам; цифры базы читаются при каждом заходе.</p>
          <p className="mt-1">Реестр {money(sh.registry.total)} {signed(sh.sp + sh.sw)} = Главная {money(sh.main.total)}.</p>
        </InfoHint>
      </div>
      <div className="mt-2 w-full max-w-4xl">
          <div className="flex items-baseline justify-between gap-3 border-t border-neutral-200 font-medium"><div className="min-w-0 py-1">Реестр документов ({invCount} счетов, все годы)</div><div className="min-w-0 whitespace-nowrap py-1 text-right tabular-nums">{money(sh.registry.total)}</div></div>
          <div className="flex items-baseline justify-between gap-3 text-neutral-600"><div className="min-w-0 py-1 pl-4">в т. ч. закупки сырья {money(sh.registry.purchase)} · производство {money(sh.registry.production)}</div></div>
          <div className="flex items-baseline justify-between gap-3 font-medium"><div className="min-w-0 pt-2">Закупки сырья: Главная − реестр ({signed(sh.sp)})</div></div>
          {rows(b.purchase, sh.purchase)}
          <div className="flex items-baseline justify-between gap-3 font-medium"><div className="min-w-0 pt-2">Работа подрядчику: Главная − реестр ({signed(sh.sw)})</div></div>
          {rows(b.production, sh.production)}
          <div className="flex items-baseline justify-between gap-3 border-t border-neutral-300 font-semibold"><div className="min-w-0 py-1">Главная: сырьё {money(sh.main.raw)} + работа подрядчику {money(sh.main.work)}</div><div className="min-w-0 whitespace-nowrap py-1 text-right tabular-nums">{money(sh.main.total)}</div></div>
      </div>
    </Card>
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
        </>
      ) : (
        <p className="text-sm text-neutral-500">Нет счетов за выбранный год.</p>
      )}
    </div>
  );
}

/** Мост считается отдельно от реестра и подгружается потоком: реестр счетов виден сразу. */
async function BridgeSection({ organizationId, live, reg }: { organizationId: string; live: Live; reg: Registry }) {
  const bridge = await loadReconBridge(organizationId, live, reg);
  return <BridgeCard b={bridge} invCount={reg.invoices.length} />;
}

export default async function ReconciliationPage() {
  const session = await requireSession(); // чтение — всем ролям
  const year = await getYearFilter();
  const orgId = session.user.organizationId;
  const reg = await loadRegistry(orgId);
  const [live, vf] = await Promise.all([loadLive(orgId, reg), loadVerifyFlags(prisma, orgId)]);
  const { invs, ids, groups } = visibleFor(year, reg);
  const canEdit = reg.source === "db" && (["OWNER", "ADMIN", "ACCOUNTANT"] as string[]).includes(session.user.role);
  const outside = reg.source === "db" ? await loadOutsidePurchases(orgId, reg) : [];
  const openGroups = groups.filter(isOpenGroup).length;

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
      <Breadcrumbs items={[{ label: "Контроль", href: "/attention" }, { label: "Сверка" }]} />
      <ControlTabs active="reconciliation" />
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold">Сверка</h1>
          <span className="rounded-full bg-neutral-900 px-2.5 py-0.5 text-xs font-medium text-white" data-testid="year-badge">
            Год: {year === "all" ? "все" : year}
          </span>
          <HowToRead />
        </div>
        <div className="mt-1 text-sm text-neutral-600">
          Счета Веллмех и оплата по документам · сверено {ruDate(reg.checkedAt)}
          <InfoHint wide label="О сверке">
            <p>Каждый счёт Веллмех — с оплатой по документам, остатком и тем, что записано в базе. База читается при каждом заходе ({yearLabel(year)}).</p>
            <p className="mt-2 text-neutral-500">{reg.source === "db" ? "Реестр хранится в базе: группы и счета добавляются и правятся кнопками на этой странице (владелец, администратор, бухгалтер); каждое изменение попадает в журнал." : "Реестр пока читается из файла: после переноса в базу появятся формы ввода."} Счетов в реестре: {reg.invoices.length}.</p>
          </InfoHint>
        </div>
      </div>

      {canEdit ? (
        <div className="flex flex-wrap items-center gap-2" data-testid="recon-toolbar">
          <GroupFormButton />
          <MarkCheckedButton lastLabel={ruDate(reg.checkedAt)} />
        </div>
      ) : null}

      {reg.recheck ? (
        <Card className="border-neutral-200 bg-neutral-50 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold">Перепроверка по документам · {ruDate(reg.recheck.date)}</div>
              <div className="mt-1 text-xs text-neutral-600">
                Подтверждено: {reg.recheck.found.length} · не найдено: {reg.recheck.notFound.length} · решений владельца: {reg.recheck.ownerDecisions.length}
                {reg.recheck.notFound.length > 0 && (
                  <InfoHint wide label="Что не найдено">
                    <ul className="space-y-1">{reg.recheck.notFound.map((x, i) => <li key={i}>• {x}</li>)}</ul>
                  </InfoHint>
                )}
              </div>
            </div>
            <Link href="/documents?gaps=1" className="btn-accent inline-flex h-7 items-center rounded-md border px-2 text-xs">
              Показать пробелы документов →
            </Link>
          </div>
        </Card>
      ) : null}

      <section className="space-y-2" aria-label="Итоги">
        <WidgetRow id="recon" title="Итоги">
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
        {year === "all" ? (
          <StreamBlock label="Мост «реестр документов → Главная»">
            <BridgeSection organizationId={orgId} live={live} reg={reg} />
          </StreamBlock>
        ) : (
          <Card className="p-3 text-sm text-neutral-600">Мост «реестр документов → Главная» строится по всем годам: выберите в шапке «Все годы».</Card>
        )}
        <Card className="flex flex-wrap items-center gap-x-4 gap-y-1 p-3 text-sm">
          <span data-testid="open-groups">
            Не сходятся: <b className="tabular-nums">{openGroups}</b> из {groups.length}
          </span>
          <InfoHint label="Что значит «не сходятся»" wide>
            Группы со статусом «Нет подтверждения оплаты», «Ручная проверка» или «Не сходится». Остальные сходятся по документам или полностью.
          </InfoHint>
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
          {reg.recheck ? (
            <InfoHint label="Что перепроверено" wide>
              <div className="space-y-2">
                <div className="font-semibold text-neutral-900">Перепроверка по документам, {reg.recheck.date}</div>
                <div>Найдено:</div>
                <ul className="list-disc space-y-1 pl-4">{reg.recheck.found.map((x, i) => <li key={i}>{x}</li>)}</ul>
                <div>Не найдено:</div>
                <ul className="list-disc space-y-1 pl-4">{reg.recheck.notFound.map((x, i) => <li key={i}>{x}</li>)}</ul>
                <div>Нужно решение владельца:</div>
                <ul className="list-disc space-y-1 pl-4">{reg.recheck.ownerDecisions.map((x, i) => <li key={i}>{x}</li>)}</ul>
              </div>
            </InfoHint>
          ) : null}
          {reg.superseded.length > 0 ? (
            <InfoHint label="Счета, заменённые новой редакцией" className="ml-auto">
              Не учитываются в итогах: {reg.superseded.map((s) => `№${s.no} на ${money(s.amountRub)} (${s.date})`).join("; ")} — заменены новой редакцией и не оплачивались.
            </InfoHint>
          ) : null}
        </Card>
      </section>

      {sections.map((sec) => {
        const list = groups.filter((g) => g.section === sec.key);
        const order = (g: Group) => {
          const l = groupInvoices(g, ids, reg);
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
              {sorted.length === 0 ? <p className="text-sm text-neutral-500">Нет групп за выбранный год — выберите «Все годы» в шапке.</p> : sorted.map((g) => <GroupBlock key={g.id} g={g} ids={ids} live={live} ver={verifyMark(g, vf)} reg={reg} />)}
            </div>
          </section>
        );
      })}

      {reg.source === "db" ? (
        <section id="outside" className="space-y-2" aria-label="Закупки вне групп">
          <h2 className="flex items-center gap-1.5 text-base font-semibold">
            Закупки вне групп
            <span className="text-sm font-normal text-neutral-500" data-testid="outside-count">· {outside.length}</span>
            <InfoHint label="Что это" wide>
              Закупки из базы, которые не входят ни в одну группу реестра: по ним ещё нет сверки со счетами. Кнопка подставляет контрагента, номер, дату и сумму из закупки и привязывает её к новой или существующей группе. Новая закупка попадает сюда сразу после создания.
            </InfoHint>
          </h2>
          {outside.length === 0 ? (
            <p className="text-sm text-neutral-500">Все закупки базы входят в группы реестра.</p>
          ) : (
            <div className="divide-y divide-neutral-100 rounded-lg border border-neutral-200 bg-white">
              {outside.map((b) => (
                <div key={b.key} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-sm" data-outside={b.key}>
                  <span className="min-w-0 flex-1 basis-56 font-medium">{b.title}<span className="ml-2 text-xs font-normal text-neutral-500">{b.counterparty}</span></span>
                  <span className="text-xs text-neutral-600">{b.numbers.length > 3 ? `${b.numbers.slice(0, 3).join(", ")} и ещё ${b.numbers.length - 3}` : b.numbers.join(", ")}</span>
                  <span className="tabular-nums">{money(b.total)}</span>
                  {canEdit ? (
                    <FromPurchaseButton b={b} groups={reg.groups.filter((g) => g.section === "purchase" && g.dbId).map((g) => ({ dbId: g.dbId!, title: g.title }))} />
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}

      <StreamBlock label="Проверка данных">
        <IntegritySection organizationId={session.user.organizationId} />
      </StreamBlock>
    </div>
  );
}
