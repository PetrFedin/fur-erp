import Link from "next/link";
import { InfoHint } from "@/components/info-hint";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMoney } from "@/lib/utils";
import type { ClientPayBridge } from "@/lib/client-pay-bridge";

const m = (v: number) => formatMoney(v.toFixed(2));
const ruDate = (iso: string) => iso.split("-").reverse().join(".");

/**
 * Мост оплат заказчика: «Оплачено всего» (Главная, «Оплаты») = разнесено на ТЗ партий + разнесено на ТЗ без партии + не разнесено (аванс).
 * inBatches — сумма «Оплачено» в таблице партий на этой странице (разнесено на партии); workInBatches — «Работа» в ней же.
 */
export function ClientPayBridgeCard({ b, inBatches, workInBatches, title = "Оплаты работы: от общей суммы к партиям" }: { b: ClientPayBridge; inBatches: number; workInBatches: number; title?: string }) {
  const noBatch = b.allocated - inBatches;
  const sum = inBatches + noBatch + b.advance;
  const ok = Math.abs(sum - b.paid) < 0.5;
  const workOut = b.work - workInBatches;
  const advances = b.payments.filter((p) => !p.hides);
  const hidePays = b.payments.filter((p) => p.hides);
  const Row = ({ k, v, sub, strong, hint }: { k: string; v: number; sub?: boolean; strong?: boolean; hint?: React.ReactNode }) => (
    <tr className={"border-t border-neutral-100 " + (strong ? "font-semibold" : "")}>
      <td className={"py-1.5 pr-3 " + (sub ? "pl-5 text-neutral-700" : "")}>{k}{hint ? <InfoHint label={k} wide>{hint}</InfoHint> : null}</td>
      <td className="py-1.5 text-right tabular-nums">{m(v)}</td>
    </tr>
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {title}
          <span className={"rounded-full px-2 py-0.5 text-xs font-medium " + (ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700")}>{ok ? "сходится до рубля" : "не сходится"}</span>
          <InfoHint label="Почему цифры разные" wide>
            <p>Здесь два разных числа, и оба верны. <b>«Оплачено всего»</b> (Главная, «Оплаты») — все проведённые оплаты заказчика. <b>«Оплачено (разнесено на партии)»</b> — только та часть, которая закреплена за конкретными ТЗ партий.</p>
            <p className="mt-1">Разница — авансы, которые заказчик перечислил, но которые ещё не разнесены по ТЗ (аванс 70% «за изделия в работе» и т. п.). Они уменьшают общий долг на Главной, но не отражаются в остатке отдельной партии, пока их не разнесут.</p>
          </InfoHint>
        </CardTitle>
      </CardHeader>
      <CardContent className="text-sm">
        <table className="w-full max-w-3xl">
          <tbody>
            <Row k="Оплачено всего (Главная, Оплаты)" v={b.paid} strong />
            <Row k="из них разнесено на партии" v={inBatches} sub hint="Σ колонки «Оплачено» в таблице партий ниже: оплаты, закреплённые за ТЗ партий (PaymentAllocation)." />
            {Math.abs(noBatch) >= 0.5 && <Row k="из них разнесено на ТЗ без партии" v={noBatch} sub hint="Оплаты закреплены за ТЗ, у которых не указана партия, — в таблице партий их нет." />}
            <Row k="не разнесено на ТЗ (аванс заказчика)" v={b.advance} sub hint="Остаток платежей, не отнесённый ни к одному ТЗ. Список — ниже. Разнести: «Оплаты» → кнопка «Разнесение» у платежа." />
            <Row k="Работа заказчикам (Главная)" v={b.work} />
            <Row k="из них в партиях (в таблице ниже)" v={workInBatches} sub />
            {Math.abs(workOut) >= 0.5 && <Row k="из них ТЗ без партии / вне выбранного года" v={workOut} sub />}
            <Row k="К оплате заказчиком (Главная) = работа − оплачено всего" v={b.balance} strong />
            <Row k="Сумма «Остаток» по партиям (работа в партиях − разнесено на партии)" v={workInBatches - inBatches} sub hint="Это не долг заказчика: нераспределённые авансы здесь не вычтены. Долг заказчика — строка выше." />
          </tbody>
        </table>
        {advances.length > 0 && (
          <details className="mt-3 max-w-4xl rounded-md border border-neutral-200 px-3 py-2">
            <summary className="cursor-pointer text-xs font-medium text-neutral-700">Какие платежи не разнесены на ТЗ ({advances.length}) — {m(b.advance)}</summary>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[560px] text-xs">
                <thead className="text-left text-neutral-500"><tr><th className="py-1 pr-2 font-medium">Дата</th><th className="py-1 pr-2 font-medium">Заказчик</th><th className="py-1 pr-2 text-right font-medium">Платёж, ₽</th><th className="py-1 pr-2 text-right font-medium">Не разнесено, ₽</th><th className="py-1 font-medium">Основание</th></tr></thead>
                <tbody>
                  {advances.map((p) => (
                    <tr key={p.id} className="border-t border-neutral-100 align-top">
                      <td className="whitespace-nowrap py-1 pr-2">{ruDate(p.date)}</td>
                      <td className="py-1 pr-2">{p.client ?? "—"}</td>
                      <td className="whitespace-nowrap py-1 pr-2 text-right tabular-nums">{m(p.amount)}</td>
                      <td className="whitespace-nowrap py-1 pr-2 text-right font-medium tabular-nums">{m(p.rest)}</td>
                      <td className="py-1 text-neutral-600">{p.doc ?? p.notes ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-neutral-500">Разнести платёж по ТЗ — на странице <Link href="/payments" className="underline">«Оплаты»</Link>, кнопка «Разнесение».</p>
            </div>
          </details>
        )}
        {hidePays.length > 0 && (
          <p className="mt-2 text-xs text-neutral-500">
            Не входит в «Оплачено всего»: {m(b.hides)} из платежей заказчика — шкуры подрядчика ({hidePays.map((p) => `${ruDate(p.date)} ${p.client ?? ""}`.trim()).join("; ")}). Это сырьё, оно учтено в «Оплатах за сырьё» и на Главной в «Использовано» меха.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
