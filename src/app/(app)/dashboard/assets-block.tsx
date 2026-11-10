"use client";

import { WidgetRow } from "@/components/widget-row";
import { InfoHint } from "@/components/info-hint";
import { useVatDisplay } from "@/lib/vat-display";
import { formatMoney, formatQty } from "@/lib/utils";
import { TILE_BOX, TileCaption, TileHead, TileList, TileValue } from "./tile";

type Pair = { incl: number; excl: number };

/**
 * Активы (первый блок Главной): сколько меха в наличии и на какую сумму, сколько готовых изделий на стоке и на какую сумму, и общая сумма активов.
 * Мех — остаток сырья (куплено минус использовано, как в блоке «Сырьё»); изделия — остаток по отчёту «заказ и продажи» (346 шт.), оценка по закупке.
 * Сумма активов = мех + изделия по закупке (розница изделий — справочно, в сумму не входит). Незавершённое производство пока не учитывается.
 */
export function AssetsBlock({ furQty, fur, goodsQty, goods, goodsRetail }: { furQty: number; fur: Pair; goodsQty: number; goods: Pair; goodsRetail: Pair }) {
  const { mode } = useVatDisplay();
  const v = (p: Pair) => (mode === "excl" ? p.excl : p.incl);
  const total = v(fur) + v(goods);
  const share = (x: number) => (total > 0 ? x / total : null);
  return (
    <WidgetRow stage id="assets" title="Активы">
      <div className="grid grid-cols-1 items-stretch gap-3 md:grid-cols-3 print:grid-cols-3">
        <div className={TILE_BOX}>
          <TileHead>Мех в наличии<InfoHint label="Мех в наличии"><p>Шкуры, купленные и ещё не пошедшие в производство: куплено минус использовано по ТЗ. Сумма — по цене закупки, как в блоке «Сырьё» (режим «с 4%» и НДС — по переключателям).</p></InfoHint></TileHead>
          <TileValue>{formatQty(furQty)} шт.</TileValue>
          <TileCaption>шкур на складе</TileCaption>
          <TileList items={[{ k: "Сумма", v: formatMoney(v(fur)), share: share(v(fur)) }]} />
        </div>
        <div className={TILE_BOX}>
          <TileHead>Изделия на стоке<InfoHint label="Изделия на стоке"><p>Готовые изделия, получено минус продано по отчёту «заказ и продажи». Сумма — по закупке (поступило в € × 110, мех, подкладка и работа вместе). Розничная стоимость — справочно: возможная выручка, в активы не входит.</p></InfoHint></TileHead>
          <TileValue>{formatQty(goodsQty)} шт.</TileValue>
          <TileCaption>получено − продано</TileCaption>
          <TileList items={[{ k: "По закупке", v: formatMoney(v(goods)), share: share(v(goods)) }, { k: "В рознице по прайсу", v: formatMoney(v(goodsRetail)), sub: true }]} />
        </div>
        <div className={TILE_BOX}>
          <TileHead>Всего активов<InfoHint label="Всего активов"><p>Мех в наличии плюс готовые изделия на стоке, обе суммы по закупке. Незавершённое производство (изделия в работе) сюда пока не входит.</p></InfoHint></TileHead>
          <TileValue>{formatMoney(total)}</TileValue>
          <TileCaption>мех + изделия по закупке</TileCaption>
          <TileList items={[{ k: "Мех", v: formatMoney(v(fur)), share: share(v(fur)) }, { k: "Изделия", v: formatMoney(v(goods)), share: share(v(goods)) }]} />
        </div>
      </div>
    </WidgetRow>
  );
}
