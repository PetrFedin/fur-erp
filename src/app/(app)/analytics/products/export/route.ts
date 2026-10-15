import { getFreshSession } from "@/lib/session";
import { getYearFilter } from "@/lib/year-filter";
import { getCommission4Mode } from "@/lib/commission4-mode";
import { loadOrderRows } from "@/lib/analytics-orders";
import { GROUPS, STATUS_LABEL, applyFilters, buildGroups, parseProductFilters } from "@/lib/analytics-products";
import { derived, parseSort, type Metrics } from "@/lib/analytics-metrics";
import { csvNum, csvResponse, toCsv } from "@/lib/csv";

/**
 * CSV «Что произведено» (UTF-8 с BOM, «;», десятичная запятая). Те же фильтры, что и у страницы (g, g2, st, cat, fur, size, batch, color, q, …),
 * та же сортировка (sort, dir), общий год и режим 4% из cookie. part=groups — сводная таблица со ВСЕМИ параметрами; part=orders — плоский список ТЗ.
 * Деньги — с НДС и без НДС отдельными колонками.
 */
export async function GET(request: Request) {
  const session = await getFreshSession();
  if (!session?.user) return new Response("Unauthorized", { status: 401 });
  const url = new URL(request.url);
  const sp: Record<string, string | string[]> = {};
  for (const k of new Set(url.searchParams.keys())) sp[k] = url.searchParams.getAll(k);
  const f = parseProductFilters(sp);
  const year = await getYearFilter();
  const c4 = await getCommission4Mode();
  const rows = applyFilters(await loadOrderRows(session.user.organizationId, year, c4), f);
  const c4Label = c4 === "on" ? "с 4%" : "без 4%";
  const stamp = `${year === "all" ? "all" : year}`;

  if (url.searchParams.get("part") === "orders") {
    const body = toCsv(
      [
        "ТЗ", "Номер ТЗ заказчика", "Статус", "Модель", "Категория", "Мех", "Размер изделия", "Цвет", "Партия", "Год", "Единиц", "Работа, ₽",
        `Себестоимость с НДС (${c4Label}), ₽`, `Себестоимость без НДС (${c4Label}), ₽`, "Шкур", "Подкладка, м",
        "Молоток за шкуру с НДС, ₽", "Молоток за шкуру без НДС, ₽", "Шкур с данными о молотке", "Ставка НДС",
      ],
      rows.map((r) => [
        r.number, r.workOrderNumber, r.group === "done" ? "сделано" : "в работе/план", r.modelName, r.category, r.fur, r.sizeRaw || r.size, r.color,
        r.batchNumber, r.year, csvNum(r.qty, 3), csvNum(r.work), csvNum(r.costIncl), csvNum(r.costExcl), csvNum(r.furQty, 3), csvNum(r.liningQty, 3),
        r.hammerSkins > 0 ? csvNum(r.hammerIncl / r.hammerSkins) : "", r.hammerSkins > 0 ? csvNum(r.hammerExcl / r.hammerSkins) : "", csvNum(r.hammerSkins, 3),
        r.vatKind === "mix" ? "смешанные" : r.vatKind === "none" ? "" : r.vatKind,
      ]),
    );
    return csvResponse(`izdeliya-tz-${stamp}.csv`, body);
  }

  const s = parseSort(f.sort, f.dir);
  const { nodes, total } = buildGroups(rows, f.g, f.g2, s.sort, s.dir);
  const head = [
    f.g2 ? `${GROUPS[f.g]} / ${GROUPS[f.g2]}` : GROUPS[f.g], "ТЗ", "Единиц", "Доля, %", "Шкур", "Шкур на ед.", "Подкладка, м", "Подкладка, м на ед.",
    `Мех за ед. с НДС (${c4Label})`, `Мех за ед. без НДС (${c4Label})`, `Мех за шкуру с НДС (${c4Label})`, `Мех за шкуру без НДС (${c4Label})`,
    "Молоток за шкуру с НДС", "Молоток за шкуру без НДС", "Молоток: доля шкур с данными, %", "Молоток: лотов с данными", "Молоток: лотов всего",
    "Работа за ед.",
    `Себестоимость за ед. с НДС (${c4Label})`, `Себестоимость за ед. без НДС (${c4Label})`, "Себестоимость мин. с НДС", "Себестоимость макс. с НДС",
    `Полная себестоимость за ед. с НДС (${c4Label})`, `Полная себестоимость за ед. без НДС (${c4Label})`, "Полная мин. с НДС", "Полная макс. с НДС",
    `Σ себестоимости с НДС (${c4Label})`, `Σ себестоимости без НДС (${c4Label})`,
    "Доля меха, %", "Доля подкладки, %", "Доля 4%, %", "Доля работы, %", "Доля расходов, %",
  ];
  const line = (label: string, m: Metrics) => {
    const d = derived(m);
    const pc = (x: number | null) => (x == null ? "" : csvNum(x * 100, 1));
    return [
      label, m.orders, csvNum(m.units, 3), total.units > 0 ? csvNum((m.units / total.units) * 100, 1) : "", csvNum(m.skins, 3), csvNum(d.skinsPerUnit, 3), csvNum(m.liningM, 3), csvNum(d.liningPerUnit, 3),
      csvNum(d.furPerUnit?.incl), csvNum(d.furPerUnit?.excl), csvNum(d.furPerSkin?.incl), csvNum(d.furPerSkin?.excl),
      csvNum(d.hammerPerSkin?.incl), csvNum(d.hammerPerSkin?.excl), pc(d.hammerSkinShare), m.lotsHammer, m.lots,
      csvNum(d.workPerUnit),
      csvNum(d.costPerUnit?.incl), csvNum(d.costPerUnit?.excl), csvNum(m.minCostIncl), csvNum(m.maxCostIncl),
      csvNum(d.fullPerUnit?.incl), csvNum(d.fullPerUnit?.excl), csvNum(m.minFullIncl), csvNum(m.maxFullIncl),
      csvNum(m.costIncl), csvNum(m.costExcl),
      pc(d.shFur), pc(d.shLining), pc(d.shC4), pc(d.shWork), pc(d.shExpenses),
    ];
  };
  const out: (string | number | null | undefined)[][] = [];
  for (const n of nodes) {
    out.push(line(n.label, n.m));
    for (const c of n.children) out.push(line(`${n.label} / ${c.label}`, c.m));
  }
  out.push(line(`Итого (${STATUS_LABEL[f.st]})`, total));
  return csvResponse(`izdeliya-${f.g}${f.g2 ? `-${f.g2}` : ""}-${stamp}.csv`, toCsv(head, out));
}
