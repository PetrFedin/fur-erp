/**
 * Аудит полноты детализации: аукционы/закупки (лоты) и ТЗ (производственные заказы).
 * ТОЛЬКО ЧТЕНИЕ базы. Пишет docs-inventory/detail-audit.json и detail-audit.md
 * (их читают другие агенты для интерфейса «что подгрузить»).
 *
 *   node --env-file=.env node_modules/.bin/tsx scripts/build-detail-audit.ts            # итоговый аудит
 *   node --env-file=.env node_modules/.bin/tsx scripts/build-detail-audit.ts --snapshot # сохранить «до» (docs-inventory/detail-audit-before.json) и выйти
 *
 * Если рядом лежит detail-audit-before.json, в итоговый JSON добавляется блок before и сводка «до/после».
 */
import { join } from "path";
import { existsSync, writeFileSync } from "fs";
import { PrismaClient } from "@prisma/client";
import {
  INV,
  loadPurchaseExtracts,
  docSessions,
  expandPurchaseRefs,
  readJson,
  writeJson,
} from "./detail-common";

const prisma = new PrismaClient();
const SNAPSHOT = process.argv.includes("--snapshot");
const pct = (a: number, b: number) => (b === 0 ? 100 : Math.round((a / b) * 1000) / 10);
const num = (x: unknown) => (x == null ? 0 : Number(x));

type Group = {
  key: string;
  house?: string;
  dbAuction?: string | null;
  documents: {
    auctionInvoices?: any[];
    wellmechInvoices?: any[];
    upd?: any[];
    specs?: any[];
    calcs?: any[];
  };
  paymentsByDocs?: any[];
  db?: { purchases?: string[] };
};

function loadGroups(): Group[] {
  const out: Group[] = [];
  for (const f of ["chain-p2025.json", "chain-p2026.json"]) {
    const d = readJson<{ groups: Group[] }>(join(INV, f), { groups: [] });
    out.push(...d.groups);
  }
  return out;
}

// Аукционные сессии, для которых «счёт аукциона» (инвойс аукционного дома) в принципе должен быть.
const AUCTION_SESSIONS = new Set([
  "SAGA 03-25", "SAGA 06-25", "SAGA 03-26", "AME 05-26", "FH 06-26", "КФХ Дуденко Л. Н.",
  "СП 03.25", "РП 03.25", "СП 05.25", "РП 05.25", "СП 12.25",
  "Закупка меха 04-26", "СОЮЗПУШНИНА 05-26", "СП 09-26",
]);

const isTemplateDate = (d: Date | null) => !!d && d.toISOString().slice(0, 10) === "2025-05-16";

async function main() {
  const org = await prisma.organization.findFirstOrThrow();
  const groups = loadGroups();
  const extracts = loadPurchaseExtracts();

  const purchases = await prisma.purchase.findMany({
    where: { organizationId: org.id },
    include: {
      items: { include: { rawMaterial: true, lot: true } },
      driveDocuments: true,
      documents: true,
      payments: true,
    },
    orderBy: { number: "asc" },
  });

  // ---------- АУКЦИОНЫ ----------
  const sessions = new Map<string, typeof purchases>();
  for (const p of purchases) {
    const k = p.auctionSession ?? "(без аукциона)";
    sessions.set(k, [...(sessions.get(k) ?? []), p]);
  }

  const purchaseGroups = new Map<string, Group[]>();
  for (const g of groups) {
    const nums = expandPurchaseRefs(g.db?.purchases ?? []);
    for (const n of nums) purchaseGroups.set(n, [...(purchaseGroups.get(n) ?? []), g]);
  }
  const nameToNumbers = new Map<string, string[]>();
  for (const p of purchases) nameToNumbers.set(p.number, [p.number]);

  const SCORED = [
    ["lotNumber", "номер лота"],
    ["grade", "вид/сорт/размер (описание)"],
    ["quantity", "количество"],
    ["unitPrice", "цена за шкуру"],
    ["vatRate", "НДС"],
    ["costDetail", "статьи затрат (costBreakdown/costPlan)"],
    ["unitCost", "итоговая стоимость за единицу"],
    ["rate", "курс/валюта в расчёте"],
  ] as const;

  const auctions: any[] = [];
  let totalLots = 0;
  let fullLots = 0;
  let sumFieldsHave = 0;
  let sumFieldsAll = 0;
  let colorHave = 0;

  for (const [session, ps] of [...sessions.entries()].sort((a, b) => a[0].localeCompare(b[0], "ru"))) {
    const items = ps.flatMap((p) => p.items.map((i) => ({ p, i })));
    const missingCount: Record<string, number> = {};
    let lotsFull = 0;
    let have = 0;
    let all = 0;
    const lotRows: any[] = [];
    for (const { p, i } of items) {
      const lot = i.lot;
      const cp: any = i.costPlan;
      const cbItems: any[] = (lot?.costBreakdown as any)?.items ?? cp?.costBreakdown?.items ?? [];
      const hasLabel = (re: RegExp) => cbItems.some((x) => re.test(String(x.label)));
      const flags: Record<string, boolean> = {
        lotNumber: !!i.lotNumber,
        grade: !!(i.rawMaterial.unit === "M" || i.grade || i.color || cp?.costBreakdown?.furDescription || (lot?.costBreakdown as any)?.furDescription),
        quantity: num(i.quantity) > 0,
        unitPrice: num(i.unitPrice) > 0,
        vatRate: i.vatRate != null,
        costDetail: cbItems.length >= 3,
        unitCost: lot ? num(lot.unitCost) > 0 : num(cp?.unitCostInclVat) > 0,
        rate:
          !AUCTION_SESSIONS.has(session) || // не аукционная закупка (подкладка, доп. материалы, прямая покупка у Веллмех) — курс не требуется
          Number(p.exchangeRate) !== 1 ||
          hasLabel(/курс/i) ||
          (lot?.costBreakdown as any)?.exchangeRateFixed != null ||
          (lot?.costBreakdown as any)?.exchangeRateInvoice != null,
      };
      let allOk = true;
      for (const [k] of SCORED) {
        all++;
        if (flags[k]) have++;
        else {
          allOk = false;
          missingCount[k] = (missingCount[k] ?? 0) + 1;
        }
      }
      if (i.color) colorHave++;
      if (allOk) lotsFull++;
      lotRows.push({ purchase: p.number, lot: i.lotNumber, missing: SCORED.filter(([k]) => !flags[k]).map(([k]) => k), color: i.color ?? null });
    }
    totalLots += items.length;
    fullLots += lotsFull;
    sumFieldsHave += have;
    sumFieldsAll += all;
    const withColor = items.filter(({ i }) => i.color).length;

    // документы
    const dd = ps.flatMap((p) => p.driveDocuments);
    const byType: Record<string, Set<string>> = {};
    for (const d of dd) (byType[d.docType] ??= new Set()).add(d.driveFileId);
    const docsPresent: Record<string, number> = {};
    for (const [t, s] of Object.entries(byType)) docsPresent[t] = s.size;
    const uploaded = ps.flatMap((p) => p.documents).length;

    // цепочки
    const gset = new Map<string, Group>();
    for (const p of ps) for (const g of purchaseGroups.get(p.number) ?? []) gset.set(g.key, g);
    const gs = [...gset.values()];
    const cat = (k: keyof Group["documents"]) => {
      const m = new Map<string, any>();
      for (const g of gs) for (const x of g.documents[k] ?? []) m.set(`${x.fileId ?? ""}|${x.no ?? ""}|${x.title ?? ""}`, x);
      return [...m.values()];
    };
    const auctionInvoices = cat("auctionInvoices");
    const wellmech = cat("wellmechInvoices");
    const upd = cat("upd");
    const specs = cat("specs");
    const calcs = cat("calcs");
    const lotsDb = items.length;
    const statuses = new Set(ps.map((p) => p.status));
    const allDraft = [...statuses].every((s) => s === "DRAFT");

    const missingDocs: Array<{ type: string; why: string }> = [];
    const docTypesDb = new Set(dd.map((d) => d.docType));
    if (AUCTION_SESSIONS.has(session)) {
      const covered = auctionInvoices.reduce((s, x) => s + num(x.lotsCount), 0);
      if (auctionInvoices.length === 0 && !docTypesDb.has("AUCTION_INVOICE"))
        missingDocs.push({ type: "AUCTION_INVOICE", why: "в Drive нет счёта/инвойса аукционного дома на лоты" });
      else if (session === "SAGA 03-26")
        missingDocs.push({
          type: "AUCTION_INVOICE",
          why: `есть только «302127 lot.jpg» (1 лот, 225 шт); счетов аукциона на остальные ${lotsDb - 1} лота (7 артикулов) нет`,
        });
      else if (covered > 0 && covered < lotsDb * 0.9)
        missingDocs.push({ type: "AUCTION_INVOICE", why: `счета аукциона покрывают ${covered} из ${lotsDb} лотов` });
    }
    if (upd.length === 0 && !docTypesDb.has("UPD"))
      missingDocs.push({
        type: "UPD",
        why: allDraft ? "поставки ещё не было — УПД появится после поставки" : "УПД/скан УПД не найден в Drive",
      });
    if (specs.length === 0 && !docTypesDb.has("SPECIFICATION") && session !== "(без аукциона)")
      missingDocs.push({ type: "SPECIFICATION", why: "нет спецификации к договору купли-продажи" });
    if (calcs.length === 0 && !docTypesDb.has("CALC_SHEET"))
      missingDocs.push({ type: "CALC_SHEET", why: "нет расчётного листа (Excel) по закупке" });
    if (wellmech.length === 0 && !docTypesDb.has("PAYMENT_INVOICE"))
      missingDocs.push({ type: "PAYMENT_INVOICE", why: "нет счёта Веллмех на оплату" });
    // платёжки: есть ли оплаты по документам без п/п
    const pays = gs.flatMap((g) => g.paymentsByDocs ?? []);
    const seenPay = new Set<string>();
    for (const x of pays) {
      const key = `${x.date}|${x.amountRub}`;
      if (seenPay.has(key)) continue;
      seenPay.add(key);
      const pp = x.ppNo == null || String(x.ppNo) === "null" ? null : String(x.ppNo);
      if (!pp)
        missingDocs.push({
          type: "PAYMENT_PROOF",
          why: `платёжка/выписка на ${Number(x.amountRub).toLocaleString("ru-RU")} ₽${x.date ? ` от ${x.date}` : " (дата не указана)"}: оплата упомянута в письме/расчёте, п/п в Drive нет`,
        });
    }
    if (pays.length === 0 && !docTypesDb.has("PAYMENT_PROOF") && !allDraft && ps.every((p) => p.payments.length === 0))
      missingDocs.push({ type: "PAYMENT_PROOF", why: "оплата по документам не найдена ни в одном письме/счёте/УПД" });

    // документы с упоминанием оплаты
    const paymentMentions: Array<{ doc: string; fileId: string | null; note: string }> = [];
    const seenF = new Set<string>();
    for (const e of extracts) {
      if (!e.payments?.length || e.duplicateOf) continue;
      if (!docSessions(e).includes(session)) continue;
      if (seenF.has(e.fileId)) continue;
      seenF.add(e.fileId);
      const note = e.payments
        .map((x: any) =>
          [x.date, x.amount != null ? `${Number(x.amount).toLocaleString("ru-RU")} ₽` : null, x.kind, x.purpose ?? x.forWhat]
            .filter(Boolean)
            .join(" · ")
        )
        .join(" | ")
        .slice(0, 400);
      paymentMentions.push({ doc: e.title, fileId: e.fileId, note });
    }
    for (const x of pays) {
      const src = x.source ?? x.evidence;
      if (!src) continue;
      const k = `chain|${x.date}|${x.amountRub}`;
      if (seenF.has(k)) continue;
      seenF.add(k);
      paymentMentions.push({
        doc: String(src).slice(0, 160),
        fileId: null,
        note: `${x.date ?? "дата?"} · ${Number(x.amountRub).toLocaleString("ru-RU")} ₽ · ${String(x.purpose ?? "").slice(0, 160)}`,
      });
    }

    const missingFields = SCORED.filter(([k]) => missingCount[k]).map(([k, label]) => ({
      field: k,
      label,
      lots: missingCount[k],
      of: items.length,
    }));
    if (items.length - withColor > 0)
      (missingFields as { field: string; label: string; lots: number; of: number }[]).push({ field: "color", label: "цвет (в документах не указан отдельно)", lots: items.length - withColor, of: items.length });

    auctions.push({
      auction: session,
      purchases: ps.map((p) => p.number),
      status: [...statuses].join("/"),
      lots: items.length,
      pieces: Math.round(items.reduce((s, { i }) => s + num(i.quantity), 0) * 100) / 100,
      completenessPct: pct(have, all),
      fullLotsPct: pct(lotsFull, items.length),
      missingFields,
      docsPresent: { ...docsPresent, ...(uploaded ? { UPLOADED_FILES: uploaded } : {}) },
      missingDocs,
      paymentMentions,
      lotsWithGaps: lotRows.filter((r) => r.missing.length).slice(0, 200),
    });
  }

  // ---------- ТЗ ----------
  const orders = await prisma.productionOrder.findMany({
    where: { organizationId: org.id },
    include: {
      productModel: true,
      client: true,
      batch: { include: { driveDocuments: true } },
      materialUsages: { include: { rawMaterial: true, lot: { select: { lotNumber: true } } } },
      driveDocuments: true,
      paymentAllocations: true,
    },
    orderBy: { number: "asc" },
  });

  const ordersOut: any[] = [];
  const counts = { full: 0, partial: 0, none: 0 };
  let oHave = 0;
  let oAll = 0;
  for (const o of orders) {
    const imp = o.endDate && o.createdAt && o.endDate.toISOString().slice(0, 10) === o.createdAt.toISOString().slice(0, 10);
    const hasLiningUsage = o.materialUsages.some((u) => /подклад|шелк|шёлк|ткань/i.test(u.rawMaterial.name));
    const R: Array<[string, string, boolean]> = [
      ["model", "модель/артикул", !!o.productModel?.name],
      ["category", "категория изделия", !!o.productModel?.category],
      ["quantity", "количество", num(o.plannedQuantity) > 0],
      ["size", "размер", !!o.size],
      ["color", "цвет", !!o.color],
      ["materialDescription", "мех (описание)", !!o.materialDescription],
      ["lining", "подкладка (описание)", !!o.lining],
      ["batch", "партия", !!o.batchId],
      ["client", "заказчик и договор", !!(o.clientId && o.contractNumber)],
      ["workPrice", "стоимость работы за ед.", num(o.clientWorkPricePerUnit) > 0],
      ["materials", "состав материалов (привязка к лотам)", o.materialUsages.length > 0],
      ["lotsLinked", "лоты у всех позиций меха", o.materialUsages.length > 0 && o.materialUsages.every((u) => u.lotId)],
      ["cost", "себестоимость единицы", o.status !== "COMPLETED" || num(o.unitCost) > 0],
      ["tzAppendix", "приложение ТЗ в Drive", o.driveDocuments.some((d) => d.docType === "TZ_APPENDIX")],
    ];
    const S: Array<[string, string, boolean]> = [
      ["workOrderDate", "дата ТЗ (по документу, не шаблон 16.05.2025)", !!o.workOrderDate && !isTemplateDate(o.workOrderDate)],
      ["endDate", "дата выпуска/сдачи (из документа, не дата импорта)", !!o.endDate && !imp],
      ["payment", "оплата привязана к ТЗ", o.paymentAllocations.length > 0],
    ];
    void hasLiningUsage;
    const missing = [...R, ...S].filter((x) => !x[2]).map((x) => ({ field: x[0], label: x[1] }));
    const haveN = [...R, ...S].filter((x) => x[2]).length;
    const total = R.length + S.length;
    oHave += haveN;
    oAll += total;
    const coreOk = R.every((x) => x[2]);
    const detail = o.materialUsages.length === 0 && !o.driveDocuments.length ? "none" : coreOk && S.every((x) => x[2]) ? "full" : "partial";
    counts[detail as "full" | "partial" | "none"]++;

    const docsPresent: Record<string, string[]> = {};
    for (const d of o.driveDocuments) (docsPresent[d.docType] ??= []).push(d.title);
    const batchDocs: Record<string, number> = {};
    for (const d of o.batch?.driveDocuments ?? []) batchDocs[d.docType] = (batchDocs[d.docType] ?? 0) + 1;
    const docsMissing: Array<{ type: string; why: string }> = [];
    if (!docsPresent.TZ_APPENDIX) docsMissing.push({ type: "TZ_APPENDIX", why: "приложение ТЗ к договору подряда не найдено в Drive" });
    if (o.batch) {
      if (!batchDocs.CALC_SHEET) docsMissing.push({ type: "CALC_SHEET", why: "нет расчёта доплаты по партии" });
      if (!batchDocs.PAYMENT_INVOICE) docsMissing.push({ type: "PAYMENT_INVOICE", why: "нет счёта на оплату по партии" });
      if (!batchDocs.UPD && !docsPresent.UPD) docsMissing.push({ type: "UPD", why: "нет УПД/акта по пошиву этой партии" });
    }
    if (o.paymentAllocations.length === 0)
      docsMissing.push({ type: "PAYMENT_PROOF", why: "нет платёжки или письма «оплачено» с датой по этому ТЗ/партии" });

    ordersOut.push({
      tz: o.workOrderNumber,
      order: o.number,
      batch: o.batch?.number ?? null,
      model: o.productModel?.name,
      quantity: num(o.plannedQuantity),
      status: o.status,
      detail,
      completenessPct: pct(haveN, total),
      missing,
      flags: imp ? ["endDate = дата импорта, не документная"] : [],
      docsPresent: Object.fromEntries(Object.entries(docsPresent).map(([k, v]) => [k, v.length])),
      batchDocsPresent: batchDocs,
      docsMissing,
    });
  }

  // партии
  const batches = await prisma.productionBatch.findMany({
    where: { organizationId: org.id },
    include: { driveDocuments: true, orders: { select: { id: true } } },
    orderBy: { number: "asc" },
  });
  const batchesOut = batches.map((b) => {
    const t: Record<string, number> = {};
    for (const d of b.driveDocuments) t[d.docType] = (t[d.docType] ?? 0) + 1;
    const miss: string[] = [];
    if (b.orders.length === 0) miss.push("в партии нет ТЗ");
    if (!b.year) miss.push("год");
    if (!b.plannedUnits) miss.push("плановое количество");
    return { batch: b.number, orders: b.orders.length, docs: t, missing: miss };
  });

  const unlinked = readJson<any[]>(join(INV, "unlinked-files.json"), []);
  const linked = new Set((await prisma.driveDocument.findMany({ select: { driveFileId: true } })).map((d) => d.driveFileId));
  const unlinkedNow = unlinked.filter((f) => !linked.has(f.id)).map((f) => ({ fileId: f.id, title: f.title, path: f.path }));

  const summary = {
    generatedAt: new Date().toISOString(),
    auctions: {
      count: auctions.length,
      lots: totalLots,
      fieldCompletenessPct: pct(sumFieldsHave, sumFieldsAll),
      fullLotsPct: pct(fullLots, totalLots),
      lotsWithColor: colorHave,
    },
    orders: {
      count: orders.length,
      full: counts.full,
      partial: counts.partial,
      none: counts.none,
      fullPct: pct(counts.full, orders.length),
      fieldCompletenessPct: pct(oHave, oAll),
    },
    unlinkedDriveFiles: unlinkedNow.length,
  };

  if (SNAPSHOT) {
    writeJson(join(INV, "detail-audit-before.json"), { summary, auctions: auctions.map((a) => ({ auction: a.auction, lots: a.lots, completenessPct: a.completenessPct, fullLotsPct: a.fullLotsPct })) });
    console.log("snapshot ДО сохранён:", JSON.stringify(summary));
    return;
  }

  const impOrders = ordersOut.filter((o) => o.flags.length).map((o) => o.order);
  const noUsage = ordersOut.filter((o) => o.missing.some((m: any) => m.field === "materials")).map((o) => `ТЗ ${o.tz} (${o.order})`);
  const ownerDecisions = [
    `Дата выпуска (endDate) у ${impOrders.length} ТЗ равна дате импорта 01.10.2026, а не документной: подтвердите фактические даты выпуска партий или разрешите очистить поле (в документах дат выпуска нет).`,
    "Дата ТЗ у ТЗ 1–96 в приложениях шаблонная (16.05.2025 = дата договора): реальные даты подписания нужны от владельца.",
    `Нет состава материалов у: ${noUsage.join(", ")} (ТЗ 75/97/104 — аксессуары из лоскута/бобра без лота; ТЗ 158 — шкуры подрядчика 176 000 ₽/ед.): заводить ли лотами.`,
    "Цвет ТЗ в базе по единому реестру (NATURAL, BLACK GLAMA …), в приложениях ТЗ — русские названия; у 68 ТЗ значения различаются по написанию: единый справочник цветов — решение владельца.",
    "ТЗ 87 (MSC-01): в «расчёт пошива 8 партии.xlsx» цвет «коричневый», в базе «бежевый» (по реестру) — какой верен.",
    "ТЗ 19/88/118: количество в приложении (2 / 34 / 4) не совпадает с количеством строк базы (разбито по моделям) — подтвердить разбивку.",
    "Партии 15 и 16 без ТЗ, года и планового количества; ТЗ 116 без приложения (создан по реестру).",
    "Нет в схеме отдельных полей: размер/категория сорта на лоте (хранятся в grade), операции и расценки ТЗ построчно (хранится только Σ работы за ед.), артикул ProductModel.sku (пусто, артикул в name). Миграция НЕ делалась; при необходимости — добавить ProductionOrder.operations Json? и RawMaterialLot.sizeGrade String?.",
    "Лоты без разложения затрат: РП 04-26 лоты 19/20/23/26/27 (номера совпадают с лотами СП 05-26, детальный расчёт по ним не разнесён), AME 204742, красная лиса З-2026-0059, подкладка Спец. 7 (расчёта нет), «Нет информации» (доп. закупки 5/6/7/9).",
  ];
  const before = readJson<any>(join(INV, "detail-audit-before.json"), null);
  const out = {
    generatedAt: summary.generatedAt,
    note: "Составлено scripts/build-detail-audit.ts (только чтение БД). missingDocs/paymentMentions — для UI «что подгрузить».",
    summary,
    before: before?.summary ?? null,
    auctions: auctions.map(({ lotsWithGaps, ...a }) => a),
    lotGaps: Object.fromEntries(auctions.filter((a) => a.lotsWithGaps.length).map((a) => [a.auction, a.lotsWithGaps])),
    orders: ordersOut,
    batches: batchesOut,
    unlinkedDriveFiles: unlinkedNow,
    ownerDecisions,
  };
  writeJson(join(INV, "detail-audit.json"), out);
  writeMd(out, before);
  console.log(JSON.stringify(summary, null, 1));
}

function writeMd(out: any, before: any) {
  const L: string[] = [];
  const s = out.summary;
  L.push("# Аудит полноты детализации: аукционы и ТЗ", "");
  L.push(`Срез: ${s.generatedAt.slice(0, 10)}. Составлен \`scripts/build-detail-audit.ts\` (только чтение БД); машинный вид — \`docs-inventory/detail-audit.json\`.`, "");
  L.push("## Сводка (до → после дозаполнения)", "");
  const b = before?.summary;
  const f = (x: any, y: any) => (x == null ? `${y}` : `${x} → ${y}`);
  L.push("| Показатель | До → После |", "|---|---|");
  L.push(`| Аукционы: поля лотов заполнены, % | ${f(b?.auctions.fieldCompletenessPct, s.auctions.fieldCompletenessPct)} |`);
  L.push(`| Аукционы: лотов с полной детализацией, % | ${f(b?.auctions.fullLotsPct, s.auctions.fullLotsPct)} |`);
  L.push(`| Лотов с цветом | ${f(b?.auctions.lotsWithColor, s.auctions.lotsWithColor)} из ${s.auctions.lots} |`);
  L.push(`| ТЗ: «полная» детализация | ${f(b?.orders.full, s.orders.full)} из ${s.orders.count} |`);
  L.push(`| ТЗ: «частичная» | ${f(b?.orders.partial, s.orders.partial)} |`);
  L.push(`| ТЗ: «нет данных» | ${f(b?.orders.none, s.orders.none)} |`);
  L.push(`| ТЗ: поля заполнены, % | ${f(b?.orders.fieldCompletenessPct, s.orders.fieldCompletenessPct)} |`);
  L.push(`| Файлов Drive, не заведённых в БД | ${f(b?.unlinkedDriveFiles, s.unlinkedDriveFiles)} |`, "");

  L.push("## 1. Аукционы и закупки", "");
  L.push("Поля лота (оцениваются): номер лота, вид/сорт/размер (описание), количество, цена за шкуру, НДС, статьи затрат (costBreakdown/costPlan, ≥3 статей), итоговая стоимость за единицу, курс/валюта в расчёте. Цвет — отдельная колонка, в оценку не входит (в документах чаще встроен в описание).", "");
  for (const a of out.auctions) {
    L.push(`### ${a.auction}`, "");
    L.push(`Закупки: ${a.purchases.join(", ")} · статус ${a.status} · лотов ${a.lots}, шт. ${a.pieces} · поля ${a.completenessPct}% · лотов полностью ${a.fullLotsPct}%`, "");
    L.push("| Что есть в документах и в базе | Чего не хватает |", "|---|---|");
    const have = Object.entries(a.docsPresent).map(([k, v]) => `${k}: ${v}`).join(", ") || "документов в базе нет";
    const miss = a.missingFields.map((m: any) => `${m.label} — ${m.lots}/${m.of} лотов`).join("; ") || "по полям лотов пробелов нет";
    L.push(`| Документы в БД: ${have} | Поля: ${miss} |`, "");
    if (a.missingDocs.length) {
      L.push("Документы, которых не хватает:", "");
      for (const m of a.missingDocs) L.push(`- **${m.type}** — ${m.why}`);
      L.push("");
    }
    if (a.paymentMentions.length) {
      L.push(`Документы с упоминанием оплаты (${a.paymentMentions.length}):`, "");
      for (const m of a.paymentMentions.slice(0, 12)) L.push(`- ${m.doc}${m.fileId ? ` (\`${m.fileId}\`)` : ""} — ${m.note}`);
      if (a.paymentMentions.length > 12) L.push(`- … ещё ${a.paymentMentions.length - 12} (см. JSON)`);
      L.push("");
    }
  }

  L.push("## 2. ТЗ (производственные заказы)", "");
  L.push("«Полная» — заполнены все поля ТЗ (модель, категория, количество, размер, цвет, мех, подкладка, партия, заказчик, работа, материалы с лотами, себестоимость, приложение ТЗ) И даты (дата ТЗ не шаблонная, дата выпуска не дата импорта) И привязана оплата. «Нет данных» — нет ни материалов, ни приложения.", "");
  const miss: Record<string, number> = {};
  for (const o of out.orders) for (const m of o.missing) miss[m.label] = (miss[m.label] ?? 0) + 1;
  L.push("Чего не хватает (число ТЗ из " + out.orders.length + "):", "");
  for (const [k, v] of Object.entries(miss).sort((a, b) => b[1] - a[1])) L.push(`- ${k}: ${v}`);
  L.push("");
  L.push("| Партия | ТЗ | Полных | Частичных | Нет данных | Без оплаты | Нет расчёта доплаты |", "|---|---|---|---|---|---|---|");
  const byBatch = new Map<string, any[]>();
  for (const o of out.orders) byBatch.set(String(o.batch ?? "—"), [...(byBatch.get(String(o.batch ?? "—")) ?? []), o]);
  for (const [k, v] of [...byBatch.entries()].sort((a, b) => Number(a[0]) - Number(b[0]))) {
    L.push(`| ${k} | ${v.length} | ${v.filter((o) => o.detail === "full").length} | ${v.filter((o) => o.detail === "partial").length} | ${v.filter((o) => o.detail === "none").length} | ${v.filter((o) => o.docsMissing.some((d: any) => d.type === "PAYMENT_PROOF")).length} | ${v.filter((o) => o.docsMissing.some((d: any) => d.type === "CALC_SHEET")).length} |`);
  }
  L.push("");
  L.push("Партии без ТЗ или без плановых данных:", "");
  for (const b2 of out.batches.filter((x: any) => x.missing.length)) L.push(`- Партия ${b2.batch}: ${b2.missing.join(", ")}`);
  L.push("");
  L.push("## 3. Требует решения владельца", "");
  for (const d of out.ownerDecisions) L.push(`- ${d}`);
  L.push("");
  if (out.unlinkedDriveFiles.length) {
    L.push("## 4. Файлы Drive, не заведённые в БД", "");
    L.push("Большинство — точные дубли уже привязанных файлов (то же имя и размер, «Копия …», «(1)»): сознательно не заводились. Остальные — в JSON, ключ unlinkedDriveFiles.", "");
    for (const f2 of out.unlinkedDriveFiles) L.push(`- ${f2.title}`);
    L.push("");
  }
  writeFileSync(join(INV, "detail-audit.md"), L.join("\n"), "utf-8");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
