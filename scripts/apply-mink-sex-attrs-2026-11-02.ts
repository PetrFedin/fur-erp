// Признаки меха «Самец» / «Самка» (группа «Пол», норка): завести в справочнике и поставить лотам норки по src/lib/data/mink-lot-sex.json
// (пол из названия лота и реестров закупок p2025a/b, p2026a; два лота SAGA 03-26 — по номеру лота, source «lot-number»).
// ТЗ, артикулы и партии получают признак через списанные лоты — в базе у них не копируется.
//   node --env-file=.env node_modules/.bin/tsx scripts/apply-mink-sex-attrs-2026-11-02.ts            # пробный прогон
//   node --env-file=.env node_modules/.bin/tsx scripts/apply-mink-sex-attrs-2026-11-02.ts --write    # записать (журнал в docs-inventory)
//   node --env-file=.env node_modules/.bin/tsx scripts/apply-mink-sex-attrs-2026-11-02.ts --rollback # снять поставленное этим скриптом
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { FUR_ATTR_SEEDS } from "../src/lib/fur-attr";
import { loadFurLots } from "../src/lib/fur-table-server";

const JOURNAL = "docs-inventory/corrections-journal-mink-sex-attrs-2026-11-02.json";
const SEX = JSON.parse(readFileSync("src/lib/data/mink-lot-sex.json", "utf8")) as Record<string, [string, string]>;
type J = { refs: { id: string; name: string }[]; links: { lotId: string; attrId: string; lot: string; sex: string; source: string }[] };

(async () => {
  const prisma = new PrismaClient();
  const org = (await prisma.organization.findFirst({ orderBy: { createdAt: "asc" } }))!.id;

  if (process.argv.includes("--rollback")) {
    const j = JSON.parse(readFileSync(JOURNAL, "utf8")) as J;
    for (const l of j.links) await prisma.rawMaterialLotAttr.deleteMany({ where: { lotId: l.lotId, attrId: l.attrId } });
    for (const r of j.refs) if ((await prisma.rawMaterialLotAttr.count({ where: { attrId: r.id } })) + (await prisma.productionOrderAttr.count({ where: { attrId: r.id } })) === 0) await prisma.furAttrRef.delete({ where: { id: r.id } });
    console.log(`откат: снято ${j.links.length} связей, признаков удалено (если не использованы) ${j.refs.length}`);
    process.exit(0);
  }

  const write = process.argv.includes("--write");
  const j: J = { refs: [], links: [] };
  const ids: Record<"M" | "F", string> = { M: "", F: "" };
  for (const [code, name] of [["M", "Самец"], ["F", "Самка"]] as const) {
    let ref = await prisma.furAttrRef.findUnique({ where: { organizationId_name: { organizationId: org, name } } });
    if (!ref) {
      const s = FUR_ATTR_SEEDS.find((x) => x.name === name)!;
      console.log(`новый признак: ${name} (группа ${s.group}, ${s.furKind})`);
      if (write) { ref = await prisma.furAttrRef.create({ data: { organizationId: org, name, group: s.group, furKind: s.furKind, aliases: s.aliases, description: s.description, autoDetect: s.autoDetect, confirmed: true } }); j.refs.push({ id: ref.id, name }); }
    }
    ids[code] = ref?.id ?? `(новый ${name})`;
  }

  const lots = (await loadFurLots(prisma, org, { kind: "fur", year: "all" })).filter((l) => l.item === "Норка");
  const cnt = { M: 0, F: 0, none: 0, already: 0 }, qty = { M: 0, F: 0, none: 0 };
  for (const l of lots) {
    const v = SEX[l.lotNumber];
    const code = v && (v[0] === "M" || v[0] === "F") ? (v[0] as "M" | "F") : null;
    if (!code) { cnt.none++; qty.none += l.recv; console.log(`  без пола: ${l.lotNumber} (${l.recv} шк.) — ${v?.[1] ?? "нет в списке"}`); continue; }
    const source = v[1].startsWith("ВЫВОД") ? "lot-number" : "doc";
    const has = await prisma.rawMaterialLotAttr.findUnique({ where: { lotId_attrId: { lotId: l.id, attrId: ids[code] } } }).catch(() => null);
    if (has) { cnt.already++; continue; }
    cnt[code]++; qty[code] += l.recv;
    if (write) await prisma.rawMaterialLotAttr.create({ data: { lotId: l.id, attrId: ids[code], source } });
    j.links.push({ lotId: l.id, attrId: ids[code], lot: l.lotNumber, sex: code, source });
  }
  console.log(`лотов норки ${lots.length}: самцов ${cnt.M} (${qty.M} шк.), самок ${cnt.F} (${qty.F} шк.), без пола ${cnt.none} (${qty.none} шк.), уже стояло ${cnt.already}`);
  if (write) {
    if (existsSync(JOURNAL)) throw new Error(`журнал ${JOURNAL} уже есть — сначала --rollback`);
    writeFileSync(JOURNAL, JSON.stringify(j, null, 1));
    console.log("ЗАПИСАНО, журнал", JOURNAL);
  }
  process.exit(0);
})();
