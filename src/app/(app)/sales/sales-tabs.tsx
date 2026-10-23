"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { PhotoGalleryButton } from "@/components/photo-gallery";
import type { Ctx } from "@/lib/margin-tree";
import { bucketsOf, daysBetween, groupBy, type Env, type Ext, type Gran, type Group, type SLine } from "@/lib/sales-section";
import { RevenueChart } from "./sales-charts";
import { DASH, d1, dateRu, money, n0, pct, seg, segGroup } from "./sales-fmt";
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

export function SeasonsTab({ ctx, env, lines, vatNote, gran, onGran, ex }: Common & { gran: Gran; onGran: (g: Gran) => void; ex: boolean }) {
  const rows = useMemo(() => bucketsOf(ctx, env, lines, "season", 0), [ctx, env, lines]);
  const series = useMemo(() => bucketsOf(ctx, env, lines, gran, 0), [ctx, env, lines, gran]);
  if (!rows.length) return <section className={sec}><p className="text-sm text-neutral-700">Нет данных за выбранный период.</p></section>;
  const cols: { label: string; get: (m: Ext, stock: number) => number | null; fmt: (v: number | null) => string }[] = [
    { label: "Приход, шт.", get: (m) => m.received, fmt: (v) => n0(v ?? 0) },
    { label: "Продано, шт.", get: (m) => m.sold, fmt: (v) => n0(v ?? 0) },
    { label: "Остаток на конец, шт.", get: (_m, s) => s, fmt: (v) => n0(v ?? 0) },
    { label: "SO", get: (m) => m.sellThrough, fmt: (v) => pct(v) },
    { label: `Выручка, ₽ (${vatNote})`, get: (m) => m.revenue, fmt: (v) => money(v) },
    { label: "Средняя цена, ₽", get: (m) => m.avgPrice, fmt: (v) => money(v) },
    { label: "Скидка при продаже", get: (m) => m.discountGiven, fmt: (v) => pct(v, 1) },
  ];
  return (
    <section aria-label="Динамика по сезонам" className={sec}>
      <h2 className="text-sm font-semibold">Динамика по сезонам</h2>
      <div className={wrap} data-keep-scroll tabIndex={0} role="region" aria-label="Сравнение сезонов">
        <table suppressHydrationWarning className="table-keep w-full border-collapse">
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
      <RevenueChart buckets={series} gran={gran} onGran={onGran} ex={ex} />
    </section>
  );
}

function Thumb({ g, photos }: { g: Pick<Group, "modelCode" | "variant" | "label">; photos: PhotoIdx }) {
  const photo = g.modelCode ? photos[g.modelCode] : undefined;
  const v = photo && g.variant ? photo.photos.filter((p) => p.variant.trim().toUpperCase() === g.variant!.trim().toUpperCase()) : [];
  return photo && v.length ? <PhotoGalleryButton modelId={photo.modelId} photos={v} title={g.label} compact thumbOnly /> : <span role="img" aria-label="Фото нет" className="mx-auto inline-block size-10 rounded border border-dashed border-neutral-300" />;
}

type Sort = "idle" | "stock";

/** Только то, чего нет в дереве: залежавшееся (нет продаж N дней). Остатки по структурам — в «Обзоре». */
export function StockTab({ ctx, env, lines, photos, today }: Common & { photos: PhotoIdx; today: string }) {
  const [sort, setSort] = useState<Sort>("idle");
  const [idle, setIdle] = useState(30);
  const groups = useMemo(() => groupBy(ctx, env, lines, "color"), [ctx, env, lines]);
  const idleDays = (g: Group) => (g.m.lastSale ? daysBetween(g.m.lastSale, today) : null);
  const list = useMemo(() => {
    const r = groups.filter((g) => g.m.stock > 0).filter((g) => { const d = g.m.lastSale ? daysBetween(g.m.lastSale, today) : null; return d === null || d >= idle; });
    const dd = (g: Group) => (g.m.lastSale ? daysBetween(g.m.lastSale, today) : 1e6);
    return [...r].sort(sort === "stock" ? (a, b) => b.m.stock - a.m.stock : (a, b) => dd(b) - dd(a));
  }, [groups, idle, sort, today]);
  return (
    <section aria-label="Залежавшееся" className={sec}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-sm font-semibold">Залежавшееся</h2>
        <div role="group" aria-label="Нет продаж, дней" className={segGroup}>
          {([30, 60, 90] as const).map((k) => <button key={k} type="button" aria-pressed={idle === k} onClick={() => setIdle(k)} className={seg(idle === k)}>{k} дн.</button>)}
        </div>
        <div role="group" aria-label="Сортировка" className={segGroup}>
          {([["idle", "По давности"], ["stock", "По остатку"]] as const).map(([k, t]) => <button key={k} type="button" aria-pressed={sort === k} onClick={() => setSort(k)} className={seg(sort === k)}>{t}</button>)}
        </div>
      </div>
      <div className={wrap} data-keep-scroll tabIndex={0} role="region" aria-label="Список залежавшегося">
        <table suppressHydrationWarning className="table-keep w-full border-collapse">
          <thead><tr className="border-b border-neutral-300">
            <th scope="col" className={th + " w-12 text-center"}>Фото</th><th scope="col" className={th + " text-left"}>Артикул · цвет</th>
            <th scope="col" className={th}>Остаток, шт.</th><th scope="col" className={th}>Последняя продажа</th><th scope="col" className={th}>Без продаж, дн.</th>
          </tr></thead>
          <tbody>
            {list.map((g) => {
              const href = movementHref(g.article, g.color, g.modelCode);
              const d = idleDays(g);
              return (
                <tr key={g.key} className="border-b border-neutral-200">
                  <td className="w-12 px-1 py-1 text-center"><Thumb g={g} photos={photos} /></td>
                  <th scope="row" className="px-2 py-1.5 text-left text-sm font-normal">{href ? <Link href={href} className="underline decoration-neutral-400 underline-offset-2">{g.label}</Link> : g.label}</th>
                  <td className={td + " font-semibold"}>{n0(g.m.stock)}</td><td className={td}>{dateRu(g.m.lastSale)}</td><td className={td}>{d === null ? "не продавалось" : d === 0 ? DASH : n0(d)}</td>
                </tr>
              );
            })}
            {list.length === 0 && <tr><td colSpan={5} className="px-2 py-4 text-center text-sm text-neutral-700">Залежавшегося нет.</td></tr>}
          </tbody>
        </table>
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

type TopBy = "revenue" | "sold" | "profit" | "idle";
const TOP_LABEL: Record<TopBy, string> = { revenue: "Выручка", sold: "Штуки", profit: "Прибыль", idle: "Без движения" };

/** Один список топ-10 с переключателем меры. */
export function TopTab({ ctx, env, lines, photos }: Common & { photos: PhotoIdx }) {
  const [by, setBy] = useState<TopBy>("revenue");
  const g = useMemo(() => groupBy(ctx, env, lines, "article"), [ctx, env, lines]);
  const f: Record<Exclude<TopBy, "idle">, (x: Group) => number | null> = { revenue: (x) => x.m.revenue, sold: (x) => x.m.sold, profit: (x) => x.m.grossProfit };
  const rows = by === "idle" ? [...g].filter((x) => x.m.stock > 0 && x.m.sold <= 0).sort((a, b) => b.m.stock - a.m.stock).slice(0, 10) : [...g].filter((x) => (f[by](x) ?? 0) > 0).sort((a, b) => (f[by](b) ?? 0) - (f[by](a) ?? 0)).slice(0, 10);
  const value = (x: Group) => by === "idle" ? { v: x.m.stock, text: n0(x.m.stock) + " шт." } : by === "sold" ? { v: x.m.sold, text: n0(x.m.sold) + " шт." } : by === "revenue" ? { v: x.m.revenue, text: money(x.m.revenue) } : { v: x.m.grossProfit ?? 0, text: money(x.m.grossProfit) };
  return (
    <section aria-label="Топ и аутсайдеры" className={sec}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Топ-10 артикулов</h2>
        <div role="group" aria-label="Мера топа" className={segGroup}>
          {(Object.keys(TOP_LABEL) as TopBy[]).map((k) => <button key={k} type="button" aria-pressed={by === k} onClick={() => setBy(k)} className={seg(by === k)}>{TOP_LABEL[k]}</button>)}
        </div>
      </div>
      <Top title={by === "idle" ? "Есть остаток, продаж нет" : TOP_LABEL[by]} rows={rows} value={value} photos={photos} />
    </section>
  );
}
