import { InfoHint } from "@/components/info-hint";
import { cn, formatMoney } from "@/lib/utils";
import {
  BASIS_LABEL,
  CONFIRM_LABEL,
  INV_STATUS_LABEL,
  invLabel,
  TOL,
  type InvCalc,
  type InvStatus,
  type Totals,
} from "./model";
import type { GroupDb, InvDb } from "./live";

export const money = (v: number | null | undefined) => (v == null ? "—" : formatMoney(v));
const dmy = (d: string | null, approx?: boolean) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}${approx ? " (≈)" : ""}` : "дата не найдена");
const pct = (v: number) => `${v >= 99.95 || v <= 0.05 ? Math.round(v) : v.toFixed(1).replace(".", ",")} %`;

export const INV_TONE: Record<InvStatus, { cls: string; dot: string; bar: string }> = {
  closed: { cls: "bg-emerald-50 text-emerald-800 border-emerald-200", dot: "bg-emerald-500", bar: "bg-emerald-500" },
  partial: { cls: "bg-amber-50 text-amber-800 border-amber-200", dot: "bg-amber-400", bar: "bg-amber-400" },
  approved: { cls: "bg-sky-50 text-sky-800 border-sky-200", dot: "bg-sky-500", bar: "bg-sky-400" },
  unpaid: { cls: "bg-red-50 text-red-800 border-red-200", dot: "bg-red-500", bar: "bg-red-500" },
};

export function Bar({ paid, approved = 0, total, className }: { paid: number; approved?: number; total: number; className?: string }) {
  const a = total > 0 ? Math.min(100, (paid / total) * 100) : 0;
  const b = total > 0 ? Math.min(100 - a, (approved / total) * 100) : 0;
  return (
    <div className={cn("flex h-2 w-full overflow-hidden rounded-full bg-neutral-200", className)} role="img" aria-label={`закрыто ${pct(a)}`}>
      <div className="h-full bg-emerald-500" style={{ width: `${a}%` }} />
      <div className="h-full bg-sky-300" style={{ width: `${b}%` }} />
    </div>
  );
}

export function StatusPill({ c }: { c: InvCalc }) {
  return <span className={cn("inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium", INV_TONE[c.status].cls)}>{INV_STATUS_LABEL(c)}</span>;
}

/** Блок «закрыто X % на сумму Y из Z» + разбивка по подтверждению. */
export function Progress({ t, db }: { t: Totals; db?: { paid: number; pct: number } | null }) {
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
        <b className="tabular-nums">закрыто {pct(t.pct)}</b>
        <span className="tabular-nums text-neutral-600">
          на {money(t.paid)} из {money(t.amount)}
        </span>
        {db ? <span className="tabular-nums text-neutral-500">· в базе {pct(db.pct)}</span> : null}
      </div>
      <Bar paid={t.paid} approved={t.approvedRub} total={t.amount} className="mt-1" />
    </div>
  );
}

export function CountsLine({ t }: { t: Totals }) {
  const item = (tone: InvStatus, label: string, n: number, rub: number) => (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("inline-block size-2.5 rounded-full", INV_TONE[tone].dot)} />
      {label}: <b>{n}</b>
      <span className="tabular-nums text-xs text-neutral-500">{money(rub)}</span>
    </span>
  );
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
      {item("closed", "закрыто", t.closed, t.closedRub)}
      {item("partial", "частично", t.partial, t.partialRub)}
      {item("approved", "только согласован", t.approved, t.approvedStatusRub)}
      {item("unpaid", "не оплачен", t.unpaid, t.unpaidRub)}
      <span className="text-neutral-500">из {t.count} счетов</span>
    </div>
  );
}

export function ConfirmLine({ t }: { t: Totals }) {
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-neutral-700">
      <span>
        Оплата подтверждена документами: <b className="tabular-nums">{money(t.paidDocs)}</b>
      </span>
      <span>
        только письмом: <b className="tabular-nums">{money(t.paidLetter)}</b>
      </span>
      <span>
        только согласовано (не оплата): <b className="tabular-nums">{money(t.approvedRub)}</b>
      </span>
      <span>
        нет подтверждения: <b className="tabular-nums">{money(t.noneRub)}</b>
      </span>
    </div>
  );
}

function PayLines({ c, db }: { c: InvCalc; db: InvDb | undefined }) {
  const { inv } = c;
  const shown = inv.paid.filter((p) => p.evidence !== "planned");
  if (!shown.length && !inv.paid.length)
    return <span className="text-neutral-500">оплат по документам нет{inv.approvals.length ? "; в переписке — согласование" : ""}</span>;
  return (
    <ul className="space-y-1.5">
      {inv.paid.map((p, i) => (
        <li key={i} className="text-xs leading-snug">
          <span className="tabular-nums font-medium">{money(p.amountRub)}</span>{" "}
          {p.evidence === "fact" ? (
            <span className={cn("rounded px-1", p.basis === "letter" ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-900")}>
              {p.basis === "letter" ? "оплачено (письмо)" : "оплачено"}
            </span>
          ) : p.evidence === "approved" ? (
            <span className="rounded bg-sky-100 px-1 text-sky-900">согласовано, не оплата</span>
          ) : (
            <span className="rounded bg-neutral-100 px-1 text-neutral-700">ожидается</span>
          )}{" "}
          <span className="text-neutral-700">{dmy(p.date, p.dateApprox)}</span>
          {p.ppNo ? <span className="text-neutral-700">, п/п №{p.ppNo}</span> : null}
          {p.basis ? <span className="text-neutral-500">, {BASIS_LABEL[p.basis]}</span> : null}
          <InfoHint label="Источник платежа" wide className="ml-1">
            <div className="space-y-1">
              <div>
                <b>{money(p.amountRub)}</b> — {p.evidence === "fact" ? "оплата подтверждена" : p.evidence === "approved" ? "только согласование, факт оплаты не найден" : "платёж ожидается"}
              </div>
              <div>Источник: {p.source}</div>
              {p.note ? <div>Примечание: {p.note}</div> : null}
              {p.dateApprox ? <div>Дата в документе невозможна или неточна — указана вероятная.</div> : null}
              {p.basis !== "pp" && p.evidence === "fact" ? <div>Номера платёжки нет; банковской выписки в документах нет.</div> : null}
            </div>
          </InfoHint>
        </li>
      ))}
      {c.approved > TOL && inv.paid.every((p) => p.evidence !== "approved") ? (
        <li className="text-xs text-sky-800">согласовано в переписке: {money(c.approved)}</li>
      ) : null}
      {db && db.pays.length === 0 ? null : null}
    </ul>
  );
}

function dbCell(c: InvCalc, db: InvDb | undefined) {
  const docs = c.inv.paid.filter((p) => p.evidence === "fact").reduce((a, p) => a + p.amountRub, 0);
  const dbPaid = db?.paid ?? 0;
  const diff = docs - dbPaid;
  if (diff > TOL && dbPaid <= TOL) return { text: "нет в базе", sub: docs > TOL ? "есть в документах" : "", tone: docs > TOL ? "text-red-700" : "text-neutral-500" };
  if (diff > TOL) return { text: money(dbPaid), sub: `не хватает ${money(diff)}`, tone: "text-amber-700" };
  if (diff < -TOL) return { text: money(dbPaid), sub: `больше, чем в документах на ${money(-diff)}`, tone: "text-amber-700" };
  return { text: dbPaid > TOL ? money(dbPaid) : "—", sub: dbPaid > TOL ? "сходится" : "", tone: dbPaid > TOL ? "text-emerald-700" : "text-neutral-500" };
}

export function InvoiceRow({ c, db, groupId }: { c: InvCalc; db: InvDb | undefined; groupId: string }) {
  const { inv } = c;
  const shared = inv.groupIds.length > 1;
  const cell = dbCell(c, db);
  const share = inv.shares[groupId];
  const label = (s: string) => <span className="text-[11px] uppercase tracking-wide text-neutral-400 xl:hidden">{s} </span>;
  return (
    <div
      className="grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-neutral-100 px-3 py-2.5 text-sm xl:grid-cols-[6.5rem_9rem_minmax(0,1fr)_minmax(0,1.5fr)_8rem_9rem_10rem] xl:items-start"
      data-invoice={inv.no ?? "none"}
    >
      <div className="font-medium">
        {invLabel(inv)}
        <span className="block text-xs font-normal text-neutral-500">{dmy(inv.date) === "дата не найдена" ? (inv.year ? `${inv.year}, дата не найдена` : "—") : dmy(inv.date)}</span>
      </div>
      <div className="xl:order-last">
        <StatusPill c={c} />
        <div className="mt-1 text-[11px] text-neutral-500">{CONFIRM_LABEL[c.confirm]}</div>
      </div>
      <div className="tabular-nums">
        {label("Сумма")}
        {money(c.amount)}
        {shared ? (
          <span className="block text-xs text-neutral-500">
            общий платёж: счёт {money(inv.amountRub)}
            <InfoHint label="Общий платёж" className="ml-1">
              Один счёт Веллмех покрывает несколько групп и показан в каждой своей долей{share != null ? ` (здесь ${money(share)})` : ""}. Разнесение — по УПД или по спецификации; платёж учтён один раз.
            </InfoHint>
          </span>
        ) : null}
      </div>
      <div className="col-span-2 min-w-0 text-xs text-neutral-700 xl:col-span-1">
        {label("За что")}
        <span className="break-words">{inv.purpose || "—"}</span>
        {inv.fileId ? (
          <span className="ml-1 text-neutral-500">счёт есть</span>
        ) : (
          <span className="ml-1 text-red-700">счёта нет в документах</span>
        )}
        {inv.notes.map((n, i) => (
          <InfoHint key={i} label="Примечание" className="ml-1">{n}</InfoHint>
        ))}
        {inv.approvals.length > 0 && (
          <InfoHint label="Согласования" wide className="ml-1">
            <ul className="space-y-1">
              {inv.approvals.map((a, i) => (
                <li key={i}>{dmy(a.date)} {a.by ? `· ${a.by}` : ""} — {a.note}</li>
              ))}
            </ul>
          </InfoHint>
        )}
      </div>
      <div className="col-span-2 min-w-0 xl:col-span-1">
        {label("Оплачено по документам")}
        <PayLines c={c} db={db} />
        {shared ? <div className="mt-1 text-[11px] text-neutral-500">общий платёж показан целиком; доля группы — в столбце «Сумма»</div> : null}
      </div>
      <div className="tabular-nums">
        {label("Остаток")}
        <span className={c.remaining > TOL ? "font-medium" : "text-neutral-500"}>{money(c.remaining)}</span>
        {c.status === "partial" || c.status === "closed" ? (
          <div className="mt-1">
            <Bar paid={c.paid} total={c.amount} />
          </div>
        ) : null}
      </div>
      <div className={cn("text-xs tabular-nums", cell.tone)}>
        {label("В базе")}
        <b className="text-sm font-medium">{cell.text}</b>
        {cell.sub ? <span className="block">{cell.sub}</span> : null}
      </div>
    </div>
  );
}

export function InvoiceHeader() {
  return (
    <div className="hidden grid-cols-[6.5rem_9rem_minmax(0,1fr)_minmax(0,1.5fr)_8rem_9rem_10rem] gap-x-3 border-t border-neutral-100 bg-neutral-50 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-neutral-500 xl:grid">
      <div>Счёт</div>
      <div className="order-last">Статус</div>
      <div>Сумма</div>
      <div>За что</div>
      <div>Оплачено по документам</div>
      <div>Остаток</div>
      <div>В базе</div>
    </div>
  );
}

export function GroupDbLine({ db, t }: { db: GroupDb | undefined; t: Totals }) {
  if (!db) return null;
  const base = t.amount;
  const p = base > 0 ? Math.min(100, (db.paid / base) * 100) : 0;
  return (
    <span className="tabular-nums">
      в базе {pct(p)} · {money(db.paid)}
      {db.cost != null ? <span className="text-neutral-500"> (стоимость в базе {money(db.cost)})</span> : null}
    </span>
  );
}
