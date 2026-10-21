import { formatNum, formatQty, formatDec1 } from "@/lib/utils";
import { prisma } from "@/lib/prisma";
import { inboxScope, type SupplierSess } from "@/lib/supplier-inbox";
import { compareCalcs } from "@/lib/calc-compare";
import type { CalcPayload } from "@/lib/supplier-calc";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";

const money = (n: number | null) => (n == null || !Number.isFinite(n) ? "—" : formatNum(n, 1));
const sign = (n: number) => (n > 0 ? "+" : "") + money(n);

/** Окончательный расчёт против предварительного: итого и разница, по лотам «за шкуру было → стало». */
export async function CompareBlock({ s, payload }: { s: Pick<SupplierSess, "user"> & { user: { organizationId: string; role: string; supplierId?: string | null } }; payload: CalcPayload }) {
  if (payload.stage !== "FINAL" || !payload.basedOnId) return null;
  const base = await prisma.supplierInbox.findFirst({ where: { id: payload.basedOnId, kind: "AUCTION_CALC", ...inboxScope(s as SupplierSess) }, select: { title: true, payload: true } });
  if (!base) return null;
  const c = compareCalcs(base.payload as unknown as CalcPayload, payload);
  const changed = c.rows.filter((r) => r.unitBefore !== r.unitAfter || r.qtyBefore !== r.qtyAfter);
  return (
    <section className="flex flex-col gap-2 rounded-md border border-neutral-200 p-3">
      <h2 className="text-sm font-semibold">Сравнение с предварительным расчётом</h2>
      <p className="text-sm">
        Предварительно: <b>{money(c.totalBefore)} ₽</b> → окончательно: <b>{money(c.totalAfter)} ₽</b>, разница <b className={c.diff > 0 ? "text-red-700" : "text-green-700"}>{sign(c.diff)} ₽</b>
        {c.qtyBefore !== c.qtyAfter && <> · шкур {formatDec1(c.qtyBefore)} → {formatDec1(c.qtyAfter)}</>}
      </p>
      {changed.length === 0 ? <p className="text-sm text-neutral-500">Нет изменений по лотам.</p> : (
        <div className="overflow-x-auto">
          <Table className="min-w-[560px]">
            <Thead><Tr><Th>Лот</Th><Th>Мех</Th><Th className="text-right">Шкур</Th><Th className="text-right">За шкуру было, ₽</Th><Th className="text-right">Стало, ₽</Th><Th className="text-right">Сумма было → стало, ₽</Th></Tr></Thead>
            <Tbody>
              {changed.map((r, i) => (
                <Tr key={i}>
                  <Td>{r.lot || "—"}</Td><Td>{r.fur || "—"}</Td>
                  <Td className="text-right tabular-nums">{r.qtyBefore === r.qtyAfter ? formatQty(r.qtyAfter ?? 0) : `${r.qtyBefore == null ? "—" : formatQty(r.qtyBefore)} → ${r.qtyAfter == null ? "—" : formatQty(r.qtyAfter)}`}</Td>
                  <Td className="text-right tabular-nums">{money(r.unitBefore)}</Td>
                  <Td className="text-right tabular-nums">{money(r.unitAfter)}</Td>
                  <Td className="text-right tabular-nums">{money(r.totalBefore)} → {money(r.totalAfter)}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </div>
      )}
    </section>
  );
}
