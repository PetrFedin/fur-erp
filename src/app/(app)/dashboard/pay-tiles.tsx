import { formatMoney } from "@/lib/utils";
import { rawRounding } from "@/lib/raw-rounding";
import type { YearFilter } from "@/lib/year-filter";
import { InfoHint } from "@/components/info-hint";
import { SupplierDebtHint } from "@/components/supplier-debt-hint";
import type { DashboardData } from "@/lib/dashboard-data";
import { WidgetRow } from "@/components/widget-row";
import { TILE_BOX, TileHead, TileValue, TileList, type TileItem } from "./tile";
import { BridgeHint } from "./mode-line";
import { formatCompactMoney } from "./compact";

/** Срок «дд.мм.гггг» уже прошёл (конец дня). */
function isPastRu(date: string): boolean {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(date);
  return m ? new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), 23, 59, 59).getTime() < Date.now() : false;
}

/**
 * Три плитки оплат: «Общая стоимость», «Оплачено», «К оплате» — одни и те же цифры на Главной и в «Оплаты → Все».
 * Всегда с НДС; 4% отдельной суммой не добавляются (оплачены в составе оплат ТЗ).
 */
export function PayTiles({ d, c4Mode, year, only, id = "pay", title = "Оплаты", headerEnd, bare = false, defaultCollapsed = false }: { /** Свёрнуто по умолчанию (на Главной эти цифры уже в полосе «Главное»). */ defaultCollapsed?: boolean; /** Только три плитки, без WidgetRow и сетки: их кладёт в общий ряд «Сырьё | Оплаты» вызывающий (RawCards pay). */ bare?: boolean; /** Ссылка «→ Раздел» над кнопками «Свернуть/Закрепить». */ headerEnd?: React.ReactNode; /** id и заголовок ряда виджетов (запоминание «свернуть/закрепить»). */ id?: string; title?: string; d: DashboardData; c4Mode: "on" | "off"; year: YearFilter; /** Только мех или только подкладка (страница «Сырьё»): без работы и без общих подсказок по долгу. */ only?: "fur" | "lining" }) {
  const { debt } = d;
  const mln = (v: number) => formatCompactMoney(v);
  const rawPaid = d.paidByItem.fur + d.paidByItem.lining;
  const prodPaid = d.paidByItem.work;
  const money = (v: number) => formatMoney(v.toFixed(2));
  const dash = (v: number) => (Math.abs(v) < 0.5 ? "—" : money(v));
  // Детализация меха и подкладки: остаток на складе, использовано (без 4%) и надбавка 4% (оплачена в составе оплат ТЗ, доплаты нет).
  const detail = (x: typeof d.raw.fur.incl) => ({ stock: x.remValue, used: c4Mode === "on" ? x.usedValueOther : x.usedValue, c4: Math.abs(x.usedValue - x.usedValueOther) });
  const furD = detail(d.raw.fur.incl), linD = detail(d.raw.lining.incl);
  // Оплачено и к оплате делятся на «за использованное» и «за остаток на складе» пропорционально их стоимости; 4% оплачены в составе оплат ТЗ (доплаты нет).
  const split = (D: ReturnType<typeof detail>, amount: number) => {
    const base = D.used + D.stock;
    const u = base > 0 ? D.used / base : 0;
    return { used: amount * u, stock: amount * (1 - u) };
  };
  const furPaidD = split(furD, d.paidByItem.fur), linPaidD = split(linD, d.paidByItem.lining);
  const furLeftD = split(furD, d.left.fur), linLeftD = split(linD, d.left.lining);

  const inFur = only !== "lining", inLin = only !== "fur", inWork = !only;
  const paidAll = (inFur ? d.paidByItem.fur : 0) + (inLin ? d.paidByItem.lining : 0) + (inWork ? prodPaid : 0);
  const leftAll = (inFur ? d.left.fur : 0) + (inLin ? d.left.lining : 0) + (inWork ? d.left.prod : 0);
  // Копеечное округление между «Куплено» (сумма лотов) и документами: на «Сырьё» показываем строкой, чтобы итог совпал с Главной (на самой Главной не трогаем).
  const roundAll = only ? rawRounding(d, { fur: inFur, lining: inLin }) : 0;
  const totalAll = paidAll + leftAll + roundAll;
  void rawPaid;
  const part = (v: number, whole: number) => (whole > 0.5 ? v / whole : null);
  const list = (whole: number, fur: number, furSplit: { stock: number; used: number }, furC4: number, lin: number, linSplit: { stock: number; used: number }, linC4: number, work: number, warn?: boolean, workLabel = "Работа"): TileItem[] => [
    ...(inFur ? [
      ...(only ? [] : [{ k: "Мех", v: money(fur), share: part(fur, whole), tone: warn && fur > 0 ? "text-amber-700" : undefined }]),
      { k: "остаток на складе", v: dash(furSplit.stock), sub: !only },
      { k: "использовано", v: dash(furSplit.used), sub: !only },
      { k: "4%", v: dash(furC4), sub: !only },
    ] : []),
    ...(inLin ? [
      ...(only ? [] : [{ k: "Подкладка", v: money(lin), share: part(lin, whole), tone: warn && lin > 0 ? "text-amber-700" : undefined }]),
      { k: "остаток на складе", v: dash(linSplit.stock), sub: !only },
      { k: "использовано", v: dash(linSplit.used), sub: !only },
      { k: "4%", v: dash(linC4), sub: !only },
    ] : []),
    ...(inWork ? [{ k: workLabel, v: money(work), share: part(work, whole), tone: warn && work > 0 ? "text-amber-700" : undefined }] : []),
  ];

  const tiles = (
    <>
      <div key="total" className={TILE_BOX}>
        <TileHead>Общая стоимость</TileHead>
        <div className="absolute right-3 top-3">
          <InfoHint label="Что такое общая стоимость" align="right">
            <p>Оплачено плюс осталось оплатить: сырьё (мех с шкурами подрядчика, подкладка) и работа по ТЗ. Всегда с НДС; 4% отдельно не добавляются.</p>
            <p className="mt-1">Общая стоимость = Оплачено + К оплате. Доля — от общей стоимости.</p>
          </InfoHint>
        </div>
        <TileValue compact={bare}>{money(totalAll)}</TileValue>
        <TileList stack={bare} items={[...list(totalAll, d.paidByItem.fur + d.left.fur, { stock: furD.stock, used: furD.used }, furD.c4, d.paidByItem.lining + d.left.lining, { stock: linD.stock, used: linD.used }, linD.c4, prodPaid + d.left.prod, true), ...(roundAll !== 0 ? [{ k: "округление", v: money(roundAll) }] : [])]} />
      </div>

      <div key="paid" className={TILE_BOX}>
        <TileHead>Оплачено всего</TileHead>
        {inWork ? (
          <div className="absolute right-3 top-3">
            <InfoHint label="Чем «Оплачено всего» отличается от оплат по партиям" align="right">
              <p>«Оплачено всего» — всё, что оплачено: сырьё и работа. В «Партиях пошива» и карточке партии — «Оплачено (разнесено на партии)»: меньше.</p>
              <p className="mt-1">Разница = неразнесённый аванс {money(d.clientDebtInfo.unallocated)} (аванс заказчика, ещё не отнесён к партиям).</p>
            </InfoHint>
          </div>
        ) : null}
        <TileValue compact={bare}>{money(paidAll)}</TileValue>
        <div data-testid="paid-by-item">
          <TileList stack={bare} items={list(paidAll, d.paidByItem.fur, furPaidD, furD.c4, d.paidByItem.lining, linPaidD, linD.c4, prodPaid, true)} />
        </div>
      </div>

      <div key="left" className={TILE_BOX} data-testid="debt-bridge">
        <TileHead>К оплате всего</TileHead>
        <div className={"absolute right-3 top-3 flex items-center gap-1" + (only ? " hidden" : "")}>
          <BridgeHint label="Как сходится долг поставщику">
            <p>Долг по работе (общий баланс): работа по всем ТЗ минус все оплаты, включая авансы, ещё не привязанные к партиям — сколько предстоит заплатить, если все авансы отработают (договор №1605: аванс 70 %, доплата 30 % после сдачи).</p>
            <p className="mt-1">Закупки всего <b>{mln(debt.total.toNumber())}</b> = мех получен <b>{mln(d.bridge.purchases.received)}</b> + ещё не получен <b>{mln(d.bridge.purchases.draft)}</b>. Минус оплачено <b>{mln(d.supplierCashPaid)}</b> = долг <b>{mln(debt.debt.toNumber())}</b>.</p>
            <p className="mt-1">Части (по УПД, счёт не оплачен, ожидаемое) в сумме дают этот долг. Всегда с НДС.</p>
          </BridgeHint>
          <SupplierDebtHint debt={debt} year={year} align="right" />
        </div>
        <TileValue compact={bare} className={leftAll > 0 ? "text-amber-700" : ""}>{money(leftAll)}</TileValue>
        <TileList stack={bare} items={list(leftAll, d.left.fur, furLeftD, 0, d.left.lining, linLeftD, 0, d.left.prod, true, "Долг по работе (общий баланс)")} />
        {d.invoiceDeadlines.length > 0 && !only ? (
          <div className="mt-2 border-t border-neutral-100 pt-2 text-xs text-neutral-600">
            <div className="font-medium text-neutral-700">Ближайшие сроки счетов</div>
            {d.invoiceDeadlines.map((x) => {
              const late = isPastRu(x.date);
              return <div key={x.auction + x.date} className={late ? "text-red-700" : undefined}>{x.date} · {x.auction} · <b className="tabular-nums">{formatMoney(x.amount.toFixed(0))}</b>{late ? " · просрочен" : ""}</div>;
            })}
          </div>
        ) : null}
      </div>
    </>
  );
  if (bare) return tiles;
  return (
    <WidgetRow defaultCollapsed={defaultCollapsed} headerEnd={headerEnd} id={id + (only ? "-" + only : "")} title={only === "fur" ? "Оплаты — мех" : only === "lining" ? "Оплаты — подкладка" : title}>
      <div className="grid grid-cols-1 items-stretch gap-3 md:grid-cols-3 print:grid-cols-3">{tiles}</div>
    </WidgetRow>
  );
}
