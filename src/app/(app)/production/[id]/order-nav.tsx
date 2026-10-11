import Link from "next/link";

type Item = { key: string; label: string; href?: string; count: number | null; title: string; active?: boolean };

/**
 * Ряд разделов именно ЭТОГО ТЗ: сам ТЗ (активный), его партия пошива, отгрузки, примерки, план заказа и план поставок по артикулу.
 * У каждого — счётчик записей по этому ТЗ (или артикулу), «—» если записей нет.
 */
export function OrderNav({
  tzLabel, batchNumber, batchCount, shipments, fittings, planCount, supplyCount, search, article,
}: {
  tzLabel: string;
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
      ? { key: "batch", label: `Партия пошива ${batchNumber}`, href: `/production/batches/${batchNumber}`, count: batchCount, title: "Партия пошива этого ТЗ: состав партии, итоги (счётчик — ТЗ в партии)" }
      : { key: "batch", label: "Партия пошива", href: "#card-batch", count: null, title: "Партия не указана — выберите её в параметрах ТЗ" },
    { key: "ship", label: "Отгрузки", href: `/shipments?q=${q}`, count: shipments, title: "Отгрузки с этим ТЗ" },
    { key: "fit", label: "Примерки", href: `/fittings?q=${q}`, count: fittings, title: "Примерки этого ТЗ" },
    { key: "plan", label: "План заказа", href: `/plan?q=${a}`, count: planCount, title: "План заказа по артикулу этого ТЗ" },
    { key: "supply", label: "План поставок", href: `/supply-plan?q=${a}`, count: supplyCount, title: "Записи плана поставок по артикулу этого ТЗ" },
  ];
  const cls = "inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900 max-md:min-h-9";
  return (
    <nav aria-label="Разделы этого ТЗ" className="flex gap-1 overflow-x-auto border-b border-neutral-200 pb-2">
      {items.map((it) => {
        const badge = it.count == null ? null : (
          <span className={"rounded-full px-1.5 text-[11px] tabular-nums " + (it.active ? "bg-white/20" : "bg-neutral-100 text-neutral-600")}>{it.count > 0 ? it.count : "—"}</span>
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
  );
}
