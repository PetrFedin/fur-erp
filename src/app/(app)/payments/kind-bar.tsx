import { formatMoney, formatMoneyCompact } from "@/lib/utils";
import { Segmented } from "@/components/segmented";
import { KIND_BUTTON_LABEL, PAY_KINDS, payslipsText, type PayType } from "@/lib/pay-kinds";

type Row = { type: string; amount: number; id?: string; pp?: string | null };

/** Сегмент «Все · Авансы · Доплаты · Окончательный расчёт · Прочее» над плитками «Оплат»: сумма на каждой кнопке, число платёжек — в подсказке; выбор в адресе (?kind=). Плитки и «К доплате» не фильтруются. */
export function KindBar({ rows, active, hrefFor }: { rows: Row[]; active: PayType | null; hrefFor: (k: PayType | null) => string }) {
  const all = rows.reduce((a, r) => a + r.amount, 0);
  const of = (k: PayType) => rows.filter((r) => ((PAY_KINDS as string[]).includes(r.type) ? r.type : "OTHER") === k);
  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      <Segmented
        label="Вид платежа"
        items={[
          { key: "all", label: <>Все · {formatMoneyCompact(all)}</>, on: active === null, href: hrefFor(null), title: `${formatMoney(all)}: ${payslipsText(rows)}` },
          ...PAY_KINDS.filter((k) => of(k).length > 0 || active === k).map((k) => {
            const list = of(k);
            return { key: k, label: <>{KIND_BUTTON_LABEL[k]} · {formatMoneyCompact(list.reduce((a, r) => a + r.amount, 0))}</>, on: active === k, href: hrefFor(k), title: `${formatMoney(list.reduce((a, r) => a + r.amount, 0))}: ${payslipsText(list)}` };
          }),
        ]}
      />
      {active ? <span className="text-xs text-neutral-600">Показаны платежи вида «{KIND_BUTTON_LABEL[active]}»; плитки и «К доплате» не фильтруются.</span> : null}
    </div>
  );
}
