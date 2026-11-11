/**
 * Сквозная цепочка артикула (прототип единой витрины): сырьё → лот → закупка → оплаты → ТЗ → получено → продано → остаток → деньги, с контрольными сверками.
 * Только чтение. Пишет отчёт в docs/data-mart/trace-<код>-<дата>.md и в консоль.
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/trace-article-chain.ts M002
 */
import "./stubs/server-only-shim";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const n = (v: unknown) => Number(v ?? 0) || 0;
const f0 = (v: number) => Math.round(v).toLocaleString("ru-RU");
const f2 = (v: number) => v.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

(async () => {
  const code = (process.argv[2] ?? "M002").toUpperCase();
  const { prisma } = await import("../src/lib/prisma");
  const { loadReportSizes } = await import("../src/lib/margin-server");
  const { loadRetailPricesState } = await import("../src/lib/import-keys");
  const { normCode } = await import("../src/lib/sales-receipts-core");
  const org = (await prisma.organization.findFirstOrThrow({ orderBy: { createdAt: "asc" } })).id;
  const L: string[] = [];
  const out = (s = "") => { L.push(s); console.log(s); };
  const norm = normCode(code);

  // 1. Модель и ТЗ
  const models = (await prisma.productModel.findMany({ where: { organizationId: org }, select: { id: true, name: true, salesCode: true, salesName: true, category: true, sellingPrice: true, isActive: true } })).filter((m) => normCode(m.name) === norm || normCode(m.salesCode ?? "") === norm);
  out(`# Сквозная цепочка артикула ${code}`); out(`_Собрано ${new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })}, только чтение._`); out();
  out("## 1. Модель и ТЗ");
  if (!models.length) out(`Модель «${code}» в «Изделиях» не найдена (проверьте написание: латиница/кириллица, с дефисом или без).`);
  for (const m of models) out(`- Модель: **${m.name}** (код в продажах ${m.salesCode ?? "—"}, «${m.salesName ?? "—"}», категория ${m.category ?? "—"}, цена ${m.sellingPrice ? f0(n(m.sellingPrice)) + " ₽" : "—"}, ${m.isActive ? "активна" : "выключена"}).`);
  const orders = await prisma.productionOrder.findMany({ where: { organizationId: org, productModelId: { in: models.map((m) => m.id) }, status: { not: "CANCELLED" } }, orderBy: { number: "asc" }, select: { id: true, number: true, status: true, plannedQuantity: true, producedQuantity: true, color: true, size: true, lining: true, materialDescription: true, clientWorkPricePerUnit: true, materialUsages: { select: { quantity: true, totalCost: true, lot: { select: { id: true, lotNumber: true, unitCost: true, purchase: { select: { number: true, auctionSession: true, orderDate: true, exchangeRate: true, supplier: { select: { name: true } } } } } }, rawMaterial: { select: { name: true, unit: true } } } } } });
  out(`ТЗ: ${orders.length} шт.; заказано ${f0(orders.reduce((a, o) => a + n(o.plannedQuantity), 0))}, произведено ${f0(orders.reduce((a, o) => a + n(o.producedQuantity), 0))}.`); out();
  out("| ТЗ | Статус | Заказано | Произведено | Цвет | Размеры | Подкладка в ТЗ | Материалов списано, ₽ |"); out("|---|---|---|---|---|---|---|---|");
  for (const o of orders) out(`| ${o.number} | ${o.status} | ${f0(n(o.plannedQuantity))} | ${f0(n(o.producedQuantity))} | ${o.color ?? ""} | ${o.size ?? ""} | ${o.lining ?? "—"} | ${f0(o.materialUsages.reduce((a, u) => a + n(u.totalCost), 0))} |`);

  // 2. Сырьё: лоты → закупки → оплаты
  out(); out("## 2. Сырьё: лоты, закупки, оплаты");
  const lots = new Map<string, { lot: string; purchase: string; auction: string; supplier: string; qty: number; cost: number; fur: boolean }>();
  for (const o of orders) for (const u of o.materialUsages) { const l = u.lot; const k = l.id; const a = lots.get(k) ?? { lot: l.lotNumber ?? "—", purchase: l.purchase?.number ?? "—", auction: l.purchase?.auctionSession ?? "—", supplier: l.purchase?.supplier.name ?? "—", qty: 0, cost: 0, fur: u.rawMaterial.unit !== "M" }; a.qty += n(u.quantity); a.cost += n(u.totalCost); lots.set(k, a); }
  const furLots = [...lots.values()].filter((l) => l.fur), linLots = [...lots.values()].filter((l) => !l.fur);
  out(`Лотов меха: ${furLots.length}, подкладки: ${linLots.length}. Списано шкур ${f0(furLots.reduce((a, l) => a + l.qty, 0))} на ${f0(furLots.reduce((a, l) => a + l.cost, 0))} ₽; подкладки ${f2(linLots.reduce((a, l) => a + l.qty, 0))} м на ${f0(linLots.reduce((a, l) => a + l.cost, 0))} ₽.`);
  const byAuc = new Map<string, { qty: number; cost: number }>();
  for (const l of furLots) { const a = byAuc.get(l.auction) ?? { qty: 0, cost: 0 }; a.qty += l.qty; a.cost += l.cost; byAuc.set(l.auction, a); }
  out(); out("| Аукцион / закупка | Шкур списано | Стоимость, ₽ | Оплачено по аукциону целиком, ₽ |"); out("|---|---|---|---|");
  for (const [auc, v] of byAuc) { const pays = auc === "—" ? [] : await prisma.payment.findMany({ where: { organizationId: org, auctionSession: auc, status: "COMPLETED" }, select: { amount: true } }); out(`| ${auc} | ${f0(v.qty)} | ${f0(v.cost)} | ${auc === "—" ? "—" : f0(pays.reduce((a, p) => a + n(p.amount), 0))} |`); }

  // 3. Отчёт «заказ и продажи»: получено, продано, остаток, закупка в €
  out(); out("## 3. Отчёт «заказ и продажи» (эталон)");
  const sizes = (await loadReportSizes(org)).filter((r) => normCode(r.modelCode ?? r.acode.split("/")[0] ?? "") === norm);
  const prices = ((await loadRetailPricesState(org))?.value as { rows?: { acode: string; color: string; size: string; price: number }[] } | undefined)?.rows ?? [];
  const priceOf = (r: { acode: string; color: string; size: string }) => prices.find((p) => p.acode === r.acode && p.color === r.color && p.size === r.size)?.price ?? null;
  const seasons = ["FW25/26", "SS26", "FW26/27"];
  const sum = (f: (r: (typeof sizes)[number]) => number) => sizes.reduce((a, r) => a + f(r), 0);
  const deliv = sum((r) => seasons.reduce((a, s) => a + (r.seas?.[s]?.deliv ?? 0), 0)), conf = sum((r) => seasons.reduce((a, s) => a + (s === "FW26/27" ? r.seas?.[s]?.conf ?? 0 : r.seas?.[s]?.conf ?? r.seas?.[s]?.deliv ?? 0), 0)), sold = sum((r) => r.sold ?? 0), delivEur = sum((r) => seasons.reduce((a, s) => a + (r.seas?.[s]?.delivEur ?? 0), 0));
  out(`Строк размеров: ${sizes.length}. Заказано ${f0(conf)}, получено ${f0(deliv)}, продано ${f0(sold)}, остаток **${f0(deliv - sold)}** (получено − продано).`);
  out(`Закупка по отчёту: поступило ${f0(delivEur)} € ⇒ ${deliv > 0 ? f2(delivEur / deliv) : "—"} €/шт. = ${deliv > 0 ? f0((delivEur / deliv) * 110) : "—"} ₽/шт. (курс 110).`);
  const stockPrice = sizes.reduce((a, r) => { const st = seasons.reduce((x, s) => x + (r.seas?.[s]?.deliv ?? 0), 0) - (r.sold ?? 0); const p = priceOf(r); return p && st > 0 ? a + st * p : a; }, 0);
  out(`Остаток по прайсу (по размерам): ${f0(stockPrice)} ₽.`);
  const byLeaf = new Map<string, { d: number; s: number }>();
  for (const r of sizes) { const k = `${r.acode} · ${r.color}`; const a = byLeaf.get(k) ?? { d: 0, s: 0 }; a.d += seasons.reduce((x, s) => x + (r.seas?.[s]?.deliv ?? 0), 0); a.s += r.sold ?? 0; byLeaf.set(k, a); }
  out(); out("| Артикул · цвет | Получено | Продано | Остаток |"); out("|---|---|---|---|");
  for (const [k, v] of byLeaf) out(`| ${k} | ${v.d} | ${v.s} | ${v.d - v.s < 0 ? "–" : v.d - v.s} |`);

  // 4. Файл «поступления и продажи»: даты
  out(); out("## 4. Файл «поступления и продажи» (даты)");
  const lines = (await prisma.salesReceiptLine.findMany({ where: { organizationId: org, modelCode: { not: null } }, select: { kind: true, pcs: true, date: true, season: true, article: true, modelCode: true, retailRub: true } })).filter((l) => normCode(l.modelCode ?? "") === norm);
  const rec = lines.filter((l) => l.kind === "RECEIPT").reduce((a, l) => a + n(l.pcs), 0), sal = lines.filter((l) => l.kind === "SALE").reduce((a, l) => a + n(l.pcs), 0), rev = lines.filter((l) => l.kind === "SALE").reduce((a, l) => a + n(l.retailRub), 0);
  const months = new Map<string, number>(); for (const l of lines.filter((x) => x.kind === "RECEIPT")) { const m = l.date.toISOString().slice(0, 7); months.set(m, (months.get(m) ?? 0) + n(l.pcs)); }
  out(`Приход по строкам файла ${f0(rec)} (по месяцам: ${[...months].sort().map(([m, v]) => `${m}: ${v}`).join(", ") || "—"}), продажи ${f0(sal)}, выручка ${f0(rev)} ₽ с НДС.`);

  // 5. Сверки
  out(); out("## 5. Сверки цепочки");
  const tzProduced = orders.reduce((a, o) => a + n(o.producedQuantity), 0), tzCost = orders.reduce((a, o) => a + o.materialUsages.reduce((x, u) => x + n(u.totalCost), 0), 0);
  const chk = (ok: boolean, text: string) => out(`- ${ok ? "✅" : "⚠️"} ${text}`);
  chk(tzProduced === deliv, `ТЗ произведено ${f0(tzProduced)} и получено по отчёту ${f0(deliv)} ${tzProduced === deliv ? "совпадают" : `расходятся на ${f0(tzProduced - deliv)} шт.`}`);
  chk(rec === deliv, `Приход по строкам файла ${f0(rec)} и получено по отчёту ${f0(deliv)} ${rec === deliv ? "совпадают" : `расходятся на ${f0(rec - deliv)} шт.`}`);
  chk(sal === sold, `Продано по строкам файла ${f0(sal)} и по отчёту ${f0(sold)} ${sal === sold ? "совпадают" : `расходятся на ${f0(sal - sold)} шт.`}`);
  const tzUnit = deliv > 0 ? tzCost / deliv : 0, repUnit = deliv > 0 ? (delivEur / deliv) * 110 : 0;
  chk(Math.abs(tzUnit - repUnit) < repUnit * 0.05 || !repUnit, `Материалы по ТЗ на изделие ${f0(tzUnit)} ₽ (без работы) и закупка по отчёту ${f0(repUnit)} ₽: ${repUnit ? `разница ${(((tzUnit - repUnit) / repUnit) * 100).toFixed(1)} % (в отчёте закупка включает работу, сборы и НДС, в ТЗ только списанные материалы)` : "нет данных отчёта"}`);
  // Полная себестоимость по ТЗ (материалы + 4 % + расходы + работа, с НДС) — то же, что «Изделия → За ед.»; сравнение с закупкой по отчёту.
  try {
    const { loadOrderRows } = await import("../src/lib/analytics-orders");
    const ids = new Set(orders.map((o) => o.id));
    const rows = (await loadOrderRows(org, "all", "on")).filter((r) => ids.has(r.id));
    const q = rows.reduce((a, r) => a + r.qty, 0), full = rows.reduce((a, r) => a + r.costIncl + r.work, 0), work = rows.reduce((a, r) => a + r.work, 0);
    const fullUnit = q > 0 ? full / q : 0;
    out(`- Полная себестоимость по ТЗ: ${f0(fullUnit)} ₽/изд. (материалы+4 %+расходы ${f0(q > 0 ? (full - work) / q : 0)} + работа ${f0(q > 0 ? work / q : 0)}), по отчёту закупка ${f0(repUnit)} ₽/изд.: ${repUnit && fullUnit ? `разница ${(((fullUnit - repUnit) / repUnit) * 100).toFixed(1)} %` : "нет данных"}.`);
  } catch (e) { out(`- Полная себестоимость по ТЗ: не удалось прочитать (${String(e).slice(0, 80)}).`); }
  chk(sizes.length > 0 && models.length > 0, `Связь «модель в изделиях ↔ строки отчёта» по коду: модель ${models.length ? "найдена" : "не найдена"}, строк отчёта ${sizes.length}.`);
  const dir = join(__dirname, "..", "docs", "data-mart"); const path = join(dir, `trace-${code}-${new Date().toISOString().slice(0, 10)}.md`);
  writeFileSync(path, L.join("\n") + "\n"); console.log("\nФайл:", path);
  process.exit(0);
})().catch((e) => { console.error(String(e).slice(0, 900)); process.exit(1); });
