"use client";

import { useState } from "react";
import Link from "next/link";
import { PhotoGalleryButton } from "@/components/photo-gallery";
import { variantOfArticle } from "@/lib/sales-receipts-core";
import { MOVE_LABEL, dmy, type MoveRow } from "@/lib/sales-section";
import { DASH, GET, NAVY, STOCK, money, n0, nSigned } from "../sales-fmt";
import type { PhotoIdx } from "../sales-tree";

export type Card = {
  title: string; color: string | null; modelCode: string | null; category: string | null; fur: string | null;
  prices: number[]; costIncl: number | null; costExcl: number | null; modelId: string | null;
  tz: { id: string; number: string; paid: number }[]; photo: PhotoIdx[string] | null;
};

const th = "px-2 py-2 text-right text-xs font-semibold whitespace-nowrap";
const td = "px-2 py-1.5 text-right text-sm tabular-nums whitespace-nowrap";

function StockChart({ rows, hot, setHot }: { rows: MoveRow[]; hot: number | null; setHot: (i: number | null) => void }) {
  const W = Math.max(320, rows.length * 28 + 90), H = 200, PL = 44, PR = 12, PT = 12, PB = 30;
  const maxV = Math.max(1, ...rows.map((r) => r.stock)), minV = Math.min(0, ...rows.map((r) => r.stock));
  const y = (v: number) => PT + (H - PT - PB) * (1 - (v - minV) / (maxV - minV));
  const x = (i: number) => PL + (rows.length <= 1 ? 0 : (i * (W - PL - PR)) / (rows.length - 1));
  const pts = rows.map((r, i) => `${x(i)},${y(r.stock)}`);
  return (
    <div className="overflow-x-auto" data-keep-scroll tabIndex={0} role="img" aria-label="Остаток по артикулу нарастающим итогом после каждого движения">
      <svg width={W} height={H} className="block" onMouseLeave={() => setHot(null)}>
        {[minV, (minV + maxV) / 2, maxV].map((v) => <g key={v}><line x1={PL} x2={W - PR} y1={y(v)} y2={y(v)} stroke="#e5e5e5" /><text x={PL - 6} y={y(v) + 4} textAnchor="end" fontSize="11" fill="#525252">{Math.round(v)}</text></g>)}
        {rows.map((r, i) => <rect key={r.line.id} x={x(i) - 4} y={y(Math.max(0, r.delta > 0 ? r.stock : r.stock - r.delta))} width="8" height={Math.max(2, Math.abs(y(r.stock) - y(r.stock - r.delta)))} fill={r.delta >= 0 ? NAVY : GET} opacity="0.35" />)}
        <polyline points={pts.join(" ")} fill="none" stroke={STOCK} strokeWidth="2" />
        {rows.map((r, i) => <circle key={r.line.id} cx={x(i)} cy={y(r.stock)} r={hot === i ? 5 : 3} fill={STOCK} onMouseEnter={() => setHot(i)}><title>{`${dmy(r.line.iso)}: ${MOVE_LABEL[r.type]} ${nSigned(r.delta)}, остаток ${r.stock}`}</title></circle>)}
        {rows.map((r, i) => (i === 0 || i === rows.length - 1 || i % Math.ceil(rows.length / 8) === 0) ? <text key={"t" + r.line.id} x={x(i)} y={H - 8} textAnchor="middle" fontSize="11" fill="#404040">{dmy(r.line.iso).slice(0, 5)}</text> : null)}
      </svg>
    </div>
  );
}

export function MovementView({ card, rows }: { card: Card; rows: MoveRow[] }) {
  const [hot, setHot] = useState<number | null>(null);
  const received = rows.filter((r) => r.line.kind === "RECEIPT").reduce((a, r) => a + r.line.pcs, 0);
  const sold = rows.filter((r) => r.line.kind === "SALE").reduce((a, r) => a + r.line.pcs, 0);
  const revIn = rows.reduce((a, r) => a + r.line.retailRub, 0), revEx = rows.reduce((a, r) => a + r.line.retailRubExVat, 0);
  const photoVariant = rows[0] ? variantOfArticle(rows[0].line.article) : "";
  const photos = card.photo && photoVariant ? card.photo.photos.filter((p) => p.variant.trim().toUpperCase() === photoVariant.trim().toUpperCase()) : [];
  const price = card.prices.length === 0 ? null : card.prices[0] === card.prices[card.prices.length - 1] ? card.prices[0] : null;
  const markup = price !== null && card.costIncl ? price / card.costIncl : null;
  const fact = (k: string, v: React.ReactNode) => <div className="flex flex-col"><dt className="text-xs text-neutral-700">{k}</dt><dd className="text-sm">{v}</dd></div>;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <Link href="/sales" className="inline-flex min-h-11 items-center text-sm underline">← Продажи и остатки</Link>
          <h1 className="break-words text-xl font-semibold">Движение по артикулу</h1>
        </div>
      </div>
      <section aria-label="Карточка артикула" className="flex flex-col gap-3 rounded-lg border border-neutral-300 bg-white p-3 sm:flex-row">
        <div className="shrink-0">
          {card.photo && photos.length ? <PhotoGalleryButton modelId={card.photo.modelId} photos={photos} title={card.title} /> : <span role="img" aria-label="Фото нет" className="inline-flex size-24 items-center justify-center rounded border border-dashed border-neutral-300 text-xs text-neutral-600">Фото нет</span>}
        </div>
        <dl className="grid min-w-0 flex-1 grid-cols-2 gap-x-4 gap-y-2 md:grid-cols-4">
          {fact("Артикул", <span className="break-words">{card.title}{card.color ? ` · ${card.color}` : ""}</span>)}
          {fact("Категория", card.category ?? DASH)}
          {fact("Тип меха", card.fur ?? DASH)}
          {fact("Цена прайса 19.10", card.prices.length === 0 ? DASH : price !== null ? money(price) : `${money(card.prices[0])} – ${money(card.prices[card.prices.length - 1])}`)}
          {fact("Себестоимость (ТЗ)", card.costIncl ? <>{money(card.costIncl)} с НДС{card.costExcl ? <span className="text-neutral-700"> · {money(card.costExcl)} без</span> : null}</> : DASH)}
          {fact("Маркап", markup === null ? DASH : "×" + markup.toFixed(2).replace(".", ","))}
          {fact("Изделие", card.modelId ? <Link href={`/models/${card.modelId}`} className="inline-flex min-h-11 items-center underline">Карточка изделия {card.modelCode ?? ""}</Link> : DASH)}
          {fact("ТЗ и оплаты", card.tz.length ? <ul className="flex flex-col">{card.tz.map((t) => <li key={t.id}><Link href={`/production/${t.id}`} className="inline-flex min-h-11 items-center underline">ТЗ {t.number}</Link><span className="text-neutral-700"> · оплачено {money(t.paid)}</span></li>)}</ul> : DASH)}
        </dl>
      </section>
      <section aria-label="Итоги" className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {[["Приход, шт.", n0(received)], ["Продано, шт.", n0(sold)], ["Остаток, шт.", n0(received - sold)], ["Выручка", `${money(revIn)} с НДС · ${money(revEx)} без`]].map(([k, v]) => <div key={k} className="rounded-lg border border-neutral-300 bg-white p-3"><div className="text-xs text-neutral-700">{k}</div><div className="text-lg font-semibold tabular-nums">{v}</div></div>)}
      </section>
      {rows.length === 0 ? <p className="rounded-lg border border-neutral-300 bg-white p-3 text-sm">По этому артикулу движений в выгрузке нет.</p> : (
        <>
          <section aria-label="Остаток нарастающим итогом" className="flex flex-col gap-2 rounded-lg border border-neutral-300 bg-white p-3">
            <h2 className="text-sm font-semibold">Остаток нарастающим итогом</h2>
            <StockChart rows={rows} hot={hot} setHot={setHot} />
            <p className="text-xs text-neutral-700" aria-live="polite">{hot !== null ? `${dmy(rows[hot].line.iso)} · ${MOVE_LABEL[rows[hot].type]} ${nSigned(rows[hot].delta)} · остаток ${n0(rows[hot].stock)}` : "Наведите на точку или строку таблицы."}</p>
          </section>
          <section aria-label="Все движения" className="flex flex-col gap-2 rounded-lg border border-neutral-300 bg-white p-3">
            <h2 className="text-sm font-semibold">Все движения</h2>
            <div className="max-h-[70vh] w-full min-w-0 overflow-auto rounded-lg border border-neutral-300" data-keep-scroll tabIndex={0} role="region" aria-label="Лента движений">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-neutral-300">
                    <th scope="col" className={th + " sticky top-0 bg-white text-left"}>Дата</th><th scope="col" className={th + " sticky top-0 bg-white text-left"}>Тип</th><th scope="col" className={th + " sticky top-0 bg-white text-left"}>Заказ</th><th scope="col" className={th + " sticky top-0 bg-white text-left"}>Сезон</th><th scope="col" className={th + " sticky top-0 bg-white text-left"}>Цвет</th>
                    <th scope="col" className={th + " sticky top-0 bg-white"}>Шт.</th><th scope="col" className={th + " sticky top-0 bg-white"}>Цена за шт.</th><th scope="col" className={th + " sticky top-0 bg-white"}>Выручка с НДС</th><th scope="col" className={th + " sticky top-0 bg-white"}>Выручка без НДС</th><th scope="col" className={th + " sticky top-0 bg-white"}>Discount</th><th scope="col" className={th + " sticky top-0 bg-white"}>Остаток</th><th scope="col" className={th + " sticky top-0 bg-white text-left"}>Источник</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const l = r.line;
                    return (
                      <tr key={l.id} onMouseEnter={() => setHot(i)} onMouseLeave={() => setHot(null)} className={"border-b border-neutral-200 " + (hot === i ? "bg-neutral-100" : "")}>
                        <th scope="row" className="px-2 py-1.5 text-left text-sm font-normal whitespace-nowrap tabular-nums">{dmy(l.iso)}</th>
                        <td className="px-2 py-1.5 text-left text-sm whitespace-nowrap">{MOVE_LABEL[r.type]}</td>
                        <td className="px-2 py-1.5 text-left text-sm tabular-nums">№{l.orderNo}</td>
                        <td className="px-2 py-1.5 text-left text-sm whitespace-nowrap">{l.season}</td>
                        <td className="px-2 py-1.5 text-left text-sm">{l.colorId ?? DASH}</td>
                        <td className={td}>{l.pcs < 0 ? nSigned(l.pcs) : n0(l.pcs)}</td>
                        <td className={td}>{l.kind === "SALE" && l.pcs !== 0 ? money(l.retailRub / l.pcs) : DASH}</td>
                        <td className={td}>{money(l.retailRub)}</td><td className={td}>{money(l.retailRubExVat)}</td><td className={td}>{money(l.discountRub)}</td>
                        <td className={td + " font-semibold"}>{n0(r.stock)}</td>
                        <td className="px-2 py-1.5 text-left text-xs whitespace-nowrap text-neutral-700">выгрузка «поступления и продажи», импорт {dmy(l.importTag.replace(/^.*:/, ""))}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-neutral-700">Остаток считается нарастающим итогом: приход минус продажи, возвраты возвращают штуки, корректировки прихода с минусом уменьшают остаток. Строки продаж без штук (только скидка) остаток не меняют.</p>
          </section>
        </>
      )}
    </div>
  );
}
