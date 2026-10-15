/**
 * Всё присланное Веллмехом раньше — в его кабинет, как записи «Входящих» со статусом «Принято» и ссылкой на УЖЕ СУЩЕСТВУЮЩИЕ
 * наши закупки и ТЗ. Новых закупок, ТЗ, лотов и списаний скрипт не создаёт; сверка остаётся как была.
 *
 *  1. Расчёты аукционов: берутся присланные Excel-файлы (письма: ~/Downloads/MEH_PST_EXTRACT/_INDEX/attachments + файл СП 09-26 из
 *     ~/Downloads). По названию аукциона выбирается формат (calc-presets.json), лоты вставляются по заголовкам файла, формулы формата
 *     пересчитывают всё. Запись создаётся ТОЛЬКО если:
 *       • формулы формата воспроизвели файл без единой ручной правки, итоги всех сверенных столбцов совпали с файлом;
 *       • каждый счёт файла нашёл нашу закупку с тем же номером счёта, лоты и количества совпали;
 *       • себестоимость каждой шкуры совпала с нашей закупкой (costPlan.unitCostInclVat или себестоимость лота) до копейки,
 *         итог по счёту совпал до копейки.
 *     Иначе — ничего не создаётся, в отчёте стоят причина и числа.
 *  2. ТЗ: присланные Word «ПРИЛОЖЕНИЕ N» разбираются, по данным собирается Word заново (src/lib/tz-docx-vendor.ts) и сверяется с оригиналом
 *     по тексту и вёрстке. Запись создаётся только при нуле расхождений и если номер ТЗ есть у нас (ProductionOrder.workOrderNumber)
 *     с тем же числом позиций и изделий. Остальные ТЗ перечисляются отдельно, ничего не подгоняется.
 *
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/import-wellmekh-history.ts              # пробный прогон (БД не меняется)
 *   ... --apply            # создать записи; на боевой базе нужен ещё --live (скрипт сам делает scripts/backup.sh)
 *   ... --rollback --apply # удалить созданные записи по журналу, вернуть изменённые
 *   ... --report <файл>    # сохранить отчёт пробного прогона в файл
 *   ... --tol 0.02         # допуск на шкуру, ₽ (по умолчанию 0,005: «до копейки»); округление частей в нашей закупке даёт до 0,02
 * Журнал: docs-inventory/corrections-journal-wellmekh-history-2026-10-15.json
 */
import "./stubs/server-only-shim";
import { execSync } from "child_process";
import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { homedir } from "os";
import { basename, join } from "path";
import { docxBlocks, layoutDiff, payloadFromDocx, textDiff } from "./lib/tz-docx-import";
import { buildTzDocx } from "../src/lib/tz-docx-vendor";
import { applySheetTable, findHeaderRow } from "../src/lib/sheet-paste";
import { getPreset, payloadFromPreset } from "../src/lib/calc-presets";
import { calcAll, type CalcPayload } from "../src/lib/supplier-calc";
import { parseTableFile } from "../src/lib/table-file";
import { tzTotals, type TzPayload } from "../src/lib/tz-vendor";

const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
const LIVE = process.argv.includes("--live");
const TOL = process.argv.includes("--tol") ? Number(process.argv[process.argv.indexOf("--tol") + 1]) : 0.005;
const REPORT = process.argv.includes("--report") ? process.argv[process.argv.indexOf("--report") + 1] : "";
const JOURNAL = join(__dirname, "..", "docs-inventory", "corrections-journal-wellmekh-history-2026-10-15.json");
const MAIL = join(homedir(), "Downloads", "MEH_PST_EXTRACT", "_INDEX");
const DOWNLOADS = join(homedir(), "Downloads");
const SUPPLIER_EMAIL = "wellmekh@demo.mvst";

const out: string[] = [];
const say = (s = "") => { out.push(s); console.log(s); };
const money = (n: number) => n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Название аукциона в файле → формат расчёта. */
const FORMATS: [RegExp, string][] = [
  [/СОЮЗПУШНИНА 09-26/i, "sp_0926"], [/СОЮЗПУШНИНА 05-26/i, "sp_2026"], [/Русьпушнина 04-26/i, "rp_2026"],
  [/СОЮЗПУШНИНА 12-25/i, "sp_rp_2025"], [/Русьпушнина\+Союзпушнина 05-25/i, "sp_rp_2025"],
  [/SAGA 03-26/i, "saga_03_26"], [/SAGA 03-25/i, "saga_03_25"], [/SAGA 06-25/i, "saga_06_25"], [/FH 06-26/i, "fh_lynx_2026"], [/ALE 05-26|AME 05-26/i, "ame_05_26"],
];

type Journal = { created: string[]; tzUpdated: { id: string; before: { status: string; createdEntityType: string | null; createdEntityId: string | null; decidedAt: string | null; decidedById: string | null; sentAt: string | null } }[]; files: string[] };

function walk(dir: string, ext: RegExp, acc: string[] = [], depth = 0): string[] {
  if (depth > 5 || !existsSync(dir)) return acc;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (!/node_modules|\.git/.test(e.name)) walk(p, ext, acc, depth + 1); } else if (ext.test(e.name) && !e.name.startsWith("~$")) acc.push(p);
  }
  return acc;
}
/** Дата письма по номеру папки вложения (index.tsv: столбец eml). */
function mailDates(): Map<string, Date> {
  const m = new Map<string, Date>();
  const f = join(MAIL, "index.tsv");
  if (!existsSync(f)) return m;
  for (const line of readFileSync(f, "utf8").split("\n").slice(1)) { const c = line.split("\t"); if (c[0] && c[6]) m.set(c[6].trim(), new Date(c[0])); }
  return m;
}
const emlOf = (p: string) => /attachments\/(\d+)\//.exec(p)?.[1] ?? "";

type CalcFind = { file: string; md5: string; title: string; preset: string; payload: CalcPayload; status: "MATCH" | "NO"; reasons: string[]; purchaseIds: string[]; sent: Date | null; totals: string };

async function main() {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const prisma = createAuditedClient("script:wellmekh-history");
  const dbName = /\/([^/?]+)(\?|$)/.exec(process.env.DATABASE_URL ?? "")?.[1] ?? "?";
  say(`База: ${dbName}${APPLY ? " · ЗАПИСЬ" : " · пробный прогон (ничего не меняется)"}`);
  if (APPLY && dbName === "fur_erp" && !LIVE) throw new Error("Это боевая база fur_erp: сначала проверьте на копии; на боевой — только с явным --live после согласия владельца");

  const user = await prisma.user.findFirstOrThrow({ where: { email: SUPPLIER_EMAIL, role: "SUPPLIER" }, select: { id: true, organizationId: true, supplierId: true } });
  const orgId = user.organizationId, supplierId = user.supplierId!;
  const owner = await prisma.user.findFirstOrThrow({ where: { organizationId: orgId, role: "OWNER", isActive: true }, select: { id: true } });

  if (ROLLBACK) {
    const j = JSON.parse(readFileSync(JOURNAL, "utf8")) as Journal;
    say(`Откат: удалить записей ${j.created.length}, вернуть ТЗ ${j.tzUpdated.length}`);
    if (!APPLY) return say("пробный откат — добавьте --apply");
    const { removeStoredFiles } = await import("../src/lib/fitting-files");
    for (const id of j.created) await prisma.supplierInbox.deleteMany({ where: { id, organizationId: orgId } });
    for (const t of j.tzUpdated) await prisma.supplierInbox.update({ where: { id: t.id }, data: { status: t.before.status as never, createdEntityType: t.before.createdEntityType, createdEntityId: t.before.createdEntityId, decidedAt: t.before.decidedAt ? new Date(t.before.decidedAt) : null, decidedById: t.before.decidedById, sentAt: t.before.sentAt ? new Date(t.before.sentAt) : null } });
    await removeStoredFiles(j.files);
    return say("откат выполнен");
  }

  // ───────── наши закупки Веллмеха
  const purchases = await prisma.purchase.findMany({
    where: { organizationId: orgId, supplierId },
    select: { id: true, number: true, invoiceNumber: true, auction: { select: { name: true } }, auctionSession: true, status: true, items: { select: { lotNumber: true, quantity: true, costPlan: true, lot: { select: { unitCost: true } } } } },
  });
  const dates = mailDates();
  const already = new Set((await prisma.supplierInbox.findMany({ where: { organizationId: orgId, supplierId, note: { startsWith: "история:" } }, select: { note: true } })).map((x) => x.note));

  // ───────── 1. расчёты
  say("\n══════════ РАСЧЁТЫ АУКЦИОНОВ ══════════");
  const files = [...walk(join(MAIL, "attachments"), /\.xlsx$/i), join(DOWNLOADS, "расчет закупки СП 09-26.xlsx")].filter((f) => existsSync(f));
  const seen = new Set<string>();
  const finds: CalcFind[] = [];
  for (const f of files) {
    const buf = readFileSync(f);
    const md5 = createHash("md5").update(buf).digest("hex");
    if (seen.has(md5)) continue;
    seen.add(md5);
    let table: string[][];
    try { table = await parseTableFile(buf, basename(f)); } catch { continue; }
    const hi = findHeaderRow(table);
    if (hi < 0) continue;
    const title = table.slice(0, hi).map((r) => r.filter(Boolean).join(" ")).join(" / ").replace(/\s+/g, " ").trim();
    const fm = FORMATS.find(([re]) => re.test(title));
    if (!fm) continue;
    const pr = getPreset(fm[1])!;
    const reasons: string[] = [];
    const r = applySheetTable(payloadFromPreset(pr), table);
    if ("error" in r) { finds.push({ file: f, md5, title, preset: fm[1], payload: payloadFromPreset(pr), status: "NO", reasons: [r.error], purchaseIds: [], sent: null, totals: "" }); continue; }
    const t = calcAll(r.payload);
    const sh = t.sheet;
    // «Цена для УПД» и «Итого в УПД» в файлах Веллмеха вносятся руками — это не расхождение формул формата
    const titleOf = new Map((r.payload.customColumns ?? []).map((c) => [c.id, c.title]));
    const manualByCol = new Map<string, number>();
    for (const o of Object.values(r.payload.overrides ?? {})) for (const cid of Object.keys(o)) if (!/упд/i.test(titleOf.get(cid) ?? "")) manualByCol.set(cid, (manualByCol.get(cid) ?? 0) + 1);
    const manualReal = [...manualByCol.values()].reduce((a, b) => a + b, 0);
    if (manualReal > 0) reasons.push(`формулы формата не воспроизвели файл: ячеек, взятых вручную, ${manualReal} (столбцы: ${[...manualByCol.keys()].map((c) => titleOf.get(c)?.replace(/ \(в файле [A-Z]+\)/, "")).join(", ")})`);
    const bad = r.checks.filter((c) => !c.ok && !/упд/i.test(c.title));
    if (bad.length) reasons.push(`итоги не совпали с файлом: ${bad.map((c) => `${c.title.replace(/ \(в файле [A-Z]+\)/, "")} (файл ${money(c.file)}, у нас ${money(c.ours)})`).join("; ")}`);
    if (!sh.unitCol) reasons.push("в формате не выбран столбец себестоимости");
    const unitAt = (i: number) => sh.cells[sh.unitCol]?.[i]?.v ?? NaN;
    // по счетам
    const byInv = new Map<string, number[]>();
    r.payload.rows.forEach((row, i) => { if (sh.used[i]) (byInv.get(row.invoice || "") ?? byInv.set(row.invoice || "", []).get(row.invoice || "")!).push(i); });
    const purchaseIds: string[] = [];
    const norm = (s: string | null) => (s ?? "").trim().toLowerCase().replace(/\s+/g, "");
    const trail = (s: string | null) => /(\d+)$/.exec((s ?? "").trim())?.[1] ?? norm(s);
    let allTotal = 0;
    for (const [inv, idxs] of byInv) {
      if (!inv) { reasons.push("в файле есть лоты без номера счёта"); continue; }
      const cand = purchases.filter((p) => norm(p.invoiceNumber) === norm(inv));
      if (cand.length !== 1) { reasons.push(`счёт ${inv}: закупок с таким номером у нас ${cand.length}${cand.length ? ` (${cand.map((c) => c.number).join(", ")})` : ""}`); continue; }
      const p = cand[0];
      purchaseIds.push(p.id);
      if (p.items.length !== idxs.length) { reasons.push(`счёт ${inv} (${p.number}): лотов в файле ${idxs.length}, в закупке ${p.items.length}`); continue; }
      const used = new Set<number>();
      let ours = 0, theirs = 0;
      for (const i of idxs) {
        const row = r.payload.rows[i];
        const k = p.items.findIndex((it, j) => !used.has(j) && (norm(it.lotNumber) === norm(row.lot) || trail(it.lotNumber) === trail(row.lot)) && Number(it.quantity) === t.qtys[i]);
        if (k < 0) { reasons.push(`счёт ${inv}: лот ${row.lot} (${t.qtys[i]} шт.) не найден в закупке ${p.number}`); continue; }
        used.add(k);
        const it = p.items[k];
        const cp = it.costPlan as { unitCostInclVat?: string } | null;
        const unitOurs = cp?.unitCostInclVat != null ? Number(cp.unitCostInclVat) : it.lot?.unitCost != null ? Number(it.lot.unitCost) : NaN;
        const u = unitAt(i);
        if (!(Math.abs(unitOurs - u) <= TOL)) reasons.push(`счёт ${inv}, лот ${row.lot}: себестоимость шкуры в файле ${Number.isFinite(u) ? money(u) : "—"}, у нас ${Number.isFinite(unitOurs) ? money(unitOurs) : "—"}`);
        ours += unitOurs * t.qtys[i]; theirs += u * t.qtys[i];
      }
      allTotal += theirs;
      if (!(Math.abs(ours - theirs) <= Math.max(0.01, TOL * t.qty))) reasons.push(`счёт ${inv}: итог файла ${money(theirs)}, у нас ${money(ours)}`);
    }
    const eml = emlOf(f);
    finds.push({ file: f, md5, title, preset: fm[1], payload: r.payload, status: reasons.length === 0 && purchaseIds.length > 0 ? "MATCH" : "NO", reasons: [...new Set(reasons)], purchaseIds, sent: dates.get(eml) ?? null, totals: `лотов ${r.added}, шкур ${t.qty}, итого ${money(allTotal || t.totalRub)} ₽` });
  }
  // «нет файла с расчётом»: аукционы наших закупок, для которых не нашлось ни одного файла
  for (const f of finds) {
    say(`\n${f.status === "MATCH" ? "✔ СОВПАЛО" : "✘ не создаём"}  ${f.title.slice(0, 60)}  [формат ${f.preset}]  ${f.totals}`);
    say(`   файл: ${f.file.replace(homedir(), "~")}${f.sent ? ` · письмо от ${f.sent.toLocaleDateString("ru-RU")}` : ""}`);
    if (f.status === "MATCH") say(`   закупки: ${f.purchaseIds.map((id) => purchases.find((p) => p.id === id)!.number).join(", ")}${already.has(`история:${f.md5}`) ? " · уже заведено ранее" : ""}`);
    else for (const x of f.reasons.slice(0, 8)) say(`   · ${x}`);
    if (f.reasons.length > 8) say(`   · …ещё причин: ${f.reasons.length - 8}`);
  }
  const noFile = [...new Set(purchases.map((p) => p.auction?.name ?? p.auctionSession ?? "").filter(Boolean))].filter((a) => !finds.some((f) => f.purchaseIds.some((id) => purchases.find((p) => p.id === id)?.auction?.name === a)));
  say(`\nАукционы с закупками, для которых расчёта-файла среди писем нет (или он не совпал): ${noFile.join("; ") || "—"}`);

  // ───────── 2. ТЗ
  say("\n══════════ ТЗ (Word) ══════════");
  const docx = [...walk(DOWNLOADS, /\.docx$/i).filter((f) => !f.includes("/MEH_PST_EXTRACT/") && /ПРИЛОЖЕНИЕ|Приложение/.test(basename(f))), ...walk(join(MAIL, "attachments"), /\.docx$/i), ...walk(join(__dirname, "..", "uploads"), /\.docx$/i)];
  const seenDoc = new Set<string>();
  type TzFind = { file: string; md5: string; p: TzPayload; td: number; ld: number; positions: string[]; reason: string };
  const tzs: TzFind[] = [];
  for (const f of docx) {
    const buf = readFileSync(f);
    const md5 = createHash("md5").update(buf).digest("hex");
    if (seenDoc.has(md5)) continue;
    seenDoc.add(md5);
    let blocks; try { blocks = await docxBlocks(buf); } catch { continue; }
    const first = (blocks.find((b) => b[0] === "P") as ["P", string] | undefined)?.[1] ?? "";
    if (!/приложение\s*№\s*\d+/i.test(first)) continue;
    let p: TzPayload;
    try { p = await payloadFromDocx(buf); } catch { say(`\n✘ ${basename(f).slice(0, 60)}: другой вид документа — разобрать не удалось (не создаём)`); continue; }
    const gen = await buildTzDocx(p);
    const td = textDiff(blocks, await docxBlocks(gen)).length, ld = (await layoutDiff(buf, gen)).length;
    const pos = await prisma.productionOrder.findMany({ where: { organizationId: orgId, workOrderNumber: p.number }, select: { id: true, plannedQuantity: true } });
    let reason = "";
    if (td || ld) reason = `Word, собранный по данным, не совпал с оригиналом: текст ${td}, вёрстка ${ld} расхождений`;
    else if (pos.length === 0) reason = `ТЗ № ${p.number} нет у нас`;
    else if (pos.length !== p.items.length || pos.reduce((a, x) => a + Number(x.plannedQuantity), 0) !== tzTotals(p).qty) reason = `позиций у нас ${pos.length}, в ТЗ ${p.items.length}; изделий у нас ${pos.reduce((a, x) => a + Number(x.plannedQuantity), 0)}, в ТЗ ${tzTotals(p).qty}`;
    tzs.push({ file: f, md5, p, td, ld, positions: pos.map((x) => x.id), reason });
  }
  tzs.sort((a, b) => Number(a.p.number) - Number(b.p.number) || Number(!!a.reason) - Number(!!b.reason));
  // один и тот же ТЗ мог прийти несколько раз (письмо, Диск): оставляем одну запись на номер, точную — в приоритете
  for (let i = tzs.length - 1; i > 0; i--) if (tzs[i].p.number === tzs[i - 1].p.number && tzs[i].p.date === tzs[i - 1].p.date) tzs.splice(i, 1);
  for (const t of tzs) say(`${t.reason ? "✘ не создаём" : "✔ ТОЧНО   "}  ТЗ № ${t.p.number} от ${t.p.date}: изделий ${tzTotals(t.p).qty}${t.reason ? ` — ${t.reason}` : ` — у нас позиций ${t.positions.length}`}  [${basename(t.file).slice(0, 48)}]`);

  // ───────── запись
  const toCalc = finds.filter((f) => f.status === "MATCH" && !already.has(`история:${f.md5}`));
  const toTz = tzs.filter((t) => !t.reason);
  say(`\nИтого к созданию: расчётов ${toCalc.length}, ТЗ ${toTz.length}${REPORT ? "" : ""}`);
  if (REPORT) writeFileSync(REPORT, out.join("\n"));
  if (!APPLY) return say("пробный прогон: БД не тронута (--apply запишет; на боевой нужен ещё --live после согласия владельца)");
  if (LIVE) execSync("bash scripts/backup.sh", { stdio: "inherit", cwd: join(__dirname, "..") });

  const { readDocumentFiles, writeDocumentFiles } = await import("../src/lib/purchase-files");
  const journal: Journal = existsSync(JOURNAL) ? (JSON.parse(readFileSync(JOURNAL, "utf8")) as Journal) : { created: [], tzUpdated: [], files: [] };
  for (const f of toCalc) {
    const p = f.payload;
    p.stage = "FINAL";
    const t = calcAll(p);
    const inv = [...new Set(p.rows.map((r) => r.invoice).filter(Boolean))];
    p.header.invoice = inv.join(", ");
    p.header.auction = p.header.auction || f.title.replace(/\(.*$/, "").trim();
    const row = await prisma.supplierInbox.create({
      data: {
        organizationId: orgId, supplierId, createdById: user.id, kind: "AUCTION_CALC", status: "ACCEPTED", title: `${p.header.auction} · счёт ${p.header.invoice}`.slice(0, 160),
        payload: { ...p, totals: { qty: t.qty, totalRub: Math.round(t.totalRub * 100) / 100 } } as never,
        note: `история:${f.md5}`, sentAt: f.sent ?? new Date(), decidedAt: f.sent ?? new Date(), decidedById: owner.id,
        createdEntityType: "Purchase", createdEntityId: f.purchaseIds.join(","),
      },
    });
    journal.created.push(row.id);
    const read = await readDocumentFiles([new File([new Uint8Array(readFileSync(f.file))], basename(f.file).replace(/__[0-9a-f]{12}(?=\.xlsx$)/, ""), { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })]);
    if (!("error" in read)) {
      const stored = await writeDocumentFiles(orgId, `supplier-inbox/${row.id}`, read.files);
      await prisma.supplierInboxFile.createMany({ data: stored.map((d) => ({ inboxId: row.id, storagePath: d.storagePath, originalName: d.originalName, mimeType: d.mimeType, sizeBytes: d.sizeBytes, kind: "OTHER" as never })) });
      journal.files.push(...stored.map((d) => d.storagePath));
    }
    say(`создан расчёт ${row.id}: ${row.title}`);
  }
  for (const tz of toTz) {
    const title = `ТЗ № ${tz.p.number} от ${tz.p.date.split("-").reverse().join(".")}`;
    const ex = await prisma.supplierInbox.findFirst({ where: { organizationId: orgId, supplierId, kind: "TZ", title: { contains: `№ ${tz.p.number}` } } });
    const entity = { createdEntityType: "ProductionOrder", createdEntityId: tz.positions.join(",") };
    const sent = new Date(`${tz.p.date}T12:00:00Z`);
    if (ex) {
      if (ex.status === "ACCEPTED") { say(`ТЗ ${tz.p.number}: уже принято ранее — пропущено`); continue; }
      journal.tzUpdated.push({ id: ex.id, before: { status: ex.status, createdEntityType: ex.createdEntityType, createdEntityId: ex.createdEntityId, decidedAt: ex.decidedAt?.toISOString() ?? null, decidedById: ex.decidedById, sentAt: ex.sentAt?.toISOString() ?? null } });
      await prisma.supplierInbox.update({ where: { id: ex.id }, data: { status: "ACCEPTED", sentAt: ex.sentAt ?? sent, decidedAt: sent, decidedById: owner.id, ...entity } });
      say(`ТЗ ${tz.p.number}: существующий черновик ${ex.id} → «Принято», связан с нашими позициями (${tz.positions.length})`);
    } else {
      const row = await prisma.supplierInbox.create({ data: { organizationId: orgId, supplierId, createdById: user.id, kind: "TZ", status: "ACCEPTED", title, payload: { ...tz.p, totals: { qty: tzTotals(tz.p).qty } } as never, note: `история:${tz.md5}`, sentAt: sent, decidedAt: sent, decidedById: owner.id, ...entity } });
      journal.created.push(row.id);
      say(`создано ТЗ ${row.id}: ${title}`);
    }
  }
  mkdirSync(join(__dirname, "..", "docs-inventory"), { recursive: true });
  writeFileSync(JOURNAL, JSON.stringify(journal, null, 1));
  say(`журнал: ${JOURNAL}`);
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
