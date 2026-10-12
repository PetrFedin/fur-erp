import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { WidgetRow } from "@/components/widget-row";
import { DEFAULT_PARAMS, computeTree, furRank, grandTotal, parseNodes, perUnit, type Agg, type BudgetNode, type BudgetParams } from "@/lib/budget-calc";
import { TILE_BOX, TileCaption, TileHead, TileValue } from "../../dashboard/tile";
import { money, pct, qty } from "../format";
import { TotalLabel } from "@/components/total-label";

export const metadata = { title: "Сравнение бюджетов" };

type Side = { name: string; season: string; nodes: BudgetNode[]; params: BudgetParams };

/** Итоги по типам сырья и по категориям внутри них. Категории с одинаковым названием в одном типе складываются. */
function byFur(s: Side) {
  const calc = computeTree(s.nodes, s.params);
  const furs = new Map<string, { agg: Agg | null; cats: Map<string, Agg> }>();
  const add = (a: Agg | null, b: Agg) => (a ? { ...a, pcs: a.pcs + b.pcs, total: a.total + b.total, hides: a.hides + b.hides } as Agg : b);
  for (const f of s.nodes.filter((n) => n.kind === "fur")) {
    const e = furs.get(f.name) ?? { agg: null, cats: new Map<string, Agg>() };
    const fa = calc.get(f.id);
    if (fa) e.agg = add(e.agg, fa);
    for (const c of s.nodes.filter((n) => n.parentId === f.id)) {
      const ca = calc.get(c.id);
      if (ca) e.cats.set(c.name, add(e.cats.get(c.name) ?? null, ca));
    }
    furs.set(f.name, e);
  }
  return furs;
}

const dRub = (a: number, b: number) => `${b - a > 0 ? "+" : ""}${Math.round(b - a).toLocaleString("ru-RU")} ₽`;
const dPct = (a: number, b: number) => (a > 0 ? pct((b / a - 1) * 100) : b > 0 ? "новое" : "—");

export default async function ComparePage({ searchParams }: { searchParams: Promise<{ a?: string; b?: string }> }) {
  const session = await requireSession();
  const sp = await searchParams;
  const rows = await prisma.budgetScenario.findMany({ where: { organizationId: session.user.organizationId, id: { in: [sp.a ?? "", sp.b ?? ""] } } });
  const toSide = (id?: string): Side | null => {
    const r = rows.find((x) => x.id === id);
    return r ? { name: r.name, season: r.season, nodes: parseNodes(r.lines), params: { ...DEFAULT_PARAMS, ...(r.params as Partial<BudgetParams>) } } : null;
  };
  const A = toSide(sp.a);
  const B = toSide(sp.b);
  if (!A || !B || sp.a === sp.b) notFound();
  const fa = byFur(A);
  const fb = byFur(B);
  const ta = grandTotal(A.nodes, A.params);
  const tb = grandTotal(B.nodes, B.params);
  const names = Array.from(new Set([...fa.keys(), ...fb.keys()])).sort((x, y) => furRank(x) - furRank(y) || x.localeCompare(y, "ru"));

  const cell = "whitespace-nowrap px-3 py-2 text-right tabular-nums";
  const line = (label: string, a: Agg | null, b: Agg | null, sub = false) => {
    const x = a?.total ?? 0, y = b?.total ?? 0;
    return (
      <tr key={(sub ? "c:" : "f:") + label + (sub ? x + "|" + y : "")} className={sub ? "text-xs text-neutral-600" : "bg-neutral-50 font-medium"}>
        <td className={"px-3 py-2 " + (sub ? "pl-8" : "")}>{label}</td>
        <td className={cell}>{a ? qty(a.pcs, 0) : "—"}</td>
        <td className={cell}>{b ? qty(b.pcs, 0) : "—"}</td>
        <td className={cell}>{a ? money(x) : "—"}</td>
        <td className={cell}>{b ? money(y) : "—"}</td>
        <td className={cell + (y - x === 0 ? "" : " font-medium")}>{dRub(x, y)}</td>
        <td className={cell}>{dPct(x, y)}</td>
      </tr>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link href="/budget" className="text-xs text-neutral-500 hover:underline">← Все бюджеты</Link>
        <h1 className="mt-1 text-xl font-semibold">Сравнение версий</h1>
        <p className="mt-0.5 text-xs text-neutral-500">Версия А: {A.name} ({A.season}) · версия Б: {B.name} ({B.season}). Var — насколько Б больше или меньше А.</p>
      </div>
      <WidgetRow id="budget-compare" title="Итоги версий">
        <div className="-mx-3 flex snap-x gap-3 overflow-x-auto px-3 pb-1 md:mx-0 md:grid md:grid-cols-3 md:overflow-visible md:px-0">
          {[
            { h: `А · ${A.name}`, v: money(ta.total), c: `${qty(ta.pcs, 0)} изд. · на 1 изд. ${money(perUnit(ta))}` },
            { h: `Б · ${B.name}`, v: money(tb.total), c: `${qty(tb.pcs, 0)} изд. · на 1 изд. ${money(perUnit(tb))}` },
            { h: "Разница Б к А", v: dRub(ta.total, tb.total), c: `${dPct(ta.total, tb.total)} · изделий ${tb.pcs - ta.pcs > 0 ? "+" : ""}${qty(tb.pcs - ta.pcs, 0)}` },
          ].map((t) => (
            <div key={t.h} className={TILE_BOX + " min-w-[250px] shrink-0 snap-start shadow-sm md:min-w-0"}>
              <TileHead>{t.h}</TileHead><TileValue>{t.v}</TileValue><TileCaption>{t.c}</TileCaption>
            </div>
          ))}
        </div>
      </WidgetRow>
      <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-xs text-neutral-500">
              <th rowSpan={2} className="px-3 py-2 text-left font-medium">Тип сырья / категория</th>
              <th colSpan={2} className="px-3 pt-2 text-center font-medium">Изделий</th>
              <th colSpan={2} className="px-3 pt-2 text-center font-medium">Всего, ₽</th>
              <th colSpan={2} className="px-3 pt-2 text-center font-medium">Var (Б к А)</th>
            </tr>
            <tr className="border-b border-neutral-200 text-xs text-neutral-500">
              {["А", "Б", "А", "Б", "₽", "%"].map((h, i) => <th key={i} className="px-3 pb-2 text-right font-medium">{h}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {names.flatMap((nm) => {
              const ea = fa.get(nm), eb = fb.get(nm);
              const cats = Array.from(new Set([...(ea?.cats.keys() ?? []), ...(eb?.cats.keys() ?? [])]));
              return [line(nm, ea?.agg ?? null, eb?.agg ?? null), ...cats.map((c) => line(c, ea?.cats.get(c) ?? null, eb?.cats.get(c) ?? null, true))];
            })}
            <tr className="row-total">
              <td className="px-3 py-2.5"><TotalLabel /></td>
              <td className={cell}>{qty(ta.pcs, 0)}</td><td className={cell}>{qty(tb.pcs, 0)}</td>
              <td className={cell}>{money(ta.total)}</td><td className={cell}>{money(tb.total)}</td>
              <td className={cell}>{dRub(ta.total, tb.total)}</td><td className={cell}>{dPct(ta.total, tb.total)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
