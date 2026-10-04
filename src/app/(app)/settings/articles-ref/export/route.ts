import { prisma } from "@/lib/prisma";
import { getFreshSession } from "@/lib/session";
import { csvNum, csvResponse, toCsv } from "@/lib/csv";

/** CSV справочника артикулов (UTF-8 с BOM, «;»): те же колонки, что понимает импорт («Наш код», «Код в продажах», …). */
export async function GET() {
  const session = await getFreshSession();
  if (!session?.user) return new Response("Unauthorized", { status: 401 });
  const orgId = session.user.organizationId;
  const [models, grouped] = await Promise.all([
    prisma.productModel.findMany({ where: { organizationId: orgId }, orderBy: { name: "asc" } }),
    prisma.productionOrder.groupBy({
      by: ["productModelId"],
      where: { organizationId: orgId, status: { not: "CANCELLED" } },
      _count: { _all: true },
      _sum: { producedQuantity: true },
    }),
  ]);
  const stat = new Map(grouped.map((g) => [g.productModelId, g]));
  const body = toCsv(
    ["Наш код", "Наше название", "Наш SKU", "Код в продажах", "Название в продажах", "Прочие написания", "Цена продажи, ₽", "ТЗ", "Произведено, шт.", "Активен"],
    models.map((m) => [
      m.name,
      (m.category ?? "").replace(/\s+/g, " ").trim(),
      m.sku,
      m.salesCode,
      m.salesName,
      m.aliases.join(", "),
      m.sellingPrice ? csvNum(Number(m.sellingPrice)) : "",
      stat.get(m.id)?._count._all ?? 0,
      csvNum(Number(stat.get(m.id)?._sum.producedQuantity ?? 0), 0),
      m.isActive ? "да" : "нет",
    ]),
  );
  return csvResponse("articles-ref.csv", body);
}
