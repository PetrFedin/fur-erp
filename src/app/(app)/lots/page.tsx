import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { formatMoney, formatQty, formatDate } from "@/lib/utils";

const UNIT_LABELS: Record<string, string> = {
  PIECE: "шт.",
  KG: "кг",
  M2: "м²",
  M: "м",
  SET: "компл.",
};

export default async function LotsArchivePage({ searchParams }: PageProps<"/lots">) {
  const session = await requireSession();
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const materialId = typeof sp.material === "string" ? sp.material : "";

  const [lots, materials] = await Promise.all([
    prisma.rawMaterialLot.findMany({
      where: {
        organizationId: session.user.organizationId,
        ...(materialId ? { rawMaterialId: materialId } : {}),
        ...(q
          ? {
              OR: [
                { lotNumber: { contains: q, mode: "insensitive" } },
                { color: { contains: q, mode: "insensitive" } },
                { grade: { contains: q, mode: "insensitive" } },
                { rawMaterial: { name: { contains: q, mode: "insensitive" } } },
              ],
            }
          : {}),
      },
      include: {
        rawMaterial: true,
        warehouse: true,
        purchase: { include: { supplier: true } },
        usages: { include: { productionOrder: true } },
      },
      orderBy: { receivedDate: "desc" },
      take: 200,
    }),
    prisma.rawMaterial.findMany({
      where: { organizationId: session.user.organizationId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Архив сырья</h1>
        <p className="text-sm text-neutral-500">
          Полная история поступивших лотов — чтобы найти нужную партию для ТЗ, смотрите
          «Использовано в» и остаток
        </p>
      </div>

      <Card>
        <CardContent className="pt-4">
          <form className="grid grid-cols-4 items-end gap-2" method="get">
            <div className="col-span-2">
              <label className="mb-1 block text-xs text-neutral-500">Поиск (лот, материал, цвет, сорт)</label>
              <Input name="q" defaultValue={q} placeholder="напр. 15016 или соболь" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-neutral-500">Сырьё</label>
              <Select name="material" defaultValue={materialId}>
                <option value="">Все материалы</option>
                {materials.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex gap-2">
              <Button type="submit" variant="outline">
                Найти
              </Button>
              <Link href="/lots" className="flex items-center text-sm text-neutral-500 hover:underline">
                Сбросить
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>

      <Table>
        <Thead>
          <Tr>
            <Th>Сырьё</Th>
            <Th>Лот</Th>
            <Th>Сорт/цвет</Th>
            <Th>Склад</Th>
            <Th>Получено</Th>
            <Th>Остаток</Th>
            <Th>Себест. за ед. (без НДС / НДС / всего)</Th>
            <Th>Поставщик / закупка</Th>
            <Th>Дата поступления</Th>
            <Th>Использовано в</Th>
          </Tr>
        </Thead>
        <Tbody>
          {lots.map((l) => (
            <Tr key={l.id}>
              <Td className="font-medium">{l.rawMaterial.name}</Td>
              <Td>{l.lotNumber ?? "без номера"}</Td>
              <Td>{[l.grade, l.color].filter(Boolean).join(" / ") || "—"}</Td>
              <Td>{l.warehouse.name}</Td>
              <Td>
                {formatQty(l.quantityReceived.toString())} {UNIT_LABELS[l.rawMaterial.unit]}
              </Td>
              <Td>
                {l.quantityRemaining.isZero() ? (
                  <Badge>Израсходован</Badge>
                ) : (
                  <>
                    {formatQty(l.quantityRemaining.toString())} {UNIT_LABELS[l.rawMaterial.unit]}
                  </>
                )}
              </Td>
              <Td className="whitespace-nowrap text-xs">
                {formatMoney(l.materialCostExclVat.toString())} / {l.vatRate.toString()}% /{" "}
                <span className="font-medium text-neutral-900">{formatMoney(l.unitCost.toString())}</span>
              </Td>
              <Td>
                {l.purchase ? (
                  <Link href={`/purchases/${l.purchase.id}`} className="hover:underline">
                    {l.purchase.supplier.name} ({l.purchase.number})
                  </Link>
                ) : (
                  "—"
                )}
              </Td>
              <Td>{formatDate(l.receivedDate)}</Td>
              <Td>
                {l.usages.length === 0
                  ? "—"
                  : l.usages.map((u, i) => (
                      <span key={u.id}>
                        {i > 0 && ", "}
                        <Link href={`/production/${u.productionOrderId}`} className="hover:underline">
                          {u.productionOrder.number}
                        </Link>
                      </span>
                    ))}
              </Td>
            </Tr>
          ))}
          {lots.length === 0 && (
            <Tr>
              <Td colSpan={10} className="py-8 text-center text-neutral-400">
                Ничего не найдено
              </Td>
            </Tr>
          )}
        </Tbody>
      </Table>
    </div>
  );
}
