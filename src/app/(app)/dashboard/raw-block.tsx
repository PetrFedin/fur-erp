"use client";

import { useState } from "react";
import Link from "next/link";
import { useVatDisplay } from "@/lib/vat-display";
import { formatMoney, formatQty } from "@/lib/utils";
import { InfoHint } from "@/components/info-hint";
import type { FlowFigures } from "@/lib/fur-table";

type Pair = { incl: FlowFigures; excl: FlowFigures };
type View = "fur" | "lining" | "all";

const usd = (v: number) => `$${v.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const rub = (v: number) => formatMoney(v.toFixed(2));

function Card({ title, children, hint }: { title: string; children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="relative rounded-lg border border-neutral-200 bg-white p-4 print:break-inside-avoid">
      <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{title}</div>
      {hint ? <div className="absolute right-3 top-3">{hint}</div> : null}
      {children}
    </div>
  );
}

function Row({ k, v, sub, strong }: { k: string; v: React.ReactNode; sub?: React.ReactNode; strong?: boolean }) {
  return (
    <div className="mt-2 first:mt-3">
      <div className="text-[11px] text-neutral-500">{k}</div>
      <div className={(strong ? "text-xl font-semibold " : "text-base font-medium ") + "break-words tabular-nums text-neutral-900"}>{v}</div>
      {sub ? <div className="text-[11px] leading-4 text-neutral-500">{sub}</div> : null}
    </div>
  );
}

export function RawBlock({ fur, lining, c4, lots }: { fur: Pair; lining: Pair; c4: "on" | "off"; lots: number }) {
  const { mode: vat } = useVatDisplay();
  const [view, setView] = useState<View>("fur");
  const F = fur[vat];
  const L = lining[vat];
  const vatW = vat === "incl" ? "с НДС" : "без НДС";
  const c4W = c4 === "on" ? "с 4%" : "без 4%";
  const otherW = c4 === "on" ? "без 4%" : "с 4%";
  const unit = view === "lining" ? "м" : "шт.";
  const cur = view === "lining" ? L : F;
  const all = view === "all";
  const usdTile = view === "fur";

  const usdBought = (() => {
    if (view === "lining") return { main: "нет данных в USD", note: "подкладка закупается без цены в долларах" };
    if (view === "all") return null;
    if (F.usdQty <= 0 || F.usdAvg == null) return { main: "нет данных в USD", note: "в выбранном срезе нет лотов с закупочной ценой в USD" };
    const share = F.recvQty > 0 ? (F.usdQty / F.recvQty) * 100 : 0;
    return { main: `${usd(F.usdAvg)} / шт.`, note: `по ${formatQty(F.usdQty)} из ${formatQty(F.recvQty)} шт. с ценой в USD (${share.toLocaleString("ru-RU", { maximumFractionDigits: 0 })}%)` };
  })();

  const seg = (id: View, label: string) => (
    <button key={id} type="button" role="tab" aria-selected={view === id} onClick={() => setView(id)}
      className={"px-3 py-1 text-sm " + (view === id ? "bg-neutral-900 text-white" : "bg-white text-neutral-700 hover:bg-neutral-50")}>{label}</button>
  );

  return (
    <section aria-labelledby="dash-raw" className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 id="dash-raw" className="text-base font-semibold">Сырьё</h2>
          <InfoHint label="Как считаются плитки сырья" wide>
            <p><b>Средневзвешенная цена</b> = Σ ₽ ÷ Σ шт. (для подкладки — ÷ Σ м): отношение сумм, а не среднее цен лотов. Считается так же, как в таблице «Сырьё».</p>
            <p className="mt-1"><b>Режимы.</b> {vatW}; использовано — {c4W}. 4% начисляется только при списании в ТЗ, поэтому к «Куплено» и «Остаток» не применяется.</p>
            <p className="mt-1"><b>Цена в долларах.</b> Только лоты, у которых в документах названа закупочная цена в USD за шкуру (молоток, до сборов). Остальные лоты в среднюю $ не входят и по курсу ЦБ не пересчитываются.</p>
            <p className="mt-1">Куплено − использовано = остаток (шт. и ₽ без 4%). «Всё» показывает только ₽: шкуры и метры не складываются.</p>
          </InfoHint>
          <span className="text-xs text-neutral-500">{lots} лотов · {vatW}</span>
        </div>
        <div className="flex items-center gap-3">
          <div role="tablist" aria-label="Вид сырья" className="inline-flex overflow-hidden rounded-md border border-neutral-300 print:hidden">
            {seg("fur", "Мех")}{seg("lining", "Подкладка")}{seg("all", "Всё")}
          </div>
          <Link href="/lots" className="text-xs text-blue-700 hover:underline print:hidden">→ Сырьё</Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3 print:grid-cols-3">
        <Card title="Куплено">
          {all ? (
            <Row k="Сумма, ₽ (мех + подкладка)" v={rub(F.recvValue + L.recvValue)} strong sub="шкуры и метры не складываются — только деньги" />
          ) : (
            <>
              <Row k="Количество" v={`${formatQty(cur.recvQty)} ${unit}`} strong />
              <Row k="Сумма" v={rub(cur.recvValue)} />
              <Row k={`Средневзвешенная цена, ₽/${unit === "м" ? "м" : "шт."}`} v={cur.recvAvg != null ? rub(cur.recvAvg) : "—"} />
              {usdTile && usdBought ? <Row k="Средневзвешенная цена, $/шт." v={usdBought.main} sub={usdBought.note} /> : null}
              {view === "lining" && usdBought ? <Row k="Цена в долларах" v={<span className="text-neutral-500">{usdBought.main}</span>} sub={usdBought.note} /> : null}
            </>
          )}
        </Card>

        <Card title="Использовано">
          {all ? (
            <Row k={`Сумма, ₽ (${c4W})`} v={rub(F.usedValue + L.usedValue)} strong sub={<>{otherW}: {rub(F.usedValueOther + L.usedValueOther)}</>} />
          ) : (
            <>
              <Row k="Количество" v={`${formatQty(cur.usedQty)} ${unit}`} strong />
              <Row k={`Сумма (${c4W})`} v={rub(cur.usedValue)} sub={<>{otherW}: {rub(cur.usedValueOther)}</>} />
              <Row k={`Средневзвешенная цена, ₽/${unit === "м" ? "м" : "шт."} (${c4W})`} v={cur.usedAvg != null ? rub(cur.usedAvg) : "—"} />
              {usdTile ? (
                <Row k="По USD-лотам, $/шт." v={F.usdUsedAvg != null ? usd(F.usdUsedAvg) : "нет данных в USD"} sub={F.usdUsedAvg != null ? `по ${formatQty(F.usdUsedQty)} из ${formatQty(F.usedQty)} шт.` : undefined} />
              ) : null}
            </>
          )}
        </Card>

        <Card title="Остаток">
          {all ? (
            <Row k="Сумма, ₽ (мех + подкладка)" v={rub(F.remValue + L.remValue)} strong sub="на складе по цене закупки лотов" />
          ) : (
            <>
              <Row k="Количество" v={`${formatQty(cur.remQty)} ${unit}`} strong />
              <Row k="Сумма" v={rub(cur.remValue)} />
              <Row k={`Средневзвешенная цена, ₽/${unit === "м" ? "м" : "шт."}`} v={cur.remAvg != null ? rub(cur.remAvg) : "—"} />
              {usdTile ? (
                <Row k="По USD-лотам, $/шт." v={F.usdRemAvg != null ? usd(F.usdRemAvg) : "нет данных в USD"} sub={F.usdRemAvg != null ? `по ${formatQty(F.usdRemQty)} из ${formatQty(F.remQty)} шт.` : undefined} />
              ) : null}
            </>
          )}
        </Card>
      </div>
    </section>
  );
}
