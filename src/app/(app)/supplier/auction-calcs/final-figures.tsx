import { cn, formatNum, formatQty, formatDec1 } from "@/lib/utils";

const money = (n: number) => (Number.isFinite(n) ? formatNum(n, 1) : "–");

/** Финальные цифры расчёта крупно: шкур, итого, средняя себестоимость шкуры. Без хуков — годится и на сервере. */
export function FinalFigures({ lots, qty, totalRub, avgRub, className, title = "Финальные цифры" }: { lots: number; qty: number; totalRub: number; avgRub: number; className?: string; title?: string }) {
  return (
    <section className={cn("rounded-lg border border-neutral-300 bg-neutral-50 p-4", className)} aria-label={title}>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">{title}</h2>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 xl:grid-cols-4">
        <Fig label="Лотов" v={String(lots)} />
        <Fig label="Шкур" v={formatDec1(qty)} />
        <Fig label="Итого" v={`${money(totalRub)} ₽`} big />
        <Fig label="Средняя за шкуру" v={`${money(avgRub)} ₽`} big />
      </div>
    </section>
  );
}
function Fig({ label, v, big }: { label: string; v: string; big?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className={cn("font-semibold tabular-nums", big ? "whitespace-nowrap text-xl xl:text-2xl" : "text-xl")}>{v}</div>
    </div>
  );
}
