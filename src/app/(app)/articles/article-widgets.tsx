"use client";

import { useMemo, useState } from "react";
import { useVatDisplay } from "@/lib/vat-display";
import { formatMoney, formatQty, formatMarkup } from "@/lib/utils";
import type { DrillOrder } from "@/lib/dashboard-drill";
import { sumOrders, sumTotal } from "@/lib/orders-sum";
import { GroupSwitch, TileCarousel, type GroupSel } from "@/components/tile-carousel";
import { TileCaption, TileList, TileValue } from "../dashboard/tile";

const money = (v: number) => formatMoney(v.toFixed(2));
const moneyNz = (v: number) => (Math.abs(v) < 0.5 ? "—" : money(v));
const NO_FUR = "Мех не указан";
const furOf = (o: DrillOrder) => o.fur || NO_FUR;
const inGroup = (grp: string, g: GroupSel) => g === "all" || grp === g;
const GROUP_NOUN: Record<GroupSel, string> = { all: "все изделия", Одежда: "одежда", Аксессуары: "аксессуары" };

/** «На 1 изделие»: Тотал + слайды по типам меха (вид меха ТЗ, как в дереве ниже); «Одежда / Аксессуары» действует на все слайды. Без ремонта. */
export function PerUnitCarousel({ orders, c4 }: { orders: DrillOrder[]; c4: "on" | "off" }) {
  const { mode: vat } = useVatDisplay();
  const [group, setGroup] = useState<GroupSel>("all");
  const own = useMemo(() => orders.filter((o) => o.cat !== "Ремонт"), [orders]);
  const furs = useMemo(() => {
    const q = new Map<string, number>();
    for (const o of own) q.set(furOf(o), (q.get(furOf(o)) ?? 0) + o.qty);
    return Array.from(q).sort((a, b) => (a[0] === NO_FUR ? 1 : b[0] === NO_FUR ? -1 : b[1] - a[1] || a[0].localeCompare(b[0], "ru"))).map(([k]) => k);
  }, [own]);

  const slide = (fur: string | null) => {
    const s = sumOrders(own.filter((o) => inGroup(o.grp, group) && (fur == null || furOf(o) === fur)), vat);
    const total = sumTotal(s);
    const share = (v: number) => (total ? v / total : null);
    if (s.qty <= 0) {
      return (
        <>
          <TileValue>—</TileValue>
          <TileCaption>нет изделий</TileCaption>
        </>
      );
    }
    return (
      <>
        <TileValue>{money(total / s.qty)}</TileValue>
        <div className="min-h-4 text-[11px] leading-4 tabular-nums text-neutral-400">{c4 === "on" ? `${money((total - s.c4) / s.qty)} без 4 %` : null}</div>
        <TileCaption>себестоимость с работой · {formatQty(s.qty)} шт. · без ремонта · {vat === "incl" ? "с НДС" : "без НДС"}</TileCaption>
        <TileList items={[
          { k: "Сырьё (мех + подкладка)", v: moneyNz((s.fur + s.lining) / s.qty), share: share(s.fur + s.lining) },
          ...(c4 === "on" ? [{ k: "Надбавка 4 %", v: moneyNz(s.c4 / s.qty), share: share(s.c4) }] : []),
          ...(Math.abs(s.other) > 0.5 && Math.abs(s.other) >= total * 0.001 ? [{ k: "Расходы ТЗ и прочее", v: money(s.other / s.qty), share: share(s.other) }] : []),
          { k: "Работа", v: moneyNz(s.work / s.qty), share: share(s.work) },
        ]} />
      </>
    );
  };

  return (
    <TileCarousel
      title="На 1 изделие"
      hintLabel="Как считается на изделие"
      hint={
        <>
          <p>Σ себестоимость с работой без ремонта ÷ Σ изделий выбранного меха и группы. Не среднее по ТЗ, а общая сумма на общее количество. «Все виды меха» — все изделия страницы, цифры те же, что были в одной плитке.</p>
          <p className="mt-1">Листайте вправо-влево, стрелками или точками: слайд на каждый вид меха ТЗ (как в дереве ниже; смешанные ТЗ — отдельным слайдом, например «Норка + Соболь»). Кнопки «Одежда / Аксессуары» меняют группу на любом слайде. Режимы шапки: {vat === "incl" ? "с НДС" : "без НДС"}, {c4 === "on" ? "с 4 % (мелко — без 4 %)" : "без 4 %"}.</p>
        </>
      }
      toolbar={<GroupSwitch value={group} onChange={setGroup} label={`Группа изделий: ${GROUP_NOUN[group]}`} />}
      slides={[{ key: "total", label: "Все виды меха", body: slide(null) }, ...furs.map((f) => ({ key: f, label: f, body: slide(f) }))]}
    />
  );
}

export type MarkupRow = { fur: string | null; grp: string; price: number | null; unit: number | null; qty: number; orders: number };
const fmtX = (v: number) => formatMarkup(v);

/** Средневзвешенные по выпуску: цена = Σ(цена × выпуск) ÷ Σ выпуск; маркап = Σ(цена × выпуск) ÷ Σ(себестоимость ед. × выпуск). Артикулы с ценой и себестоимостью. */
function aggOf(list: MarkupRow[]) {
  const priced = list.filter((r) => r.price && r.unit && r.qty > 0);
  if (priced.length === 0) return null;
  const sumW = priced.reduce((a, r) => a + r.qty, 0);
  const retail = priced.reduce((a, r) => a + r.price! * r.qty, 0);
  const cost = priced.reduce((a, r) => a + r.unit! * r.qty, 0);
  return { n: priced.length, price: retail / sumW, markup: cost > 0 ? retail / cost : 0 };
}

/** «Маркап»: Тотал + слайды по основному виду меха артикула (как в таблице «Наценка по меху и категориям»); тот же переключатель «Одежда / Аксессуары». */
export function MarkupCarousel({ rows }: { rows: MarkupRow[] }) {
  const [group, setGroup] = useState<GroupSel>("all");
  const furs = useMemo(() => {
    const q = new Map<string, number>();
    for (const r of rows) if (r.fur) q.set(r.fur, (q.get(r.fur) ?? 0) + r.qty);
    return Array.from(q).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ru")).map(([k]) => k);
  }, [rows]);

  const slide = (fur: string | null) => {
    const list = rows.filter((r) => inGroup(r.grp, group) && (fur == null || r.fur === fur));
    const a = aggOf(list);
    const noPrice = list.filter((r) => !r.price && r.orders > 0).length;
    if (!a && list.every((r) => r.orders === 0)) {
      return (
        <>
          <TileValue>—</TileValue>
          <TileCaption>нет изделий</TileCaption>
        </>
      );
    }
    return (
      <>
        <TileValue>{a ? fmtX(a.markup) : "—"}</TileValue>
        <TileCaption>розница ÷ себестоимость, средневзвешенно{a ? "" : " · нет артикулов с ценой"}</TileCaption>
        <TileList items={[
          { k: "Ср. розничная цена", v: a ? formatMoney(a.price.toFixed(0)) : "—" },
          { k: "Артикулов с ценой", v: a ? String(a.n) : "—" },
          { k: "Без цены", v: noPrice || "—" },
        ]} />
      </>
    );
  };

  return (
    <TileCarousel
      title="Наценка"
      hintLabel="Как считается наценка"
      hint={
        <>
          <p>Σ(цена × выпуск) ÷ Σ(себестоимость ед. × выпуск) по артикулам с розничной ценой. «Все виды меха» — все артикулы списка; слайды — по основному виду меха артикула (тому, на который списано больше всего меха). Подробно по меху и категориям — в таблице ниже.</p>
          <p className="mt-1">Кнопки «Одежда / Аксессуары» меняют группу на любом слайде.</p>
        </>
      }
      toolbar={<GroupSwitch value={group} onChange={setGroup} label={`Группа изделий: ${GROUP_NOUN[group]}`} />}
      slides={[{ key: "total", label: "Все виды меха", body: slide(null) }, ...furs.map((f) => ({ key: f, label: f, body: slide(f) }))]}
    />
  );
}
