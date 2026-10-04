import { getFreshSession } from "@/lib/session";
import { getYearFilter } from "@/lib/year-filter";
import { getCommission4Mode } from "@/lib/commission4-mode";
import { loadOrderRows } from "@/lib/analytics-orders";
import { GROUPS, STATUS_LABEL, aggregate, applyFilters, groupRows, parseProductFilters, per } from "@/lib/analytics-products";
import { csvNum, csvResponse, toCsv } from "@/lib/csv";

/**
 * CSV «Что произведено» (UTF-8 с BOM, «;», десятичная запятая). Те же фильтры, что и у страницы: g, st, cat, fur, size, batch, q,
 * плюс общий год и режим 4% из cookie. part=groups — сводная таблица; part=orders — плоский список ТЗ.
 * Деньги — с НДС и без НДС отдельными колонками.
 */
export async function GET(request: Request) {
  const session = await getFreshSession();
  if (!session?.user) return new Response("Unauthorized", { status: 401 });
  const url = new URL(request.url);
  const f = parseProductFilters(Object.fromEntries(url.searchParams));
  const year = await getYearFilter();
  const c4 = await getCommission4Mode();
  const rows = applyFilters(await loadOrderRows(session.user.organizationId, year, c4), f);
  const c4Label = c4 === "on" ? "с 4%" : "без 4%";
  const stamp = `${year === "all" ? "all" : year}`;

  if (url.searchParams.get("part") === "orders") {
    const body = toCsv(
      ["ТЗ", "Номер ТЗ заказчика", "Статус", "Модель", "Категория", "Мех", "Размер", "Цвет", "Партия", "Год", "Единиц", "Работа, ₽", `Себестоимость с НДС (${c4Label}), ₽`, `Себестоимость без НДС (${c4Label}), ₽`, "Мех, шк.", "Подкладка, м"],
      rows.map((r) => [
        r.number, r.workOrderNumber, r.group === "done" ? "сделано" : "в работе/план", r.modelName, r.category, r.fur, r.sizeRaw || r.size, r.color,
        r.batchNumber, r.year, csvNum(r.qty, 3), csvNum(r.work), csvNum(r.costIncl), csvNum(r.costExcl), csvNum(r.furQty, 3), csvNum(r.liningQty, 3),
      ]),
    );
    return csvResponse(`izdeliya-tz-${stamp}.csv`, body);
  }

  const groups = groupRows(rows, f.g);
  const total = aggregate("Итого", rows);
  const line = (label: string, a: ReturnType<typeof aggregate>) => [
    label, a.orders, csvNum(a.units, 3), total.units > 0 ? csvNum((a.units / total.units) * 100, 1) : "",
    csvNum(per(a.work, a.unitsWork)), csvNum(per(a.furQty, a.unitsMat)), csvNum(per(a.liningQty, a.unitsMat)),
    csvNum(per(a.costIncl, a.unitsCosted)), csvNum(per(a.costExcl, a.unitsCosted)), csvNum(a.costIncl), csvNum(a.costExcl),
  ];
  const body = toCsv(
    [GROUPS[f.g], "ТЗ", "Единиц", "Доля, %", "Работа за ед., ₽", "Мех, шк. за ед.", "Подкладка, м за ед.", `Себестоимость за ед. с НДС (${c4Label})`, `Себестоимость за ед. без НДС (${c4Label})`, `Σ себестоимости с НДС (${c4Label})`, `Σ себестоимости без НДС (${c4Label})`],
    [...groups.map((g) => line(g.label, g)), line(`Итого (${STATUS_LABEL[f.st]})`, total)],
  );
  return csvResponse(`izdeliya-${f.g}-${stamp}.csv`, body);
}
