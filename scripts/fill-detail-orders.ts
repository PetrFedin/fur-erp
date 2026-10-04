/**
 * Дозаполнение деталей ТЗ (ProductionOrder) и моделей (ProductModel) из документов.
 * Пустые поля заполняются; существующие значения НЕ перезаписываются.
 *
 *  1. ProductModel.description — розничное описание и каталожная категория из единого реестра
 *     (21-08 ЕДИНЫЙ_РЕЕСТР_ПО_МЕХУ_MVST 2.xlsx, лист «Реестр (единый)», колонки «название для каталога» и
 *     «Товары для женщин / Одежда / …»); данные предвыгружены в scripts/registry_product_info.json.
 *  2. ProductionOrder color/lining/materialDescription из приложений ТЗ (extract/prod*.json): только однозначные
 *     значения (без «разн.», «версии расходятся», дробей «беж./корич.»).
 *  3. Партия 8: цвет и мех по «расчёт пошива 8 партии.xlsx» (Drive 12EQLSCDGMV-m8tz8QTbXZ7lovE-Tn8_m,
 *     расчёт доплаты 26.01.2026) для ТЗ 88 (MGL01/MGL03/MGL02).
 *
 *   node --env-file=.env node_modules/.bin/tsx scripts/fill-detail-orders.ts            # пробный прогон
 *   node --env-file=.env node_modules/.bin/tsx scripts/fill-detail-orders.ts --apply    # применить (после scripts/backup.sh)
 *   node --env-file=.env node_modules/.bin/tsx scripts/fill-detail-orders.ts --rollback # откат по журналу
 *
 * Журнал: docs-inventory/corrections-journal-detail-orders.json
 */
import { join } from "path";
import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";
import { INV, readJson, writeJson, ROOT } from "./detail-common";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
const JOURNAL = join(INV, "corrections-journal-detail-orders.json");

type Change = {
  entity: "ProductionOrder" | "ProductModel";
  id: string;
  ref: string;
  field: string;
  old: string | null;
  new: string;
  source: string;
};

const CYR = "АВЕКМНОРСТХ";
const LAT = "ABEKMHOPCTX";
const nm = (s: string) =>
  s.toUpperCase().split("").map((c) => (CYR.includes(c) ? LAT[CYR.indexOf(c)] : c)).join("").replace(/O/g, "0").replace(/[^A-Z0-9]/g, "");

const AMBIG = /разн|версии|\/|\bили\b|^-$/i;
const ok = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0 && !AMBIG.test(v);

// Партия 8, расчёт доплаты за пошив 26.01.2026 (прочитан в Drive): ТЗ 88 по моделям.
const BATCH8_SRC = "«расчет пошива 8 партии.xlsx» (Drive 12EQLSCDGMV-m8tz8QTbXZ7lovE-Tn8_m), партия 8, расчёт доплаты 26.01.2026";
const BATCH8: Record<string, { color: string; material: string }> = {
  MGL01: { color: "бежевый", material: "соболь 2/1 норка 1/1" },
  MGL03: { color: "коричневый", material: "соболь норка" },
  MGL02: { color: "коричневый", material: "норка браун кашемир" }, // пустые поля у «браун»-варианта
};

async function rollback() {
  const j = readJson<{ changes: Change[] }>(JOURNAL, { changes: [] });
  let done = 0;
  let skipped = 0;
  for (const c of j.changes) {
    const cur: any =
      c.entity === "ProductionOrder"
        ? await prisma.productionOrder.findUnique({ where: { id: c.id } })
        : await prisma.productModel.findUnique({ where: { id: c.id } });
    if (!cur || cur[c.field] !== c.new) { skipped++; continue; }
    if (c.entity === "ProductionOrder") await prisma.productionOrder.update({ where: { id: c.id }, data: { [c.field]: c.old } });
    else await prisma.productModel.update({ where: { id: c.id }, data: { [c.field]: c.old } });
    done++;
  }
  writeJson(JOURNAL, { ...j, changes: [], rolledBackAt: new Date().toISOString(), rolledBackCount: done });
  console.log(`Откат: восстановлено ${done}, пропущено ${skipped}.`);
}

async function main() {
  if (ROLLBACK) return rollback();
  const org = await prisma.organization.findFirstOrThrow();
  const changes: Change[] = [];

  // 1. Модели
  const info = readJson<Record<string, { retailName: string | null; catalog: string | null; sourceFile: string; registryRows: number[] }>>(
    join(ROOT, "scripts", "registry_product_info.json"),
    {}
  );
  const models = await prisma.productModel.findMany({ where: { organizationId: org.id } });
  for (const m of models) {
    const i = info[nm(m.name)];
    if (!i || m.description) continue;
    const parts = [i.retailName, i.catalog ? `Каталог: ${i.catalog}` : null].filter((x): x is string => typeof x === "string" && x.length > 0);
    if (!parts.length) continue;
    changes.push({
      entity: "ProductModel",
      id: m.id,
      ref: m.name,
      field: "description",
      old: null,
      new: parts.join("\n"),
      source: `${i.sourceFile}, строки ${i.registryRows.join(", ")}`,
    });
  }

  // 2. ТЗ из приложений
  const W = new Map<string, Array<{ doc: string; w: any }>>();
  for (const f of ["prod2025a", "prod2025b", "prod2026"]) {
    const d = JSON.parse(readFileSync(join(INV, "extract", `${f}.json`), "utf-8"));
    for (const doc of Array.isArray(d) ? d : d.documents) {
      if (!/^(приложение|ТЗ)/i.test(String(doc.docType))) continue;
      for (const w of doc.workOrders ?? []) if (w.tzNumber != null) W.set(String(w.tzNumber), [...(W.get(String(w.tzNumber)) ?? []), { doc: doc.title, w }]);
    }
  }
  const orders = await prisma.productionOrder.findMany({ where: { organizationId: org.id }, include: { productModel: true, batch: true } });
  for (const o of orders) {
    const ws = (W.get(o.workOrderNumber ?? "") ?? []).filter((x) => nm(String(x.w.model ?? "").split("/")[0]) === nm(o.productModel.name) || !String(x.w.model ?? "").includes("/") && nm(String(x.w.model)) === nm(o.productModel.name));
    if (ws.length) {
      const colors = new Set(ws.map((x) => x.w.color).filter(ok).map((c: string) => c.trim()));
      if (!o.color && colors.size === 1) changes.push({ entity: "ProductionOrder", id: o.id, ref: `${o.number} (ТЗ ${o.workOrderNumber})`, field: "color", old: null, new: [...colors][0], source: `приложение ТЗ: ${ws[0].doc}` });
      const linings = new Set(
        ws
          .map((x) => x.w.lining)
          .filter(Boolean)
          .map((l: any) => (typeof l === "string" ? l : l.name ?? l.composition))
          .filter(ok)
          .map((s: string) => s.trim())
      );
      if (!o.lining && linings.size === 1) changes.push({ entity: "ProductionOrder", id: o.id, ref: `${o.number} (ТЗ ${o.workOrderNumber})`, field: "lining", old: null, new: [...linings][0], source: `приложение ТЗ: ${ws[0].doc}` });
    }
    // 3. партия 8, ТЗ 88
    if (o.batch?.number === 8 && o.workOrderNumber === "88") {
      const b = BATCH8[o.productModel.name.toUpperCase()];
      if (b) {
        if (!o.color) changes.push({ entity: "ProductionOrder", id: o.id, ref: `${o.number} (ТЗ 88)`, field: "color", old: null, new: b.color, source: BATCH8_SRC });
        if (!o.materialDescription && !(o.productModel.name === "MGL02" && o.color === "пастель"))
          changes.push({ entity: "ProductionOrder", id: o.id, ref: `${o.number} (ТЗ 88)`, field: "materialDescription", old: null, new: b.material, source: BATCH8_SRC });
      }
    }
  }
  // ТЗ 80 (М016 норка белая вельвет): мех из названия приложения, подкладка — из приложения (ветка выше), здесь только описание
  for (const o of orders) {
    if (o.workOrderNumber === "80" && !o.materialDescription)
      changes.push({
        entity: "ProductionOrder",
        id: o.id,
        ref: `${o.number} (ТЗ 80)`,
        field: "materialDescription",
        old: null,
        new: "норка белая вельвет",
        source: "название приложения «ПРИЛОЖЕНИЕ 80 (М016 норка белая вельвет 6 шт).docx»",
      });
  }

  const byField: Record<string, number> = {};
  for (const c of changes) byField[`${c.entity}.${c.field}`] = (byField[`${c.entity}.${c.field}`] ?? 0) + 1;
  console.log(APPLY ? "== APPLY ==" : "== DRY-RUN (ничего не записано) ==");
  console.log("Изменений:", changes.length, byField);
  for (const c of changes.slice(0, 40)) console.log(`  ${c.entity} ${c.ref} ${c.field}: «${c.new.slice(0, 80).replace(/\n/g, " | ")}»`);
  if (!APPLY) return;

  const prev = readJson<{ changes: Change[] }>(JOURNAL, { changes: [] });
  const applied: Change[] = [];
  for (const c of changes) {
    if (c.entity === "ProductionOrder") await prisma.productionOrder.update({ where: { id: c.id }, data: { [c.field]: c.new } });
    else await prisma.productModel.update({ where: { id: c.id }, data: { [c.field]: c.new } });
    applied.push(c);
    writeJson(JOURNAL, { script: "fill-detail-orders.ts", changes: [...prev.changes, ...applied] });
  }
  writeJson(JOURNAL, { script: "fill-detail-orders.ts", appliedAt: new Date().toISOString(), summary: byField, changes: [...prev.changes, ...applied] });
  console.log(`Применено ${applied.length}. Журнал: ${JOURNAL}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
