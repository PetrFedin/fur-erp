import Link from "next/link";
import { requireSession } from "@/lib/session";
import { Card } from "@/components/ui/card";
import { InfoHint } from "@/components/info-hint";
import { cn } from "@/lib/utils";
import { getYearFilter, yearLabel } from "@/lib/year-filter";
import data from "@/data/reconciliation.json";
import { loadLive, type Live } from "./live";
import { prisma } from "@/lib/prisma";
import { getCommission4Mode } from "@/lib/commission4-mode";
import { loadAuctionPanels } from "@/lib/auction-doc-checklist";
import { loadBatchPanels } from "@/lib/production-doc-checklist";
import { TONE_DOT, overallTone } from "@/lib/doc-panel";
import { loadVerifyFlags, type VerifyFlags } from "@/lib/verification";

/** Документы и оплата по группе — те же панели и статусы, что в карточках аукциона/партии и на «Документах». */
type DocInfo = { href: string; label: string; missing: number; proofMissing: number; dot: string };
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
import { ConfirmLine, CountsLine, GroupDbLine, INV_TONE, InvoiceHeader, InvoiceRow, Progress, driveUrl, money } from "./parts";

export const metadata = { title: "Реестр сверки" };
export const dynamic = "force-dynamic"; // цифры «в базе» читаются из БД при каждом заходе

const STATUS: Record<RecStatus, { label: string; hint: string; cls: string }> = {
  ok: { label: "Сходится на 100%", hint: "документы = база = оплата", cls: "bg-emerald-50 text-emerald-800 border-emerald-200" },
  docs: { label: "По документам сходится", hint: "в базе копейки или оплата не привязана", cls: "bg-lime-50 text-lime-800 border-lime-200" },
  unpaid: { label: "Нет подтверждения оплаты", hint: "стоимость сходится, оплату нечем подтвердить", cls: "bg-amber-50 text-amber-800 border-amber-200" },
  conflict: { label: "Не сходится", hint: "документы противоречат базе или друг другу", cls: "bg-red-50 text-red-800 border-red-200" },
  empty: { label: "Нет данных", hint: "в папке и в базе пусто", cls: "bg-neutral-100 text-neutral-600 border-neutral-200" },
};

function Mark({ ok }: { ok: boolean | null }) {
  if (ok === null) return <span className="text-neutral-400">нет данных</span>;
  return ok ? <span className="text-emerald-600">✓</span> : <span className="text-red-600">✗</span>;
}

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
          <li><b>ЗАКРЫТ</b> — по документам оплачено всё, остаток меньше 1 ₽ (копейки округления).</li>
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

function GroupBlock({ g, ids, live, doc, ver }: { g: Group; ids: Set<string>; live: Live; doc: DocInfo | null; ver: { text: string; cls: string } | null }) {
  const list = groupInvoices(g, ids);
  const t = totalsOf(list);
  const db = live.group.get(g.id);
  const tone = groupTone(list);
  const st = STATUS[g.status];
  const dbShare = db && t.amount > 0 ? Math.min(100, (db.paid / t.amount) * 100) : 0;
  return (
    <details className="group rounded-lg border border-neutral-200 bg-white" id={g.id}>
      <summary className="flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5 text-sm [&::-webkit-details-marker]:hidden">
        <span className={cn("inline-block size-2.5 shrink-0 rounded-full", tone ? INV_TONE[tone].dot : "bg-neutral-400")} />
        <span className="min-w-0 flex-1 basis-56 font-medium">
          {g.title}
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

      <div className="border-t border-neutral-100">
        {list.length > 0 ? (
          <>
            <InvoiceHeader />
            {list.map((c) => (
              <InvoiceRow key={c.inv.id} c={c} db={live.inv.get(c.inv.id)} groupId={g.id} />
            ))}
          </>
        ) : (
          <p className="px-3 py-2 text-xs text-neutral-500">Счетов Веллмех по этой группе в документах нет.</p>
        )}

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-neutral-100 bg-neutral-50 px-3 py-2 text-xs text-neutral-700">
          <GroupDbLine db={db} t={t} />
          {db?.note ? <span className="text-neutral-500">{db.note}</span> : null}
          <span>
            Документы: стоимость <b className="tabular-nums">{money(g.doc.costRub)}</b>, оплачено <b className="tabular-nums">{money(g.doc.paidRub)}</b>
          </span>
          <InfoHint label="Проверки и расхождения" wide>
            <div className="space-y-2">
              <div className="font-semibold text-neutral-900">Проверки</div>
              <ul className="space-y-0.5">
                {g.checks.map((c) => (
                  <li key={c.label} className="flex justify-between gap-3">
                    <span>{c.label}</span>
                    <Mark ok={c.ok} />
                  </li>
                ))}
              </ul>
              <dl className="space-y-0.5 tabular-nums">
                <div className="flex justify-between gap-3"><dt>Счета по документам</dt><dd>{money(g.doc.invoicesRub)}</dd></div>
                <div className="flex justify-between gap-3"><dt>Снимок базы: стоимость</dt><dd>{money(g.db.costRub)}</dd></div>
                <div className="flex justify-between gap-3"><dt>Снимок базы: оплачено</dt><dd>{money(g.db.paidRub)}</dd></div>
                <div className="flex justify-between gap-3"><dt>Снимок базы: остаток</dt><dd>{money(g.db.remainingRub)}</dd></div>
              </dl>
              {g.db.refs ? <p className="text-neutral-500">{g.db.refs}</p> : null}
              {g.diffs.length > 0 && (
                <>
                  <div className="font-semibold text-neutral-900">Расхождения ({g.diffs.length})</div>
                  <ul className="space-y-2">
                    {g.diffs.map((d, i) => (
                      <li key={i} className="rounded bg-neutral-50 p-2">
                        <div className="font-medium">{d.what}</div>
                        {d.doc && <div>Документ: {d.doc}</div>}
                        {d.db && <div>База: {d.db}</div>}
                        {d.why && <div className="text-neutral-500">Почему: {d.why}</div>}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {g.notes.length > 0 && (
                <>
                  <div className="font-semibold text-neutral-900">Заметки</div>
                  <ul className="list-disc space-y-1 pl-4">
                    {g.notes.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </InfoHint>
          {g.agreements && g.agreements.length > 0 ? (
            <InfoHint label="Согласования по группе" wide>
              <ul className="space-y-1">
                {g.agreements.map((a, i) => (
                  <li key={i}>{a.date ?? "—"} · {a.by || "—"} — {a.note}</li>
                ))}
              </ul>
            </InfoHint>
          ) : null}
          {doc ? (
            <Link href={doc.href} className="inline-flex flex-wrap items-center gap-1.5 hover:underline" title="Чек-лист документов, загрузка и отметка оплаты — в карточке">
              <span aria-hidden className={cn("inline-block size-2.5 rounded-full", doc.dot)} />
              <span>
                Документы и оплата: <b>{doc.label}</b>
                {doc.missing > 0 ? <span className="font-semibold text-red-700"> · нет документов: {doc.missing}</span> : null}
                {doc.proofMissing > 0 ? <span className="text-amber-700"> · платёжек нет: {doc.proofMissing}</span> : null}
              </span>
              <span className="text-blue-600">→</span>
            </Link>
          ) : null}
          {g.section === "production" && g.advanceRub ? (
            <span className="text-neutral-600">аванс, засчитанный в расчёте партии: <b className="tabular-nums">{money(g.advanceRub)}</b></span>
          ) : null}
          {g.files.length > 0 && (
            <InfoHint label="Документы Drive" wide>
              <ul className="space-y-0.5">
                {g.files.map((f) => (
                  <li key={f.fileId} className="truncate">
                    <a href={driveUrl(f.fileId)} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline">{f.title}</a>
                  </li>
                ))}
              </ul>
            </InfoHint>
          )}
        </div>
      </div>
    </details>
  );
}

function SummaryCard({ title, t, hint }: { title: string; t: Totals; hint?: React.ReactNode }) {
  return (
    <Card className="space-y-2 p-3">
      <div className="flex items-center gap-1 text-sm font-semibold">
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
    </Card>
  );
}

export default async function ReconciliationPage() {
  const session = await requireSession(); // чтение — всем ролям
  const year = await getYearFilter();
  const live = await loadLive(session.user.organizationId);
  const { invs, ids, groups } = visibleFor(year);
  const c4Mode = await getCommission4Mode();
  const vf = await loadVerifyFlags(prisma, session.user.organizationId);
  const [auctionPanels, batchPanels] = await Promise.all([
    loadAuctionPanels(prisma, session.user.organizationId, { canUpload: false, canMark: false }),
    loadBatchPanels(prisma, session.user.organizationId, { c4Mode, canUpload: false, canMark: false }),
  ]);
  const docFor = (g: Group): DocInfo | null => {
    const hit =
      g.section === "production"
        ? batchPanels.find((b) => b.number === g.dbLink.batch)
        : auctionPanels.find((a) => (g.dbLink.purchases ?? []).some((n) => a.purchaseNumbers.includes(n)));
    if (!hit) return null;
    const p = hit.panel;
    return {
      href: "batchId" in hit ? `/production/batches/${hit.number}` : (p.href ?? "/lots"),
      label: p.pay.label,
      missing: p.missingCount,
      proofMissing: p.proofMissing,
      dot: TONE_DOT[overallTone(p.missingCount, p.pay, p.proofMissing)],
    };
  };

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
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold">Реестр сверки</h1>
          <span className="rounded-full bg-neutral-900 px-2.5 py-0.5 text-xs font-medium text-white" data-testid="year-badge">
            Год: {year === "all" ? "все" : year}
          </span>
          <HowToRead />
        </div>
        <p className="mt-1 text-sm text-neutral-600">
          Каждый счёт Веллмех — с оплатой по документам, остатком и тем, что записано в базе. Сверено {data.checkedAt}; база читается при каждом заходе ({yearLabel(year)}).
        </p>
      </div>

      <section className="space-y-2" aria-label="Итоги">
        <SummaryCard title="Итого по всему реестру" t={totalAll} />
        <div className="grid gap-2 md:grid-cols-2">
          {sections.map((sec) => {
            const t = totalsOf(calcAll.filter((c) => c.inv.section === sec.key));
            return <SummaryCard key={sec.key} title={sec.title} t={t} />;
          })}
        </div>
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
        const t = totalsOf(calcAll.filter((c) => c.inv.section === sec.key));
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
            <Card className="space-y-1 p-3">
              <Progress t={t} />
              <CountsLine t={t} />
            </Card>
            <div className="space-y-2">
              {sorted.length === 0 ? <p className="text-sm text-neutral-500">Нет групп за выбранный год.</p> : sorted.map((g) => <GroupBlock key={g.id} g={g} ids={ids} live={live} doc={docFor(g)} ver={verifyMark(g, vf)} />)}
            </div>
          </section>
        );
      })}

      <p className="text-xs text-neutral-500">
        Строки документов собраны скриптом <code>npx tsx scripts/build-reconciliation.ts</code> (файл src/data/reconciliation.json + docs-inventory/reconciliation-extra.json). Недостающие документы — на странице{" "}
        <Link href="/documents" className="underline">Покрытие документами</Link>, список дел — «Что не заведено». Счетов в реестре: {ALL_INVOICES.length}.
      </p>
    </div>
  );
}
