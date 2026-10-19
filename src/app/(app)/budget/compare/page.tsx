import { Breadcrumbs } from "@/components/breadcrumbs";
import { THGroup } from "@/components/table-head";
import Link from "next/link";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { WidgetRow } from "@/components/widget-row";
import { DEFAULT_PARAMS, computeTree, furRank, grandTotal, parseNodes, perUnit, type Agg, type BudgetNode, type BudgetParams } from "@/lib/budget-calc";
import { TILE_BOX, TileCaption, TileHead, TileValue } from "../../dashboard/tile";
import { money, pct, qty } from "../format";
import { InfoHint } from "@/components/info-hint";
import { TotalLabel } from "@/components/total-label";
import { formatMoneySigned } from "@/lib/utils";

export const metadata = { title: "Сравнение бюджетов" };

type Side = { name: string; season: string; nodes: BudgetNode[]; params: BudgetParams };

/** Итоги по типам сырья, категориям внутри них и длинам внутри категорий. Категории (и длины) с одинаковым названием в одном типе складываются. */
function byFur(s: Side) {
  const calc = computeTree(s.nodes, s.params);
  const furs = new Map<string, { agg: Agg | null; cats: Map<string, Agg>; lens: Map<string, Agg> }>();
  const add = (a: Agg | null, b: Agg) => (a ? { ...a, pcs: a.pcs + b.pcs, total: a.total + b.total, hides: a.hides + b.hides } as Agg : b);
  for (const f of s.nodes.filter((n) => n.kind === "fur")) {
    const e = furs.get(f.name) ?? { agg: null, cats: new Map<string, Agg>(), lens: new Map<string, Agg>() };
    const fa = calc.get(f.id);
    if (fa) e.agg = add(e.agg, fa);
    for (const c of s.nodes.filter((n) => n.parentId === f.id)) {
      const ca = calc.get(c.id);
      if (ca) e.cats.set(c.name, add(e.cats.get(c.name) ?? null, ca));
      for (const l of s.nodes.filter((n) => n.parentId === c.id && n.kind === "len")) {
        const la = calc.get(l.id);
        if (la) e.lens.set(`${c.name}\u0000${l.name}`, add(e.lens.get(`${c.name}\u0000${l.name}`) ?? null, la));
      }
    }
    furs.set(f.name, e);
  }
  return furs;
}

const dRub = (a: number, b: number) => formatMoneySigned(b - a);
const dPct = (a: number, b: number) => (a > 0 ? pct((b / a - 1) * 100) : b > 0 ? "новое" : "—");

export default async function ComparePage({ searchParams }: { searchParams: Promise<{ a?: string; b?: string }> }) {
  const session = await requireSession();
  const sp = await searchParams;
  if (!sp.a || !sp.b) {
    return (
      <div className="flex flex-col gap-4">
        <Breadcrumbs items={[{ label: "Бюджет", href: "/budget" }, { label: "Сравнение" }]} />
        <div className="rounded-lg border border-dashed border-neutral-300 bg-white p-6 text-center text-sm text-neutral-500">
          <p>Выберите две версии бюджета для сравнения</p>
          <Link href="/budget" className="mt-2 inline-block text-blue-700 hover:underline">← К списку бюджетов</Link>
        </div>
      </div>
    );
  }
  const rows = await prisma.budgetScenario.findMany({ where: { organizationId: session.user.organizationId, id: { in: [sp.a ?? "", sp.b ?? ""] } } });
  const toSide = (id?: string): Side | null => {
    const r = rows.find((x) => x.id === id);
    return r ? { name: r.name, season: r.season, nodes: parseNodes(r.lines), params: { ...DEFAULT_PARAMS, ...(r.params as Partial<BudgetParams>) } } : null;
  };
  const A = toSide(sp.a);
  const B = toSide(sp.b);
  if (!A || !B || sp.a === sp.b) {
    return (
      <div className="flex flex-col gap-4">
        <Breadcrumbs items={[{ label: "Бюджет", href: "/budget" }, { label: "Сравнение" }]} />
        <div className="rounded-lg border border-dashed border-neutral-300 bg-white p-6 text-center text-sm text-neutral-500">
          <p>{sp.a === sp.b ? "Для сравнения нужны две разные версии бюджета." : "Одну из выбранных версий не удалось найти — возможно, она удалена."}</p>
          <Link href="/budget" className="mt-2 inline-block text-blue-700 hover:underline">← К списку бюджетов</Link>
        </div>
      </div>
    );
  }
  const fa = byFur(A);
  const fb = byFur(B);
  const ta = grandTotal(A.nodes, A.params);
  const tb = grandTotal(B.nodes, B.params);
  const names = Array.from(new Set([...fa.keys(), ...fb.keys()])).sort((x, y) => furRank(x) - furRank(y) || x.localeCompare(y, "ru"));

  const cell = "whitespace-nowrap px-3 py-2 text-right tabular-nums";
  const line = (label: string, a: Agg | null, b: Agg | null, sub = false, deep = false, kpre = "") => {
    const x = a?.total ?? 0, y = b?.total ?? 0;
    return (
      <tr key={kpre + (deep ? "l:" : sub ? "c:" : "f:") + label + (sub ? x + "|" + y : "")} className={deep ? "text-xs text-neutral-500" : sub ? "text-xs text-neutral-600" : "bg-neutral-50 font-medium"}>
        <td className={"px-3 py-2 " + (deep ? "pl-12" : sub ? "pl-8" : "")}>{label}</td>
        <td className={cell + " border-l border-neutral-200"}>{a ? qty(a.pcs, 0) : "—"}</td>
        <td className={cell}>{b ? qty(b.pcs, 0) : "—"}</td>
        <td className={cell + " border-l border-neutral-200"}>{a ? money(x) : "—"}</td>
        <td className={cell}>{b ? money(y) : "—"}</td>
        <td className={cell + " border-l border-neutral-200" + (y - x === 0 ? "" : " font-medium")}>{dRub(x, y)}</td>
        <td className={cell}>{dPct(x, y)}</td>
      </tr>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <style>{"@media print { @page { size: A4 landscape; margin: 8mm; } }"}</style>
      <Breadcrumbs items={[{ label: "Бюджет", href: "/budget" }, { label: "Сравнение" }]} />
      <div>
        <h1 className="text-xl font-semibold">Сравнение версий
          <InfoHint label="Как читать сравнение" wide>
            <p>Версия А: {A.name} ({A.season}) · версия Б: {B.name} ({B.season}). Отклонение — насколько Б больше или меньше А.</p>
          </InfoHint>
        </h1>
      </div>
      <WidgetRow id="budget-compare" title="Итоги версий">
        <div className="grid grid-cols-1 items-stretch gap-3 md:grid-cols-3 print:grid-cols-3">
          {[
            { h: `А · ${A.name}`, v: money(ta.total), c: `${qty(ta.pcs, 0)} изд. · на 1 изд. ${money(perUnit(ta))}` },
            { h: `Б · ${B.name}`, v: money(tb.total), c: `${qty(tb.pcs, 0)} изд. · на 1 изд. ${money(perUnit(tb))}` },
            { h: "Разница Б к А", v: dRub(ta.total, tb.total), c: `${dPct(ta.total, tb.total)} · изделий ${tb.pcs - ta.pcs > 0 ? "+" : ""}${qty(tb.pcs - ta.pcs, 0)}` },
          ].map((t) => (
            <div key={t.h} className={TILE_BOX + " shadow-sm print:shadow-none"}>
              <TileHead>{t.h}</TileHead><TileValue>{t.v}</TileValue><TileCaption>{t.c}</TileCaption>
            </div>
          ))}
        </div>
      </WidgetRow>
      <div className="scroll-hint overflow-x-auto rounded-lg border border-neutral-200 bg-white p-3 print:overflow-visible print:border-0 print:p-0">
        <table className="w-full min-w-[760px] table-fixed text-left text-sm print:min-w-0 print:text-xs">
          <thead>
            <tr className="border-b border-neutral-200 text-xs text-neutral-500">
              <th rowSpan={2} className="w-[170px] px-3 py-2 text-left font-medium">Тип сырья / категория / длина</th>
              <THGroup colSpan={2}>Изделий, шт.</THGroup>
              <THGroup colSpan={2}>Всего, ₽</THGroup>
              <THGroup colSpan={2}>Отклонение (Б к А)</THGroup>
            </tr>
            <tr className="border-b border-neutral-200 text-xs text-neutral-500">
              {["А", "Б", "А", "Б", "₽", "%"].map((h, i) => <th key={i} className={"px-3 pb-2 text-right font-medium" + (i % 2 === 0 ? " border-l border-neutral-200" : "")}>{h}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {names.flatMap((nm) => {
              const ea = fa.get(nm), eb = fb.get(nm);
              const cats = Array.from(new Set([...(ea?.cats.keys() ?? []), ...(eb?.cats.keys() ?? [])]));
              return [
                line(nm, ea?.agg ?? null, eb?.agg ?? null),
                ...cats.flatMap((c) => {
                  const lens = Array.from(new Set([...(ea?.lens.keys() ?? []), ...(eb?.lens.keys() ?? [])])).filter((k) => k.startsWith(c + "\u0000"));
                  return [
                    line(c, ea?.cats.get(c) ?? null, eb?.cats.get(c) ?? null, true),
                    ...lens.map((k) => line(k.slice(c.length + 1), ea?.lens.get(k) ?? null, eb?.lens.get(k) ?? null, true, true, nm + "|" + c + "|")),
                  ];
                }),
              ];
            })}
            <tr className="row-total">
              <td className="px-3 py-2.5"><TotalLabel /></td>
              <td className={cell + " border-l border-neutral-200"}>{qty(ta.pcs, 0)}</td><td className={cell}>{qty(tb.pcs, 0)}</td>
              <td className={cell + " border-l border-neutral-200"}>{money(ta.total)}</td><td className={cell}>{money(tb.total)}</td>
              <td className={cell + " border-l border-neutral-200"}>{dRub(ta.total, tb.total)}</td><td className={cell}>{dPct(ta.total, tb.total)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
