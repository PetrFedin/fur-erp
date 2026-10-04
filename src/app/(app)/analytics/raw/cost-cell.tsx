import type { Decimal } from "@prisma/client/runtime/library";
import { Money } from "@/components/money";

const q2 = (d: Decimal) => d.toFixed(2);

/** Сумма в ₽ (с/без НДС по переключателю шапки); в режиме «С 4%» ниже — итог с надбавкой 4% по строкам, где она применяется. */
export function CostCell({ incl, excl, extraIncl, extraExcl, c4 }: { incl: Decimal; excl: Decimal; extraIncl: Decimal; extraExcl: Decimal; c4: "on" | "off" }) {
  return (
    <>
      <Money incl={q2(incl)} excl={q2(excl)} />
      {c4 === "on" && !extraIncl.isZero() && (
        <span className="block text-xs text-neutral-500">
          с 4%: <Money incl={q2(incl.add(extraIncl))} excl={q2(excl.add(extraExcl))} />
        </span>
      )}
    </>
  );
}
