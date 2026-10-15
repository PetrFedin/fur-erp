import { formatMoney } from "@/lib/utils";
import { alignColumn, roundRub } from "@/lib/money-round";
import { payNumbers } from "@/lib/pay-display";
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
  const prodPaid = d.paidByItem.work;
  const money = (v: number) => formatMoney(roundRub(v));
  const dash = (v: number) => (Math.abs(v) < 0.5 ? "—" : money(v));
  // Деньги — целые рубли, сходящиеся на экране (src/lib/money-round.ts): мех + подкладка выровнены вместе с плитками «Куплено / Использовано / Остаток»,
  // оплачено и к оплате делятся по статьям так, чтобы Σ статей == показанному итогу.
  const N = payNumbers(d, c4Mode, only);
  const { furD, linD, inFur, inLin, inWork, P, L, T, paidAll, leftAll, roundAll, totalAll, furPaidD, linPaidD, furLeftD, linLeftD } = N;
  const part = (v: number, whole: number) => (whole > 0.5 ? v / whole : null);
  const list = (whole: number, fur: number, furSplit: { stock: number; used: number }, furC4: number, lin: number, linSplit: { stock: number; used: number }, linC4: number, work: number, warn?: boolean, workLabel = "Работа подрядчику"): TileItem[] => [
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

  // Оплачено по типам платежа: аванс, доплата, окончательный расчёт и прочее (только те, что есть); сумма и число платежей.
  // Показываем, когда Σ типов = «Оплачено всего» (без фильтров); при фильтрах «Оплачено» пересчитано по статьям, разбивки по типам для него нет.
  const TYPE_LABEL = { ADVANCE: "Аванс", PARTIAL: "Доплата", FINAL: "Окончательный платёж", OTHER: "Прочие платежи" } as const;
  const typeRows = d.paidByType.filter((t) => t.count > 0 || Math.abs(t.amount) >= 0.5);
  const typeSum = typeRows.reduce((a, t) => a + t.amount, 0);
  const typesOk = inWork && !only && typeRows.length > 0 && Math.abs(typeSum - paidAll) < 1;
  const typeAl = alignColumn(typeRows.map((t) => t.amount), paidAll); // типы платежа складываются в показанное «Оплачено всего»
  const typeItems: TileItem[] = typeRows.map((t, i) => ({ k: `${TYPE_LABEL[t.type]} · ${t.count} ${t.count % 10 === 1 && t.count % 100 !== 11 ? "платёж" : t.count % 10 >= 2 && t.count % 10 <= 4 && (t.count % 100 < 10 || t.count % 100 >= 20) ? "платежа" : "платежей"}`, v: money(typeAl.values[i]), share: part(typeAl.values[i], paidAll) }));

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
        <TileList stack={bare} items={[...list(totalAll, T.fur, { stock: furD.stock, used: furD.used }, furD.c4, T.lining, { stock: linD.stock, used: linD.used }, linD.c4, T.work, true), ...(roundAll !== 0 ? [{ k: "округление (лоты и документы)", v: money(roundAll) }] : [])]} />
      </div>

      <div key="paid" className={TILE_BOX}>
        <TileHead>Оплачено всего</TileHead>
        {inWork ? (
          <div className="absolute right-3 top-3">
            <InfoHint label="Чем «Оплачено всего» отличается от оплат по партиям" align="right">
              <p>«Оплачено всего» — всё, что оплачено: сырьё и работа. В «Партиях пошива» и карточке партии — «Оплачено (разнесено на партии)»: меньше.</p>
              <p className="mt-1">Разница = неразнесённый аванс {money(d.clientDebtInfo.unallocated)} (аванс подрядчику, ещё не отнесён к партиям).</p>
            </InfoHint>
          </div>
        ) : null}
        <TileValue compact={bare}>{money(paidAll)}</TileValue>
        <div data-testid="paid-by-item">
          <TileList stack={bare} items={list(paidAll, P.fur, furPaidD, furD.c4, P.lining, linPaidD, linD.c4, P.work, true)} />
        </div>
        {typesOk ? (
          <div data-testid="paid-by-type" className="mt-2 border-t border-neutral-100 pt-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">По типам платежа</div>
            <TileList stack={bare} items={typeItems} />
          </div>
        ) : null}
      </div>

      <div key="left" className={TILE_BOX} data-testid="debt-bridge">
        <TileHead>К оплате всего</TileHead>
        <div className={"absolute right-3 top-3 flex items-center gap-1" + (only ? " hidden" : "")}>
          <BridgeHint label="Как сходится долг поставщику">
            <p>К оплате всего = за мех и подкладку {money(L.fur + L.lining)} + за работу подрядчику {money(L.work)}.</p>
            <p className="mt-1">Долг по работе подрядчику (общий баланс): работа по всем ТЗ минус все оплаты, включая авансы, ещё не привязанные к партиям — сколько предстоит заплатить, если все авансы отработают (договор №1605: аванс 70 %, доплата 30 % после сдачи).</p>
            <p className="mt-1">Закупки всего <b>{mln(debt.total.toNumber())}</b> = мех получен <b>{mln(d.bridge.purchases.received)}</b> + ещё не получен <b>{mln(d.bridge.purchases.draft)}</b>. Минус оплачено <b>{mln(d.supplierCashPaid)}</b> = долг <b>{mln(debt.debt.toNumber())}</b>.</p>
            <p className="mt-1">Части (по УПД, счёт не оплачен, ожидаемое) в сумме дают этот долг. Всегда с НДС.</p>
          </BridgeHint>
          <SupplierDebtHint debt={debt} year={year} align="right" />
        </div>
        <TileValue compact={bare} className={leftAll > 0 ? "text-amber-700" : ""}>{money(leftAll)}</TileValue>
        {inWork && !only ? <div className="text-xs text-neutral-500">за мех и подкладку {money(L.fur + L.lining)} + за работу подрядчику {money(L.work)}</div> : null}
        <TileList stack={bare} items={list(leftAll, L.fur, furLeftD, 0, L.lining, linLeftD, 0, L.work, true, "Долг по работе подрядчику")} />
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
