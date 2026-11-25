import type { Decimal } from "@prisma/client/runtime/library";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { formatQty } from "@/lib/utils";
import { ApplyBomButton } from "../order-actions";
import { UNIT_LABELS } from "./calc-rows";
import type { CardOrder } from "./include";

/** Состав модели (на 1 изделие и на план) и кнопка «применить состав» — пункт меню «Добавить». */
export function BomBlock({ orderId, plannedQuantity, materials }: { orderId: string; plannedQuantity: Decimal; materials: CardOrder["productModel"]["materials"] }) {
  return (
    <div className="flex flex-col gap-3">
      <Table>
        <Thead>
          <Tr>
            <Th>Материал</Th>
            <Th>На 1 изделие</Th>
            <Th>На план ({formatQty(plannedQuantity.toString())} шт.)</Th>
          </Tr>
        </Thead>
        <Tbody>
          {materials.map((line) => (
            <Tr key={line.id}>
              <Td>{line.rawMaterial.name}</Td>
              <Td>{formatQty(line.quantityPerUnit.toString())} {UNIT_LABELS[line.rawMaterial.unit]}</Td>
              <Td>{formatQty(line.quantityPerUnit.mul(plannedQuantity).toString())} {UNIT_LABELS[line.rawMaterial.unit]}</Td>
            </Tr>
          ))}
        </Tbody>
      </Table>
      <div>
        <ApplyBomButton orderId={orderId} />
      </div>
    </div>
  );
}
