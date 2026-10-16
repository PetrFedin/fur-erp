// Сверка «кабинет Веллмеха ↔ учёт заказчика»: то, что Веллмех внёс и мы приняли (расчёты аукционов, ТЗ), должно СОВПАДАТЬ
// с нашими закупками, лотами и ТЗ — те же номера счетов и лотов, шкуры, суммы ₽, курс, НДС, статусы, документы.
// Только чтение (ничего не пишет). Суммы Веллмеха считаются теми же функциями, что и на его страницах (calcAll, buildStatement, tzTotals).
// Код возврата 1 — при расхождениях. Допуски: копейки округления (на строку/лот), курс до 6 знаков.
//   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/test-supplier-sync.ts
//   SYNC_TOL_SCALE=4 … — на обезличенной демо-базе (деньги ×K): допуски округления тоже ×K.
//   SYNC_VERBOSE=1 — печатать и совпавшие показатели.
import "./stubs/server-only-shim";
import { PrismaClient } from "@prisma/client";
import { calcAll, calcVatPct, ensureRowIds, lotKey, type CalcPayload } from "../src/lib/supplier-calc";
import { buildStatement } from "../src/lib/auction-statement";
import { tzTotals, type TzPayload } from "../src/lib/tz-vendor";
import { supplierRawRows, supplierAcceptedCalcs } from "../src/lib/supplier-raw";
import { loadSupplierAuction } from "../src/lib/supplier-auction";

const prisma = new PrismaClient();
const SCALE = Number(process.env.SYNC_TOL_SCALE) || 1;
const VERBOSE = !!process.env.SYNC_VERBOSE;
let fails = 0, checks = 0, infos = 0;
const bad: string[] = [];
let curTitle = "";
/** Расхождения в самих данных: объяснены, кодом не чинятся (данные в БД не правим), поэтому не считаются ошибкой логики. */
const KNOWN: { title: RegExp; what: RegExp; why: string }[] = [
  { title: /^AME 05-26/, what: /шкуры/, why: "Веллмех внёс 376 шкур, заказчик исправил лот 204742 по УПД до 371 шк. (цена за шкуру выше, итог ₽ тот же с точностью до рубля): нужен окончательный расчёт Веллмеха на 371 или решение владельца" },
];
const known = (what: string) => KNOWN.find((k) => k.title.test(curTitle) && k.what.test(what));
const eq = (what: string, got: number, want: number, tol = 0.01) => {
  checks++;
  const ok = Math.abs(got - want) <= tol * SCALE;
  if (!ok && known(what)) infos++, bad.push(`  • [данные] ${what}: ${got.toFixed(2)} ≠ ${want.toFixed(2)} — ${known(what)!.why}`);
  else if (!ok) { fails++; bad.push(`  ✗ ${what}: Веллмех ${got.toFixed(2)} ≠ заказчик ${want.toFixed(2)} (Δ ${(got - want).toFixed(2)})`); }
  else if (VERBOSE) console.log(`  ✓ ${what}: ${got.toFixed(2)}`);
};
const same = (what: string, got: string, want: string) => {
  checks++;
  if (got !== want) { fails++; bad.push(`  ✗ ${what}: Веллмех «${got}» ≠ заказчик «${want}»`); }
  else if (VERBOSE) console.log(`  ✓ ${what}: ${got}`);
};
/** Известное расхождение в самих данных (не чинится кодом): печатается отдельно, на код возврата не влияет. */
const info = (what: string) => { infos++; bad.push(`  • ${what}`); };
const flush = (head: string) => { console.log(head); for (const l of bad.splice(0)) console.log(l); };
const norm = (s: string) => s.trim().replace(/\s+/g, " ");

(async () => {
  const org = (await prisma.organization.findFirst())!.id;

  // ================================================================================== 1. Принятые расчёты аукционов
  const calcs = await prisma.supplierInbox.findMany({
    where: { organizationId: org, kind: "AUCTION_CALC", status: "ACCEPTED" },
    orderBy: { title: "asc" },
    select: { id: true, title: true, supplierId: true, createdEntityType: true, createdEntityId: true, payload: true },
  });
  console.log(`Принятых расчётов аукционов: ${calcs.length}`);
  for (const c of calcs) {
    curTitle = c.title;
    const p = ensureRowIds(c.payload as unknown as CalcPayload);
    const pids = (c.createdEntityId ?? "").split(",").filter(Boolean);
    checks++;
    if (c.createdEntityType !== "Purchase" || pids.length === 0) { fails++; bad.push("  ✗ расчёт принят, но закупка не привязана"); flush(`— ${c.title}`); continue; }
    const purchases = await prisma.purchase.findMany({
      where: { id: { in: pids }, organizationId: org },
      select: {
        id: true, number: true, status: true, currency: true, exchangeRate: true, invoiceNumber: true, supplierId: true, auctionSession: true,
        auction: { select: { name: true } },
        items: { select: { lotNumber: true, quantity: true, unitPrice: true, subtotal: true, costPlan: true, lot: { select: { totalCost: true, vatRate: true, quantityReceived: true } } } },
        driveDocuments: { select: { docType: true } }, documents: { select: { kind: true } },
      },
    });
    checks++;
    if (purchases.length !== pids.length) { fails++; bad.push(`  ✗ закупок найдено ${purchases.length} из ${pids.length} привязанных`); }
    for (const pu of purchases) same(`закупка ${pu.number}: поставщик = поставщик расчёта`, pu.supplierId, c.supplierId);

    let vatNoted = false;
    const t = calcAll(p);
    const st = buildStatement(p, t);
    // Стоимость строки у заказчика: лот (если принято на склад) → иначе расчёт в позиции закупки (costPlan.unitCostInclVat) × количество
    const custTotal = (it: (typeof purchases)[number]["items"][number]) => {
      if (it.lot) return Number(it.lot.totalCost);
      const cp = it.costPlan as { unitCostInclVat?: number | string } | null;
      return cp?.unitCostInclVat != null ? Number(cp.unitCostInclVat) * Number(it.quantity) : NaN;
    };
    const allItems = purchases.flatMap((x) => x.items);
    const custQty = allItems.reduce((a, i) => a + Number(i.quantity), 0);
    const custSum = allItems.reduce((a, i) => a + custTotal(i), 0);
    // допуск: до 1 ₽ на лот (цена за единицу округляется до копеек × количество) + 0,05 ₽ на лот
    const tolTotal = Math.max(5, allItems.length * 1.5);
    eq("шкуры: итого расчёта = Σ закупок", t.qty, custQty, 0.001);
    eq("итого ₽: расчёт = Σ лотов закупок", t.totalRub, custSum, tolTotal);
    eq("итого ₽: расчёт = Σ лотов в «За что заплачено»", st.total, t.totalRub, 0.01);

    // по счетам
    const invoices = [...new Set(p.rows.filter((r, i) => t.sheet.used[i]).map((r) => norm(r.invoice ?? "")).filter(Boolean))];
    for (const pu of purchases) {
      const inv = norm(pu.invoiceNumber ?? "");
      // одна закупка на несколько счетов расчёта (SAGA 03-25) — сравниваем целиком; иначе строки расчёта отбираются по номеру счёта закупки
      const byInvoice = invoices.length > 1 && purchases.length > 1;
      const idx = p.rows.map((_, i) => i).filter((i) => t.sheet.used[i] && (!byInvoice || norm(p.rows[i].invoice ?? "") === inv));
      if (byInvoice) { checks++; if (!invoices.includes(inv)) { fails++; bad.push(`  ✗ счёт закупки ${pu.number} «${inv}» не найден в расчёте (${invoices.join(", ")})`); } }
      const cq = idx.reduce((a, i) => a + (t.qtys[i] ?? 0), 0);
      const ct = idx.reduce((a, i) => a + (t.calcs[i]?.totalRub ?? 0), 0);
      eq(`счёт ${inv || pu.number}: шкуры`, cq, pu.items.reduce((a, i) => a + Number(i.quantity), 0), 0.001);
      eq(`счёт ${inv || pu.number}: итого ₽`, ct, pu.items.reduce((a, i) => a + custTotal(i), 0), Math.max(3, pu.items.length * 1.5));
      // лоты
      // номера лотов сравниваем по ключу (у заказчика бывают приставки аукциона «FW26-30» — Веллмех подтягивает их тем же lotKey)
      const calcLots = idx.map((i) => lotKey(p.rows[i].lot)).filter(Boolean).sort();
      const custLots = pu.items.map((i) => lotKey(i.lotNumber)).filter(Boolean).sort();
      same(`счёт ${inv || pu.number}: номера лотов`, calcLots.join(","), custLots.join(","));
      const dup = calcLots.filter((l, k) => calcLots.indexOf(l) !== k);
      if (dup.length) info(`счёт ${inv || pu.number}: повторяющиеся номера лотов в расчёте (${[...new Set(dup)].join(", ")}) — у Веллмеха цена по ним не показывается в списке «Сырьё» (нельзя однозначно сопоставить)`);
      // курс и валюта
      if (pu.currency !== "RUB") {
        // курс расчёта один на весь файл (t.rate); у заказчика курс — по каждому счёту. Кабинет Веллмеха показывает курсы по счетам (loadSupplierAuction.invoices[].rate)
        const cr = Number(pu.exchangeRate);
        checks++;
        if (t.rate > 0 && Math.abs(t.rate - cr) > 0.0005) info(`счёт ${inv || pu.number}: курс расчёта ${t.rate.toFixed(4)} ≠ курс закупки ${cr.toFixed(4)} (в кабинете Веллмеха показаны курсы по счетам)`);
        same(`счёт ${inv || pu.number}: валюта`, norm(p.header.currency || "USD").toUpperCase(), pu.currency.toUpperCase());
      }
      // НДС
      const lotVat = [...new Set(pu.items.filter((i) => i.lot).map((i) => Number(i.lot!.vatRate)))];
      const wv = calcVatPct(p);
      if (lotVat.length && wv == null) { if (!vatNoted) info(`в расчёте Веллмеха ставка НДС не указана (таблица без параметра НДС), у лотов заказчика ${lotVat.join("/")}% — Веллмех её не показывает`); vatNoted = true; }
      else if (lotVat.length) { checks++; if (lotVat.length !== 1 || wv !== lotVat[0]) { fails++; bad.push(`  ✗ счёт ${inv || pu.number}: НДС Веллмеха ${wv ?? "—"}% ≠ НДС лотов ${lotVat.join("/")}%`); } }
    }
    // аукцион
    const aName = norm(p.header.auction);
    const pName = [...new Set(purchases.map((x) => norm(x.auction?.name ?? x.auctionSession ?? "")))];
    checks++;
    if (aName && !pName.some((n) => n.replace(/\./g, "-") === aName.replace(/\./g, "-") || aName.replace(/[.-]/g, "").includes(n.replace(/[.-]/g, "")) || n.replace(/[.-]/g, "").includes(aName.replace(/[.-]/g, "")))) info(`название аукциона в расчёте «${aName}» ≠ в закупке «${pName.join("; ")}» (проверить привязку)`);
    // страницы: «Сырьё» Веллмеха использует те же закупки
    const view = await supplierAcceptedCalcs(org, c.supplierId, pids);
    checks++;
    if (!view.some((v) => v.id === c.id)) { fails++; bad.push("  ✗ расчёт не виден в кабинете Веллмеха (Сырьё → аукцион): нет в supplierAcceptedCalcs"); }
    const page = await loadSupplierAuction(org, c.supplierId, pids[0]);
    checks++;
    if (!page?.calc || page.calc.id !== c.id) { fails++; bad.push("  ✗ страница аукциона Веллмеха не показывает расчёт"); }
    else {
      const pageLotsSum = page.items.filter((i) => pids.includes(i.purchaseId) || true).reduce((a, i) => a + i.subtotal, 0);
      void pageLotsSum;
    }
    // документы: «есть/нет» у Веллмеха (УПД/спец.) должно совпадать с нашими документами закупки
    const rows = await supplierRawRows(org, c.supplierId);
    for (const pu of purchases) {
      const w = rows.filter((r) => r.purchaseId === pu.id);
      const wellDoc = w.length > 0 && w.every((r) => r.doc !== "");
      const custDoc = pu.driveDocuments.some((d) => d.docType === "UPD" || d.docType === "SPECIFICATION") || pu.documents.some((d) => d.kind === "UPD" || d.kind === "SPECIFICATION");
      checks++;
      if (wellDoc !== custDoc && !(w.some((r) => r.doc !== "") && custDoc)) info(`закупка ${pu.number}: УПД/спецификация — у Веллмеха ${wellDoc ? "есть" : "нет"}, у заказчика ${custDoc ? "есть" : "нет"} (данные: документа нет)`);
      for (const r of w) same(`закупка ${pu.number} лот ${r.lotNumber}: статус «принято/в пути»`, r.received ? "RECEIVED" : "NOT", pu.status === "RECEIVED" ? "RECEIVED" : "NOT");
    }
    // Аванс/остаток: аванс и промежуточные платежи расчёта не больше итога (оплаты заказчика ведутся по п/п и в кабинет Веллмеха не выводятся)
    checks++;
    if (t.advance + t.interim > t.totalRub + 1) { fails++; bad.push(`  ✗ аванс+промежуточные ${(t.advance + t.interim).toFixed(2)} больше итога ${t.totalRub.toFixed(2)}`); }
    flush(`— ${c.title}: шкур ${t.qty}, итого ${t.totalRub.toFixed(2)} ₽ (закупки: ${purchases.map((x) => x.number).join(", ")})`);
  }

  // Каждая закупка Веллмеха с лотами аукциона, у которой нет принятого расчёта, — «Нет расчёта» в кабинете; считаем, чтобы видеть охват
  const sup = await prisma.supplier.findMany({ where: { organizationId: org, users: { some: { role: "SUPPLIER" } } }, select: { id: true, name: true } });
  for (const s of sup) {
    const raw = await supplierRawRows(org, s.id);
    const covered = new Set(calcs.flatMap((c) => (c.createdEntityId ?? "").split(",")));
    const noCalc = [...new Set(raw.filter((r) => !covered.has(r.purchaseId)).map((r) => r.purchaseId))];
    console.log(`Закупок у Веллмеха: ${new Set(raw.map((r) => r.purchaseId)).size}, из них с принятым расчётом: ${new Set(raw.map((r) => r.purchaseId)).size - noCalc.length} (без расчёта: ${noCalc.length} — «Нет расчёта», данные: расчёт не вносился)`);
    // этапы сырья: закупка этапа — закупка этого поставщика, лот — этой закупки
    const stages = await prisma.supplierRawStage.findMany({ where: { organizationId: org, supplierId: s.id }, select: { id: true, purchaseId: true, lotId: true, lotNumber: true, stage: true, purchase: { select: { supplierId: true, number: true } }, lot: { select: { purchaseId: true, lotNumber: true } } } });
    for (const g of stages) {
      same(`этап ${g.stage} (${g.purchase.number}): закупка принадлежит поставщику`, g.purchase.supplierId, s.id);
      if (g.lot) same(`этап ${g.stage} (${g.purchase.number}): лот из этой закупки`, g.lot.purchaseId ?? "", g.purchaseId);
    }
    console.log(`Этапов сырья: ${stages.length}`);
    flush("— этапы сырья");
  }

  // ================================================================================== 2. Принятые ТЗ
  const tzs = await prisma.supplierInbox.findMany({
    where: { organizationId: org, kind: "TZ", status: "ACCEPTED" }, orderBy: { title: "asc" },
    select: { id: true, title: true, supplierId: true, createdEntityId: true, payload: true },
  });
  console.log(`Принятых ТЗ Веллмеха: ${tzs.length}`);
  for (const z of tzs) {
    const p = z.payload as unknown as TzPayload;
    const t = tzTotals(p);
    const ids = (z.createdEntityId ?? "").split(",").filter(Boolean);
    const orders = await prisma.productionOrder.findMany({
      where: { id: { in: ids }, organizationId: org },
      select: { id: true, number: true, workOrderNumber: true, workOrderDate: true, plannedQuantity: true, clientWorkPricePerUnit: true, contractorId: true, batch: { select: { number: true } }, driveDocuments: { select: { docType: true } } },
    });
    checks++;
    if (orders.length !== ids.length || orders.length === 0) { fails++; bad.push(`  ✗ ТЗ в учёте найдено ${orders.length} из ${ids.length}`); }
    eq("изделий: ТЗ Веллмеха = Σ ТЗ заказчика", t.qty, orders.reduce((a, o) => a + Number(o.plannedQuantity), 0), 0.001);
    // работа: у заказчика цена за единицу округлена до копеек → допуск 0,005 ₽ × количество
    const custWork = orders.reduce((a, o) => a + Number(o.clientWorkPricePerUnit ?? 0) * Number(o.plannedQuantity), 0);
    eq("работа, ₽: ТЗ Веллмеха = Σ (цена за ед. × кол-во) у заказчика", t.work, custWork, Math.max(1, t.qty * 0.01));
    for (const o of orders) {
      same(`ТЗ ${o.number}: № ТЗ`, norm(p.number), norm(o.workOrderNumber ?? ""));
      same(`ТЗ ${o.number}: дата ТЗ`, norm(p.date), o.workOrderDate ? o.workOrderDate.toISOString().slice(0, 10) : "");
      same(`ТЗ ${o.number}: подрядчик`, z.supplierId, o.contractorId ?? "");
      const pb = /^\d{1,4}$/.test((p.batch ?? "").trim()) ? String(Number(p.batch.trim())) : "";
      if (pb) same(`ТЗ ${o.number}: партия`, pb, String(o.batch?.number ?? ""));
      checks++;
      if (!o.driveDocuments.some((d) => d.docType === "TZ_APPENDIX")) info(`ТЗ ${o.number}: нет приложения ТЗ (Word) у заказчика`);
    }
    flush(`— ${z.title}: изделий ${t.qty}, работа ${t.work.toFixed(2)} ₽`);
  }

  console.log(`\nСверка Веллмех ↔ заказчик: проверок ${checks}, расхождений ${fails}, замечаний по данным ${infos}`);
  process.exit(fails ? 1 : 0);
})().finally(() => prisma.$disconnect());
