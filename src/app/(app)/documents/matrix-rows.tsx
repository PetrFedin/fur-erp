import { COLUMNS, type Cell, type ColKey, type CovFilters, type CovRow, type SectionKey } from "@/lib/doc-coverage";
import type { RegCell } from "@/lib/registry-coverage";
import { cn } from "@/lib/utils";
import { RowCard } from "@/components/responsive-rows";
import Link from "next/link";

// Строки матрицы покрытия: общий код страницы и серверного действия «раскрыть группу» (loadDocGroup).

export function OrigCell({ have, total }: { have: number; total: number }) {
  return (
    <span className={cn("text-center text-xs tabular-nums", total === 0 ? "text-neutral-300" : have === total ? "text-emerald-700" : have === 0 ? "text-neutral-500" : "text-amber-700")} title="Сколько документов записи лежит в приложении файлом (остальные — файл ещё не загружен)">
      {total === 0 ? "—" : `${have} из ${total}`}
    </span>
  );
}

export function MatrixRow({ r, cols, template, withReg }: { r: CovRow; cols: ColKey[]; template: string; withReg: boolean }) {
  return (
    <Link href={r.href} className="grid items-center gap-1 px-3 py-2 hover:bg-neutral-50" style={{ gridTemplateColumns: template }}>
      <span className="min-w-0">
        <span className="block break-words text-sm font-medium text-neutral-900">{r.title}</span>
        <span className="block break-words text-xs text-neutral-500">{r.sub}</span>
        {r.extras.map((e, i) => (
          <span key={i} className={cn("block text-xs", e.ok ? "text-emerald-700" : "font-medium text-red-600")}>
            {e.text}
          </span>
        ))}
      </span>
      {cols.map((c) => (
        <CellView key={c} cell={r.cells[c]} />
      ))}
      {withReg ? <RegView reg={r.registry} /> : null}
      <OrigCell have={r.origHave} total={r.origTotal} />
    </Link>
  );
}

export function CellView({ cell }: { cell: Cell }) {
  if (cell.need === "na") return <span className="text-center text-[11px] text-neutral-300">не треб.</span>;
  if (cell.ok)
    return (
      <span className="text-center text-sm font-medium text-emerald-700" title={cell.viaRef ? "Есть номер платёжки в карточке оплаты" : undefined}>
        ✓{cell.count > 0 ? ` ${cell.count}` : " №"}
      </span>
    );
  if (cell.need === "required")
    return <span className="mx-auto rounded bg-red-50 px-1.5 py-0.5 text-center text-xs font-medium text-red-700">нет</span>;
  return <span className="text-center text-[11px] text-neutral-500">необяз.</span>;
}

export function MobileCard({ r }: { r: CovRow }) {
  const have = COLUMNS.filter((c) => r.cells[c.key].ok).map((c) => (r.cells[c.key].count > 0 ? `${c.label} (${r.cells[c.key].count})` : `${c.label} (№)`));
  return (
    <RowCard
      title={r.title}
      href={r.href}
      subtitle={r.sub}
      badge={
        r.gaps.length > 0 ? (
          <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">нет: {r.gaps.length}</span>
        ) : (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">✓</span>
        )
      }
      fields={[
        { label: "Не хватает", value: r.gaps.length > 0 ? <span className="font-medium text-red-700">{r.gaps.map((g) => g.label).join(", ")}</span> : <span className="text-emerald-700">всё есть</span> },
        { label: "Оригинал", value: r.origTotal === 0 ? "—" : `${r.origHave} из ${r.origTotal}` },
        ...(r.registry.state !== "none" ? [{ label: "Реестр", value: <RegView reg={r.registry} inline /> }] : []),
      ]}
      details={[{ label: "Есть", value: have.length > 0 ? have.join(", ") : null }, ...(r.extras.length > 0 ? [{ label: "Оплаты", value: r.extras.map((e) => e.text).join("; ") }] : [])]}
    />
  );
}

const regTone: Record<RegCell["state"], string> = {
  found: "text-emerald-700",
  partial: "text-amber-700",
  missing: "rounded bg-red-50 px-1.5 py-0.5 font-medium text-red-700",
  later: "text-neutral-500",
  untracked: "text-neutral-500",
  none: "text-neutral-300",
};

export function RegView({ reg, inline }: { reg: RegCell; inline?: boolean }) {
  const text = reg.state === "found" || reg.state === "partial" ? `✓ ${reg.text}` : reg.text;
  return (
    <span title={reg.title || undefined} className={cn("break-words text-[11px] leading-tight", inline ? "text-left" : "text-center", regTone[reg.state])}>
      {text}
    </span>
  );
}

export function RegGroupCell({ rows }: { rows: CovRow[] }) {
  const tracked = rows.filter((r) => r.registry.state !== "none" && r.registry.state !== "untracked" && r.registry.state !== "later");
  const ok = tracked.filter((r) => r.registry.state === "found" || r.registry.state === "partial").length;
  return (
    <span className={cn("text-center text-xs tabular-nums", tracked.length === 0 ? "text-neutral-300" : ok === tracked.length ? "text-emerald-700" : "text-red-600")}>
      {tracked.length === 0 ? "" : `${ok}/${tracked.length}`}
    </span>
  );
}


/** Строки одной группы в нужном порядке — одинаково для страницы и для подгрузки при раскрытии. */
export function sortGroupRows(section: SectionKey, rows: CovRow[], f: CovFilters): CovRow[] {
  const out = [...rows];
  if (f.sort === "gaps") out.sort((a, b) => b.gaps.length - a.gaps.length);
  else if (section === "tz" || section === "purchases") out.sort((a, b) => a.number.localeCompare(b.number, "ru", { numeric: true }));
  return out;
}

/** Колонки секции и шаблон сетки — зависят от всех видимых строк секции, поэтому считаются в одном месте. */
export function sectionLayout(rows: CovRow[]) {
  const cols = COLUMNS.filter((c) => rows.some((r) => r.cells[c.key].need !== "na"));
  const withReg = rows.some((r) => r.registry.state !== "none");
  const template = `minmax(0,1fr) repeat(${cols.length}, 4.75rem)${withReg ? " 9.5rem" : ""} 5.5rem`;
  return { cols, withReg, template };
}

/** Содержимое группы для таблицы (≥ md). */
export function GroupTableRows({ rows, cols, template, withReg }: { rows: CovRow[]; cols: ColKey[]; template: string; withReg: boolean }) {
  return (
    <div className="divide-y divide-neutral-100 border-t border-neutral-100">
      {rows.map((r) => (
        <MatrixRow key={r.id} r={r} cols={cols} template={template} withReg={withReg} />
      ))}
    </div>
  );
}

/** Содержимое группы для карточек (< md). */
export function GroupCards({ rows }: { rows: CovRow[] }) {
  return (
    <div className="flex flex-col gap-2 p-2 pt-0">
      {rows.map((r) => (
        <MobileCard key={r.id} r={r} />
      ))}
    </div>
  );
}
