import Link from "next/link";
import { Decimal } from "@prisma/client/runtime/library";
import { Money } from "@/components/money";
import { Ref4 } from "@/components/c4-note";
import { formatQty, formatDec1 } from "@/lib/utils";
import { aggOf, pctText, usedPct, type RawLot } from "@/lib/raw-analytics";

/** Колонки таблицы лотов и итоговых строк групп (одинаковые, чтобы цифры стояли друг под другом). */
export const LOT_COLS = "md:grid-cols-[2fr_1fr_1fr_1fr_1fr_0.8fr_1.2fr_1.4fr]";

const q2 = (d: Decimal) => d.toFixed(2);
const qty = (d: Decimal, unit: string) => `${formatDec1(d.toString())} ${unit}`;

/** Лоты раскрытой группы (подгружаются при раскрытии строки). */
export function GroupLots({ lots, unit, c4, showAuction }: { lots: RawLot[]; unit: string; c4: "on" | "off"; showAuction: boolean }) {
  return (
    <div className="bg-neutral-50/60 px-3 pb-3">
      {lots.map((l) => (
        <LotRowView key={l.id} l={l} unit={unit} c4={c4} showAuction={showAuction} />
      ))}
    </div>
  );
}

function LotRowView({ l, unit, c4, showAuction }: { l: RawLot; unit: string; c4: "on" | "off"; showAuction: boolean }) {
  const a = aggOf([l]);
  const lab = "block text-xs text-neutral-500 md:hidden";
  if (l.synthetic) {
    // Строка моста до Главной (не лот склада): без ссылок на карточку лота.
    return (
      <div className="border-t border-neutral-200 py-2 text-sm first:border-t-0">
        <div className={`grid grid-cols-2 gap-2 ${LOT_COLS}`}>
          <div className="col-span-2 md:col-span-1">
            <div className="font-medium">{l.synthetic === "ordered" ? `Заказано, не получено · ${l.kind}` : `Шкуры подрядчика · ${l.year}`}</div>
            <div className="text-xs text-neutral-500">{l.synthetic === "ordered" ? `${l.auctionLabel} · лотов склада ещё нет` : "оплачены в составе пошива, в ТЗ не списаны"}</div>
          </div>
          <span className="tabular-nums"><span className={lab}>Куплено</span>{qty(l.recv, unit)}</span>
          <span className="tabular-nums"><span className={lab}>Использовано</span>{qty(l.used, unit)}</span>
          <span className="tabular-nums"><span className={lab}>В учёте</span><span aria-label="совпадает с остатком">✓</span></span>
          <span className="font-medium tabular-nums"><span className={lab}>Остаток</span>{qty(l.rem, unit)}</span>
          <span className="tabular-nums"><span className={lab}>% исп.</span>{pctText(usedPct(a))}</span>
          <span className="tabular-nums"><span className={lab}>Куплено, ₽</span><Money incl={q2(a.recvIncl)} excl={q2(a.recvExcl)} /></span>
          <span className="tabular-nums"><span className={lab}>Стоимость остатка</span><Money incl={q2(a.remIncl)} excl={q2(a.remExcl)} /></span>
        </div>
      </div>
    );
  }
  return (
    <div className="border-t border-neutral-200 py-2 text-sm first:border-t-0">
      <div className={`grid grid-cols-2 gap-2 ${LOT_COLS}`}>
        <div className="col-span-2 md:col-span-1">
          <div className="font-medium">
            Лот{" "}
            <Link href={`/analytics/raw/lot/${l.id}`} className="underline hover:text-neutral-900" title="Карточка лота: где использован, учёт, остаток">{l.lotNumber}</Link>
            {l.purchaseId && (
              <Link href={`/purchases/${l.purchaseId}`} className="ml-2 text-xs font-normal text-neutral-500 underline hover:text-neutral-900">закупка {l.purchaseNumber}</Link>
            )}
          </div>
          <div className="text-xs text-neutral-500">
            {l.kind} · {l.cat}{l.size !== "Не указан" ? ` · ${l.size}` : ""}
            {showAuction ? ` · ${l.auctionLabel}` : ""} · {l.year}
          </div>
        </div>
        <span className="tabular-nums"><span className={lab}>Куплено</span>{qty(l.recv, unit)}</span>
        <span className="tabular-nums"><span className={lab}>Использовано</span>{qty(l.used, unit)}</span>
        <span className={"tabular-nums " + (l.movementGap.isZero() ? "" : "font-medium text-red-700")} title={l.movementGap.isZero() ? undefined : `журнал − лот = ${formatDec1(l.movementGap.toString())}`}>
          <span className={lab}>В учёте</span>{qty(l.jNet, unit)}
        </span>
        <span className="font-medium tabular-nums"><span className={lab}>Остаток</span>{qty(l.rem, unit)}</span>
        <span className="tabular-nums"><span className={lab}>% исп.</span>{pctText(usedPct(a))}</span>
        <span className="tabular-nums">
          <span className={lab}>Цена за единицу</span>
          <Money incl={q2(l.unitIncl)} excl={q2(l.unitExcl)} />
          <Ref4 mode={c4} incl={q2(l.unitIncl)} excl={q2(l.unitExcl)} />
        </span>
        <span className="tabular-nums">
          <span className={lab}>Стоимость остатка</span>
          <Money incl={q2(a.remIncl)} excl={q2(a.remExcl)} />
          <Ref4 mode={c4} incl={q2(a.remIncl)} excl={q2(a.remExcl)} />
        </span>
      </div>
      <div className="mt-1 text-xs text-neutral-600">
        {l.usages.length > 0 ? (
          <>
            Использован в ТЗ:{" "}
            {l.usages.map((u, i) => (
              <span key={u.orderId}>
                {i > 0 && ", "}
                <Link href={`/production/${u.orderId}`} className="underline hover:text-neutral-900">{u.label}</Link> ({formatDec1(u.qty.toString())})
              </span>
            ))}
            {" · "}
          </>
        ) : (
          <>Ни в одном ТЗ не использован · </>
        )}
        <Link href={`/analytics/raw/lot/${l.id}`} className="font-medium underline hover:text-neutral-900">Где использован →</Link>
      </div>
    </div>
  );
}
