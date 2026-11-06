import "server-only";
import { prisma } from "@/lib/prisma";
import { loadSalesInput } from "@/lib/sales-server";
import { tzAwaitSizes } from "@/lib/tz-await";
import { furRuLabel } from "@/lib/sales-receipts-core";
import { baseForecast, FC_MONTHS, leafKeyOf, netMonths, tzPartsByModel, type Overrides } from "@/lib/fw26-plan";
import type { Commission4Mode } from "@/lib/commission4-mode";

/** Отчёт по заказу и поставкам (как в отчёте поставщика): позиция = артикул × цвет; по каждому сезону заказ и приход (шт., €), приход по месяцам, у FW26/27 ещё прогноз поставок на ноябрь/декабрь. */
export type SupplyVals = { conf: number; confEur: number; deliv: number; delivEur: number };
export type SupplyLeaf = {
  cls: "clothes" | "acc" | "other"; cat1: string; fur: string; cat2: string;
  by: Record<string, SupplyVals>;
  /** Сезон → месяц (YYYY-MM) → штук получено. */
  months: Record<string, Record<string, number>>;
  /** Прогноз поставок FW26/27 по месяцам (ноябрь, декабрь; январь — если включён). */
  fc: Record<string, number>;
};

const FUR_RU: Record<string, string> = { SABLE: "Соболь", MINK: "Норка", FOX: "Лиса", SWAKARA: "Каракульча", LYNX: "Рысь", BEAVER: "Бобр", CHINCHILLA: "Шиншилла" };
const SEASONS = ["FW26/27", "SS26", "FW25/26"] as const;
const FROM_LINE: Record<string, (typeof SEASONS)[number]> = { "FW 25/26": "FW25/26", "SS 2026": "SS26", "FW 26/27": "FW26/27" };

export async function loadSupplyLeaves(orgId: string, c4: Commission4Mode): Promise<SupplyLeaf[]> {
  const [data, tz, state] = await Promise.all([
    loadSalesInput(orgId, c4),
    tzAwaitSizes(orgId, c4),
    prisma.systemState.findUnique({ where: { organizationId_key: { organizationId: orgId, key: "sales-fw26-forecast" } } }),
  ]);
  const st = (state?.value ?? {}) as { cells?: Overrides; janOn?: boolean };
  const overrides = st.cells ?? {};
  const fcMonths = FC_MONTHS.filter((m) => m !== "2027-01" || st.janOn) as string[];

  // Приход по месяцам: сезон → позиция → месяц → шт.
  const recv = new Map<string, Map<string, Map<string, number>>>();
  for (const l of data.input.lines) {
    const s = FROM_LINE[l.season];
    if (l.kind !== "RECEIPT" || !l.pcs || !s) continue;
    const k = leafKeyOf(l.article, l.colorId), m = l.iso.slice(0, 7);
    const bySeason = recv.get(s) ?? recv.set(s, new Map()).get(s)!;
    const mm = bySeason.get(k) ?? bySeason.set(k, new Map()).get(k)!;
    mm.set(m, (mm.get(m) ?? 0) + l.pcs);
  }

  type Acc = SupplyLeaf & { key: string; model: string; fw26aw: number };
  const leaves = new Map<string, Acc>();
  for (const r of data.sizes) {
    if (!r.seas) continue;
    const k = leafKeyOf(r.acode, r.color);
    const lf = leaves.get(k) ?? { key: k, model: r.modelCode ?? "", cls: (r.cls ?? "other") as SupplyLeaf["cls"], cat1: (r.l2 || "(без категории)").trim(), fur: furRuLabel(r.fur ?? "Не указан", FUR_RU), cat2: (r.l4 || r.l5 || "(без категории)").trim(), by: {}, months: {}, fc: {}, fw26aw: 0 };
    for (const s of SEASONS) {
      const c = r.seas[s]; if (!c) continue;
      const closed = s !== "FW26/27";
      const v = lf.by[s] ?? (lf.by[s] = { conf: 0, confEur: 0, deliv: 0, delivEur: 0 });
      v.conf += closed ? c.conf ?? c.deliv ?? 0 : c.conf ?? 0;
      v.confEur += closed ? c.confEur ?? c.delivEur ?? 0 : c.confEur ?? 0;
      v.deliv += c.deliv ?? 0; v.delivEur += c.delivEur ?? 0;
    }
    leaves.set(k, lf);
  }
  const list = [...leaves.values()];
  for (const lf of list) {
    for (const s of SEASONS) {
      const mm = recv.get(s)?.get(lf.key); if (!mm) continue;
      const use = s === "FW26/27" ? netMonths(mm) : mm;
      lf.months[s] = Object.fromEntries(use);
    }
  }
  // Прогноз ноября/декабря FW26/27: то, что в ТЗ и ещё не пришло, — в ноябре; остаток — пополам (как в Excel и «Приходе по месяцам»).
  const fw = list.filter((l) => l.by["FW26/27"]);
  for (const l of fw) { const got = Object.values(l.months["FW26/27"] ?? {}).reduce((a, x) => a + x, 0); l.fw26aw = Math.max(0, (l.by["FW26/27"]?.conf ?? 0) - got); }
  const tzByModel = new Map<string, number>();
  for (const t of tz) tzByModel.set(t.modelCode ?? "", (tzByModel.get(t.modelCode ?? "") ?? 0) + (t.fw26Conf ?? 0));
  const parts = tzPartsByModel(fw.map((l) => ({ model: l.model, aw: l.fw26aw })), tzByModel);
  fw.forEach((l, i) => {
    const b = baseForecast(l.fw26aw, parts[i]);
    const base: Record<string, number> = { "2026-11": b.nov, "2026-12": b.dec, "2027-01": 0 };
    for (const m of fcMonths) l.fc[m] = overrides[l.key]?.[m] ?? base[m];
  });
  return list
    .filter((l) => Object.values(l.by).some((v) => v.conf || v.deliv))
    .map(({ key: _k, model: _m, fw26aw: _a, ...rest }) => rest);
}
