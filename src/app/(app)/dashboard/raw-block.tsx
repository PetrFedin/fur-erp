"use client";

import { useState } from "react";
import Link from "next/link";
import { useVatDisplay } from "@/lib/vat-display";
import { formatMoney, formatQty } from "@/lib/utils";
import { InfoHint } from "@/components/info-hint";
import type { FlowFigures } from "@/lib/fur-table";
import { TILE_BOX, TileHead } from "./tile";
import { ModeLine, Note, type ModeInfo } from "./mode-line";
import { formatCompactMoney } from "./compact";

type Pair = { incl: FlowFigures; excl: FlowFigures };
type View = "fur" | "lining" | "all";

const usd = (v: number) => `$${v.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const rub = (v: number) => formatMoney(v.toFixed(2));

function Card({ title, children, hint }: { title: string; children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className={TILE_BOX}>
      <TileHead>{title}</TileHead>
      {hint ? <div className="absolute right-3 top-3">{hint}</div> : null}
      {children}
    </div>
  );
}

/** Строка плитки: подпись, цифра, пояснение — высоты зарезервированы, чтобы строки трёх плиток стояли на одном уровне. */
function Row({ k, v, sub, strong }: { k: string; v: React.ReactNode; sub?: React.ReactNode; strong?: boolean }) {
  return (
    <div className="mt-2 first:mt-1">
      <div className="min-h-4 text-[11px] leading-4 text-neutral-500">{k}</div>
      <div className={(strong ? "text-xl font-semibold " : "text-base font-medium ") + "min-h-7 break-words leading-7 tabular-nums text-neutral-900"}>{v}</div>
      <div className="min-h-4 text-[11px] leading-4 text-neutral-500">{sub}</div>
    </div>
  );
}

export function RawBlock({ fur, lining, c4, lots, info, orderFilters }: { fur: Pair; lining: Pair; c4: "on" | "off"; lots: number; info: ModeInfo; orderFilters: boolean }) {
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
    const b = F.usdBySource;
    const parts = [
      b.direct > 0 ? `в долларах в расчёте лота — ${formatQty(b.direct)}` : null,
      b.eur > 0 ? `евро × курс EUR→USD из расчёта — ${formatQty(b.eur)}` : null,
      b.rub > 0 ? `молоток ₽ ÷ курс USD/RUB из расчёта — ${formatQty(b.rub)}` : null,
      b.calc > 0 ? `цена $ из расчёта Drive — ${formatQty(b.calc)}` : null,
    ].filter(Boolean).join("; ");
    return {
      main: `${usd(F.usdAvg)} / шт.`,
      note: `по ${formatQty(F.usdQty)} из ${formatQty(F.recvQty)} шт. с ценой в USD (${share.toLocaleString("ru-RU", { maximumFractionDigits: 0 })}%)`,
      hint: `Источники цены, шт.: ${parts || "—"}. Остальные лоты — без цены в USD (только рубли или нет курса в документах).`,
    };
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
            <p className="mt-1"><b>Цена в долларах</b> — молоток за шкуру (до сборов), только из документов лота: строка в долларах; цена в евро × записанный в расчёте курс EUR→USD; молоток в ₽ ÷ записанный курс USD/RUB; цена $ из расчёта Drive. Остальные лоты в среднюю $ не входят и по курсу ЦБ не пересчитываются.</p>
            {usdBought && "hint" in usdBought && usdBought.hint ? <p className="mt-1">{usdBought.hint}</p> : null}
            <p className="mt-1">Куплено − использовано = остаток (шт. и ₽ без 4%). «Всё» показывает только ₽: шкуры и метры не складываются.</p>
          </InfoHint>
          <span className="text-xs text-neutral-500">{lots} лотов</span>
          <ModeLine info={info} c4={c4} />
        </div>
        <div className="flex items-center gap-3">
          <div role="tablist" aria-label="Вид сырья" className="inline-flex overflow-hidden rounded-md border border-neutral-300 print:hidden">
            {seg("fur", "Мех")}{seg("lining", "Подкладка")}{seg("all", "Всё")}
          </div>
          <Link href="/lots" className="text-xs text-blue-700 hover:underline print:hidden">→ Сырьё</Link>
        </div>
      </div>

      <div className="grid grid-cols-1 items-stretch gap-3 md:grid-cols-3 print:grid-cols-3">
        <Card title="Куплено">
          {all ? (
            <Row k="Сумма, ₽ (мех + подкладка)" v={rub(F.recvValue + L.recvValue)} strong sub="шкуры и метры не складываются — только деньги" />
          ) : (
            <>
              <Row k="Количество" v={`${formatQty(cur.recvQty)} ${unit}`} strong />
              <Row k="Сумма (всегда без 4%)" v={rub(cur.recvValue)} />
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
              <Row k={`Средневзвешенная цена, ₽/${unit === "м" ? "м" : "шт."} (${c4W})`} v={cur.usedAvg != null ? rub(cur.usedAvg) : "—"} sub={cur.usedQty > 0 ? <>{otherW}: {rub(cur.usedValueOther / cur.usedQty)}</> : undefined} />
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
              <Row k="Сумма (всегда без 4%)" v={rub(cur.remValue)} />
              <Row k={`Средневзвешенная цена, ₽/${unit === "м" ? "м" : "шт."}`} v={cur.remAvg != null ? rub(cur.remAvg) : "—"} />
              {usdTile ? (
                <Row k="По USD-лотам, $/шт." v={F.usdRemAvg != null ? usd(F.usdRemAvg) : "нет данных в USD"} sub={F.usdRemAvg != null ? `по ${formatQty(F.usdRemQty)} из ${formatQty(F.remQty)} шт.` : undefined} />
              ) : null}
            </>
          )}
        </Card>
      </div>
      <RawBridge F={F} L={L} view={view} c4={c4} vat={vat} unit={unit} orderFilters={orderFilters} />
    </section>
  );
}

const mln = (v: number) => formatCompactMoney(v);

/** Мост «куплено = использовано (без 4%) + остаток»; 4% и НДС — отдельными прибавками, чтобы было видно, откуда разница. */
function RawBridge({ F, L, view, c4, vat, unit, orderFilters }: { F: FlowFigures; L: FlowFigures; view: View; c4: "on" | "off"; vat: "incl" | "excl"; unit: string; orderFilters: boolean }) {
  const parts = view === "all" ? [F, L] : [view === "lining" ? L : F];
  const sum = (k: "recvValue" | "remValue" | "usedValue" | "usedValueOther") => parts.reduce((a, x) => a + x[k], 0);
  const usedBase = c4 === "on" ? sum("usedValueOther") : sum("usedValue");
  const c4Extra = Math.abs(sum("usedValue") - sum("usedValueOther"));
  // НДС в «Куплено» — по ставке лота (20% и 22%), поэтому одной формулой «×1,2» его не получить.
  return (
    <div className="space-y-1">
      <Note>
        <b>Куплено {mln(sum("recvValue"))} = использовано {mln(usedBase)} (без 4%) + остаток {mln(sum("remValue"))}</b>
        {view !== "all" ? <> ({formatQty(parts[0].recvQty)} = {formatQty(parts[0].usedQty)} + {formatQty(parts[0].remQty)} {unit})</> : null}
        . «Куплено» и «Остаток» всегда без 4%: надбавка 4% начисляется только при списании в ТЗ.{" "}
        {c4 === "on"
          ? <>В «Использовано» сейчас <b>с 4%: +{mln(c4Extra)}</b> — поэтому {mln(sum("usedValue"))} + остаток {mln(sum("remValue"))} ≠ куплено, и средневзвешенная «куплено» может лежать вне интервала «использовано — остаток».</>
          : <>С 4% использованное было бы на {mln(c4Extra)} больше (мелкая строка в «Использовано»).</>}
        {" "}Цены — {vat === "incl" ? "с НДС" : "без НДС"}; НДС берётся по ставке каждого лота (20% или 22%).
      </Note>
      {orderFilters ? <Note tone="warn">Выбран фильтр по ТЗ: «Использовано» — только в выбранных ТЗ, остальное списание в «Остаток» не попадает, поэтому куплено − использовано ≠ остаток.</Note> : null}
    </div>
  );
}
