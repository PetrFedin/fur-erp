import Link from "next/link";
import type { ReactNode } from "react";
import { Th } from "@/components/ui/table";
import { Money } from "@/components/money";
import { InfoHint } from "@/components/info-hint";
import { formatMoney, formatQty, formatShare } from "@/lib/utils";
import { COLUMNS, COL_KEYS, derived, type ColKey, type Metrics, type SortDir } from "@/lib/analytics-metrics";

export const pct1 = (x: number) => formatShare(x);
export const pct0 = (x: number) => formatShare(x);
export const q2 = (x: number | null) => (x == null ? "—" : formatQty(Math.round(x * 100) / 100));

const Dash = () => <span className="text-neutral-500">—</span>;

/** Ячейка колонки для показателей строки. total — показатели всей таблицы (для «Доли»). */
export function MetricCell({ col, m, total }: { col: ColKey; m: Metrics; total: Metrics }): ReactNode {
  const d = derived(m);
  switch (col) {
    case "orders":
      return m.orders;
    case "units":
      return formatQty(m.units);
    case "share":
      return total.units > 0 ? pct1(m.units / total.units) : "—";
    case "skinsUnit":
      return q2(d.skinsPerUnit);
    case "skins":
      return m.skins > 0 ? formatQty(m.skins) : "—";
    case "liningUnit":
      return q2(d.liningPerUnit);
    case "liningSum":
      return m.liningM > 0 ? formatQty(Math.round(m.liningM * 100) / 100) : "—";
    case "furUnit":
      return d.furPerUnit ? <Money incl={d.furPerUnit.incl} excl={d.furPerUnit.excl} /> : <Dash />;
    case "furSkin":
      return d.furPerSkin ? <Money incl={d.furPerSkin.incl} excl={d.furPerSkin.excl} /> : <Dash />;
    case "hammer":
      return d.hammerPerSkin ? (
        <div>
          <Money incl={d.hammerPerSkin.incl} excl={d.hammerPerSkin.excl} />
          {d.hammerSkinShare != null && d.hammerSkinShare < 0.999 && (
            <div className="text-[11px] leading-tight text-neutral-500">данные у {pct0(d.hammerSkinShare)} шкур</div>
          )}
        </div>
      ) : m.skins > 0 ? (
        <span className="text-[11px] text-neutral-500">нет данных</span>
      ) : (
        <Dash />
      );
    case "hammerCov":
      return m.lots > 0 ? (
        <div>
          {pct0(d.hammerSkinShare ?? 0)} шкур
          <div className="text-[11px] leading-tight text-neutral-500">лотов {m.lotsHammer} из {m.lots}</div>
        </div>
      ) : (
        <Dash />
      );
    case "work":
      return d.workPerUnit == null ? <Dash /> : formatMoney(d.workPerUnit.toFixed(2));
    case "costUnit":
      return d.costPerUnit ? (
        <div>
          <Money incl={d.costPerUnit.incl} excl={d.costPerUnit.excl} />
          <Range lo={m.minCostIncl} hi={m.maxCostIncl} lo2={m.minCostExcl} hi2={m.maxCostExcl} />
        </div>
      ) : (
        <Dash />
      );
    case "fullUnit":
      return d.fullPerUnit ? (
        <div>
          <Money incl={d.fullPerUnit.incl} excl={d.fullPerUnit.excl} />
          <Range lo={m.minFullIncl} hi={m.maxFullIncl} lo2={m.minFullExcl} hi2={m.maxFullExcl} />
        </div>
      ) : (
        <Dash />
      );
    case "costSum":
      return m.costIncl > 0 ? <Money incl={m.costIncl} excl={m.costExcl} /> : <Dash />;
    case "struct":
      return d.shFur == null ? (
        <Dash />
      ) : (
        <div className="whitespace-nowrap text-left text-[11px] leading-tight text-neutral-600">
          мех {pct0(d.shFur)} · подкл. {pct0(d.shLining ?? 0)}
          <br />
          4% {pct0(d.shC4 ?? 0)} · работа {pct0(d.shWork ?? 0)} · расх. {pct0(d.shExpenses ?? 0)}
        </div>
      );
  }
}

function Range({ lo, hi, lo2, hi2 }: { lo: number | null; hi: number | null; lo2: number | null; hi2: number | null }) {
  if (lo == null || hi == null || Math.abs(hi - lo) < 0.005) return null;
  return (
    <div className="text-[11px] leading-tight text-neutral-500">
      от <Money incl={lo} excl={lo2} /> до <Money incl={hi} excl={hi2} />
    </div>
  );
}

/** Заголовок колонки: клик — сортировка (повторный — в обратную сторону), рядом InfoHint с формулой. */
export function SortTh({
  label,
  hint,
  href,
  active,
  dir,
  left,
  suffix,
}: {
  label: ReactNode;
  hint?: ReactNode;
  href: string;
  active: boolean;
  dir: SortDir;
  left?: boolean;
  suffix?: string;
}) {
  return (
    <Th className={left ? "" : "text-right"} aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}>
      <Link href={href} className={`inline-flex items-center gap-1 whitespace-nowrap hover:text-neutral-900 ${active ? "text-neutral-900" : ""}`} title="Сортировать">
        {label}
        {suffix}
        <span aria-hidden className={active ? "text-neutral-900" : "text-neutral-300"}>
          {active ? (dir === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </Link>
      {hint && (
        <InfoHint label={`О колонке «${typeof label === "string" ? label : ""}»`} align={left ? "left" : "right"} wide>
          {hint}
        </InfoHint>
      )}
    </Th>
  );
}

/** Колонки с суффиксом режима 4% в подписи. */
export const colLabel = (k: ColKey, c4: string) => (["costUnit", "fullUnit", "costSum", "furUnit", "furSkin"].includes(k) ? `${COLUMNS[k].label}${c4}` : COLUMNS[k].label);

/** Ссылка на сортировку: тот же адрес, другой sort/dir (тот же столбец — переключает направление). */
export function sortHref(base: (over: { sort: string; dir: string }) => string, key: string, cur: { sort: string; dir: SortDir }, firstDir: SortDir = "desc"): string {
  const same = cur.sort === key;
  return base({ sort: key, dir: same ? (cur.dir === "asc" ? "desc" : "asc") : key === "label" ? "asc" : firstDir });
}

/** Переключатель набора колонок + выбор колонок (форма GET, сохраняет остальные параметры). */
export function ViewBar({
  all,
  picked,
  cols,
  toggleAllHref,
  action,
  hidden,
}: {
  all: boolean;
  picked: boolean;
  cols: ColKey[];
  toggleAllHref: string;
  action: string;
  hidden: [string, string][];
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <Link href={toggleAllHref} className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 hover:bg-neutral-50 max-md:min-h-9">
        {all && !picked ? "Только основные колонки" : "Показать все параметры"}
      </Link>
      <details className="relative">
        <summary className="cursor-pointer select-none rounded-md border border-neutral-300 bg-white px-3 py-1.5 hover:bg-neutral-50 max-md:min-h-9">
          Выбрать колонки{picked ? ` · ${cols.length}` : ""}
        </summary>
        <form method="get" action={action} className="absolute left-0 z-30 mt-1 flex w-72 max-w-[85vw] flex-col gap-1 rounded-lg border border-neutral-200 bg-white p-3 shadow-lg">
          {hidden.map(([k, v], i) => (
            <input key={`${k}-${i}`} type="hidden" name={k} value={v} />
          ))}
          {COL_KEYS.map((k) => (
            <label key={k} className="flex items-center gap-2 py-0.5 text-sm">
              <input type="checkbox" name="cols" value={k} defaultChecked={cols.includes(k)} className="size-4" />
              {COLUMNS[k].label}
            </label>
          ))}
          <button type="submit" className="mt-2 h-8 rounded-md bg-neutral-900 px-3 text-xs font-medium text-white hover:bg-neutral-700">
            Применить
          </button>
          <span className="text-[11px] text-neutral-500">Выбор сохраняется в адресе страницы — ссылкой можно поделиться.</span>
        </form>
      </details>
    </div>
  );
}

/** Сортировка на телефоне (заголовков таблицы там нет): список ссылок. */
export function MobileSort({ items, cur }: { items: { key: string; label: string; href: string }[]; cur: { sort: string; dir: SortDir } }) {
  const now = items.find((i) => i.key === cur.sort);
  return (
    <details className="md:hidden">
      <summary className="inline-flex min-h-9 cursor-pointer select-none items-center rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm">
        Сортировка: {now ? `${now.label} ${cur.dir === "asc" ? "↑" : "↓"}` : "по умолчанию"}
      </summary>
      <div className="mt-1 flex flex-col rounded-lg border border-neutral-200 bg-white p-1 text-sm">
        {items.map((i) => (
          <Link key={i.key} href={i.href} className="rounded px-2 py-2 hover:bg-neutral-50">
            {i.label} {i.key === cur.sort ? (cur.dir === "asc" ? "↑" : "↓") : ""}
          </Link>
        ))}
      </div>
    </details>
  );
}
