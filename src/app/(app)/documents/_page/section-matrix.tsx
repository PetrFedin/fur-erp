import { Card } from "@/components/ui/card";
import { ResponsiveRows } from "@/components/responsive-rows";
import { SECTION_TITLES, type CovFilters, type CovRow, type SectionKey } from "@/lib/doc-coverage";
import { cn } from "@/lib/utils";
import { LazyDetails } from "../../lots/lazy-details";
import { loadDocGroup } from "../group-actions";
import { type VerMap } from "../ver-status";
import { GroupCards, GroupTableRows, MatrixRow, MobileCard, RegGroupCell, sectionLayout, sortGroupRows } from "../matrix-rows";
import { plural } from "./tones";

// ------------------------------------------------------------------ матрица

type Group = { key: string; title: string; sort: number; rows: CovRow[] };

export function SectionMatrix({ section, rows, f, ver, verFilter }: { section: SectionKey; rows: CovRow[]; f: CovFilters; ver: VerMap; verFilter: boolean }) {
  const { cols, withReg, template } = sectionLayout(rows);

  const groupMap = new Map<string, Group>();
  for (const r of rows) {
    const g = groupMap.get(r.groupKey) ?? { key: r.groupKey, title: r.groupTitle, sort: r.groupSort, rows: [] };
    g.rows.push(r);
    groupMap.set(r.groupKey, g);
  }
  const groups = [...groupMap.values()];
  const gapsOf = (g: Group) => g.rows.reduce((s, r) => s + r.gaps.length, 0);
  if (f.sort === "gaps") groups.sort((a, b) => gapsOf(b) - gapsOf(a));
  else if (section === "purchases") groups.sort((a, b) => b.sort - a.sort || a.title.localeCompare(b.title, "ru"));
  else if (section === "tz") groups.sort((a, b) => b.sort - a.sort);
  for (const g of groups) g.rows = sortGroupRows(section, g.rows, f);
  const grouped = groups.length > 1 || (groups.length === 1 && (section === "purchases" || section === "tz"));
  const openAll = !!f.gaps || !!f.q || verFilter || groups.length === 1;

  const header = (
    <div className="grid items-end gap-1 border-b border-neutral-200 bg-neutral-50 px-3 py-2 text-[11px] font-medium leading-tight text-neutral-500" style={{ gridTemplateColumns: template }}>
      <span>Запись</span>
      {cols.map((c) => (
        <span key={c.key} className="text-center" title={c.attach}>
          {c.label}
        </span>
      ))}
      {withReg ? <span className="text-center" title="Есть ли запись в едином реестре (xlsx): лист и строка. Сверка от даты, указанной в блоке «Покрытие реестром»">Реестр</span> : null}
    </div>
  );

  const table = (
    <Card className="overflow-hidden">
      {header}
      {grouped
        ? groups.map((g) => (
            <LazyDetails
              key={g.key}
              defaultOpen={openAll}
              load={openAll ? undefined : loadDocGroup.bind(null, section, g.key, "table", f.auction, f.gaps ? "1" : "", f.q, f.sort)}
              className="group border-b border-neutral-100 last:border-b-0"
              summary={<summary className="grid cursor-pointer list-none items-center gap-1 bg-white px-3 py-2 hover:bg-neutral-50" style={{ gridTemplateColumns: template }}>
                <span className="flex min-w-0 items-center gap-2">
                  <span className="text-neutral-500 transition-transform group-open:rotate-90" aria-hidden>›</span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium" title={g.title}>{g.title}</span>
                    <span className="block text-xs text-neutral-500">
                      {g.rows.length} зап. ·{" "}
                      <span className={gapsOf(g) > 0 ? "text-red-600" : "text-emerald-700"}>{gapsOf(g) > 0 ? `не прикреплено: ${gapsOf(g)}` : "без пробелов"}</span>
                    </span>
                  </span>
                </span>
                {cols.map((c) => {
                  const need = g.rows.filter((r) => r.cells[c.key].need === "required");
                  const ok = need.filter((r) => r.cells[c.key].ok).length;
                  return (
                    <span key={c.key} className={cn("text-center text-xs tabular-nums", need.length === 0 ? "text-neutral-500" : ok === need.length ? "text-emerald-700" : ok === 0 ? "text-red-600" : "text-amber-700")}>
                      {need.length === 0 ? "" : `${ok}/${need.length}`}
                    </span>
                  );
                })}
                {withReg ? <RegGroupCell rows={g.rows} /> : null}
              </summary>}
            >
              {openAll ? <GroupTableRows rows={g.rows} cols={cols.map((c) => c.key)} template={template} withReg={withReg} ver={ver} /> : null}
            </LazyDetails>
          ))
        : (
          <div className="divide-y divide-neutral-100">
            {groups.flatMap((g) => g.rows).map((r) => (
              <MatrixRow key={r.id} r={r} cols={cols.map((c) => c.key)} template={template} withReg={withReg} ver={ver} />
            ))}
          </div>
        )}
    </Card>
  );

  const cards = grouped ? (
    groups.map((g) => (
      <LazyDetails
        key={g.key}
        defaultOpen={openAll}
        load={openAll ? undefined : loadDocGroup.bind(null, section, g.key, "cards", f.auction, f.gaps ? "1" : "", f.q, f.sort)}
        className="rounded-lg border border-neutral-200 bg-white"
        summary={
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 p-3 text-sm">
            <span className="min-w-0 break-words font-medium">{g.title}</span>
            <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-medium", gapsOf(g) > 0 ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700")}>
              {gapsOf(g) > 0 ? gapsOf(g) : "✓"}
            </span>
          </summary>
        }
      >
        {openAll ? <GroupCards rows={g.rows} ver={ver} /> : null}
      </LazyDetails>
    ))
  ) : (
    groups.flatMap((g) => g.rows).map((r) => <MobileCard key={r.id} r={r} ver={ver} />)
  );

  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h2 className="block-title">{SECTION_TITLES[section]}</h2>
        {/* Процент — только в плитках сверху; здесь число пробелов. */}
        {(() => {
          const n = rows.filter((r) => r.gaps.length > 0).length;
          return n > 0 ? (
            <span className="text-sm font-medium tabular-nums text-red-600">
              {n} {plural(n, "пробел", "пробела", "пробелов")}
            </span>
          ) : (
            <span className="text-sm text-emerald-700">без пробелов</span>
          );
        })()}
      </div>
      <ResponsiveRows table={table}>{cards}</ResponsiveRows>
    </section>
  );
}
