import Link from "next/link";
import { requireSession } from "@/lib/session";
import { Card } from "@/components/ui/card";
import { formatMoney } from "@/lib/utils";
import { cn } from "@/lib/utils";
import data from "@/data/reconciliation.json";

export const metadata = { title: "Реестр сверки" };

type Status = "ok" | "docs" | "unpaid" | "conflict" | "empty";
type Group = (typeof data.groups)[number] & { status: Status };

const STATUS: Record<Status, { label: string; hint: string; cls: string; dot: string }> = {
  ok: { label: "Сходится на 100%", hint: "документы = база = оплата", cls: "bg-emerald-50 text-emerald-800 border-emerald-200", dot: "bg-emerald-500" },
  docs: { label: "По документам сходится", hint: "в базе копейки или оплата не привязана", cls: "bg-lime-50 text-lime-800 border-lime-200", dot: "bg-lime-500" },
  unpaid: { label: "Нет подтверждения оплаты", hint: "стоимость сходится, оплату нечем подтвердить", cls: "bg-amber-50 text-amber-800 border-amber-200", dot: "bg-amber-400" },
  conflict: { label: "Не сходится", hint: "документы противоречат базе или друг другу", cls: "bg-red-50 text-red-800 border-red-200", dot: "bg-red-500" },
  empty: { label: "Нет данных", hint: "в папке и в базе пусто", cls: "bg-neutral-100 text-neutral-600 border-neutral-200", dot: "bg-neutral-400" },
};
const ORDER: Status[] = ["ok", "docs", "unpaid", "conflict", "empty"];

const money = (v: number | null) => (v == null ? "—" : formatMoney(v));
const driveUrl = (id: string) => `https://drive.google.com/file/d/${id}/view`;

function Mark({ ok }: { ok: boolean | null }) {
  if (ok === null) return <span className="text-neutral-400">нет данных</span>;
  return ok ? <span className="text-emerald-600">✓</span> : <span className="text-red-600">✗</span>;
}

function GroupRow({ g }: { g: Group }) {
  const st = STATUS[g.status];
  return (
    <details className="group rounded-lg border border-neutral-200 bg-white" id={g.id}>
      <summary className="flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2.5 text-sm [&::-webkit-details-marker]:hidden">
        <span className={cn("inline-block size-2.5 shrink-0 rounded-full", st.dot)} />
        <span className="min-w-0 flex-1 basis-56 font-medium">
          {g.title}
          <span className="ml-2 text-xs font-normal text-neutral-500">{g.house}</span>
        </span>
        <span className="tabular-nums text-neutral-700">
          <span className="text-xs text-neutral-500">документы </span>
          {money(g.doc.costRub)}
        </span>
        <span className="tabular-nums text-neutral-700">
          <span className="text-xs text-neutral-500">оплачено </span>
          {money(g.doc.paidRub)}
        </span>
        <span className={cn("rounded-full border px-2 py-0.5 text-xs", st.cls)}>{st.label}</span>
      </summary>
      <div className="grid gap-4 border-t border-neutral-100 px-3 py-3 text-sm md:grid-cols-2">
        <div>
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-500">Проверки</div>
          <ul className="space-y-0.5">
            {g.checks.map((c) => (
              <li key={c.label} className="flex justify-between gap-3">
                <span>{c.label}</span>
                <Mark ok={c.ok} />
              </li>
            ))}
          </ul>
          <div className="mb-1 mt-3 text-xs font-medium uppercase tracking-wide text-neutral-500">Документы / база</div>
          <dl className="space-y-0.5 tabular-nums">
            <div className="flex justify-between gap-3"><dt>Счета</dt><dd>{money(g.doc.invoicesRub)}</dd></div>
            <div className="flex justify-between gap-3"><dt>В базе: стоимость</dt><dd>{money(g.db.costRub)}</dd></div>
            <div className="flex justify-between gap-3"><dt>В базе: оплачено</dt><dd>{money(g.db.paidRub)}</dd></div>
            <div className="flex justify-between gap-3"><dt>В базе: остаток</dt><dd>{money(g.db.remainingRub)}</dd></div>
          </dl>
          {g.db.refs ? <p className="mt-2 text-xs text-neutral-500">{g.db.refs}</p> : null}
          {g.files.length > 0 && (
            <div className="mt-3">
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-500">Документы Drive</div>
              <ul className="space-y-0.5">
                {g.files.map((f) => (
                  <li key={f.fileId} className="truncate">
                    <a href={driveUrl(f.fileId)} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline">
                      {f.title}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <div>
          {g.diffs.length > 0 && (
            <>
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-500">Расхождения</div>
              <ul className="space-y-2">
                {g.diffs.map((d, i) => (
                  <li key={i} className="rounded-md bg-neutral-50 p-2">
                    <div className="font-medium">{d.what}</div>
                    {d.doc && <div className="text-xs text-neutral-700">Документ: {d.doc}</div>}
                    {d.db && <div className="text-xs text-neutral-700">База: {d.db}</div>}
                    {d.why && <div className="text-xs text-neutral-500">Почему: {d.why}</div>}
                  </li>
                ))}
              </ul>
            </>
          )}
          {g.notes.length > 0 && (
            <ul className="mt-3 list-disc space-y-1 pl-4 text-xs text-neutral-600">
              {g.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </details>
  );
}

export default async function ReconciliationPage() {
  await requireSession(); // чтение — всем ролям
  const groups = data.groups as Group[];
  const sections = [
    { key: "purchase", title: "Закупка меха и сырья ↔ оплата" },
    { key: "production", title: "Производство ↔ оплата производства" },
  ] as const;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Реестр сверки</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Для каждой закупки и партии: счета, УПД, оплата по документам Drive и то, что записано в базе. СП — Союзпушнина, РП — Русьпушнина. Сверено {data.checkedAt}.
        </p>
        <p className="mt-1 text-xs text-neutral-500">{data.note}</p>
      </div>

      {sections.map((sec) => {
        const list = groups.filter((g) => g.section === sec.key);
        const counts = ORDER.map((s) => ({ s, n: list.filter((g) => g.status === s).length })).filter((x) => x.n > 0);
        return (
          <section key={sec.key} className="space-y-2">
            <h2 className="text-base font-semibold">{sec.title}</h2>
            <Card className="flex flex-wrap gap-x-5 gap-y-1 p-3 text-sm">
              {counts.map(({ s, n }) => (
                <span key={s} className="inline-flex items-center gap-1.5" title={STATUS[s].hint}>
                  <span className={cn("inline-block size-2.5 rounded-full", STATUS[s].dot)} />
                  {STATUS[s].label}: <b>{n}</b>
                </span>
              ))}
              <span className="text-neutral-500">из {list.length}</span>
            </Card>
            <div className="space-y-2">
              {ORDER.flatMap((s) => list.filter((g) => g.status === s)).map((g) => (
                <GroupRow key={g.id} g={g} />
              ))}
            </div>
          </section>
        );
      })}

      <p className="text-xs text-neutral-500">
        Данные собраны из отчётов сверки по папке «мех» (<code>npx tsx scripts/build-reconciliation.ts</code>). Недостающие документы — на странице{" "}
        <Link href="/documents" className="underline">Покрытие документами</Link>, список дел — «Что не заведено».
      </p>
    </div>
  );
}
