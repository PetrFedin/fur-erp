import Link from "next/link";
import { formatMoney, formatMoneyCompact } from "@/lib/utils";
import { KIND_BUTTON_LABEL, PAY_KINDS, kindTotals, type PayType } from "@/lib/pay-kinds";

const mln = (v: number) => formatMoneyCompact(v);

/** Кнопки «Все · Авансы · Доплаты · Окончательный расчёт · Прочее» над плитками «Оплат»: число и сумма на каждой; выбор в адресе (?kind=). Плитки и «К доплате» не фильтруются. */
export function KindBar({ rows, active, hrefFor }: { rows: { type: string; amount: number }[]; active: PayType | null; hrefFor: (k: PayType | null) => string }) {
  const t = kindTotals(rows);
  const all = rows.reduce((a, r) => a + r.amount, 0);
  const cls = (on: boolean) => "inline-flex min-h-11 items-center rounded-md border px-3 text-sm " + (on ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 bg-white text-neutral-700 hover:text-neutral-900");
  return (
    <nav aria-label="Вид платежа" className="flex flex-wrap items-center gap-2 print:hidden">
      <Link href={hrefFor(null)} aria-current={active === null ? "page" : undefined} className={cls(active === null)} title={formatMoney(all)}>Все {rows.length} · {mln(all)}</Link>
      {PAY_KINDS.filter((k) => t[k].count > 0 || active === k).map((k) => (
        <Link key={k} href={hrefFor(k)} aria-current={active === k ? "page" : undefined} className={cls(active === k)} title={formatMoney(t[k].total)}>{KIND_BUTTON_LABEL[k]} {t[k].count} · {mln(t[k].total)}</Link>
      ))}
      {active ? <span className="text-xs text-neutral-600">Показаны платежи вида «{KIND_BUTTON_LABEL[active]}»; плитки и «К доплате» не фильтруются.</span> : null}
    </nav>
  );
}
