import type { ReactNode } from "react";
import { InfoHint } from "./info-hint";
import { COMMISSION_RATE } from "@/lib/commission4-const";
import type { Commission4Mode } from "@/lib/commission4-mode";
import { formatMoney } from "@/lib/utils";
import { Decimal } from "@prisma/client/runtime/library";
import { Money } from "./money";

/** Метка режима рядом с итогом: «с 4%» / «без 4%». */
export function Mode4Badge({ mode, className = "" }: { mode: Commission4Mode; className?: string }) {
  return (
    <span
      className={`ml-1 rounded-full border px-1.5 py-0.5 align-middle text-[11px] font-medium ${
        mode === "on" ? "border-amber-300 bg-amber-50 text-amber-800" : "border-neutral-300 bg-neutral-50 text-neutral-500"
      } ${className}`}
    >
      {mode === "on" ? "с 4%" : "без 4%"}
    </span>
  );
}

const pct = `${COMMISSION_RATE * 100}%`;

/**
 * Подсказка «откуда 4%»: сырьё/подкладка × 4% = надбавка. Числа — строки с рублями (уже посчитанные на сервере),
 * либо null, если по строке нет данных.
 */
export function C4Hint({
  mode,
  base,
  extra,
  excluded,
  total,
  formula,
  title = "Расчёт 4%",
  children,
  align,
}: {
  mode: Commission4Mode;
  /** Сырьё и подкладка, к которым применяется 4% (с НДС, без 4%), руб. */
  base: string | number | null;
  /** Сырьё и подкладка без 4% (лоскут, партия 6 и др.), руб. */
  excluded?: string | number | null;
  /** Надбавка 4% по этой строке, руб. */
  extra: string | number | null;
  /** Итого с учётом режима, руб. */
  total?: string | number | null;
  /** Своя строка расчёта вместо «сырьё × 4%» (когда надбавка считается не от суммы строк, а, например, по остатку). */
  formula?: ReactNode;
  title?: string;
  children?: ReactNode;
  align?: "left" | "right";
}) {
  const f = (v: string | number) => formatMoney(String(v));
  return (
    <InfoHint label={title} align={align}>
      <b>{title}</b>
      <p className="mt-1">
        «4%» — наценка при купле-продаже меха и подкладки подрядчику (не комиссия Веллмеха; его вознаграждение 4,5% за сопровождение закупки сырья — отдельно, в расходах закупки): в ТЗ мы платим на 4% больше за мех и подкладку в ТЗ (4% от цены без НДС, затем НДС по ставке каждого лота — при разных ставках считается построчно). Работа, расходы, фурнитура, шкуры подрядчика и прочее не облагаются; закупки, оплаты и долг поставщику от 4% не меняются.
      </p>
      {formula ? (
        <p className="mt-1">{formula}</p>
      ) : base == null || extra == null ? (
        <p className="mt-1 font-medium text-amber-700">Нет данных: по этой строке нельзя посчитать 4%.</p>
      ) : (
        <p className="mt-1">
          Сырьё и подкладка с 4%: {f(base)} × {pct} = <b>{f(extra)}</b>
          {mode === "on" ? " — уже включено в цифру." : " — добавится в режиме «С 4%»."}
          {excluded != null && Number(excluded) !== 0 && (
            <>
              <br />
              Без 4% (лоскут, партия 6 и др.): {f(excluded)} — 4% не начисляется.
            </>
          )}
          {total != null && (
            <>
              <br />
              Всего, ₽ {mode === "on" ? "с 4%" : "без 4%"}: <b>{f(total)}</b>
            </>
          )}
        </p>
      )}
      {children}
    </InfoHint>
  );
}

/**
 * Справочная строка «с 4%: X» под ценой/стоимостью сырья или подкладки в режиме «С 4%».
 * Сама закупка, лот и долг не меняются — 4% начисляется при списании в ТЗ; здесь показано, во что это обойдётся.
 */
export function Ref4({
  mode,
  incl,
  excl,
  className = "",
}: {
  mode: Commission4Mode;
  incl: Decimal.Value;
  excl?: Decimal.Value | null;
  className?: string;
}) {
  const k = new Decimal(1).add(COMMISSION_RATE);
  const i = new Decimal(incl);
  const e = excl != null ? new Decimal(excl) : null;
  const altIncl = mode === "on" ? i : i.mul(k);
  const altExcl = e == null ? null : mode === "on" ? e : e.mul(k);
  return (
    <div className={`whitespace-nowrap text-xs font-normal text-neutral-500 ${className}`}>
      {mode === "on" ? "без 4%" : "с 4%"}: <Money incl={altIncl.toFixed(2)} excl={altExcl?.toFixed(2) ?? null} />
      <InfoHint label="Сравнение 4%">
        <p>
          Основная цифра показана в выбранном режиме. Здесь всегда показан противоположный вариант для быстрого сравнения: {mode === "on" ? "без комиссии 4%" : "с комиссией 4%"}.
        </p>
        <p className="mt-1">4% применяется только к сырью и подкладке в ТЗ, где это разрешено; работа, закупка, оплаты и долг поставщику не меняются.</p>
      </InfoHint>
    </div>
  );
}
