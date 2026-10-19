"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { PhotoGalleryButton } from "@/components/photo-gallery";
import type { Ctx, ReportSizeRow } from "@/lib/margin-tree";
import { colorOfLine } from "@/lib/sales-receipts-core";
import { bucketsOf, daysBetween, groupBy, sortSeasons, type Cat, type Env, type Ext, type Group, type SLine } from "@/lib/sales-section";
import { DASH, btn, d1, dateRu, money, n0, pct, seg, segGroup } from "./sales-fmt";
import { movementHref } from "@/lib/sales-url";
import type { PhotoIdx } from "./sales-tree";

const th = "px-2 py-2 text-right text-xs font-semibold whitespace-nowrap";
const td = "px-2 py-1.5 text-right text-sm tabular-nums whitespace-nowrap";
const wrap = "max-h-[75vh] w-full min-w-0 overflow-auto rounded-lg border border-neutral-300";
const sec = "flex min-w-0 flex-col gap-3 rounded-lg border border-neutral-300 bg-white p-3";

type Common = { ctx: Ctx; env: Env; lines: SLine[]; vatNote: string };

/** Стрелка тренда к предыдущему сезону: только направление. */
function Trend({ cur, prev }: { cur: number | null; prev: number | null | undefined }) {
  if (cur === null || prev === null || prev === undefined || Math.abs(cur - prev) < 1e-9) return null;
  const up = cur > prev;
  return <span role="img" aria-label={up ? "выше, чем в прошлом сезоне" : "ниже, чем в прошлом сезоне"} className="ml-1 text-xs text-neutral-600">{up ? "▲" : "▼"}</span>;
}

export function SeasonsTab({ ctx, env, lines, vatNote }: Common) {
  const rows = useMemo(() => bucketsOf(ctx, env, lines, "season", 0), [ctx, env, lines]);
  if (!rows.length) return <section className={sec}><p className="text-sm text-neutral-700">Нет данных за выбранный период.</p></section>;
  const cols: { label: string; get: (m: Ext, stock: number) => number | null; fmt: (v: number | null) => string }[] = [
    { label: "Приход, шт.", get: (m) => m.received, fmt: (v) => n0(v ?? 0) },
    { label: "Продано, шт.", get: (m) => m.sold, fmt: (v) => n0(v ?? 0) },
    { label: "Остаток на конец, шт.", get: (_m, s) => s, fmt: (v) => n0(v ?? 0) },
    { label: "Sell-through", get: (m) => m.sellThrough, fmt: (v) => pct(v) },
    { label: `Выручка, ₽ (${vatNote})`, get: (m) => m.revenue, fmt: (v) => money(v) },
    { label: "Средняя цена, ₽", get: (m) => m.avgPrice, fmt: (v) => money(v) },
    { label: "Скидка при продаже", get: (m) => m.discountGiven, fmt: (v) => pct(v, 1) },
  ];
  return (
    <section aria-label="Динамика по сезонам" className={sec}>
      <h2 className="text-sm font-semibold">Динамика по сезонам</h2>
      <div className={wrap} data-keep-scroll tabIndex={0} role="region" aria-label="Сравнение сезонов">
        <table className="w-full border-collapse">
          <thead><tr className="border-b border-neutral-300"><th scope="col" className={th + " text-left"}>Сезон</th>{cols.map((c) => <th key={c.label} scope="col" className={th}>{c.label}</th>)}</tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.key} className="border-b border-neutral-200">
                <th scope="row" className="px-2 py-1.5 text-left text-sm font-normal whitespace-nowrap">{r.label}</th>
                {cols.map((c) => <td key={c.label} className={td}>{c.fmt(c.get(r.m, r.stock))}<Trend cur={c.get(r.m, r.stock)} prev={i > 0 ? c.get(rows[i - 1].m, rows[i - 1].stock) : undefined} /></td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-neutral-700">Стрелка — направление к предыдущему сезону. Сезоны разной длины: сравнивайте с учётом даты последней продажи. Остаток нарастающий: поступления и продажи ранних сезонов уменьшают его в более поздних.</p>
    </section>
  );
}

function Thumb({ g, photos }: { g: Pick<Group, "modelCode" | "variant" | "label">; photos: PhotoIdx }) {
  const photo = g.modelCode ? photos[g.modelCode] : undefined;
  const v = photo && g.variant ? photo.photos.filter((p) => p.variant.trim().toUpperCase() === g.variant!.trim().toUpperCase()) : [];
  return photo && v.length ? <PhotoGalleryButton modelId={photo.modelId} photos={v} title={g.label} compact thumbOnly /> : <span role="img" aria-label="Фото нет" className="mx-auto inline-block size-10 rounded border border-dashed border-neutral-300" />;
}

type StockBy = "article" | "color" | "size";
type Sort = "stock" | "cover" | "idle";

export function StockTab({ ctx, env, lines, sizes, photos, today, cat }: Common & { sizes: ReportSizeRow[]; photos: PhotoIdx; today: string; cat: Cat }) {
  const [by, setBy] = useState<StockBy>("article");
  const [sort, setSort] = useState<Sort>("stock");
  const [idle, setIdle] = useState(0);
  const groups = useMemo(() => (by === "size" ? [] : groupBy(ctx, env, lines, by)), [ctx, env, lines, by]);
  const idleDays = (g: Group) => (g.m.lastSale ? daysBetween(g.m.lastSale, today) : null);
  const list = useMemo(() => {
    let r = groups.filter((g) => g.m.stock > 0);
    if (idle > 0) r = r.filter((g) => { const d = g.m.lastSale ? daysBetween(g.m.lastSale, today) : null; return d === null || d >= idle; });
    const cov = (g: Group) => g.m.coverMonths ?? Number.POSITIVE_INFINITY;
    const dd = (g: Group) => (g.m.lastSale ? daysBetween(g.m.lastSale, today) : 1e6);
    return [...r].sort(sort === "stock" ? (a, b) => b.m.stock - a.m.stock : sort === "cover" ? (a, b) => cov(b) - cov(a) : (a, b) => dd(b) - dd(a));
  }, [groups, idle, sort, today]);
  const sizeRows = useMemo(() => sizes.filter((r) => r.stock > 0 && (cat === "all" || r.cls === cat)).sort((a, b) => b.stock - a.stock), [sizes, cat]);
  const total = by === "size" ? sizeRows.reduce((a, r) => a + r.stock, 0) : list.reduce((a, g) => a + g.m.stock, 0);
  return (
    <section aria-label="Остатки" className={sec}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-sm font-semibold">Остатки</h2>
        <div role="group" aria-label="Разрез остатков" className={segGroup}>
          {([["article", "Артикулы"], ["color", "Цвета"], ["size", "Размеры"]] as const).map(([k, t]) => <button key={k} type="button" aria-pressed={by === k} onClick={() => setBy(k)} className={seg(by === k)}>{t}</button>)}
        </div>
        {by !== "size" && (
          <>
            <div role="group" aria-label="Сортировка" className={segGroup}>
              {([["stock", "По остатку"], ["cover", "По покрытию"], ["idle", "По давности"]] as const).map(([k, t]) => <button key={k} type="button" aria-pressed={sort === k} onClick={() => setSort(k)} className={seg(sort === k)}>{t}</button>)}
            </div>
            <div role="group" aria-label="Залежавшееся" className={segGroup}>
              {([[0, "Все"], [30, "30 дн."], [60, "60 дн."], [90, "90 дн."]] as const).map(([k, t]) => <button key={k} type="button" aria-pressed={idle === k} title={k ? `Нет продаж ${k} дней и больше` : "Все остатки"} onClick={() => setIdle(k)} className={seg(idle === k)}>{k ? `Без продаж ${t}` : t}</button>)}
            </div>
          </>
        )}
      </div>
      <p className="text-xs text-neutral-700">{by === "size" ? "Размеры — по Report на 19.10.2026, с периодом и фильтрами выгрузки не связаны (учитывается только категория)." : "Остаток = приход − продано за выбранный период и категорию."} Всего в списке: <b className="tabular-nums">{n0(total)}</b> шт.</p>
      <div className={wrap} data-keep-scroll tabIndex={0} role="region" aria-label="Список остатков">
        {by === "size" ? (
          <table className="w-full border-collapse">
            <thead><tr className="border-b border-neutral-300"><th scope="col" className={th + " text-left"}>Артикул · цвет · размер</th><th scope="col" className={th}>Получено</th><th scope="col" className={th}>Продано</th><th scope="col" className={th}>Остаток</th></tr></thead>
            <tbody>{sizeRows.map((r, i) => <tr key={i} className="border-b border-neutral-200"><th scope="row" className="px-2 py-1.5 text-left text-sm font-normal">{r.acode} · {colorOfLine(r.color)} · {r.size}</th><td className={td}>{n0(r.deliv)}</td><td className={td}>{n0(r.sold)}</td><td className={td}>{n0(r.stock)}</td></tr>)}</tbody>
          </table>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-neutral-300">
                <th scope="col" className={th + " w-12 text-center"}>Фото</th><th scope="col" className={th + " text-left"}>{by === "color" ? "Артикул · цвет" : "Артикул"}</th>
                <th scope="col" className={th}>Приход</th><th scope="col" className={th}>Продано</th><th scope="col" className={th}>Остаток</th><th scope="col" className={th}>Покрытие, мес.</th><th scope="col" className={th}>Последняя продажа</th><th scope="col" className={th}>Без продаж, дн.</th>
              </tr>
            </thead>
            <tbody>
              {list.map((g) => {
                const href = movementHref(g.article, g.color, g.modelCode);
                const d = idleDays(g);
                return (
                  <tr key={g.key} className="border-b border-neutral-200">
                    <td className="w-12 px-1 py-1 text-center"><Thumb g={g} photos={photos} /></td>
                    <th scope="row" className="px-2 py-1.5 text-left text-sm font-normal">{href ? <Link href={href} className="underline decoration-neutral-400 underline-offset-2">{g.label}</Link> : g.label}</th>
                    <td className={td}>{n0(g.m.received)}</td><td className={td}>{n0(g.m.sold)}</td><td className={td + " font-semibold"}>{n0(g.m.stock)}</td>
                    <td className={td}>{d1(g.m.coverMonths)}</td><td className={td}>{dateRu(g.m.lastSale)}</td><td className={td}>{d === null ? "не продавалось" : d === 0 ? DASH : n0(d)}</td>
                  </tr>
                );
              })}
              {list.length === 0 && <tr><td colSpan={8} className="px-2 py-4 text-center text-sm text-neutral-700">Нет остатков по выбранным условиям.</td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

function Top({ title, rows, value, photos }: { title: string; rows: Group[]; value: (g: Group) => { v: number; text: string }; photos: PhotoIdx }) {
  const max = Math.max(...rows.map((g) => Math.abs(value(g).v)), 1);
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-neutral-300 p-3">
      <h3 className="text-sm font-semibold">{title}</h3>
      {rows.length === 0 ? <p className="text-sm text-neutral-700">Нет данных.</p> : (
        <ol className="flex flex-col gap-1">
          {rows.map((g, i) => {
            const val = value(g), href = movementHref(g.article, null, g.modelCode);
            return (
              <li key={g.key} className="flex items-center gap-2">
                <span className="w-5 shrink-0 text-right text-xs tabular-nums text-neutral-600">{i + 1}</span>
                <span className="w-11 shrink-0"><Thumb g={g} photos={photos} /></span>
                <span className="min-w-0 flex-1">
                  {href ? <Link href={href} className="block truncate text-sm underline decoration-neutral-400 underline-offset-2" title={g.label}>{g.label}</Link> : <span className="block truncate text-sm">{g.label}</span>}
                  <span className="block h-1.5 rounded bg-neutral-100"><span className="block h-1.5 rounded bg-neutral-700" style={{ width: `${Math.max(2, (Math.abs(val.v) / max) * 100)}%` }} /></span>
                </span>
                <span className="shrink-0 text-sm tabular-nums">{val.text}</span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

export function TopTab({ ctx, env, lines, photos, vatNote }: Common & { photos: PhotoIdx }) {
  const g = useMemo(() => groupBy(ctx, env, lines, "article"), [ctx, env, lines]);
  const top = (f: (x: Group) => number | null, n = 10) => [...g].filter((x) => (f(x) ?? 0) > 0).sort((a, b) => (f(b) ?? 0) - (f(a) ?? 0)).slice(0, n);
  const idle = [...g].filter((x) => x.m.stock > 0 && x.m.sold <= 0).sort((a, b) => b.m.stock - a.m.stock).slice(0, 10);
  const worst = [...g].filter((x) => x.m.grossProfit !== null).sort((a, b) => a.m.grossProfit! - b.m.grossProfit!).slice(0, 10).filter((x) => x.m.grossProfit! < 0);
  return (
    <section aria-label="Топ и аутсайдеры" className={sec}>
      <h2 className="text-sm font-semibold">Топ и аутсайдеры</h2>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Top title={`Топ-10 по выручке, ${vatNote}`} rows={top((x) => x.m.revenue)} value={(x) => ({ v: x.m.revenue, text: money(x.m.revenue) })} photos={photos} />
        <Top title="Топ-10 по проданным штукам" rows={top((x) => x.m.sold)} value={(x) => ({ v: x.m.sold, text: n0(x.m.sold) + " шт." })} photos={photos} />
        <Top title="Топ-10 по валовой прибыли" rows={top((x) => x.m.grossProfit)} value={(x) => ({ v: x.m.grossProfit ?? 0, text: money(x.m.grossProfit) })} photos={photos} />
        <Top title="Без движения: есть остаток, продаж нет" rows={idle} value={(x) => ({ v: x.m.stock, text: n0(x.m.stock) + " шт." })} photos={photos} />
        {worst.length > 0 && <Top title="Продано ниже себестоимости" rows={worst} value={(x) => ({ v: x.m.grossProfit ?? 0, text: money(x.m.grossProfit) })} photos={photos} />}
      </div>
      <p className="text-xs text-neutral-700">Артикулы выбранного периода и категории. Валовая прибыль — только где в ТЗ есть себестоимость.</p>
    </section>
  );
}

export function OrdersTab({ ctx, env, lines, onOpen, vatNote }: Common & { onOpen: (orderNo: string) => void }) {
  const rows = useMemo(() => groupBy(ctx, env, lines, "order").sort((a, b) => (a.m.firstReceipt ?? "9") < (b.m.firstReceipt ?? "9") ? -1 : 1), [ctx, env, lines]);
  const seasonOf = (g: Group) => sortSeasons(g.lines.map((l) => l.season)).join(", ");
  return (
    <section aria-label="Заказы" className={sec}>
      <h2 className="text-sm font-semibold">Заказы: что пришло, продалось и осталось</h2>
      <div className={wrap} data-keep-scroll tabIndex={0} role="region" aria-label="Заказы на поставку">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-neutral-300">
              <th scope="col" className={th + " text-left"}>Заказ</th><th scope="col" className={th + " text-left"}>Сезон</th><th scope="col" className={th}>Пришло, шт.</th><th scope="col" className={th}>Продано, шт.</th>
              <th scope="col" className={th}>Остаток, шт.</th><th scope="col" className={th}>Sell-through</th><th scope="col" className={th}>Выручка, ₽ ({vatNote})</th><th scope="col" className={th}>Первая поставка</th><th scope="col" className={th}>Последняя продажа</th><th scope="col" className={th}><span className="sr-only">Действие</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((g) => (
              <tr key={g.key} className="border-b border-neutral-200">
                <th scope="row" className="px-2 py-1.5 text-left text-sm font-normal tabular-nums">№{g.label}</th>
                <td className="px-2 py-1.5 text-left text-sm whitespace-nowrap">{seasonOf(g)}</td>
                <td className={td}>{n0(g.m.received)}</td><td className={td}>{n0(g.m.sold)}</td><td className={td + " font-semibold"}>{n0(g.m.stock)}</td>
                <td className={td}>{pct(g.m.sellThrough)}</td><td className={td}>{money(g.m.revenue)}</td><td className={td}>{dateRu(g.m.firstReceipt)}</td><td className={td}>{dateRu(g.m.lastSale)}</td>
                <td className="px-2 py-1 text-right"><button type="button" onClick={() => onOpen(g.label)} className={btn}>В таблицу</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-neutral-700">Sell-through больше 100 % возможен: продажи заказа включают остатки других поступлений. Строки продаж заказа без штук (только скидка) в штуки не входят. Кнопка «В таблицу» открывает «Обзор» с поиском по номеру заказа.</p>
    </section>
  );
}

