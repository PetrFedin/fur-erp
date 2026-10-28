import "server-only";
import { prisma } from "@/lib/prisma";
import { loadOrderRows, receivedByModel } from "@/lib/analytics-orders";
import type { Commission4Mode } from "@/lib/commission4-mode";
import { normCode } from "@/lib/sales-receipts-core";
import type { ReportSizeRow } from "@/lib/margin-tree";

/**
 * «Ждём» по нашим ТЗ: по каждой модели — объём ТЗ (без ремонта) минус получено по приходу, если положительный. Заказ в «Продажах и остатках» =
 * получено + ждём = объём ТЗ (как «В выпуске» в «Производстве»), а не заказ из отчёта. Строки в виде строк отчёта (fw26Conf = ждём, fw26Deliv = 0),
 * чтобы существующие деревья и итоги «Заказано» работали без изменений. Тип меха кладётся в код после «/», категории — из прихода той же модели.
 */
const FUR_KEY: Record<string, string> = { Норка: "MINK", Соболь: "SABLE", Лиса: "FOX", Песец: "ARCTIC FOX", Свакара: "SWAKARA", Рысь: "LYNX", Бобр: "BEAVER", Каракульча: "KARAKULCHA", Каракуль: "BROADTAIL" };

export async function tzAwaitSizes(orgId: string, c4: Commission4Mode): Promise<ReportSizeRow[]> {
  const [rows, recv, models] = await Promise.all([
    loadOrderRows(orgId, "all", c4),
    receivedByModel(orgId),
    prisma.productModel.findMany({ where: { organizationId: orgId }, select: { id: true, name: true } }),
  ]);
  const name = new Map(models.map((m) => [m.id, m.name]));
  const by = new Map<string, { q: number; fur: Map<string, number>; grp: string; cat: string }>();
  for (const r of rows) {
    if (r.category === "Ремонт") continue;
    const e = by.get(r.modelId) ?? { q: 0, fur: new Map<string, number>(), grp: r.categoryGroup ?? "", cat: r.category };
    e.q += r.qty; e.fur.set(r.fur ?? "", (e.fur.get(r.fur ?? "") ?? 0) + r.qty); by.set(r.modelId, e);
  }
  const out: ReportSizeRow[] = [];
  for (const [id, e] of by) {
    const u = Math.round(e.q - (recv.get(id) ?? 0));
    if (u <= 0) continue;
    const fur = [...e.fur].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
    const key = FUR_KEY[fur.split(/[ +]/)[0]] ?? "MINK";
    const model = name.get(id) ?? "";
    out.push({
      acode: `${model}/${key}`, color: "", size: "", modelCode: normCode(model), cls: e.grp === "Аксессуары" ? "acc" : "clothes",
      conf: u, fw26Conf: u, fw26Deliv: 0, deliv: 0, sold: 0, stock: 0, nsRub: 0, nsRubEx: 0,
    });
  }
  return out;
}
