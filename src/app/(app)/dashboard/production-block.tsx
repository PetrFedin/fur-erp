"use client";

import { useState } from "react";
import Link from "next/link";
import { useVatDisplay } from "@/lib/vat-display";
import { formatMoney, formatQty } from "@/lib/utils";
import { InfoHint } from "@/components/info-hint";
import { ProductionModal } from "./production-modal";
import { TILE_BOX, TileCaption, TileHead, TileValue } from "./tile";
import { BridgeHint, type ModeInfo } from "./mode-line";
import { formatCompactMoney } from "./compact";

export type ProdNums = { orders: number; qty: number; costIncl: number; costExcl: number; work: number; matIncl: number; matExcl: number; c4Incl: number; c4Excl: number };
export type ProdBridge = { usedBase: { incl: number; excl: number }; comparable: boolean; lotFilters: boolean; yearOnly: boolean };

const Tile = ({ label, hint, onClick, aria, value, caption, valueClass }: { label: string; hint?: React.ReactNode; onClick?: () => void; aria?: string; value: React.ReactNode; caption?: React.ReactNode; valueClass?: string }) => {
  const body = (
    <>
      <TileHead>{label}</TileHead>
      <TileValue className={valueClass}>{value}</TileValue>
      <TileCaption>{caption}</TileCaption>
    </>
  );
  return (
    <div className="relative">
      {onClick ? (
        <button type="button" onClick={onClick} aria-label={aria} aria-haspopup="dialog" className={TILE_BOX + " w-full shadow-sm transition hover:border-neutral-400 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700 print:shadow-none"}>{body}</button>
      ) : (
        <div className={TILE_BOX}>{body}</div>
      )}
      {hint ? <div className="absolute right-3 top-3">{hint}</div> : null}
    </div>
  );
};

export function ProductionBlock({ done, work, c4, search, info, bridge }: { done: ProdNums; work: ProdNums; c4: "on" | "off"; search: Record<string, string[]>; info: ModeInfo; bridge: ProdBridge }) {
  const { mode: vat } = useVatDisplay();
  const [open, setOpen] = useState<null | "done" | "work">(null);
  const cost = (n: ProdNums) => (vat === "incl" ? n.costIncl : n.costExcl);
  const avg = done.qty > 0 ? cost(done) / done.qty : null;
  void info;
  const vatW = vat === "incl" ? "с НДС" : "без НДС";
  const c4W = c4 === "on" ? "с 4%" : "без 4%";
  const money = (v: number) => formatMoney(v.toFixed(2));
  const active = open === "work" ? work : done;

  return (
    <section aria-labelledby="dash-prod" className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="dash-prod" className="flex items-center gap-2 text-base font-semibold">Производство
          <ProdBridgeHint done={done} work={work} c4={c4} vat={vat} bridge={bridge} />
        </h2>
        <div className="flex items-center gap-3 text-xs text-neutral-500">
          <Link href="/production" className="text-blue-700 hover:underline print:hidden">→ ТЗ</Link>
        </div>
      </div>
      <div className="grid grid-cols-1 items-stretch gap-3 sm:grid-cols-2 xl:grid-cols-4 print:grid-cols-4">
        <Tile
          label="Произведено"
          onClick={() => setOpen("done")}
          aria="Произведено изделий — открыть состав стоимости производства"
          hint={
            <InfoHint label="Что такое «произведено» и «в работе»" wide align="right">
              <p><b>Произведено</b> — выпуск ТЗ в статусе «Завершён».</p>
              <p className="mt-1"><b>В работе</b> — план ТЗ «В работе» и «Запланировано»; сырьё — по списаниям на сегодня. В «Произведено» они не входят и с ним не складываются.</p>
              <p className="mt-1">Те же правила — в «ТЗ», «Партиях», «Изделиях», аналитике, печати и окне состава.</p>
            </InfoHint>
          }
          value={<>{formatQty(done.qty)} шт.</>}
          caption={<>{done.orders} ТЗ · состав →</>}
        />
        <Tile
          label="Себестоимость"
          onClick={() => setOpen("done")}
          aria="Себестоимость произведённого — открыть гистограмму по партиям, годам, категориям и меху"
          hint={
            <InfoHint label="Что такое себестоимость" wide align="right">
              <p><b>Себестоимость</b> = мех + подкладка + надбавка 4% (в режиме «С 4%») + расходы ТЗ — как в «ТЗ», «Партиях» и аналитике. <b>Работа</b> сюда не входит.</p>
              <p className="mt-1"><b>Сырьё + работа</b> = себестоимость + цена работы × количество.</p>
            </InfoHint>
          }
          value={money(cost(done))}
          caption={<>+ работа <b className="tabular-nums text-neutral-700">{money(done.work)}</b><br />всего <b className="tabular-nums text-neutral-700">{money(cost(done) + done.work)}</b></>}
        />
        <Tile
          label="На 1 изделие"
          hint={
            <InfoHint label="Как считается средняя себестоимость" wide align="right">
              <p><b>Средневзвешенная</b> = Σ себестоимость ÷ Σ изделий (не среднее по ТЗ). Режимы: {vatW}, {c4W}.</p>
            </InfoHint>
          }
          value={avg != null ? money(avg) : "—"}
          caption={<>без работы{avg != null && done.work > 0 ? <><br />с работой {money(avg + done.work / done.qty)}</> : null}</>}
        />
        <Tile
          label="В работе"
          onClick={() => setOpen("work")}
          aria="В работе — открыть состав стоимости"
          value={<>{formatQty(work.qty)} шт.</>}
          caption={<>{work.orders} ТЗ · списано <b className="tabular-nums text-neutral-700">{money(cost(work))}</b></>}
        />
      </div>
      {open ? (
        <ProductionModal
          scope={open}
          search={search}
          totals={{ costIncl: active.costIncl, costExcl: active.costExcl, qty: active.qty, orders: active.orders }}
          title={open === "done" ? `Произведено ${formatQty(done.qty)} шт. на ${money(cost(done))}` : `В работе ${formatQty(work.qty)} шт., списано ${money(cost(work))}`}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </section>
  );
}

const mln = (v: number) => formatCompactMoney(v);

/** Мост цифр Производства: состав себестоимости, работа, НДС и связь с блоком «Сырьё» — теперь в «i» у заголовка. */
function ProdBridgeHint({ done, work, c4, vat, bridge }: { done: ProdNums; work: ProdNums; c4: "on" | "off"; vat: "incl" | "excl"; bridge: ProdBridge }) {
  const g = (n: ProdNums) => ({ cost: vat === "incl" ? n.costIncl : n.costExcl, mat: vat === "incl" ? n.matIncl : n.matExcl, c4: vat === "incl" ? n.c4Incl : n.c4Excl });
  const D = g(done), W = g(work);
  const rawOther = D.cost - D.mat - D.c4;
  const other = Math.abs(rawOther) < 0.5 ? 0 : rawOther;
  const vatAmount = done.costIncl - done.costExcl;
  const matBoth = D.mat + W.mat;
  return (
    <BridgeHint label="Как сходятся цифры производства" warn={!bridge.comparable}>
      <p><b>Себестоимость {mln(D.cost)} = сырьё (мех + подкладка) {mln(D.mat)} + {c4 === "on" ? <>4%: +{mln(D.c4)}</> : "4%: не начислено"} + расходы ТЗ и прочее {mln(other)}.</b> Работа {mln(done.work)} в себестоимость не входит: сырьё + работа = {mln(D.cost + done.work)}.</p>
      <p className="mt-1">НДС в себестоимости ({vat === "incl" ? "учтён" : "вычтен"}): {mln(vatAmount)} — по ставке лота (20% или 22%). 4% — только на мех и подкладку. Средняя на изделие = Σ себестоимость ÷ Σ изделий (не среднее по ТЗ).</p>
      {bridge.comparable ? (
        <p className="mt-1"><b>Связь с блоком «Сырьё»:</b> использовано сырья {mln(bridge.usedBase[vat])} (без 4%) = в завершённых ТЗ {mln(D.mat)} + в ТЗ «в работе» {mln(W.mat)} ({matBoth === 0 ? "—" : "сходится"}). В «Произведено» входят только завершённые, поэтому «Использовано» в «Сырьё» больше на списанное в ТЗ «в работе».</p>
      ) : (
        <p className="mt-1"><b>С блоком «Сырьё» цифры не равны:</b>{" "}
          {bridge.yearOnly ? "«Сырьё» отбирает лоты по году закупки, «Производство» — ТЗ по году ТЗ (сырьё 2025 года могло уйти в ТЗ 2026). " : ""}
          {bridge.lotFilters ? "При фильтре по меху/цвету/НДС/аукциону «Сырьё» показывает только выбранные лоты, а «Производство» — ТЗ целиком, где такой лот списан. " : ""}
          Без фильтров и на «Все годы» они сходятся.</p>
      )}
    </BridgeHint>
  );
}
