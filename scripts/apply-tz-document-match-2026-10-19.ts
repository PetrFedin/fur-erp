/**
 * Сведение себестоимости ТЗ с итогом Word-ТЗ (Приложение к договору подряда №1605) — ПРЕДЛОЖЕНИЕ от 19.10.2026, НЕ ПРИМЕНЕНО.
 *
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-tz-document-match-2026-10-19.ts                      # пробный прогон (БД не меняется)
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-tz-document-match-2026-10-19.ts --apply              # применить на НЕ боевой базе (копия, scratch)
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-tz-document-match-2026-10-19.ts --apply --live       # применить на боевой базе fur_erp (сам делает scripts/backup.sh; --no-backup — без копии)
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-tz-document-match-2026-10-19.ts --rollback [--apply [--live]]
 *   доп. ключи: --only=172,171 (только эти ТЗ), --rounding (ещё и ярус B: округление документа ≤ 100 ₽ у ТЗ с НДС 20%)
 *
 * ПРИЧИНА (проверена построчно по Word-ТЗ 116, 141, 169–183 и по итогам остальных Приложений): в Приложениях, выпущенных с 22% НДС, цена каждой строки сырья =
 * (цена лота БЕЗ НДС) × 1,04 (наша надбавка уже вписана в цену документа) × 1,22. В системе строка = количество × цена лота С НДС лота; у лотов 2025 г. ставка 20%,
 * поэтому строка в системе меньше документа ровно в 1,22/1,20 раза (+1,667%). Параметр «ставка НДС строки» в ТЗ сумму не меняет (сумма с НДС фиксирована,
 * меняется только разбивка), поэтому «поставить НДС ТЗ 22%» итог не поднимет.
 *
 * СПОСОБ: строки списаний, ЛОТЫ, закупки и остатки НЕ трогаем (иначе ломается тождество «куплено = использовано + остаток», проверка 4 в test-reconciliation).
 * Разницу ведём отдельной строкой доп. расхода ТЗ (как уже сделано для ТЗ 178 «Доп. материалы по приложению 178»):
 *   • «Корректировка по документу ТЗ» = (итог документа) − (система без этой строки) − (доп. материалы из документа). По построчной сверке это 1/60 от суммы строк на лотах 20%
 *     с надбавкой 4% плюс округление цены за единицу в самом документе (допуск проверяется ≤ 200 ₽);
 *   • «Доп. материалы» — только там, где в документе есть строка «стоимость продукции за ед.» (ТЗ 122 и 131), а в системе её нет.
 * После записи: сумма «Полная себестоимость (с работой) — с НДС, с 4%» ТЗ в системе = «составляет … руб.» документа (допуск 1 ₽).
 * Для завершённых ТЗ пересчитывается снимок ТЗ (materialCost/expenseCost/totalCost/unitCost) и оценка склада ГП — так же, как syncCompletedOrderCost при правке расхода в карточке.
 * Подтверждение (verifiedAt) у изменённых ТЗ и их партий снимается — как делает приложение при правке расхода; прежние значения лежат в журнале и возвращаются откатом.
 */
import Module from "module";
import { join } from "path";
import { execSync } from "child_process";
import { Decimal } from "@prisma/client/runtime/library";
import type { Prisma } from "@prisma/client";
const M = Module as unknown as { _resolveFilename: (...a: unknown[]) => string };
const orig = M._resolveFilename;
M._resolveFilename = function (this: unknown, req: unknown, ...rest: unknown[]) {
  if (req === "server-only") return join(__dirname, "stubs", "empty.js");
  return orig.call(this, req, ...rest);
};

const APPLY = process.argv.includes("--apply");
const LIVE = process.argv.includes("--live");
const ROLLBACK = process.argv.includes("--rollback");
const NO_BACKUP = process.argv.includes("--no-backup");
const ROUNDING = process.argv.includes("--rounding");
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) ?? "").slice(7).split(",").map((s) => s.trim()).filter(Boolean);
const TAG = "[tz-doc-match:2026-10-19]";
const CAT_ADJ = "Корректировка по документу ТЗ";
const MAX_RESID = 200; // ₽: больше — это не «НДС + округление», а другая причина (лот, количество, работа): ТЗ пропускается и идёт владельцу на решение
const TOL = 1; // ₽

// Ярус A: Приложение с НДС 22% по всем строкам, лоты в системе 20%. ref — «Общая стоимость настоящего ТЗ составляет … руб.».
const TIER_A: Record<string, { ref: number; src: string; extras?: { perUnit: number; qty: number; cat: string; desc: string }[] }> = {
  "70": { ref: 786722.04, src: "ПРИЛОЖЕНИЕ 70 (MH03)+4% - 22%.docx" },
  "71": { ref: 804383.44, src: "ПРИЛОЖЕНИЕ 71 (MH03 торторо+пастель)+4%.docx" },
  "72": { ref: 28118.26, src: "ПРИЛОЖЕНИЕ 72 (MH05 чалма браун)+4%.docx" },
  "73": { ref: 44725.52, src: "ПРИЛОЖЕНИЕ 73 (MH06 ободок)+4%.docx" },
  "74": { ref: 61553.64, src: "ПРИЛОЖЕНИЕ 74 (MH15 бейсболка)+4%.docx" },
  "76": { ref: 1391493.0, src: "ПРИЛОЖЕНИЕ 76 (MH01 соболь) +4%.docx" },
  "77": { ref: 17987.75, src: "ПРИЛОЖЕНИЕ 77 (MH17 норка)+4%.docx" },
  "78": { ref: 757116.09, src: "ПРИЛОЖЕНИЕ 78 (М022 каракульча)+4% - 22%.docx" },
  "80": { ref: 1396326.0, src: "ПРИЛОЖЕНИЕ 80 (М016 норка белая вельвет 6 шт) +4%.docx" },
  "81": { ref: 889286.0, src: "ПРИЛОЖЕНИЕ 81 (М015 норка белая вельвет 2 шт)+4%.docx" },
  "82": { ref: 4623948.0, src: "ПРИЛОЖЕНИЕ 82 (М001А - соболь торторо 2 шт. )+4%.docx" },
  "83": { ref: 1065169.9, src: "ПРИЛОЖЕНИЕ 83 (М0005-соболь 1 шт.)+4%.docx" },
  "84": { ref: 2253842.7, src: "ПРИЛОЖЕНИЕ 84 (М001А - соболь торторо 1 шт. )+4%.docx" },
  "85": { ref: 444639.84, src: "ПРИЛОЖЕНИЕ 85 (М015 норка белая вельвет 1 шт) 4% НДС 22%.docx" },
  "86": { ref: 497716.35, src: "ПРИЛОЖЕНИЕ 86 (М022 каракульча)+4% НДС 22%.docx" },
  "87": { ref: 2424207.0, src: "ПРИЛОЖЕНИЕ 87 (MSC-01 шарфы соболь) - 5 шт +4% НДС 22%.docx" },
  "88": { ref: 1196058.21, src: "ПРИЛОЖЕНИЕ 88 (варежки)+4% НДС 22%.docx" },
  "89": { ref: 61553.64, src: "ПРИЛОЖЕНИЕ 89 (MH15 бейсболка) 3 шт + 4 % YLC 22%.docx" },
  "98": { ref: 578338.71, src: "ПРИЛОЖЕНИЕ 98 (МН09 соболь 10 шт) 4%.docx" },
  "99": { ref: 53963.26, src: "ПРИЛОЖЕНИЕ 99 (МН17 норка 3 шт.)4%.docx" },
  "100": { ref: 91427.0, src: "ПРИЛОЖЕНИЕ 100 (варежки) 4%.docx" },
  "101": { ref: 2356369.63, src: "ПРИЛОЖЕНИЕ 101 (MSC-01 шарфы соболь-5шт)+4%.docx" },
  "102": { ref: 48814.34, src: "ПРИЛОЖЕНИЕ 102 (MSC-01 шарф норка пастель-1 шт)+4%.docx" },
  "103": { ref: 125914.27, src: "ПРИЛОЖЕНИЕ 103 (МН17 норка 7 шт.)+4%.docx" },
  "105": { ref: 18285.4, src: "ПРИЛОЖЕНИЕ 105 (MGL01 варежки 1 шт)+4%.docx" },
  "106": { ref: 439329.0, src: "ПРИЛОЖЕНИЕ 106 (MSC-01 шарф норка пастель-9 шт)+4%.docx" },
  "107": { ref: 564938.11, src: "ПРИЛОЖЕНИЕ 107 (MSC-01 шарф норка жемчуг-12 шт)+4%.docx" },
  "108": { ref: 701618.84, src: "ПРИЛОЖЕНИЕ 108 (MSC-01 шарф норка блэкглама 16 шт)+4%.docx" },
  "109": { ref: 442466.53, src: "ПРИЛОЖЕНИЕ 109 (MSC-01 шарф норка ирис 10 шт)+4%.docx" },
  "110": { ref: 2573253.78, src: "ПРИЛОЖЕНИЕ 110 (М003 соболь 1 изд)+4%.docx" },
  "113": { ref: 377058.67, src: "ПРИЛОЖЕНИЕ 113 (MH16 - 4 шт.).docx" },
  "114": { ref: 414268.47, src: "ПРИЛОЖЕНИЕ 114 (MH16 - 2 шт.).docx" },
  "115": { ref: 231684.05, src: "ПРИЛОЖЕНИЕ 115 (MH11 - 8 шт.).docx" },
  "117": { ref: 4026885.28, src: "ПРИЛОЖЕНИЕ 117 (М057- 1 шт).docx" },
  "118": { ref: 817487.4, src: "ПРИЛОЖЕНИЕ 118 (4 шт. аксессуары).docx" },
  "119": { ref: 4549282.35, src: "ПРИЛОЖЕНИЕ 119 (М025 виолет)+.docx" },
  "120": { ref: 1160322.67, src: "ПРИЛОЖЕНИЕ 120 (М056 перл)+.docx" },
  "122": { ref: 280139.82, src: "ПРИЛОЖЕНИЕ 122 (MSC03 белая косынка)+.docx", extras: [{"perUnit": 4080, "qty": 5, "cat": "Доп. материалы", "desc": "Дополнительные материалы по приложению 122: 4 080 ₽ за единицу × 5 шт., с НДС 22 %"}] },
  "123": { ref: 1171030.71, src: "ПРИЛОЖЕНИЕ 123 (М041 черная норка)+.docx" },
  "124": { ref: 1176768.0, src: "ПРИЛОЖЕНИЕ 124 (М001Е - арк.лиса)+.docx" },
  "125": { ref: 6178219.29, src: "ПРИЛОЖЕНИЕ 125 (М002 - 2 соболя)+.docx" },
  "126": { ref: 895962.52, src: "ПРИЛОЖЕНИЕ 126 (МSC04 - 7 шарфов пастель)+.docx" },
  "127": { ref: 341556.89, src: "ПРИЛОЖЕНИЕ 127 (М012 - 2 манишки)+.docx" },
  "128": { ref: 1684840.39, src: "ПРИЛОЖЕНИЕ 128 (М052 - 6 шуб из лис)+.docx" },
  "129": { ref: 273586.94, src: "ПРИЛОЖЕНИЕ 129 (МSC03 - 4 косынки виолет)+.docx" },
  "131": { ref: 281065.0, src: "ПРИЛОЖЕНИЕ 131 (МSC06 -5 шарфов лиса арктик)+.docx", extras: [{"perUnit": 1337, "qty": 5, "cat": "Доп. материалы", "desc": "Дополнительные материалы по приложению 131: 1 337 ₽ за единицу × 5 шт., с НДС 22 %"}] },
  "132": { ref: 4340861.18, src: "ПРИЛОЖЕНИЕ 132 (М049 -1 соболь)+.docx" },
  "133": { ref: 3846214.0, src: "ПРИЛОЖЕНИЕ 133 (М001А -1 соболь)+.docx" },
  "134": { ref: 1017635.48, src: "ПРИЛОЖЕНИЕ 134 (2 вяз.соболь капюш)+.docx" },
  "135": { ref: 94264.67, src: "ПРИЛОЖЕНИЕ 135 (MH16 - 1 соболь)+.docx" },
  "137": { ref: 3228746.14, src: "ПРИЛОЖЕНИЕ 137 (М045 - 10 шт.) перл+.docx" },
  "138": { ref: 656704.23, src: "ПРИЛОЖЕНИЕ 138 (М009 браун - 2 шт.)+.docx" },
  "140": { ref: 6432834.99, src: "ПРИЛОЖЕНИЕ 140 (М002А соболь - 1 шт.)+.docx" },
  "141": { ref: 8590908.97, src: "ПРИЛОЖЕНИЕ 141 (М001К соболь - 2 шт.)+.docx" },
  "143": { ref: 2731839.05, src: "ПРИЛОЖЕНИЕ 143 (М050 - 1 шт)+.docx" },
  "145": { ref: 1081753.98, src: "ПРИЛОЖЕНИЕ 145 (М012 - 1 шт)+.docx" },
  "148": { ref: 352337.67, src: "ПРИЛОЖЕНИЕ 148 (М031 - 1 шт) каракуль+.docx" },
  "149": { ref: 773548.45, src: "ПРИЛОЖЕНИЕ 149 (М056 - 2 шт) норка жемчуг+.docx" },
  "150": { ref: 632439.65, src: "ПРИЛОЖЕНИЕ 150 (М026 - 1 шт) норка белая +.docx" },
  "152": { ref: 9567478.96, src: "ПРИЛОЖЕНИЕ 152 (М002А соболь - 1 шт.) ТОП.docx" },
  "153": { ref: 647978.31, src: "ПРИЛОЖЕНИЕ 153 (М012 - 4 манишки браун).docx" },
  "160": { ref: 789601.62, src: "ПРИЛОЖЕНИЕ 160 (МН-03 норка+соболь - 8 шт).docx" },
  "161": { ref: 152244.39, src: "ПРИЛОЖЕНИЕ 161 (МН-05 норка жемчуг - 10 шт).docx" },
  "164": { ref: 508817.74, src: "ПРИЛОЖЕНИЕ 164 (MSC05 1 вяз.соболь капюш).docx" },
  "166": { ref: 386774.22, src: "ПРИЛОЖЕНИЕ 1166 (М056 - 1 шт) норка жемчуг.docx" },
  "169": { ref: 392256.0, src: "ПРИЛОЖЕНИЕ 169 (М001Е - арк.лиса).docx" },
  "171": { ref: 1953441.89, src: "ПРИЛОЖЕНИЕ 171 (М023 - 1 шт).docx" },
  "172": { ref: 3812374.22, src: "ПРИЛОЖЕНИЕ 172 (М002 - 1 собол).docx" },
  "174": { ref: 2548367.3, src: "ПРИЛОЖЕНИЕ_174_М026_4_шт_норка_белая.docx" },
  "182": { ref: 577337.6, src: "ПРИЛОЖЕНИЕ 182 (МН06-МН07 - 46 шт).docx" },
  "183": { ref: 508817.74, src: "ПРИЛОЖЕНИЕ_183_MSC05_1_вяз_соболь_капюш.docx" },
};

// Ярус B (только с --rounding): Приложение с НДС 20%, итог округлён до рубля за единицу; разница ≤ 100 ₽.
const TIER_B: Record<string, { ref: number; src: string; extras?: { perUnit: number; qty: number; cat: string; desc: string }[] }> = {
  "3": { ref: 1284319.58, src: "ПРИЛОЖЕНИЕ 3 (1 соболь М003)+4%.docx" },
  "6": { ref: 355262.3, src: "ПРИЛОЖЕНИЕ 6 (1 норка М010)+4%.docx" },
  "7": { ref: 579241.76, src: "ПРИЛОЖЕНИЕ 7 (1 норка М011)+4%.docx" },
  "10": { ref: 536643.56, src: "ПРИЛОЖЕНИЕ 10 (1 свакара 020)+4%.docx" },
  "11": { ref: 640277.67, src: "ПРИЛОЖЕНИЕ 11 (4 манишки ирис М012)+4%.docx" },
  "12": { ref: 793680.04, src: "ПРИЛОЖЕНИЕ 12 (5 манишки блекглама М012)+4%.docx" },
  "13": { ref: 828533.8, src: "ПРИЛОЖЕНИЕ 13 (4 манишки лаванда М012)+4%.docx" },
  "14": { ref: 1777975.53, src: "ПРИЛОЖЕНИЕ 14 (5 юбка свакара коричневая М019)+4%.docx" },
  "15": { ref: 2830058.12, src: "ПРИЛОЖЕНИЕ 15 (6 жакет свакара коричневая М018)+4%.docx" },
  "16": { ref: 488654.28, src: "ПРИЛОЖЕНИЕ 16 (1 жакет свакара нуга М018)+4%.docx" },
  "17": { ref: 2249993.56, src: "ПРИЛОЖЕНИЕ 17 (3 жакет свакара облако М021)+4%.docx" },
  "18": { ref: 765822.5, src: "ПРИЛОЖЕНИЕ 18 (1 пальто свакара фондю М021)+4%.docx" },
  "19": { ref: 845189.43, src: "ПРИЛОЖЕНИЕ 19 (манишки 2 ирис 2 блекглама 1 лаванда М012) +4% — копия.docx" },
  "20": { ref: 4809308.79, src: "ПРИЛОЖЕНИЕ 20 (swakara 8 изд) +4 %.docx" },
  "22": { ref: 2662736.44, src: "ПРИЛОЖЕНИЕ 22 (7 изд. из норки)+4%.docx" },
  "23": { ref: 1317138.0, src: "ПРИЛОЖЕНИЕ 23 (соболь 1 изд) +4%.docx" },
  "24": { ref: 3771063.05, src: "ПРИЛОЖЕНИЕ 24 (6 изд. из свакара)+4%.docx" },
  "25": { ref: 762733.7, src: "ПРИЛОЖЕНИЕ 25 (1 жакет свакара облако М021) +4%.docx" },
  "28": { ref: 1110696.52, src: "ПРИЛОЖЕНИЕ 28 (норка фигурная стрижка) +4%.docx" },
  "30": { ref: 355262.3, src: "ПРИЛОЖЕНИЕ 30 (М010 -  1 ед. норка) +4%.docx" },
  "31": { ref: 1685540.7, src: "ПРИЛОЖЕНИЕ 31 (М010 -  4 ед. норки пастель)+4%.docx" },
  "32": { ref: 1348600.03, src: "ПРИЛОЖЕНИЕ 32 (020-свакара 3 изд) + 4%.docx" },
  "33": { ref: 561983.17, src: "ПРИЛОЖЕНИЕ 33 (М016 изд 3 шт.-1)+4%.docx" },
  "34": { ref: 1114803.54, src: "ПРИЛОЖЕНИЕ 34 (М11 - 2 изд) +4%.docx" },
  "35": { ref: 2019790.23, src: "ПРИЛОЖЕНИЕ 35 (М009  - 4 изд) +4%.docx" },
  "36": { ref: 2097390.75, src: "ПРИЛОЖЕНИЕ 36 (М009  - 6 изд. )+4%.docx" },
  "49": { ref: 1567291.9, src: "ПРИЛОЖЕНИЕ 49 (MSC-01 шарфы соболь)+4%.docx" },
  "50": { ref: 187327.73, src: "ПРИЛОЖЕНИЕ 50 (М016  - 1 ед.) +4%.docx" },
  "64": { ref: 65502.0, src: "ПРИЛОЖЕНИЕ 64 (MH06 ирис).docx" },
};

const rub = (v: Decimal.Value) => new Decimal(v).toDecimalPlaces(2).toNumber().toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const D = (v: Decimal.Value) => new Decimal(v);
const RATE4 = new Decimal("0.04");
const K22 = new Decimal(1.22).div(1.2).sub(1); // 1/60

type Journal = {
  script: string; status: "applied" | "rolled-back"; at: string; db: string;
  createdExpenses: { id: string; orderId: string; tz: string; amount: string }[];
  createdCategoryId: string | null;
  orders: { id: string; tz: string; old: { materialCost: string | null; expenseCost: string | null; totalCost: string | null; unitCost: string | null; verifiedAt: string | null; verifiedBy: string | null; verifyNote: string | null } }[];
  batches: { id: string; old: { verifiedAt: string | null; verifiedBy: string | null; verifyNote: string | null } }[];
  stock: { id: string; oldAvgUnitCost: string }[];
  movements: { id: string }[];
};

async function main() {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const { INV, readJson, writeJson } = await import("./detail-common");
  const { fullFinishedCost, orderStockContribution, FG_FULL_COST_NOTE } = await import("../src/lib/finished-goods-cost");
  const url = process.env.DATABASE_URL ?? "";
  const dbName = url.split("?")[0].split("/").pop() ?? "";
  const isLive = dbName === "fur_erp";
  if (APPLY && isLive && !LIVE) throw new Error(`База «${dbName}» боевая: для записи нужен --live (для репетиции укажите копию через DATABASE_URL).`);
  if (APPLY && !isLive && LIVE) throw new Error(`--live указан, но DATABASE_URL смотрит на «${dbName}», а не на fur_erp.`);
  const prisma = createAuditedClient("script:apply-tz-document-match-2026-10-19");
  const JOURNAL = join(INV, `corrections-journal-tz-document-match-2026-10-19${isLive ? "" : `-${dbName}`}.json`);
  const org = (await prisma.organization.findFirst({ select: { id: true } }))!.id;

  if (ROLLBACK) {
    const j = readJson<Journal | null>(JOURNAL, null);
    if (!j || j.status !== "applied") { console.log("Журнал пуст или уже откачен — откатывать нечего."); await prisma.$disconnect(); return; }
    console.log(`Откат (${dbName}): расходов ${j.createdExpenses.length}, ТЗ ${j.orders.length}, партий ${j.batches.length}, склад ГП ${j.stock.length}, движений ${j.movements.length}${APPLY ? "" : " (пробный — добавьте --apply)"}`);
    if (APPLY) {
      await prisma.$transaction(async (tx) => {
        await tx.finishedGoodsMovement.deleteMany({ where: { id: { in: j.movements.map((x) => x.id) } } });
        // один остаток склада мог меняться несколькими ТЗ подряд: возвращаем значение ДО первой правки (первая запись журнала)
        const firstAvg = new Map<string, string>();
        for (const s of j.stock) if (!firstAvg.has(s.id)) firstAvg.set(s.id, s.oldAvgUnitCost);
        for (const [id, avg] of firstAvg) await tx.finishedGoodsStock.update({ where: { id }, data: { avgUnitCost: avg } });
        await tx.productionExpense.deleteMany({ where: { id: { in: j.createdExpenses.map((x) => x.id) } } });
        for (const o of j.orders) {
          await tx.productionOrder.update({
            where: { id: o.id },
            data: { materialCost: o.old.materialCost, expenseCost: o.old.expenseCost, totalCost: o.old.totalCost, unitCost: o.old.unitCost, verifiedAt: o.old.verifiedAt ? new Date(o.old.verifiedAt) : null, verifiedBy: o.old.verifiedBy, verifyNote: o.old.verifyNote },
          });
        }
        for (const b of j.batches) await tx.productionBatch.update({ where: { id: b.id }, data: { verifiedAt: b.old.verifiedAt ? new Date(b.old.verifiedAt) : null, verifiedBy: b.old.verifiedBy, verifyNote: b.old.verifyNote } });
        if (j.createdCategoryId) {
          const used = await tx.productionExpense.count({ where: { categoryId: j.createdCategoryId } });
          if (used === 0) await tx.expenseCategory.delete({ where: { id: j.createdCategoryId } });
        }
      }, { timeout: 120000, maxWait: 15000 });
      writeJson(JOURNAL, { ...j, status: "rolled-back", at: new Date().toISOString() });
      console.log("Откат выполнен.");
    }
    await prisma.$disconnect();
    return;
  }

  const targets: Record<string, { ref: number; src: string; extras?: { perUnit: number; qty: number; cat: string; desc: string }[]; tier: "A" | "B" }> = {};
  for (const [k, v] of Object.entries(TIER_A)) targets[k] = { ...v, tier: "A" };
  if (ROUNDING) for (const [k, v] of Object.entries(TIER_B)) targets[k] = { ...v, tier: "B" };
  const tzs = Object.keys(targets).filter((k) => !ONLY.length || ONLY.includes(k)).sort((a, b) => Number(a) - Number(b));

  const orders = await prisma.productionOrder.findMany({
    where: { organizationId: org, workOrderNumber: { in: tzs }, status: { not: "CANCELLED" } },
    select: {
      id: true, number: true, workOrderNumber: true, status: true, plannedQuantity: true, producedQuantity: true, clientWorkPricePerUnit: true, workOrderDate: true, createdAt: true,
      batchId: true, verifiedAt: true, verifiedBy: true, verifyNote: true, materialCost: true, expenseCost: true, totalCost: true, unitCost: true,
      finishedWarehouseId: true, productModelId: true, productModel: { select: { name: true } },
      materialUsages: { select: { id: true, totalCost: true, commission4: true, vatRate: true, quantity: true, lot: { select: { lotNumber: true, vatRate: true } } } },
      expenses: { select: { id: true, amount: true, description: true, category: { select: { name: true } } } },
    },
  });

  type Plan = {
    tz: string; ref: number; src: string; tier: "A" | "B";
    orders: typeof orders; sysBase: Decimal; uplift: Decimal; extras: Decimal; remaining: Decimal; resid: Decimal;
    lineLog: string[]; rows: { orderId: string; cat: string; amount: Decimal; desc: string }[]; problem: string | null; existing: { id: string; orderId: string; amount: Decimal; desc: string }[];
  };
  const plans: Plan[] = [];
  for (const tz of tzs) {
    const t = targets[tz];
    const os = orders.filter((o) => o.workOrderNumber === tz);
    const p: Plan = { tz, ref: t.ref, src: t.src, tier: t.tier, orders: os, sysBase: D(0), uplift: D(0), extras: D(0), remaining: D(0), resid: D(0), lineLog: [], rows: [], problem: null, existing: [] };
    plans.push(p);
    if (os.length === 0) { p.problem = "ТЗ не найдено в базе"; continue; }
    const upByOrder = new Map<string, Decimal>();
    for (const o of os) {
      const units = o.status === "COMPLETED" ? o.producedQuantity : o.plannedQuantity;
      let sum = D(0);
      for (const u of o.materialUsages) {
        const line = u.commission4 ? D(u.totalCost).mul(D(1).add(RATE4)) : D(u.totalCost);
        sum = sum.add(line);
        if (t.tier === "A" && u.vatRate == null && D(u.lot.vatRate).eq(20)) {
          const up = line.mul(K22);
          upByOrder.set(o.id, (upByOrder.get(o.id) ?? D(0)).add(up));
          p.uplift = p.uplift.add(up);
          p.lineLog.push(`    ${o.number} лот ${u.lot.lotNumber ?? "(подкладка)"}: ${rub(line)} → ${rub(line.add(up))} (+${rub(up)})`);
        }
      }
      for (const e of o.expenses) {
        if (e.description?.startsWith(TAG)) p.existing.push({ id: e.id, orderId: o.id, amount: D(e.amount), desc: e.description });
        else sum = sum.add(e.amount);
      }
      if (o.clientWorkPricePerUnit != null) sum = sum.add(D(o.clientWorkPricePerUnit).mul(units));
      p.sysBase = p.sysBase.add(sum);
    }
    // доп. материалы из документа — на первую позицию ТЗ
    const ex = t.extras ?? [];
    for (const e of ex) {
      const amt = D(e.perUnit).mul(e.qty);
      p.extras = p.extras.add(amt);
      p.rows.push({ orderId: os[0].id, cat: e.cat, amount: amt, desc: `${TAG} ${e.desc}` });
    }
    p.remaining = D(t.ref).sub(p.sysBase).sub(p.extras);
    p.resid = p.remaining.sub(p.uplift);
    if (p.resid.abs().gt(MAX_RESID)) { p.problem = `остаток после НДС 22% и доп. материалов ${rub(p.resid)} ₽ больше допуска ${MAX_RESID} ₽ — другая причина, не правлю`; p.rows = []; continue; }
    if (p.remaining.abs().gt(TOL)) {
      // разносим по позициям пропорционально их доле НДС-эффекта; остаток округления — на позицию с наибольшей долей
      const parts = os.map((o) => ({ o, w: upByOrder.get(o.id) ?? D(0) }));
      const totalW = parts.reduce((s, x) => s.add(x.w), D(0));
      let left = p.remaining;
      const sorted = [...parts].sort((a, b) => b.w.comparedTo(a.w));
      sorted.forEach((x, i) => {
        const part = i === sorted.length - 1 || totalW.isZero() ? left : p.remaining.mul(x.w.div(totalW)).toDecimalPlaces(2);
        const v = i === 0 && totalW.isZero() ? p.remaining : part;
        if (totalW.isZero() && i > 0) return;
        left = left.sub(v);
        if (v.abs().lt(0.005)) return;
        p.rows.push({ orderId: x.o.id, cat: CAT_ADJ, amount: v.toDecimalPlaces(2), desc: `${TAG} ТЗ ${tz}: ${t.tier === "A" ? `НДС 22 % по документу вместо 20 % в лотах: +${rub(p.uplift)} ₽` : "округление цены за единицу в документе"}; округление документа ${rub(p.resid)} ₽; итог документа ${rub(t.ref)} ₽ (${t.src})` });
      });
    }
  }

  // ───────── вывод
  const out: string[] = [`# Сведение себестоимости ТЗ с Word-ТЗ — ${APPLY ? "ПРИМЕНЕНИЕ" : "пробный прогон"} (${new Date().toISOString()}), база «${dbName}»`, ""];
  let sumDelta = D(0), nChange = 0, nSkip = 0, nSame = 0;
  for (const p of plans) {
    const want = p.rows.reduce((s, r) => s.add(r.amount), D(0));
    const have = p.existing.reduce((s, r) => s.add(r.amount), D(0));
    const status = p.problem ? `ПРОПУСК: ${p.problem}` : p.existing.length && have.sub(want).abs().lt(0.01) && p.existing.length === p.rows.length ? "уже применено" : want.isZero() && !p.existing.length ? "совпадает (в пределах 1 ₽)" : "будет записано";
    out.push(`## ТЗ ${p.tz} (${p.orders.map((o) => o.productModel.name).join(", ")}) · ярус ${p.tier} · документ ${rub(p.ref)} · система без поправки ${rub(p.sysBase)} · Δ ${rub(D(p.ref).sub(p.sysBase))} — ${status}`);
    if (p.problem) { nSkip++; out.push(""); continue; }
    out.push(...p.lineLog);
    for (const r of p.rows) out.push(`    + расход «${r.cat}» ${p.orders.find((o) => o.id === r.orderId)?.number}: ${rub(r.amount)} ₽ — ${r.desc.slice(TAG.length + 1, TAG.length + 120)}…`);
    out.push(`    итого после: ${rub(p.sysBase.add(want))} ₽ (документ ${rub(p.ref)}; |Δ| = ${rub(D(p.ref).sub(p.sysBase).sub(want).abs())})`, "");
    if (status === "уже применено" || (want.isZero() && !p.existing.length)) nSame++; else { nChange++; sumDelta = sumDelta.add(want.sub(have)); }
  }
  out.push(`ИТОГО: ТЗ к изменению ${nChange}, без изменений ${nSame}, пропущено ${nSkip}; общий рост себестоимости ТЗ ${rub(sumDelta)} ₽`);
  console.log(out.join("\n"));
  if (!APPLY) { console.log("\nПробный прогон: БД не менялась. Для записи — --apply (копия) или --apply --live (боевая)."); await prisma.$disconnect(); return; }

  const prev = readJson<Journal | null>(JOURNAL, null);
  if (prev && prev.status === "applied") { console.log("Журнал уже содержит применённое сведение — повторно не применяю (сначала --rollback --apply)."); await prisma.$disconnect(); return; }
  if (isLive && !NO_BACKUP) { console.log("Копия базы перед применением: scripts/backup.sh …"); execSync("sh scripts/backup.sh", { stdio: "inherit" }); }

  const journal: Journal = { script: "apply-tz-document-match-2026-10-19.ts", status: "applied", at: new Date().toISOString(), db: dbName, createdExpenses: [], createdCategoryId: null, orders: [], batches: [], stock: [], movements: [] };
  await prisma.$transaction(async (tx) => {
    let adj = await tx.expenseCategory.findFirst({ where: { organizationId: org, name: CAT_ADJ, kind: "PRODUCTION" } });
    const mats = await tx.expenseCategory.findFirst({ where: { organizationId: org, name: "Доп. материалы", kind: "PRODUCTION" } });
    const changed = new Set<string>();
    for (const p of plans) {
      if (p.problem) continue;
      const want = p.rows.reduce((s, r) => s.add(r.amount), D(0));
      const have = p.existing.reduce((s, r) => s.add(r.amount), D(0));
      if (p.existing.length === p.rows.length && have.sub(want).abs().lt(0.01)) continue;
      // идемпотентность: прежние строки этого скрипта заменяем новыми (журнал фиксирует только созданные в этом запуске)
      if (p.existing.length) await tx.productionExpense.deleteMany({ where: { id: { in: p.existing.map((e) => e.id) } } });
      for (const r of p.rows) {
        let cat = r.cat === CAT_ADJ ? adj : mats;
        if (!cat && r.cat === CAT_ADJ) { adj = cat = await tx.expenseCategory.create({ data: { organizationId: org, name: CAT_ADJ, kind: "PRODUCTION" } }); journal.createdCategoryId = cat.id; }
        if (!cat) throw new Error(`Нет категории расходов «${r.cat}»`);
        const o = p.orders.find((x) => x.id === r.orderId)!;
        const ex = await tx.productionExpense.create({ data: { productionOrderId: r.orderId, categoryId: cat.id, amount: r.amount, date: o.workOrderDate ?? o.createdAt, description: r.desc }, select: { id: true } });
        journal.createdExpenses.push({ id: ex.id, orderId: r.orderId, tz: p.tz, amount: r.amount.toFixed(2) });
        changed.add(r.orderId);
      }
      for (const e of p.existing) changed.add(e.orderId);
    }
    // снимок ТЗ, склад ГП, подтверждение — как syncCompletedOrderCost и resetVerification в приложении
    for (const id of changed) {
      const o = await tx.productionOrder.findUnique({ where: { id }, include: { materialUsages: true, expenses: true } });
      if (!o) continue;
      journal.orders.push({ id, tz: o.workOrderNumber ?? "", old: { materialCost: o.materialCost?.toString() ?? null, expenseCost: o.expenseCost?.toString() ?? null, totalCost: o.totalCost?.toString() ?? null, unitCost: o.unitCost?.toString() ?? null, verifiedAt: o.verifiedAt?.toISOString() ?? null, verifiedBy: o.verifiedBy, verifyNote: o.verifyNote } });
      if (o.verifiedAt) await tx.productionOrder.update({ where: { id }, data: { verifiedAt: null, verifiedBy: null, verifyNote: null } });
      if (o.batchId && !journal.batches.some((b) => b.id === o.batchId)) {
        const b = await tx.productionBatch.findUnique({ where: { id: o.batchId }, select: { id: true, verifiedAt: true, verifiedBy: true, verifyNote: true } });
        if (b?.verifiedAt) { journal.batches.push({ id: b.id, old: { verifiedAt: b.verifiedAt.toISOString(), verifiedBy: b.verifiedBy, verifyNote: b.verifyNote } }); await tx.productionBatch.update({ where: { id: b.id }, data: { verifiedAt: null, verifiedBy: null, verifyNote: null } }); }
      }
      if (o.status !== "COMPLETED" || o.producedQuantity.isZero()) continue;
      const materialCost = o.materialUsages.reduce((s, u) => s.add(u.totalCost), D(0));
      const expenseCost = o.expenses.reduce((s, e) => s.add(e.amount), D(0));
      const totalCost = materialCost.add(expenseCost);
      const snapshotDelta = totalCost.sub(o.totalCost ?? D(0));
      const contribution = await orderStockContribution(tx as Prisma.TransactionClient, id);
      const full = fullFinishedCost(o, o.producedQuantity);
      const stockDelta = contribution.marked ? full.total.sub(contribution.count === 0 ? (o.totalCost ?? D(0)) : contribution.net) : snapshotDelta;
      await tx.productionOrder.update({ where: { id }, data: { materialCost, expenseCost, totalCost, unitCost: totalCost.div(o.producedQuantity) } });
      if (stockDelta.abs().lt(0.005)) continue;
      const stock = await tx.finishedGoodsStock.findUnique({ where: { warehouseId_productModelId: { warehouseId: o.finishedWarehouseId, productModelId: o.productModelId } } });
      if (!stock) continue;
      journal.stock.push({ id: stock.id, oldAvgUnitCost: stock.avgUnitCost.toString() });
      const newTotal = stock.quantity.mul(stock.avgUnitCost).add(stockDelta);
      await tx.finishedGoodsStock.update({ where: { id: stock.id }, data: { avgUnitCost: stock.quantity.isZero() ? stock.avgUnitCost : newTotal.div(stock.quantity) } });
      const mv = await tx.finishedGoodsMovement.create({
        data: {
          organizationId: org, warehouseId: o.finishedWarehouseId, productModelId: o.productModelId, type: stockDelta.greaterThan(0) ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT", quantity: 0,
          unitCost: stockDelta.abs().div(o.producedQuantity), totalCost: stockDelta.abs(), productionOrderId: id,
          notes: `${TAG} Сведение с итогом Word-ТЗ. ${contribution.marked ? FG_FULL_COST_NOTE : "Корректировка себестоимости после правки завершённого ТЗ"}`,
        },
        select: { id: true },
      });
      journal.movements.push({ id: mv.id });
    }
  }, { timeout: 300000, maxWait: 15000 });
  writeJson(JOURNAL, journal);
  console.log(`\nПрименено на «${dbName}»: создано расходов ${journal.createdExpenses.length}, пересчитано ТЗ ${journal.orders.length}. Журнал: ${JOURNAL}`);

  // контроль после записи: итог ТЗ в системе = итог документа (допуск 1 ₽)
  const after = await prisma.productionOrder.findMany({
    where: { organizationId: org, workOrderNumber: { in: tzs }, status: { not: "CANCELLED" } },
    select: { workOrderNumber: true, status: true, plannedQuantity: true, producedQuantity: true, clientWorkPricePerUnit: true, materialUsages: { select: { totalCost: true, commission4: true } }, expenses: { select: { amount: true } } },
  });
  let bad = 0;
  for (const tz of tzs) {
    const p = plans.find((x) => x.tz === tz)!;
    if (p.problem) continue;
    let s = D(0);
    for (const o of after.filter((x) => x.workOrderNumber === tz)) {
      for (const u of o.materialUsages) s = s.add(u.commission4 ? D(u.totalCost).mul(D(1).add(RATE4)) : u.totalCost);
      for (const e of o.expenses) s = s.add(e.amount);
      if (o.clientWorkPricePerUnit != null) s = s.add(D(o.clientWorkPricePerUnit).mul(o.status === "COMPLETED" ? o.producedQuantity : o.plannedQuantity));
    }
    const d = s.sub(targets[tz].ref);
    if (d.abs().gt(TOL)) { bad++; console.log(`  ✗ ТЗ ${tz}: система ${rub(s)} ≠ документ ${rub(targets[tz].ref)} (Δ ${rub(d)})`); }
  }
  console.log(bad ? `После записи расхождений > ${TOL} ₽: ${bad}` : `После записи: у всех ${tzs.length - plans.filter((x) => x.problem).length} ТЗ сумма в системе = сумма документа (допуск ${TOL} ₽).`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
