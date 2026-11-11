import type { Prisma } from "@prisma/client";

type J = Record<string, unknown>;
const obj = (v: unknown): J => (v && typeof v === "object" && !Array.isArray(v) ? (v as J) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export type PlanCounts = { planLines: number; planParams: number; presentationItems: number; shipmentLines: number; decisions: number };

/** Раскладывает JSON-источники плана (бюджет, презентация сезона, зачёты отгрузок, решения владельца) в таблицы массива. */
export async function buildPlanTables(
  tx: Prisma.TransactionClient,
  orgId: string,
  helpers: { normCode: (s: string) => string; canonOf: (raw: string | null | undefined) => { canon: string } },
): Promise<PlanCounts> {
  await tx.dmPlanLine.deleteMany({ where: { organizationId: orgId } });
  await tx.dmPlanParam.deleteMany({ where: { organizationId: orgId } });
  await tx.dmPresentationItem.deleteMany({ where: { organizationId: orgId } });
  await tx.dmShipmentLine.deleteMany({ where: { organizationId: orgId } });
  await tx.dmDecision.deleteMany({ where: { organizationId: orgId } });
  const c: PlanCounts = { planLines: 0, planParams: 0, presentationItems: 0, shipmentLines: 0, decisions: 0 };

  const states = await tx.systemState.findMany({
    where: { organizationId: orgId, OR: [{ key: { startsWith: "budget-pcs:" } }, { key: { startsWith: "fw27-presentation" } }, { key: { startsWith: "shipment-zi:" } }, { key: { startsWith: "owner-decision:" } }] },
    select: { key: true, value: true },
  });

  for (const st of states) {
    const v = obj(st.value);
    if (st.key.startsWith("budget-pcs:")) {
      const scenario = st.key.slice("budget-pcs:".length);
      const asOfObj = v.asOf;
      const asOf = typeof asOfObj === "string" ? asOfObj : asOfObj ? JSON.stringify(asOfObj) : null;
      const lines = arr(v.rows).map((r) => obj(r));
      if (lines.length) {
        await tx.dmPlanLine.createMany({ data: lines.map((r) => ({ organizationId: orgId, scenario, season: str(v.season), supplier: str(v.supplier), asOf, block: str(r.block) ?? "", cat: str(r.cat) ?? "", fur: str(r.fur) ?? "", len: str(r.len) ?? "", pcs: Math.round(num(r.pcs) ?? 0), avg: num(r.avg), avgText: str(r.avgText), st: (r.st ?? []) as Prisma.InputJsonValue })) });
        c.planLines += lines.length;
      }
      const params = Object.entries(obj(v.params));
      if (params.length) {
        await tx.dmPlanParam.createMany({ data: params.map(([key, value]) => ({ organizationId: orgId, scenario, key, value: (value ?? null) as Prisma.InputJsonValue })) });
        c.planParams += params.length;
      }
    } else if (st.key.startsWith("fw27-presentation")) {
      const source = str(v.source) ?? "FW27";
      const asOf = str(v.asOf);
      const rows: Prisma.DmPresentationItemCreateManyInput[] = [];
      for (const sl of arr(v.slides).map((x) => obj(x))) {
        for (const it of arr(sl.items).map((x) => obj(x))) {
          rows.push({ organizationId: orgId, source, asOf, page: Math.round(num(sl.page) ?? 0), kind: str(sl.kind) ?? "", cat: str(sl.cat) ?? "", fur: str(sl.fur) ?? "", len: str(sl.len) ?? "", title: str(sl.title) ?? "", itemId: str(it.id) ?? "", pcs: num(it.pcs) === null ? null : Math.round(num(it.pcs)!), file: str(it.file), caption: str(it.caption) });
        }
      }
      if (rows.length) { await tx.dmPresentationItem.createMany({ data: rows }); c.presentationItems += rows.length; }
    } else if (st.key.startsWith("shipment-zi:")) {
      const shipmentId = st.key.slice("shipment-zi:".length);
      const rows = arr(v.lines).map((x) => obj(x)).filter((r) => str(r.article));
      if (rows.length) {
        await tx.dmShipmentLine.createMany({ data: rows.map((r) => {
          const article = str(r.article)!;
          const model = helpers.normCode(article.split(/[\s/]/)[0] ?? article);
          return { organizationId: orgId, shipmentId, supply: str(r.supply), sheet: str(r.sheet), rowNo: num(r.row) === null ? null : Math.round(num(r.row)!), article, modelCode: model, colorKey: `${model}|${helpers.canonOf(str(r.colorRu)).canon}`, size: String(r.size ?? ""), boutique: str(r.boutique), sum: num(r.sum) ?? 0, vat: num(r.vat) ?? 0 };
        }) });
        c.shipmentLines += rows.length;
      }
    } else if (st.key.startsWith("owner-decision:")) {
      await tx.dmDecision.create({ data: { organizationId: orgId, key: st.key.slice("owner-decision:".length), label: str(v.label), choice: str(v.choice), note: str(v.note), at: str(v.at) ? new Date(str(v.at)!) : null, byName: str(v.byName) } });
      c.decisions++;
    }
  }
  return c;
}
