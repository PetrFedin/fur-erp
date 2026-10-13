import { uniqueLabelCount } from "@/lib/tz-key";
import Link from "next/link";
import { InfoHint } from "@/components/info-hint";
import { debtLabel, formatMoney, OVERPAY_FROM } from "@/lib/utils";
import type { ReactNode } from "react";
import { Goods, SplitLine, type ClientPayRow, type PaidGood } from "./client-payments-table";

/** Детализация даты на вкладке «За производство»: все оплаты этого дня и, за какой товар каждая из них пришла. */
export function ClientDateDetail({ date, rows, back, owedNote, owedGoods }: { date: string; rows: (ClientPayRow & { verifySlot?: ReactNode })[]; back: string; owedNote?: { orders: number; batches: string }; owedGoods?: PaidGood[] }) {
  const total = rows.reduce((s, r) => s + r.amount, 0);
  return (
    <section className="flex flex-col gap-4" aria-label={`Оплаты за ${date}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <Link href={back} className="text-sm text-blue-700 hover:underline">← Все оплаты за производство</Link>
          <h2 className="mt-1 text-lg font-semibold">Оплаты за {date}</h2>
        </div>
        <div className="text-right">
          <div className="text-xs text-neutral-500">Оплат: {rows.length}</div>
          <div className="text-xl font-semibold tabular-nums">{formatMoney(total.toFixed(2))}</div>
        </div>
      </div>
      {rows.length > 0 && rows.every((r) => r.goods.length === 0) && owedNote ? (() => {
        const due = rows.reduce((a, r) => a + r.due, 0);
        const paid = rows.reduce((a, r) => a + r.paid, 0);
        return (
          <section className="rounded-lg border border-neutral-200 bg-white p-4" aria-label="К оплате, оплачено, остаток">
            <p className="mb-2 flex items-center gap-1.5 text-xs text-neutral-500">Авансы под {owedNote.orders} ТЗ{owedNote.batches ? `, партии ${owedNote.batches}` : ""}<InfoHint label="Что это за ТЗ" wide><p>Работа ТЗ, под которую внесены авансы: {owedNote.orders} ТЗ{owedNote.batches ? `, партии ${owedNote.batches}` : ""}.</p></InfoHint></p>
            <dl className="grid gap-2 sm:grid-cols-3">
              <div className="rounded-md bg-neutral-50 px-3 py-2"><dt className="text-xs text-neutral-500">К оплате</dt><dd className="font-medium tabular-nums">{formatMoney(due.toFixed(2))}</dd></div>
              <div className="rounded-md bg-neutral-50 px-3 py-2"><dt className="text-xs text-neutral-500">Оплачено</dt><dd className="font-medium tabular-nums">{formatMoney(paid.toFixed(2))}</dd></div>
              <div className="rounded-md border border-amber-300 bg-neutral-50 px-3 py-2"><dt className="text-xs text-neutral-500">{debtLabel(due - paid, "Остаток к оплате")}</dt><dd className="font-medium tabular-nums text-amber-700">{formatMoney((due - paid < -OVERPAY_FROM ? paid - due : due - paid).toFixed(2))}</dd></div>
            </dl>
            {owedGoods && owedGoods.length > 0 ? (
              <details className="mt-3 border-t border-neutral-100 pt-3 text-sm">
                <summary className="cursor-pointer text-neutral-600 hover:text-neutral-900">{`Состав: ${uniqueLabelCount(owedGoods.map((g) => ({ id: g.id, label: g.label })))} ТЗ`}</summary>
                <p className="mt-1 flex items-center gap-1.5 text-xs text-neutral-500">Оплачено показано условно<InfoHint label="Почему условно"><p>ТЗ под авансы не назначены, поэтому оплачено показано условно: авансы поровну по доле работы каждого ТЗ.</p></InfoHint></p>
                <div className="mt-2"><Goods goods={owedGoods} /></div>
              </details>
            ) : null}
          </section>
        );
      })() : null}
      {rows.length === 0 ? <p className="rounded-md bg-neutral-50 px-3 py-6 text-center text-sm text-neutral-500">В эту дату оплат нет.</p> : null}
      {rows.map((r) => {
        const noTz = r.goods.length === 0;
        const invoice = /сч[её]т[^№;·]*№\s*([^\s;·]+)(?:\s+от\s+(\d{2}\.\d{2}\.\d{4}))?/i.exec(r.basis ?? "");
        const what = (r.note ?? "").replace(/\.?\s*Согласован.*$/i, "").trim();
        return (
          <article key={r.id} className="rounded-lg border border-neutral-200 bg-white p-4">
            <header className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-lg font-semibold tabular-nums">{formatMoney(r.amount.toFixed(2))}</span>
                  <span className="text-sm text-neutral-600">{r.type}{invoice ? ` по счёту №${invoice[1]}${invoice[2] ? ` от ${invoice[2]}` : ""}` : ""}</span>
                </div>
                {noTz && what ? <p className="mt-1 text-sm text-neutral-700">{what}</p> : null}
              </div>
            </header>

            {noTz ? null : (
              <>
                <div className="mt-2"><SplitLine amount={r.amount} allocated={r.allocated} hidesNote={r.hidesNote} movedTo={r.movedTo} /></div>
                <details className="mt-3 border-t border-neutral-100 pt-3 text-sm">
                  <summary className="cursor-pointer text-neutral-600 hover:text-neutral-900">{`Состав: ${uniqueLabelCount(r.goods.map((g) => ({ id: g.id, label: g.label })))} ТЗ`}</summary>
                  <div className="mt-2"><Goods goods={r.goods} /></div>
                </details>
              </>
            )}
            {!r.confirmed && r.verifySlot ? <div className="mt-3 w-80 max-w-full">{r.verifySlot}</div> : null}
          </article>
        );
      })}
      {rows.length > 0 && rows.every((r) => r.goods.length === 0) ? (
        <p className="flex items-center gap-1.5 text-xs text-neutral-500">ТЗ под эти авансы ещё не назначены<InfoHint label="Подробнее про авансы" wide><p>ТЗ под эти авансы ещё не назначены: в счетах указаны изделия «в работе» (модели и цвета), без номеров ТЗ. По письму Василия от 01.09 заказы первой части — 21 559 500 ₽; работа этих ТЗ в приложении — на 629 200 ₽ больше, разница не сверена.</p></InfoHint></p>
      ) : null}
    </section>
  );
}

