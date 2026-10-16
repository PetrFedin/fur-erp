/**
 * Групповой внос расчётов Веллмеха к УЖЕ СУЩЕСТВУЮЩИМ закупкам (17 закупок «группы А»): записи «Входящих» (SupplierInbox, AUCTION_CALC)
 * со статусом «Принято» и ссылкой на закупки (createdEntityId = id закупок через запятую) — так же, как десять расчётов import-wellmekh-history.ts.
 * Новых закупок, лотов, документов, списаний и оплат НЕ создаёт; сверка остаётся как была.
 *
 * Расчёт вносится только если итог по каждому счёту совпал с нашей закупкой (с НДС) в допуске копеек (±1 ₽ или 0,005 ₽ × число шкур),
 * а число шкур и лоты совпали. Иначе закупка остаётся без расчёта и попадает в список «не внесено» с причиной.
 * Основание в данных — только номера документов (УПД, счета). Ссылок на файлы и внешние хранилища в записях нет.
 *
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/import-wellmekh-inbound-2026-10-16.ts              # пробный прогон
 *   ... --apply            # создать записи; на боевой базе нужен ещё --live (скрипт сам делает bash scripts/backup.sh)
 *   ... --rollback --apply # удалить созданные записи по журналу
 *   ... --report <файл>    # сохранить отчёт прогона
 * Журнал: docs-inventory/corrections-journal-wellmekh-inbound-2026-10-16[-<копия>].json
 */
import "./stubs/server-only-shim";
import { execSync } from "child_process";
import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { applySheetTable, findHeaderRow, headerScore } from "../src/lib/sheet-paste";
import { getPreset, payloadFromPreset } from "../src/lib/calc-presets";
import { calcAll, calcVatPct, newId, paramKey, syncLetters, emptyPayload, type CalcPayload, type CustomCol } from "../src/lib/supplier-calc";
import { parseXlsxSheets } from "../src/lib/table-file";

const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
const LIVE = process.argv.includes("--live");
const REPORT = process.argv.includes("--report") ? process.argv[process.argv.indexOf("--report") + 1] : "";
const dbNameOf = /\/([^/?]+)(\?|$)/.exec(process.env.DATABASE_URL ?? "")?.[1] ?? "?";
const JOURNAL = join(__dirname, "..", "docs-inventory", `corrections-journal-wellmekh-inbound-2026-10-16${dbNameOf === "fur_erp" ? "" : `-${dbNameOf}`}.json`);
const SRC = join(__dirname, "..", "docs-inventory", "inbound-2026-10-16");
const SUPPLIER_EMAIL = "wellmekh@demo.mvst";
const SENT = new Date("2026-10-16T09:00:00Z");

const out: string[] = [];
const say = (s = "") => { out.push(s); console.log(s); };
const money = (n: number) => n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const r2 = (n: number) => Math.round(n * 100) / 100;
const normS = (s: string | null | undefined) => (s ?? "").trim().toLowerCase().replace(/ё/g, "е").replace(/\s+/g, "");
const normH = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/[^\p{L}\p{N}%]+/gu, " ").trim();
const QTY_H = /^(quantity|кол|количество|шт)(\s|$|\.)/;

type Journal = { created: string[] };
type PurchaseRow = { id: string; number: string; invoiceNumber: string | null; auction: { name: string } | null; items: { lotNumber: string | null; quantity: unknown; subtotal: unknown; vatRate: unknown }[] };
/** Строка итога по счёту: что в расчёте и что в закупке (с НДС). */
type InvCmp = { inv: string; purchase: string; calcQty: number; ourQty: number; calcTotal: number; ourTotal: number; ok: boolean; why: string };
type Plan = { key: string; title: string; payload: CalcPayload; purchaseNumbers: string[]; cmp: InvCmp[]; problems: string[]; basis: string };

/** Номер лота у нас и в файле: точно, без суффикса «-2» (разбитый лот), по хвостовым цифрам. */
const lotLevels: ((a: string, b: string) => boolean)[] = [
  (a, b) => a === b,
  (a, b) => a.replace(/-\d+$/, "") === b.replace(/-\d+$/, ""),
  (a, b) => { const ta = /(\d+)$/.exec(a)?.[1], tb = /(\d+)$/.exec(b)?.[1]; return !!ta && ta === tb; },
];
const ourTotal = (p: PurchaseRow) => p.items.reduce((s, i) => s + Number(i.subtotal) * (1 + Number(i.vatRate) / 100), 0);
const ourQty = (p: PurchaseRow) => p.items.reduce((s, i) => s + Number(i.quantity), 0);
const tolFor = (qty: number) => Math.max(1, 0.005 * qty);

// ───────── лотовые таблицы (СП/РП 03-25): заголовки файла → формат sp_rp_2025
const isHeaderRow = (row: string[]) => headerScore(row) >= 3 && row.map(normH).some((x) => /^(invoice|счет|номер счета)(\s|$)/.test(x)) && row.map(normH).some((x) => /^(lot|лот)/.test(x)) && row.map(normH).some((x) => QTY_H.test(x));
function lotTable(table: string[][]): string[][] {
  const h = table.findIndex(isHeaderRow);
  const qi = table[h].map(normH).findIndex((x) => QTY_H.test(x));
  const data = table.slice(h + 1).filter((r) => /^[\d\s.,]+$/.test((r[qi] ?? "").trim()) && (r[qi] ?? "").trim() !== "");
  return [...table.slice(0, h + 1), ...data];
}

/** Расчёт из лотовой таблицы файла по формату; возвращает payload и таблицу счетов. */
async function fromLotFile(file: string, presetId: string, auction: string, invAlias: Record<string, string> = {}): Promise<CalcPayload | string> {
  const sheets = await parseXlsxSheets(readFileSync(join(SRC, file)), 1_500_000);
  const table = lotTable(sheets[0]);
  const pr = getPreset(presetId)!;
  const hi = findHeaderRow(table);
  const base = payloadFromPreset(pr);
  const r = applySheetTable(base, table);
  void hi;
  if ("error" in r) return r.error;
  const p = r.payload;
  p.stage = "FINAL";
  p.header.auction = auction;
  p.rows = p.rows.map((row) => (row.invoice && invAlias[row.invoice] ? { ...row, invoice: invAlias[row.invoice] } : row));
  return p;
}

/** Сверка расчёта (строки с номером счёта) с закупками по счетам. */
function compareInvoices(p: CalcPayload, purchases: PurchaseRow[], candidates: PurchaseRow[], opts: { lots: boolean }): { cmp: InvCmp[]; problems: string[]; numbers: string[] } {
  const t = calcAll(p);
  const sh = t.sheet;
  const unitAt = (i: number) => sh.cells[sh.unitCol]?.[i]?.v ?? NaN;
  const byInv = new Map<string, number[]>();
  p.rows.forEach((row, i) => { if (!sh.used[i]) return; (byInv.get(row.invoice || "") ?? byInv.set(row.invoice || "", []).get(row.invoice || "")!).push(i); });
  void purchases;
  const cmp: InvCmp[] = [], problems: string[] = [], numbers: string[] = [];
  for (const [inv, idxs] of byInv) {
    const cand = candidates.filter((c) => normS(c.invoiceNumber) === normS(inv));
    if (cand.length !== 1) { problems.push(`счёт ${inv}: закупок с таким номером среди целевых ${cand.length}`); continue; }
    const pu = cand[0];
    numbers.push(pu.number);
    const calcQty = idxs.reduce((s, i) => s + t.qtys[i], 0);
    const calcTotal = idxs.reduce((s, i) => s + (unitAt(i) || 0) * t.qtys[i], 0);
    const oq = ourQty(pu), ot = ourTotal(pu);
    let why = "";
    if (Math.abs(calcQty - oq) > 0.0005) why = `шкур в расчёте ${calcQty}, в закупке ${oq}`;
    else if (opts.lots) {
      const used = new Set<number>();
      for (const i of idxs) {
        let k = -1;
        for (const eq of lotLevels) { k = pu.items.findIndex((it, j) => !used.has(j) && eq(normS(it.lotNumber), normS(p.rows[i].lot)) && Number(it.quantity) === t.qtys[i]); if (k >= 0) break; }
        if (k < 0) { why = `лот ${p.rows[i].lot} (${t.qtys[i]} шт.) не найден в закупке`; break; }
        used.add(k);
      }
      if (!why && pu.items.length !== idxs.length) why = `лотов в расчёте ${idxs.length}, в закупке ${pu.items.length}`;
    }
    const diff = calcTotal - ot;
    if (!why && Math.abs(diff) > tolFor(calcQty)) why = `итог расчёта ${money(calcTotal)}, у нас ${money(ot)} (разница ${money(diff)} ₽ больше допуска ${tolFor(calcQty).toFixed(2)} ₽)`;
    cmp.push({ inv, purchase: pu.number, calcQty, ourQty: oq, calcTotal, ourTotal: ot, ok: !why, why });
    if (why) problems.push(`счёт ${inv} (${pu.number}): ${why}`);
  }
  return { cmp, problems, numbers };
}

/** Свободная таблица по формату с готовыми строками-«сводками по счетам» (одна строка на счёт). */
function summaryPayload(presetId: string, auction: string, params: Record<string, string>, rows: Record<string, string>[], currency = "RUB"): CalcPayload {
  const pr = getPreset(presetId)!;
  const p = payloadFromPreset(pr);
  p.params = (p.params ?? []).map((q) => (q.name in params ? { ...q, value: params[q.name] } : q));
  p.rows = rows.map((r) => ({ _id: newId(), ...r }));
  p.stage = "FINAL";
  p.header.auction = auction;
  p.header.currency = currency;
  return p;
}

/** Добавить столбец в свободную таблицу (буквы выставляются заново). */
function addCol(p: CalcPayload, c: Omit<CustomCol, "letter">): CalcPayload {
  return syncLetters({ ...p, customColumns: [...(p.customColumns ?? []), { ...c, letter: "?" }] });
}
const numCell = (s: string | undefined) => { const x = Number(String(s ?? "").replace(/\s/g, "").replace(",", ".")); return Number.isFinite(x) ? x : NaN; };

async function buildPlans(purchases: PurchaseRow[]): Promise<Plan[]> {
  const plans: Plan[] = [];
  const byNum = (nums: string[]) => purchases.filter((p) => nums.includes(p.number));
  /** Номер лота нашей закупки с единственной позицией (в сводке по счёту лота нет — берём номер из закупки). */
  const lotOf = (n: string) => (purchases.find((x) => x.number === n)?.items.length === 1 ? purchases.find((x) => x.number === n)!.items[0].lotNumber ?? "" : "");
  const add = (key: string, title: string, basis: string, payload: CalcPayload, targets: string[], lots: boolean) => {
    const c = compareInvoices(payload, purchases, byNum(targets), { lots });
    const missing = targets.filter((n) => !c.numbers.includes(n));
    const problems = [...c.problems, ...missing.map((n) => `закупка ${n} не получила счёта в расчёте`)];
    plans.push({ key, title, payload, purchaseNumbers: c.numbers, cmp: c.cmp, problems, basis });
  };

  // РП 03-25 и СП 03-25: лотовые таблицы
  const rp = await fromLotFile("rp-0325-upd.xlsx", "sp_rp_2025", "РП 03-25");
  if (typeof rp === "string") plans.push({ key: "rp0325", title: "РП 03-25", payload: payloadFromPreset(getPreset("sp_rp_2025")!), purchaseNumbers: [], cmp: [], problems: [rp], basis: "" });
  else add("rp0325", "РП 03-25", "УПД №77 от 16.05.2025, счета 2153–2157", rp, ["З-2026-0014", "З-2026-0015", "З-2026-0016", "З-2026-0017", "З-2026-0018"], true);
  const sp = await fromLotFile("sp-0325-upd.xlsx", "sp_rp_2025", "СП 03-25", { "1351": "1046" });
  if (typeof sp === "string") plans.push({ key: "sp0325", title: "СП 03-25", payload: payloadFromPreset(getPreset("sp_rp_2025")!), purchaseNumbers: [], cmp: [], problems: [sp], basis: "" });
  else add("sp0325", "СП 03-25", "счета 1046, 1048–1053", sp, ["З-2026-0020", "З-2026-0021", "З-2026-0022", "З-2026-0023", "З-2026-0024", "З-2026-0025", "З-2026-0026"], true);
  // КФХ Дуденко: З-2026-0005 (счёт 5К7), финальный расчёт «молоток → НДС → выделка → перевозка → комиссия»
  {
    const sheets = await parseXlsxSheets(readFileSync(join(SRC, "mink-brown-0725.xlsx")), 1_500_000);
    const r = sheets[0][2];
    const qty = numCell(r[2]), hammer = numCell(r[4]), dress = numCell(r[7]), transp = numCell(r[8]);
    const p = summaryPayload("sp_rp_summary_2025", "КФХ Дуденко 07-25", { ндс_проц: "20", выделка_без_ндс: String(dress / 1.2 / qty), перевозка_на_шкуру: String(transp / qty), ком_проц: "4.5" },
      [{ invoice: String(r[1]).trim(), fur: "Норка коричневая", lot: lotOf("З-2026-0005"), k_C: String(qty), k_D: String(hammer), k_F: "0" }]);
    add("duden5k7", "КФХ Дуденко 07-25 · 5К7", "счёт №117 от 29.07.2025, УПД, спецификация №3", p, ["З-2026-0005"], false);
  }
  // КФХ Дуденко: З-2026-0006, 0007 (счета 7 и 8, приложение 6, УПД №122 от 26.08.2025) — по «Для УПД»
  {
    // данные фактического расчёта приложения 6: счёт, описание, шт., цена без НДС, молоток, услуги выделка+крашение (с НДС), перевозка (с НДС), цена для УПД
    const rows = [
      { inv: "7", fur: "Норка браун 0 F", qty: 150, price: 5050, hammer: 757500, dress: 37500, transp: 18.18181818, upd: 6538 },
      { inv: "8", fur: "Норка серебристо-голубая 50 M", qty: 70, price: 7481, hammer: 523670, dress: 28524, transp: 18.18181818, upd: 9722 },
    ];
    let p = summaryPayload("sp_rp_summary_2025", "КФХ Дуденко 07-25", { ндс_проц: "20", выделка_без_ндс: "0", перевозка_на_шкуру: "0", ком_проц: "4.5" },
      rows.map((x) => ({ invoice: x.inv, fur: x.fur, lot: lotOf(x.inv === "7" ? "З-2026-0006" : "З-2026-0007"), k_C: String(x.qty), k_D: String(x.hammer), k_F: "0", ["@" + paramKey("выделка_без_ндс")]: String(x.dress / 1.2 / x.qty), ["@" + paramKey("перевозка_на_шкуру")]: String(x.transp / x.qty), k_upd: String(x.upd) })));
    p = addCol(p, { id: "k_upd", title: "Цена для УПД, ₽", unit: "₽", kind: "input", formula: "" });
    p.unitCostColumn = "k_upd";
    add("duden78", "КФХ Дуденко 07-25 · 7, 8", "УПД №122 от 26.08.2025, счёт №122 от 04.08.2025, приложение 6", p, ["З-2026-0006", "З-2026-0007"], false);
  }
  // Подкладка 05.26 (ткань, Турция): З-2026-0061, счёт 157, УПД №233
  {
    const sheets = await parseXlsxSheets(readFileSync(join(SRC, "lining-0526.xlsx")), 1_500_000);
    const t = sheets[0];
    const calcRows = t.slice(2, 10).filter((r) => (r[0] ?? "").trim() && numCell(r[1]) > 0);
    const updRows = t.slice(12, 20).filter((r) => (r[0] ?? "").trim() && numCell(r[1]) > 0);
    const rate = String(numCell(calcRows[0][6]));
    let p = summaryPayload("lining_import", "Подкладка 05-26", { курс: rate, карго_проц: "2", нал_проц: "10", ндс_проц: "22", ком_проц: "4.5" },
      calcRows.map((r, i) => ({ invoice: "157", fur: r[0].trim(), k_B: String(numCell(r[1])), k_C: String(numCell(r[2])), k_E: String(numCell(r[4])), k_upd: String(numCell(updRows[i]?.[2])) })));
    p = addCol(p, { id: "k_upd", title: "Цена для УПД, ₽", unit: "₽", kind: "input", formula: "" });
    p.unitCostColumn = "k_upd";
    add("lining0526", "Подкладка 05-26", "УПД №233, счёт №157", p, ["З-2026-0061"], false);
  }
  // Доп. материалы 06.26: З-2026-0062, счёт 181 — строки расчёта (суммы УПД) с количествами из спецификации закупки
  {
    const sheets = await parseXlsxSheets(readFileSync(join(SRC, "extra-0626.xlsx")), 1_500_000);
    const lines = sheets[0].slice(2, 4).map((r) => ({ name: r[0].trim(), buy: numCell(r[1]), upd: numCell(r[4]) }));
    const pu = purchases.find((x) => x.number === "З-2026-0062");
    const rows: Record<string, string>[] = [];
    for (const l of lines) {
      const it = pu?.items.find((i) => Math.abs(Number(i.subtotal) * (1 + Number(i.vatRate) / 100) - l.upd) <= 0.05);
      rows.push({ invoice: "181", fur: l.name.replace("альпако", "альпака"), k_q: String(it ? Number(it.quantity) : 1), k_buy: String(l.buy), k_upd: String(l.upd) });
    }
    let p = emptyPayload("SHEET");
    p.params = [{ name: "ндс_проц", label: "НДС, %", value: "22" }, { name: "ком_проц", label: "Комиссия РМ, %", value: "4.5" }];
    p.rows = rows.map((r) => ({ _id: newId(), ...r }));
    p = addCol(p, { id: "k_q", title: "Количество", unit: "м.п.", kind: "input", formula: "" });
    p = addCol(p, { id: "k_buy", title: "Закупка без НДС (строка), ₽", unit: "₽", kind: "input", formula: "" });
    p = addCol(p, { id: "k_vat", title: "С НДС (строка), ₽", unit: "₽", kind: "formula", formula: "=E*(1+ндс_проц/100)" });
    p = addCol(p, { id: "k_com", title: "С комиссией (строка), ₽", unit: "₽", kind: "formula", formula: "=F*(1+ком_проц/100)" });
    p = addCol(p, { id: "k_upd", title: "Цена для УПД (строка), ₽", unit: "₽", kind: "input", formula: "" });
    p = addCol(p, { id: "k_unit", title: "Цена за единицу, ₽", unit: "₽", kind: "formula", formula: "=H/D" });
    p.qtyColumn = "k_q"; p.unitCostColumn = "k_unit"; p.stage = "FINAL"; p.header.auction = "Доп. материалы 06-26"; p.header.currency = "RUB";
    add("extra0626", "Доп. материалы 06-26", "УПД, счёт №181", p, ["З-2026-0062"], false);
  }
  return plans;
}

async function main() {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const prisma = createAuditedClient("script:wellmekh-inbound");
  say(`База: ${dbNameOf}${APPLY ? " · ЗАПИСЬ" : " · пробный прогон (ничего не меняется)"}`);
  if (APPLY && dbNameOf === "fur_erp" && !LIVE) throw new Error("Это боевая база fur_erp: сначала проверьте на копии; на боевой — только с явным --live после согласия владельца");
  const user = await prisma.user.findFirstOrThrow({ where: { email: SUPPLIER_EMAIL, role: "SUPPLIER" }, select: { id: true, organizationId: true, supplierId: true } });
  const orgId = user.organizationId, supplierId = user.supplierId!;
  const owner = await prisma.user.findFirstOrThrow({ where: { organizationId: orgId, role: "OWNER", isActive: true }, select: { id: true } });

  if (ROLLBACK) {
    const j = JSON.parse(readFileSync(JOURNAL, "utf8")) as Journal;
    say(`Откат: удалить записей ${j.created.length}`);
    if (!APPLY) return say("пробный откат — добавьте --apply");
    if (dbNameOf === "fur_erp") execSync("bash scripts/backup.sh", { stdio: "inherit", cwd: join(__dirname, "..") });
    for (const id of j.created) await prisma.supplierInbox.deleteMany({ where: { id, organizationId: orgId } });
    return say("откат выполнен");
  }

  const purchases = (await prisma.purchase.findMany({
    where: { organizationId: orgId, supplierId, status: { not: "CANCELLED" } },
    select: { id: true, number: true, invoiceNumber: true, auction: { select: { name: true } }, items: { select: { lotNumber: true, quantity: true, subtotal: true, vatRate: true } } },
  })) as PurchaseRow[];
  const already = new Set((await prisma.supplierInbox.findMany({ where: { organizationId: orgId, supplierId, kind: "AUCTION_CALC", note: { startsWith: "история:" } }, select: { note: true } })).map((x) => (x.note ?? "").split("\n")[0]));
  const linked = await prisma.supplierInbox.findMany({ where: { organizationId: orgId, supplierId, kind: "AUCTION_CALC" }, select: { createdEntityId: true } });
  const linkedIds = new Set(linked.flatMap((l) => (l.createdEntityId ?? "").split(",")));

  const plans = await buildPlans(purchases);
  say("\n══════════ ЧТО ЗАПИШЕТСЯ ══════════");
  const good: Plan[] = [];
  for (const pl of plans) {
    const t = calcAll(pl.payload);
    const ok = pl.problems.length === 0 && pl.cmp.length > 0;
    const ids = pl.purchaseNumbers.map((n) => purchases.find((p) => p.number === n)!.id);
    const isDup = ids.some((id) => linkedIds.has(id));
    say(`\n${ok ? (isDup ? "= уже есть расчёт" : "✔ ВНОСИМ") : "✘ НЕ ВНОСИМ"}  ${pl.title}  · шкур ${t.qty}, итого ${money(t.totalRub)} ₽ · НДС ${calcVatPct(pl.payload) ?? "—"}${pl.basis ? ` · основание: ${pl.basis}` : ""}`);
    for (const c of pl.cmp) say(`   счёт ${c.inv} → ${c.purchase}: шкур ${c.calcQty}/${c.ourQty}, расчёт ${money(c.calcTotal)}, закупка ${money(c.ourTotal)}, разница ${money(c.calcTotal - c.ourTotal)}${c.ok ? "" : " ✘"}`);
    for (const x of pl.problems) say(`   · ${x}`);
    if (ok && !isDup) good.push(pl);
  }
  say(`\nИтого к внесению: расчётов ${good.length}, закупок ${good.reduce((s, g) => s + g.purchaseNumbers.length, 0)}`);
  if (REPORT) writeFileSync(REPORT, out.join("\n"));
  if (!APPLY) return say("пробный прогон: БД не тронута");
  if (LIVE) execSync("bash scripts/backup.sh", { stdio: "inherit", cwd: join(__dirname, "..") });

  const journal: Journal = existsSync(JOURNAL) ? (JSON.parse(readFileSync(JOURNAL, "utf8")) as Journal) : { created: [] };
  for (const pl of good) {
    const p = pl.payload;
    const t = calcAll(p);
    const inv = [...new Set(p.rows.map((r) => r.invoice).filter(Boolean))];
    p.header.invoice = inv.join(", ");
    const marker = `история:${createHash("md5").update(`inbound-2026-10-16:${pl.key}`).digest("hex")}`;
    if (already.has(marker)) { say(`уже заведено: ${pl.title}`); continue; }
    const ids = pl.purchaseNumbers.map((n) => purchases.find((x) => x.number === n)!.id);
    const row = await prisma.supplierInbox.create({
      data: {
        organizationId: orgId, supplierId, createdById: user.id, kind: "AUCTION_CALC", status: "ACCEPTED", title: `${p.header.auction} · счёт ${p.header.invoice}`.slice(0, 160),
        payload: { ...p, totals: { qty: t.qty, totalRub: r2(t.totalRub) } } as never,
        note: pl.basis ? `${marker}\nОснование: ${pl.basis}` : marker, sentAt: SENT, decidedAt: SENT, decidedById: owner.id,
        createdEntityType: "Purchase", createdEntityId: ids.join(","),
      },
    });
    journal.created.push(row.id);
    mkdirSync(join(__dirname, "..", "docs-inventory"), { recursive: true });
    writeFileSync(JOURNAL, JSON.stringify(journal, null, 1));
    say(`создан расчёт ${row.id}: ${row.title}`);
  }
  say(`журнал: ${JOURNAL}`);
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
