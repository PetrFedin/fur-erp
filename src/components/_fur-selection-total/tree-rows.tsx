"use client";

import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { formatMoney, cn } from "@/lib/utils";
import { InfoHint } from "@/components/info-hint";
import { shortMaterialName } from "@/lib/material-name";
import { useClientSort } from "@/lib/use-client-sort";
import { NO_AUCTION, figures, flowOf, lotCountLabel, planUsdAvg, rowsBy, type FlowFigures, type FurKind, type FurLot, type TableRow } from "@/lib/fur-table";
import { A, OTHER_FUR, Q, R, hasLotCard, type Level } from "./helpers";
import { Num } from "./cells";
import type { TableCells } from "./table-cells";

/** Строки дерева таблицы: [год →] вид → партия → лот → ТЗ. Раскрытие (expanded) и сортировка — в FurSelectionTotal. */
export function makeTreeRows(ctx: {
  kind: FurKind; vat: "incl" | "excl"; show4: boolean; mode: Parameters<typeof figures>[1]; expanded: Set<string>; toggleExp: (key: string) => void; levels: Level[];
  summaryOnly?: boolean; lockItem?: string; group: "item" | "year" | "auction" | "lots"; table: { selectedKeys: string[] };
  cs: ReturnType<typeof useClientSort<{ figures: FlowFigures; label: string }>>; byBought: (rows: TableRow[]) => TableRow[]; rowsFor: (list: FurLot[], level: Level) => TableRow[];
  yearAligned: { total: FlowFigures; byKey: Map<string, FlowFigures> } | null; showQty: boolean; showMoney: boolean; tc: TableCells;
}) {
  const { kind, vat, show4, mode, expanded, toggleExp, levels, summaryOnly, lockItem, group, table, cs, byBought, rowsFor, yearAligned, showQty, showMoney } = ctx;
  const { GROUPS, showHam, showUsd, showPay, showVat, cells, payCells, vatCells } = ctx.tc;
  const pad = (depth: number) => ({ paddingLeft: 12 + depth * (kind === "lining" ? 12 : 20) });

  /** Строка ТЗ: сколько лота ушло в это ТЗ, на какую сумму (без 4%), цена за единицу и надбавка 4%. */
  const renderUsage = (l: FurLot, u: FurLot["usages"][number], depth: number) => {
    const sumU = vat === "incl" ? u.incl : u.excl;
    const extra = vat === "incl" ? u.extraIncl : u.extraExcl;
    return (
      <tr key={`u:${l.id}:${u.orderId}`} data-sub="usage" className="border-t border-neutral-100 bg-neutral-50/70 text-xs text-neutral-600">
        <td className="sticky left-0 z-10 bg-neutral-50 py-1.5 pr-3" style={pad(depth)}>
          <Link href={`/production/${u.orderId}`} className="text-blue-700 hover:underline">ТЗ {u.number}</Link>
          <span className="ml-1.5 text-neutral-500">{u.qty > 0 ? `${formatMoney(sumU / u.qty)}/${kind === "lining" ? "м" : "шт."}` : ""}</span>
        </td>
        {GROUPS.map((g) => (
          <Fragment key={g.key}>
            {showQty && <Num first small muted>{g.key === "used" ? Q(u.qty) : <span className="text-neutral-500">–</span>}</Num>}
            {showMoney && (
              <Num first={!showQty} small muted>
                {g.key === "used" ? <><div>{R(sumU)}</div>{show4 && extra > 0.005 ? <div className="text-[11px] text-neutral-500">4 %: {R(extra)}</div> : null}</> : <span className="text-neutral-500">–</span>}
              </Num>
            )}
            <Num small muted>{g.key === "used" && u.qty > 0 ? A(sumU / u.qty) : <span className="text-neutral-500">–</span>}</Num>
            {showHam && g.key === "recv" && <Num small muted><span className="text-neutral-500">–</span></Num>}
            {showUsd && <Num small muted><span className="text-neutral-500">–</span></Num>}
          </Fragment>
        ))}
        {showPay && <><Num first small muted><span className="text-neutral-500">–</span></Num><Num small muted><span className="text-neutral-500">–</span></Num></>}
        {showVat && <><Num first small muted><span className="text-neutral-500">–</span></Num><Num small muted><span className="text-neutral-500">–</span></Num></>}
      </tr>
    );
  };

  const renderLot = (l: FurLot, depth: number, path: string, parentLabel: string) => {
    const lk = `${path}/l:${l.id}`;
    const lOpen = expanded.has(lk);
    const canOpen = l.usages.length > 0;
    const sub = [path === "flat" ? l.auctionLabel : null, l.materialName !== parentLabel ? l.materialName : null, l.color !== "Не указан" ? l.color : null, l.size !== "Не указан" ? l.size : null, String(l.year), ...l.attrs].filter(Boolean).join(" · ");
    const purchaseTitle = [l.supplier, l.purchaseNumber].filter(Boolean).join(" · ");
    const pct = l.recv > 0 ? Math.min(100, (l.used / l.recv) * 100) : 0;
    return (
      <Fragment key={lk}>
        <tr data-sub="lot" onClick={canOpen ? () => toggleExp(lk) : undefined} className={cn("border-t border-neutral-100 bg-white text-[13px]", canOpen && "cursor-pointer hover:bg-neutral-50", lOpen && "text-neutral-900")}>
          <td className="sticky left-0 z-10 bg-white py-1.5 pr-3 align-top" style={pad(depth)}>
            <div className="flex items-center gap-1 whitespace-nowrap">
              <span aria-hidden className={cn("inline-block w-3 shrink-0 text-neutral-500 transition-transform", lOpen && "rotate-90", !canOpen && "invisible")}>›</span>
              {canOpen ? <button type="button" aria-expanded={lOpen} aria-label={`Раскрыть ТЗ лота ${l.lotNumber}`} onClick={(e) => { e.stopPropagation(); toggleExp(lk); }} className="text-left font-medium">№ {l.lotNumber}</button> : <span className="font-medium">№ {l.lotNumber}</span>}
              {hasLotCard(l) ? (
                <Link href={`/analytics/raw/lot/${l.id}`} onClick={(e) => e.stopPropagation()} className="ml-1 text-[11px] text-blue-700 hover:underline" title="Карточка лота">карточка ›</Link>
              ) : (
                // Карточки нет (строка-заглушка «заказано, не получено» / «шкуры подрядчика»): приглушённый «—» с пояснением в «i».
                <span className="ml-1 inline-flex items-center gap-1 text-[11px] text-neutral-600" onClick={(e) => e.stopPropagation()}>
                  <span aria-disabled="true" role="link" title="Карточки нет">–</span>
                  <InfoHint label="Почему нет карточки лота" align="left">{l.id.startsWith("hides") ? "Шкуры подрядчика: отдельной карточки лота нет, списания — в ТЗ." : "Лот не использован — детализации списаний нет."}</InfoHint>
                </span>
              )}
              {l.purchaseId ? (
                <Link href={`/purchases/${l.purchaseId}`} onClick={(e) => e.stopPropagation()} className="ml-0.5 text-[11px] text-neutral-600 hover:text-blue-700 hover:underline" title={`Закупка ${purchaseTitle}`} aria-label={`Открыть закупку ${l.purchaseNumber ?? ""}`}>↗</Link>
              ) : null}
            </div>
            <div className="truncate pl-4 text-[11px] text-neutral-500" title={[sub, purchaseTitle].filter(Boolean).join(" · ")}>{sub}</div>
          </td>
          {cells(figures(flowOf([l]), mode), { small: true, usedBar: l.recv > 0 ? pct : undefined, plan: planUsdAvg([l], flowOf([l])), lot: l })}
          {payCells([l], { small: true })}
          {showVat && vatCells([l], { small: true, single: true })}
        </tr>
        {lOpen ? l.usages.map((u) => renderUsage(l, u, depth + 1)) : null}
      </Fragment>
    );
  };

  /** Названия-ссылки: вид меха → страница вида (/lots/fur/…), ткань → её лоты, партия → страница аукциона (/lots?auction=…). */
  const nameHref = (level: Level, row: TableRow): string | null => {
    if (level === "item") return kind === "lining" ? `/lots?tab=lining&lmat=${encodeURIComponent(row.label)}` : `/lots/fur/${encodeURIComponent(row.label)}`;
    if (level === "auction") return row.key.startsWith("Шкуры подрядчика") ? "/lots/contractor-hides" : row.key === NO_AUCTION ? null : kind === "lining" ? `/lots/lining/${encodeURIComponent(row.key)}` : `/lots?auction=${encodeURIComponent(row.key)}`;
    return null;
  };
  const nameTitle = (level: Level, row: TableRow) => (level === "item" ? (kind === "lining" ? "Лоты этой ткани" : `Страница вида меха «${row.label}»`) : row.key.startsWith("Шкуры подрядчика") ? "Шкуры подрядчика: детализация" : `Страница аукциона «${row.label}»`);
  const auctionSub = (row: TableRow) => {
    const dates = row.lots.map((l) => l.orderDate).filter((x): x is string => !!x).sort();
    const sup = [...new Set(row.lots.map((l) => l.supplier).filter((x): x is string => !!x))];
    const d = dates[0] ? dates[0].split("-").reverse().join(".") : "";
    return [d, sup.length === 1 ? sup[0] : sup.length > 1 ? `${sup.length} поставщ.` : ""].filter(Boolean).join(" · ") || " ";
  };
  // Название ткани: «Ткань №N» / сокращение известных длинных названий, остальное переносится на 2 строки (без «…»); полное — в title.
  const wrapName = kind === "lining";
  const shown = (level: Level, row: TableRow) => (kind === "lining" && level === "item" ? shortMaterialName(row.label) : row.label);
  // off — сдвиг уровней: под строкой «Остальной мех» (малые виды меха) идут виды, затем аукционы.
  const renderNode = (row: TableRow, depth: number, path: string, off = 0): ReactNode => {
    const synth = row.key === OTHER_FUR;
    const level: Level = synth ? "item" : levels[depth - off];
    const key = `${path}/${level}:${row.key}`;
    const open = expanded.has(key);
    const leaf = Boolean(summaryOnly) && !lockItem && !synth && depth + 1 - off >= levels.length;
    const isSel = depth === 0 && group === "item" && table.selectedKeys.includes(row.key);
    const inner = open && !leaf
      ? synth
        ? cs.sort(byBought(rowsBy(row.lots, mode, (l) => l.item))).map((c) => renderNode(c, depth + 1, key, off + 1))
        : depth + 1 - off < levels.length
          ? cs.sort(rowsFor(row.lots, levels[depth + 1 - off])).map((c) => renderNode(c, depth + 1, key, off))
          : row.lots.map((l) => renderLot(l, depth + 1, key, row.label))
      : null;
    // Оранжевая полоска слева (тема customer: bg-neutral-50/70) — только у родительских строк «год» и «вид меха»; у аукциона — лёгкий фон без полоски.
    const isAuction = level === "auction";
    const subBg = isAuction ? "bg-neutral-50/40" : "bg-neutral-50/70";
    return (
      <Fragment key={key}>
        <tr
          data-row={depth === 0 && group === "item" ? row.key : undefined}
          data-sub={isAuction ? "auction" : undefined}
          onClick={leaf ? undefined : () => toggleExp(key)}
          className={cn(leaf ? "border-t border-neutral-100" : "cursor-pointer border-t border-neutral-100", depth === 0 ? "hover:bg-neutral-50" : subBg + " text-[13px] hover:bg-neutral-100/70", isSel && "bg-amber-50/60 hover:bg-amber-50", open && depth > 0 && "text-neutral-900")}
        >
          <td className={cn("sticky left-0 z-10 py-2 pr-3", depth === 0 ? (isSel ? "bg-amber-50" : "bg-white") : "bg-neutral-50 py-1.5")} style={pad(depth)}>
            <div className="flex min-w-0 items-center whitespace-nowrap">
              {leaf ? <span aria-hidden className="mr-1 inline-block w-3" /> : (
              <button type="button" aria-expanded={open} aria-label={`${open ? "Свернуть" : "Раскрыть"}: ${row.label}`} className="shrink-0 text-left" onClick={(e) => { e.stopPropagation(); toggleExp(key); }}>
                <span aria-hidden className={cn("mr-1 inline-block w-3 text-neutral-500 transition-transform", open && "rotate-90")}>›</span>
              </button>)}
              {!synth && nameHref(level, row) ? (
                <Link href={nameHref(level, row)!} onClick={(e) => e.stopPropagation()} title={row.label === shown(level, row) ? nameTitle(level, row) : row.label} className={cn(wrapName ? "line-clamp-2 whitespace-normal break-words leading-tight" : "truncate", "rounded-sm hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-neutral-900", depth === 0 ? "font-medium" : undefined)}>
                  {shown(level, row)}<span aria-hidden className="ml-1 text-[11px] text-neutral-600">↗</span>
                </Link>
              ) : (
                <span className={cn(wrapName ? "line-clamp-2 whitespace-normal break-words leading-tight" : "truncate", depth === 0 ? "font-medium" : undefined)} title={row.label}>{shown(level, row)}</span>
              )}
            </div>
            <div className="truncate pl-4 text-[11px] leading-4 text-neutral-500" title={lotCountLabel(row.lots)}>{lotCountLabel(row.lots)}</div>
            {isAuction ? <div className="truncate pl-4 text-[11px] text-neutral-500" title={auctionSub(row)}>{auctionSub(row)}</div> : null}
          </td>
          {cells(depth === 0 && group === "year" ? yearAligned?.byKey.get(row.key) ?? row.figures : row.figures, { ...(depth === 0 ? {} : { small: true }), plan: planUsdAvg(row.lots, row.flow) })}
          {payCells(row.lots, depth === 0 ? {} : { small: true })}
          {showVat && vatCells(row.lots, { small: depth !== 0 })}
        </tr>
        {inner}
      </Fragment>
    );
  };

  return { pad, renderLot, renderNode };
}
