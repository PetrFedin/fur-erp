import Link from "next/link";
import { HIDDEN_MODULES } from "@/lib/hidden-modules";

type Item = { key: string; label: string; href?: string; count: number | null; unit?: string; title: string; active?: boolean };

/**
 * Ряд разделов именно ЭТОГО ТЗ: сам ТЗ (активный), его партия пошива, отгрузки, примерки, план заказа и план поставок по артикулу.
 * У каждого — счётчик записей по этому ТЗ (или артикулу), «—» если записей нет.
 */
export function OrderNav({
  tzLabel, positions, batchNumber, batchCount, shipments, fittings, planCount, supplyCount, search, article,
}: {
  tzLabel: string;
  /** Если в документе ТЗ несколько артикулов: номер позиции, соседние позиции и все позиции этого ТЗ. */
  positions?: {
    index: number;
    total: number;
    prev: { id: string; label: string } | null;
    next: { id: string; label: string } | null;
    all: { id: string; label: string; current: boolean }[];
  } | null;
  batchNumber: number | null;
  batchCount: number | null;
  shipments: number;
  fittings: number;
  planCount: number;
  supplyCount: number;
  /** Номер ТЗ для поиска в отгрузках/примерках. */
  search: string;
  /** Название артикула для плана заказа / плана поставок. */
  article: string;
}) {
  const q = encodeURIComponent(search);
  const a = encodeURIComponent(article);
  const items: Item[] = [
    { key: "tz", label: tzLabel, count: null, title: "Эта карточка ТЗ", active: true },
    batchNumber != null
      ? { key: "batch", label: `Партия пошива № ${batchNumber}`, href: `/production/batches/${batchNumber}`, count: batchCount, unit: "ТЗ", title: `Партия пошива № ${batchNumber}: состав партии, итоги (в партии ${batchCount} ТЗ)` }
      : { key: "batch", label: "Партия пошива", href: "#card-batch", count: null, title: "Партия не указана — выберите её в параметрах ТЗ" },
    ...(HIDDEN_MODULES.shipments ? [] : [{ key: "ship", label: "Отгрузки", href: `/shipments?q=${q}`, count: shipments, title: "Отгрузки с этим ТЗ" }]),
    ...(HIDDEN_MODULES.fittings ? [] : [{ key: "fit", label: "Примерки", href: `/fittings?q=${q}`, count: fittings, title: "Примерки этого ТЗ" }]),
    ...(HIDDEN_MODULES.orderPlan ? [] : [{ key: "plan", label: "План заказа", href: `/plan?q=${a}`, count: planCount, title: "План заказа по артикулу этого ТЗ" }]),
    ...(HIDDEN_MODULES.supplyPlan ? [] : [{ key: "supply", label: "План поставок", href: `/supply-plan?q=${a}`, count: supplyCount, title: "Записи плана поставок по артикулу этого ТЗ" }]),
  ];
  const cls = "inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900 max-md:min-h-9";
  const pos = positions;
  const step = "inline-flex min-h-8 items-center rounded-md border border-neutral-300 px-2.5 py-1 text-sm text-neutral-700 hover:bg-neutral-100";
  const stepOff = "inline-flex min-h-8 items-center rounded-md border border-neutral-200 px-2.5 py-1 text-sm text-neutral-300";
  return (
    <>
    {pos ? (
      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm" role="group" aria-label="Позиции этого ТЗ">
        <span className="font-medium text-neutral-800">{tzLabel.split(" · ")[0]} · поз. {pos.index}/{pos.total}</span>
        <span className="text-xs text-neutral-500">один ТЗ из документа, артикулы:</span>
        {pos.prev ? <Link href={`/production/${pos.prev.id}`} className={step} title={`Предыдущая позиция: ${pos.prev.label}`} aria-label={`Предыдущая позиция: ${pos.prev.label}`}>‹</Link> : <span className={stepOff} aria-hidden>‹</span>}
        {pos.next ? <Link href={`/production/${pos.next.id}`} className={step} title={`Следующая позиция: ${pos.next.label}`} aria-label={`Следующая позиция: ${pos.next.label}`}>›</Link> : <span className={stepOff} aria-hidden>›</span>}
        <span className="flex flex-wrap items-center gap-1">
          {pos.all.map((x) => x.current
            ? <span key={x.id} aria-current="true" className="rounded-md bg-neutral-900 px-2 py-0.5 text-xs text-white">{x.label}</span>
            : <Link key={x.id} href={`/production/${x.id}`} className="rounded-md border border-neutral-300 px-2 py-0.5 text-xs text-blue-700 hover:bg-neutral-100">{x.label}</Link>)}
        </span>
      </div>
    ) : null}
    <nav aria-label="Разделы этого ТЗ" className="flex gap-1 overflow-x-auto border-b border-neutral-200 pb-2">
      {items.map((it) => {
        const badge = it.count == null ? null : (
          <span className={"rounded-full px-1.5 text-[11px] tabular-nums " + (it.active ? "bg-white/20" : "bg-neutral-100 text-neutral-600")}>{it.count > 0 ? (it.unit ? `${it.count} ${it.unit}` : it.count) : "—"}</span>
        );
        return it.active ? (
          <span key={it.key} aria-current="page" title={it.title} className={cls + " bg-neutral-900 text-white"}>{it.label}</span>
        ) : (
          <Link key={it.key} href={it.href!} title={it.title} className={cls + " text-neutral-700 hover:bg-neutral-100"}>
            {it.label}
            {badge}
          </Link>
        );
      })}
    </nav>
    </>
  );
}
