import { tzCountText, uniqueOrderCount } from "@/lib/tz-key";
import { TH as Head, THGroup } from "@/components/table-head";
import Link from "next/link";
import { InfoHint } from "@/components/info-hint";
import { STAGE_ORDER, STAGE_STYLES, type Stage } from "@/lib/calendar-actions";
import { fmtRu } from "@/lib/calendar-grid";
import { pipeTitle, type PipeItem } from "@/lib/calendar-pipeline";
import { buildMonthTable, cellItems, dateSpan, sumOf, type StageSums, type TableFilters } from "@/lib/calendar-table";
import { formatQty } from "@/lib/utils";
import { TotalLabel } from "@/components/total-label";
import { BTN } from "./ui";

type HrefFn = (patch: Record<string, string | string[]>) => string;

export function StageChip({ stage, word }: { stage: Stage; word?: string }) {
  const st = STAGE_STYLES[stage];
  return <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-xs leading-tight ${st.chip}`}>{word ?? st.short}</span>;
}

/** Цветные мелкие числа по стадиям; нули не показываем («—», если пусто). */
export function Nums({ s, withRepair = true }: { s: StageSums; withRepair?: boolean }) {
  const parts = STAGE_ORDER.filter((k) => s[k] > 0 && (withRepair || k !== "repair"));
  if (parts.length === 0) return <span className="text-neutral-300">—</span>;
  return (
    <span className="inline-flex flex-wrap justify-end gap-x-1.5 tabular-nums">
      {parts.map((k) => <span key={k} className={`${STAGE_STYLES[k].text} ${k === "repair" ? "italic" : ""}`} title={`${STAGE_STYLES[k].label}: ${s[k]} шт.`}>{formatQty(s[k])}</span>)}
    </span>
  );
}

export function StageLegend({ only }: { only?: Stage[] }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-neutral-500">
      {STAGE_ORDER.filter((k) => !only || only.includes(k)).map((k) => (
        <span key={k} className="inline-flex items-center gap-1" title={STAGE_STYLES[k].hint}><i className={`size-2 rounded-full ${STAGE_STYLES[k].dot}`} />{STAGE_STYLES[k].label}</span>
      ))}
    </div>
  );
}

const dateText = (p: PipeItem) => (p.expected ? `${fmtRu(p.expected.date)}` : "—");

/** Строка ТЗ в списках: артикул, мех, кол-во, стадия, ожидаемая дата + источник. */
export function PipeRow({ p, cardHref }: { p: PipeItem; cardHref: string }) {
  return (
    <div className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded border bg-white px-2 py-1 text-xs ${p.overdue ? "border-red-500 ring-1 ring-red-500" : "border-neutral-200"}`}>
      <Link href={cardHref} className="font-medium text-blue-700 hover:underline" title={p.wo ? `Внутренний номер ${p.number}` : undefined}>{pipeTitle(p)}</Link>
      <span>{p.articleLabel}</span>
      <span className="text-neutral-500">{p.fur}</span>
      <span className="tabular-nums">×{formatQty(p.qty)}</span>
      <StageChip stage={p.stage} word={p.stageWord} />
      <span className="ml-auto text-neutral-600 tabular-nums">
        {dateText(p)}
        {p.expected && <span className="ml-1 text-xs text-neutral-500">{p.expected.source}</span>}
      </span>
    </div>
  );
}

/** Карточка ТЗ: полное описание с датами, источником сырья и ссылками. */
export function PipeCard({ p, closeHref, eventHref }: { p: PipeItem; closeHref: string; eventHref?: (id: string) => string }) {
  const rawByPurchase = new Map<string, { key: string; purchaseId: string | null; label: string; auction: string; qty: number; dates: string[] }>();
  for (const r of p.raw) {
    const key = r.purchaseId ?? r.lotId;
    const cur = rawByPurchase.get(key) ?? { key, purchaseId: r.purchaseId, label: r.purchaseNumber ?? `лот ${r.lotNumber ?? "—"}`, auction: r.auction, qty: 0, dates: [] };
    cur.qty += r.qty;
    if (r.receivedDate) cur.dates.push(`получен ${fmtRu(r.receivedDate)}`);
    else if (r.expectedDate) cur.dates.push(`ожидается ${fmtRu(r.expectedDate)}`);
    rawByPurchase.set(key, cur);
  }
  const st = STAGE_STYLES[p.stage];
  const rows: [string, React.ReactNode][] = [
    ["Артикул", p.articleLabel],
    ["Мех", p.fur],
    ["Количество", `${formatQty(p.qty)} шт.${p.stage === "ready" || p.stage === "shipped" ? ` (${[p.units.shipped ? `отгружено ${p.units.shipped}` : "", p.units.ready ? `на складе ${p.units.ready}` : ""].filter(Boolean).join(", ")})` : ""}`],
    ["ТЗ", <Link key="tz" href={`/production/${p.id}`} className="text-blue-700 hover:underline" title={p.wo ? `Внутренний номер ${p.number}` : undefined}>{pipeTitle(p)} → открыть</Link>],
    ["Партия пошива", p.batchNo === "none" ? p.batchLabel : <Link key="b" href={`/production/batches/${p.batchNo}`} className="text-blue-700 hover:underline">{p.batchLabel}</Link>],
    ["Стадия", <span key="st" className="inline-flex items-center gap-1"><StageChip stage={p.stage} word={p.stageWord} /><span className="text-neutral-500">{st.hint}</span></span>],
    ...(p.status === "COMPLETED" ? [] : [["Плановая дата", p.endDate ? fmtRu(p.endDate) : "—"] as [string, React.ReactNode]]),
    [p.status === "COMPLETED" ? "Окончание (факт)" : "Ожидаем", p.expected ? <span key="ex">{fmtRu(p.expected.date)} <span className="text-neutral-400">({p.expected.source})</span>{p.overdue ? <span className="ml-1 text-red-600">просрочено</span> : null}</span> : "—"],
    ["Даты ТЗ", [p.workOrderDate ? `ТЗ от ${fmtRu(p.workOrderDate)}` : "", p.startDate ? `старт ${fmtRu(p.startDate)}` : ""].filter(Boolean).join(" · ") || "—"],
    ["Сырьё", rawByPurchase.size === 0 ? "—" : (
      <span key="raw" className="flex flex-col gap-0.5">
        {[...rawByPurchase.values()].map((r) => (
          <span key={r.key}>
            {r.purchaseId ? <Link href={`/purchases/${r.purchaseId}`} className="text-blue-700 hover:underline">{r.label}</Link> : r.label}
            {" · "}<Link href={`/lots?auction=${encodeURIComponent(r.auction)}`} className="text-blue-700 hover:underline">{r.auction}</Link>
            {" · "}{formatQty(r.qty)} шт.{r.dates.length ? ` · ${[...new Set(r.dates)].join(", ")}` : ""}
          </span>
        ))}
      </span>
    )],
  ];
  return (
    <section aria-label={`Карточка ТЗ ${pipeTitle(p)}`} className={`rounded-lg border bg-white p-3 ${p.overdue ? "border-red-500" : "border-neutral-200"}`}>
      <h3 className="mb-2 flex flex-wrap items-center gap-2 border-b border-neutral-200 pb-2 block-title">
        <span>{p.articleLabel} · {pipeTitle(p)}</span> <StageChip stage={p.stage} word={p.stageWord} />
        <Link href={closeHref} className={BTN + " ml-auto"} aria-label="Закрыть карточку ТЗ">Закрыть</Link>
      </h3>
      <div className="flex flex-col gap-2 text-sm">
        <dl className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-x-3 gap-y-1">
          {rows.map(([k, v]) => (<div key={k} className="contents"><dt className="text-xs text-neutral-500">{k}</dt><dd className="min-w-0 break-words text-xs">{v}</dd></div>))}
        </dl>
        {eventHref && p.eventIds.length > 0 && (
          <p className="text-xs text-neutral-500">События календаря по этому ТЗ: {p.eventIds.map((id, i) => <Link key={id} href={eventHref(id)} className="mr-2 text-blue-700 hover:underline">#{i + 1}</Link>)}</p>
        )}
      </div>
    </section>
  );
}


/** Крупные подписи стадий словами: «Отгружено 30», «ТЗ 7»; нули не показываем. */
export function StageChips({ s, withRepair = true, size = "md" }: { s: StageSums; withRepair?: boolean; size?: "sm" | "md" }) {
  const parts = STAGE_ORDER.filter((k) => s[k] > 0 && (withRepair || k !== "repair"));
  if (parts.length === 0) return <span className="text-sm text-neutral-400">нет изделий</span>;
  return (
    <span className="flex flex-wrap gap-1.5">
      {parts.map((k) => (
        <span key={k} title={`${STAGE_STYLES[k].label}: ${STAGE_STYLES[k].hint}`} className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 ${size === "sm" ? "text-xs" : "text-sm"} ${STAGE_STYLES[k].chip}`}>
          {STAGE_STYLES[k].label} <b className="tabular-nums">{formatQty(s[k])}</b>
        </span>
      ))}
    </span>
  );
}

/** Полоска долей стадий (без ремонта): с первого взгляда видно, сколько готово, а сколько ещё в пути. */
export function StageBar({ s }: { s: StageSums }) {
  const tot = sumOf(s, false);
  if (tot <= 0) return null;
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-neutral-100" role="img" aria-label="Доли стадий">
      {STAGE_ORDER.filter((k) => k !== "repair" && s[k] > 0).map((k) => <i key={k} className={STAGE_STYLES[k].dot} style={{ width: `${(s[k] / tot) * 100}%` }} title={`${STAGE_STYLES[k].label}: ${s[k]} шт.`} />)}
    </div>
  );
}

/** Крупная легенда стадий рядом с блоком (подсказки — по наведению). */
export function BigLegend() {
  return (
    <div className="flex flex-wrap gap-1.5" aria-label="Стадии">
      {STAGE_ORDER.map((k) => <span key={k} title={STAGE_STYLES[k].hint} className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm ${STAGE_STYLES[k].chip}`}><i className={`size-2.5 rounded-full ${STAGE_STYLES[k].dot}`} />{STAGE_STYLES[k].label}</span>)}
    </div>
  );
}

/** «Стадии»: строки — виды меха, столбцы — стадии плана → сырьё → в работе → готово → отгружено (+ ремонт), под числом — сроки. */
export function StagesView({ items, filters, href, cell, cardHref }: { items: PipeItem[]; filters: TableFilters; href: HrefFn; cell: string; cardHref: (id: string) => string }) {
  const t = buildMonthTable(items, filters, true);
  const [cStage, cFur] = cell.includes("~") ? cell.split("~") : ["", ""];
  const rowItems = (fur: string, stage: Stage | "*") =>
    items.filter((p) => (fur === "*" || p.fur === fur) && cellItems([p], filters, true, "*", "*").length > 0 && (stage === "*" ? true : (p.units[stage] ?? 0) > 0 && (!filters.stage.length || filters.stage.includes(stage))));
  const open = cStage && cFur ? rowItems(cFur, cStage as Stage | "*") : [];
  const stages = STAGE_ORDER.filter((k) => !filters.stage.length || filters.stage.includes(k));
  const td = "px-1.5 py-1.5 text-right align-top text-xs tabular-nums whitespace-nowrap";
  const BL = " border-l border-neutral-200";
  const link = (stage: string, fur: string) => href({ cell: `${stage}~${fur}` }) + "#cell";
  const span = (fur: string, stage: Stage) => {
    const its = rowItems(fur, stage);
    const sp = dateSpan(its);
    const nod = its.filter((p) => !p.expected).length;
    if (!sp && nod === 0) return null;
    return (
      <div className="whitespace-normal text-[11px] font-normal leading-tight text-neutral-500">
        {sp ? (sp.min === sp.max ? fmtRu(sp.min) : `${fmtRu(sp.min)} – ${fmtRu(sp.max)}`) : "срока нет"}
        {nod > 0 && sp ? ` · без срока ${nod}` : ""}
      </div>
    );
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="scroll-hint overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full min-w-[760px] table-fixed text-left">
          <colgroup>
            <col style={{ width: 170 }} />
            {stages.map((k) => <col key={k} />)}
            <col />
          </colgroup>
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-white" />
              <THGroup colSpan={Math.max(1, stages.length)} className="bg-white">Путь изделия: план → отгрузка</THGroup>
              <THGroup className="bg-white">Итого</THGroup>
            </tr>
            <tr className="border-b border-neutral-200">
              <th className="sticky left-0 z-10 bg-white px-2 py-1.5 text-left text-xs font-medium text-neutral-500">Вид меха</th>
              {stages.map((k, i) => <Head key={k} label={STAGE_STYLES[k].label} unit="шт." align="right" sep={i === 0} className={STAGE_STYLES[k].text} title={STAGE_STYLES[k].hint} />)}
              <Head label={stages.includes("repair") ? "Всего с ремонтом" : "Всего"} unit="шт." align="right" sep className="text-neutral-500" />
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {t.rows.map((r) => (
              <tr key={r.fur}>
                <th scope="row" className="sticky left-0 z-10 bg-white px-2 py-1.5 text-left text-xs font-medium" title={r.fur}>
                  <span className="flex items-center gap-1"><span className="min-w-0 flex-1 truncate">{r.fur}</span><Link href={`/production?fur=${encodeURIComponent(r.fur)}`} title="Открыть в «ТЗ» с этим видом меха" aria-label={`Открыть в ТЗ: ${r.fur}`} className="text-[11px] text-neutral-400 hover:text-neutral-900">↗</Link></span>
                </th>
                {stages.map((k, i) => (
                  <td key={k} className={`${td} ${i === 0 ? BL : ""} ${cStage === k && cFur === r.fur ? "bg-[var(--ui-soft)]" : ""}`}>
                    {r.total[k] > 0 ? <Link href={link(k, r.fur)} className={`block hover:underline ${STAGE_STYLES[k].text}`}>{formatQty(r.total[k])}{span(r.fur, k)}</Link> : <span className="text-neutral-400">—</span>}
                  </td>
                ))}
                <td className={`${td} font-medium${BL}`}><Link href={link("*", r.fur)} className="hover:underline">{formatQty(stages.reduce((a, k) => a + r.total[k], 0))}</Link></td>
              </tr>
            ))}
            {t.rows.length === 0 && <tr><td colSpan={stages.length + 2} className="px-2 py-4 text-center text-xs text-neutral-500">Нет данных по выбранным фильтрам.</td></tr>}
          </tbody>
          <tfoot>
            <tr className="row-total">
              <th scope="row" className="sticky left-0 z-10 px-2 py-1.5 text-left text-xs"><TotalLabel unit="шт." /></th>
              {stages.map((k, i) => <td key={k} className={`${td}${i === 0 ? BL : ""}`}>{t.grand[k] > 0 ? formatQty(t.grand[k]) : <span className="opacity-60">—</span>}</td>)}
              <td className={`${td}${BL}`}>{formatQty(stages.reduce((a, k) => a + t.grand[k], 0))}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <StageLegend />
        <InfoHint wide label="Как читать стадии">Изделие проходит стадии слева направо: план → сырьё (мех уже закуплен и списан) → в работе (раскрой / пошив) → готово → отгружено. Под числом — ожидаемые сроки ТЗ этой стадии (от самого раннего до самого позднего), «без срока» — ТЗ, у которых срока нет. Ремонт — отдельно, в «В выпуске» не входит: итог «Всего с ремонтом» ({formatQty(sumOf(t.grand, true))} шт.) = «В выпуске» {formatQty(sumOf(t.grand, false))} шт. + ремонт {formatQty(t.grand.repair)} шт. Число изделий без ремонта: {formatQty(sumOf(t.grand, false))} шт.</InfoHint>
      </div>
      {open.length > 0 && (
        <section id="cell" aria-label="ТЗ ячейки" className="flex flex-col gap-1 rounded-lg border border-neutral-200 bg-white p-3">
          <h3 className="mb-1 flex flex-wrap items-center gap-2 border-b border-neutral-200 pb-2 block-title">
            {cFur === "*" ? "Все виды меха" : cFur} · {cStage === "*" ? "все стадии" : STAGE_STYLES[cStage as Stage]?.label} · <span className="font-normal text-neutral-500">{tzCountText(uniqueOrderCount(open), open.length)}</span>
            <Link href={href({ cell: "" })} className={BTN + " ml-auto"}>Закрыть</Link>
          </h3>
          {open.map((p) => <PipeRow key={p.id} p={p} cardHref={cardHref(p.id)} />)}
        </section>
      )}
    </div>
  );
}
