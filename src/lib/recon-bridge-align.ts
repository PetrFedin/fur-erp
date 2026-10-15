// Мост «Реестр документов → Главная» (страница «Сверка») в целых рублях, складывающихся на экране (src/lib/money-round.ts).
// Чистая функция: данные моста не меняются, только то, что показываем.
import { lrAllocate, roundRub } from "@/lib/money-round";

export type BridgeLike = {
  registry: { total: number; purchase: number; production: number };
  main: { total: number; raw: number; work: number };
  purchase: { value: number }[];
  production: { value: number }[];
};
export type BridgeShown = {
  main: { total: number; raw: number; work: number };
  registry: { total: number; purchase: number; production: number };
  purchase: number[];
  production: number[];
  /** Σ строк разницы по закупкам / по производству. */
  sp: number;
  sw: number;
};

/**
 * Главная (сырьё + работа) = round(точного итога); сырьё и работа — под него наибольшими остатками;
 * реестр закупок и строки разницы закупок складываются в показанное сырьё, реестр производства и строки производства — в показанную работу.
 * Поэтому «реестр + разница по закупкам + разница по производству = Главная» сходится ровно в рублях.
 */
export function alignBridge(b: BridgeLike): BridgeShown {
  const total = roundRub(b.main.total);
  const [raw, work] = lrAllocate([b.main.raw, b.main.work], total);
  const pv = lrAllocate([b.registry.purchase, ...b.purchase.map((r) => r.value)], raw);
  const dv = lrAllocate([b.registry.production, ...b.production.map((r) => r.value)], work);
  const purchase = pv.slice(1), production = dv.slice(1);
  return {
    main: { total, raw, work },
    registry: { total: pv[0] + dv[0], purchase: pv[0], production: dv[0] },
    purchase, production,
    sp: purchase.reduce((a, v) => a + v, 0), sw: production.reduce((a, v) => a + v, 0),
  };
}
