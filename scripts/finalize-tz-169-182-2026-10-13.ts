/**
 * Доработка ТЗ 169–182 по решениям владельца (13.10.2026): партия 22, категории «Муфта»/«Манжеты», цвета, пометки о списаниях,
 * доп. материалы ТЗ 178 как расход, исправление заметок.
 *
 *   node --env-file=.env node_modules/.bin/tsx scripts/finalize-tz-169-182-2026-10-13.ts            # пробный прогон («было → стало», БД не меняется)
 *   node --env-file=.env node_modules/.bin/tsx scripts/finalize-tz-169-182-2026-10-13.ts --apply    # применить (сам делает scripts/backup.sh; --no-backup — без копии, только для тестовой БД)
 *   node --env-file=.env node_modules/.bin/tsx scripts/finalize-tz-169-182-2026-10-13.ts --rollback            # откат по журналу (пробный)
 *   node --env-file=.env node_modules/.bin/tsx scripts/finalize-tz-169-182-2026-10-13.ts --rollback --apply    # откат
 *
 * Что делает (всё в одной транзакции, старые значения — в docs-inventory/corrections-journal-finalize-tz-169-182-2026-10-13.json):
 *  1. Партия 22 («Поставка 22», 2026, 77 изделий) и привязка 16 заказов ТЗ 169–182. Подтверждение партии не ставится.
 *  2. Категории «Муфта» и «Манжеты» (группа «Аксессуары», подтверждены) → артикулы MMF01, MCF01.
 *  3. Цвета: «Т-Коричневый» → «Тёмно-коричневый» (синоним «Т-Коричневый»), «Бордовый» (синоним «Бордо»), «Кремовый» — подтверждаются.
 *  4. Заметки: лоскут соболя (ТЗ 179, МН07) — сырьё не списывается; подкладка не указана; МН07 PLANNED → IN_PROGRESS.
 *  5. Расход ТЗ 178: статья «Доп. материалы» (Производство), 791,78 ₽ × 1 шт. (с НДС 22 %, без 4 %).
 *  7. Заметки ТЗ 176 (опечатка лота) и ТЗ 182 (округление цены лота).
 * НЕ делает: завершение ТЗ/выпуск (пункт 6 — файл «производство на 22092026» не даёт сданных изделий по ТЗ 169–182), правку списаний лота 300687 (п. 8 — документы подтверждают 30 + 30).
 */
import Module from "module";
import { join } from "path";
import { execSync } from "child_process";
const M = Module as unknown as { _resolveFilename: (...a: unknown[]) => string };
const orig = M._resolveFilename;
M._resolveFilename = function (this: unknown, req: unknown, ...rest: unknown[]) {
  if (req === "server-only") return join(__dirname, "stubs", "empty.js");
  return orig.call(this, req, ...rest);
};

const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
const NO_BACKUP = process.argv.includes("--no-backup");
const SCRIPT = "finalize-tz-169-182-2026-10-13";
const TZ_FROM = 169, TZ_TO = 182;
const EXPENSE_CAT = "Доп. материалы";
const EXPENSE_AMOUNT = 791.78;
const SCRIPT_TAG = " (apply-tz-169-182-2026-10-13.ts)";
const LOSKUT = "Мех — лоскут соболя заказчика/остатки, сырьё со склада не списывается.";
const NO_LINING = "Подкладка в приложении не указана — списание не заведено.";

const r2 = (n: number) => Math.round(n * 100) / 100;
const rub = (n: number) => r2(n).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const LAT: Record<string, string> = { М: "M", Н: "H", Е: "E", С: "C", К: "K", А: "A", О: "O", Т: "T", Р: "P", В: "B", Х: "X" };
const nm = (s: string) => s.toUpperCase().replace(/[\s\-_]/g, "").replace(/[А-Я]/g, (c) => LAT[c] ?? c);

type Journal = {
  script: string; status: "applied" | "rolled-back"; at: string;
  batch: { id: string } | null;
  orders: { id: string; tz: string; old: { batchId: string | null; notes: string | null; status: string; color: string | null } }[];
  createdCategories: string[];
  models: { id: string; name: string; old: { category: string | null; categoryRefId: string | null } }[];
  colors: { id: string; old: { name: string; aliases: string[]; note: string | null } }[];
  createdExpenseCategory: string | null;
  expenseId: string | null;
};

async function main() {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const { INV, readJson, writeJson } = await import("./detail-common");
  const { Decimal } = await import("@prisma/client/runtime/library");
  const { isProposed } = await import("../src/lib/color-ref");
  const prisma = createAuditedClient(`script:${SCRIPT}`);
  const JOURNAL = join(INV, `corrections-journal-${SCRIPT.replace("finalize-", "finalize-")}.json`);

  const org = await prisma.organization.findFirst({ orderBy: { createdAt: "asc" } });
  if (!org) throw new Error("нет организации");
  const orgId = org.id;

  // ----- Откат -----
  if (ROLLBACK) {
    const j = readJson<Journal | null>(JOURNAL, null);
    if (!j || j.status !== "applied") { console.log("Журнал пуст или уже откачен — откатывать нечего."); await prisma.$disconnect(); return; }
    console.log(`Откат: заказов ${j.orders.length}, партия ${j.batch ? "будет удалена" : "—"}, категорий ${j.createdCategories.length}, цветов ${j.colors.length}, расход ${j.expenseId ? "будет удалён" : "—"}${APPLY ? "" : " (пробный — добавьте --apply)"}`);
    if (j.batch) {
      const linked = await prisma.productionOrder.count({ where: { batchId: j.batch.id, id: { notIn: j.orders.map((o) => o.id) } } });
      const docs = await prisma.driveDocument.count({ where: { productionBatchId: j.batch.id } });
      if (linked || docs) { console.log(`ОТКАТ НЕВОЗМОЖЕН: к партии 22 привязаны другие ТЗ (${linked}) или документы (${docs}).`); await prisma.$disconnect(); process.exitCode = 1; return; }
    }
    if (APPLY) {
      await prisma.$transaction(async (tx) => {
        if (j.expenseId) await tx.productionExpense.deleteMany({ where: { id: j.expenseId } });
        if (j.createdExpenseCategory && (await tx.productionExpense.count({ where: { categoryId: j.createdExpenseCategory } })) === 0) await tx.expenseCategory.deleteMany({ where: { id: j.createdExpenseCategory } });
        for (const o of j.orders) await tx.productionOrder.update({ where: { id: o.id }, data: { batchId: o.old.batchId, notes: o.old.notes, status: o.old.status as never, color: o.old.color } });
        if (j.batch) await tx.productionBatch.deleteMany({ where: { id: j.batch.id } });
        for (const m of j.models) await tx.productModel.update({ where: { id: m.id }, data: { category: m.old.category, categoryRefId: m.old.categoryRefId } });
        for (const id of j.createdCategories) if ((await tx.productModel.count({ where: { categoryRefId: id } })) === 0) await tx.categoryRef.deleteMany({ where: { id } });
        for (const c of j.colors) await tx.colorRef.update({ where: { id: c.id }, data: c.old });
      }, { timeout: 120000, maxWait: 15000 });
      writeJson(JOURNAL, { ...j, status: "rolled-back", at: new Date().toISOString() });
      console.log("Откат выполнен.");
    }
    await prisma.$disconnect();
    return;
  }

  // ----- Чтение -----
  const problems: string[] = [];
  const prev = readJson<Journal | null>(JOURNAL, null);
  if (prev && prev.status === "applied") problems.push("журнал уже содержит применённую доработку — сначала --rollback --apply");

  const orders = await prisma.productionOrder.findMany({
    where: { organizationId: orgId, workOrderNumber: { in: Array.from({ length: TZ_TO - TZ_FROM + 1 }, (_, i) => String(TZ_FROM + i)) } },
    include: { productModel: { select: { name: true } }, materialUsages: { include: { lot: { select: { lotNumber: true, materialCostExclVat: true, vatRate: true, unitCost: true } } } }, expenses: true },
    orderBy: { number: "asc" },
  });
  if (orders.length !== 16) problems.push(`найдено ТЗ-заказов ${orders.length}, ожидалось 16`);
  const planned = orders.reduce((s, o) => s + Number(o.plannedQuantity), 0);
  if (planned !== 77) problems.push(`изделий в ТЗ 169–182: ${planned}, ожидалось 77`);

  // 1. Партия
  const batchNo = 22;
  const existingBatch = await prisma.productionBatch.findFirst({ where: { organizationId: orgId, number: batchNo } });
  if (existingBatch) problems.push("партия 22 уже существует");
  const already = orders.filter((o) => o.batchId);
  if (already.length) problems.push(`у ТЗ ${already.map((o) => o.workOrderNumber).join(", ")} уже есть партия`);

  // 2. Категории и артикулы
  const catSpecs = [
    { name: "Муфта", alias: "Муфта меховая", model: "MMF01", sortOrder: 111 },
    { name: "Манжеты", alias: "Манжеты меховые", model: "MCF01", sortOrder: 112 },
  ];
  const cats = await prisma.categoryRef.findMany({ where: { organizationId: orgId } });
  const models = await prisma.productModel.findMany({ where: { organizationId: orgId } });
  const catPlan = catSpecs.map((c) => {
    const m = models.filter((x) => nm(x.name) === nm(c.model));
    if (m.length !== 1) problems.push(`артикул ${c.model}: найдено ${m.length}, ожидался 1`);
    if (cats.some((x) => x.name === c.name)) problems.push(`категория «${c.name}» уже есть`);
    return { ...c, m: m[0] };
  });

  // 3. Цвета
  const colors = await prisma.colorRef.findMany({ where: { organizationId: orgId } });
  const colorSpecs = [
    { from: "Т-Коричневый", to: "Тёмно-коричневый", aliases: ["Т-Коричневый"], note: "Подтверждено владельцем 13.10.2026: «Т-Коричневый» в ТЗ 181 = тёмно-коричневый (приложение 181, норка махагон)." },
    { from: "Бордовый", to: "Бордовый", aliases: ["Бордо"], note: "Подтверждено владельцем 13.10.2026: цвет ТЗ 180 (в названии приложения — «бордо»)." },
    { from: "Кремовый", to: "Кремовый", aliases: [], note: "Подтверждено владельцем 13.10.2026: цвет МН06 в ТЗ 182 (норка лаванда)." },
  ];
  const colorPlan = colorSpecs.map((c) => {
    const r = colors.find((x) => x.name === c.from);
    if (!r) problems.push(`цвет «${c.from}» не найден`);
    else if (!isProposed(r.note)) problems.push(`цвет «${c.from}» уже подтверждён`);
    if (c.to !== c.from && colors.some((x) => x.name === c.to)) problems.push(`цвет «${c.to}» уже есть — объединять нужно вручную`);
    return { ...c, r };
  });

  // 4–5, 7. Заметки / статусы
  type Edit = { o: (typeof orders)[number]; notes: string; status?: string; color?: string; why: string[] };
  const edits: Edit[] = [];
  for (const o of orders) {
    const tz = Number(o.workOrderNumber);
    const model = nm(o.productModel.name);
    let n = (o.notes ?? "").replace(SCRIPT_TAG, "");
    const why: string[] = [];
    let status: string | undefined, color: string | undefined;
    const rep = (re: RegExp, to: string, tag: string) => { if (re.test(n)) { n = n.replace(re, to); why.push(tag); return true; } return false; };
    const add = (s: string, tag: string) => { if (!n.includes(s)) { n = `${n.trim()} ${s}`.trim(); why.push(tag); } };
    // подкладка не указана
    const lin = /Подкладка в блоке «Заказчик передал» не указана( \(в таблице ТЗ — ([^)]*)\))? — списание подкладки не заведено\./;
    const mLin = lin.exec(n);
    if (mLin) rep(lin, mLin[2] ? `Подкладка в приложении не указана (в таблице ТЗ — ${mLin[2]}) — списание не заведено.` : NO_LINING, "подкладка");
    // лоскут
    if (tz === 179) rep(/Мех \(лоскут соболя\) в блоке «Заказчик передал» не указан — списание меха не заведено\./, LOSKUT, "лоскут");
    if (tz === 182 && model === "MH07") {
      rep(/Сырьё в блоке «Заказчик передал» не указано \(лоскут соболя\) — списаний нет\./, LOSKUT, "лоскут");
      if (o.status === "PLANNED") { status = "IN_PROGRESS"; why.push("статус PLANNED → IN_PROGRESS"); }
    }
    // доп. материалы
    if (tz === 178) rep(/Дополнительные материалы по ТЗ: .*?в расходы не заведены \(вопрос владельцу\)\./, `Доп. материалы: 791,78 ₽ за единицу с НДС 22 % — заведены в расходы ТЗ (статья «${EXPENSE_CAT}»); какие именно материалы, в приложении не указано.`, "доп. материалы");
    // 176: опечатка лота
    if (tz === 176) add("В приложении лот указан как РП0426.233 — принят лот 23 (опечатка).", "опечатка лота");
    // 182: округление
    if (tz === 182 && model === "MH06") {
      const u = o.materialUsages.find((x) => x.lot.lotNumber);
      const f = u ? { 518005: 93404.91, 519506: 152932.61 }[Number(u.lot.lotNumber)] : undefined;
      if (u && f) {
        const calc = r2(Number(u.lot.materialCostExclVat) * 1.04 * 1.22 * Number(u.quantity));
        const d = r2(Math.abs(f - calc));
        const price = u.lot.lotNumber === "518005" ? "8 834" : "14 464";
        add(`Сумма строки меха в приложении отличается от расчёта по лотам на ${rub(d).replace(".", ",")} ₽: в приложении цена лота округлена до рубля (${price} ₽ с НДС 20 %). Верной считается сумма, рассчитанная по лотам.`, `округление ${rub(d)} ₽`);
      } else problems.push(`ТЗ 182 ${o.number}: не найден лот 518005/519506 для заметки об округлении`);
    }
    // 181: текст цвета
    if (tz === 181 && o.color === "Т-Коричневый") { color = "Тёмно-коричневый"; why.push("цвет «Т-Коричневый» → «Тёмно-коричневый»"); }
    if (n !== (o.notes ?? "") || status || color) edits.push({ o, notes: n, status, color, why });
  }
  const mn07 = orders.filter((o) => Number(o.workOrderNumber) === 182 && nm(o.productModel.name) === "MH07");
  if (mn07.length !== 1) problems.push(`МН07 в ТЗ 182: найдено ${mn07.length}, ожидалось 1`);

  // 5. Расход ТЗ 178
  const o178 = orders.find((o) => o.workOrderNumber === "178");
  if (!o178) problems.push("ТЗ 178 не найдено");
  else if (o178.expenses.length) problems.push(`у ТЗ 178 уже есть расходы (${o178.expenses.length})`);
  const expCat = await prisma.expenseCategory.findFirst({ where: { organizationId: orgId, name: EXPENSE_CAT, kind: "PRODUCTION" } });

  // ----- Отчёт -----
  const L: string[] = [];
  L.push(`# Доработка ТЗ 169–182 — ${APPLY ? "ПРИМЕНЕНИЕ" : "пробный прогон"} (${new Date().toISOString()})`, "");
  L.push("## 1. Партия 22", `- создать партию: № 22, «Поставка 22», 2026, плановых изделий ${planned}, примечание «ТЗ 169–182»; подтверждение не ставится`);
  for (const o of orders) L.push(`- ТЗ ${o.workOrderNumber} (${o.number}, ${o.productModel.name} ${o.color ?? ""}): партия «нет» → «Поставка 22»`);
  L.push("", "## 2. Категории и артикулы");
  for (const c of catPlan) L.push(`- категория «${c.name}» (группа Аксессуары, синоним «${c.alias}», подтверждена) — создать; артикул ${c.m?.name}: категория «${c.m?.category ?? "—"}» → «${c.name}»`);
  L.push("", "## 3. Цвета");
  for (const c of colorPlan) if (c.r) L.push(`- «${c.r.name}» (${c.r.aliases.join(", ") || "без синонимов"}; «${(c.r.note ?? "").slice(0, 40)}») → «${c.to}» (синонимы: ${[...c.r.aliases, ...c.aliases].join(", ") || "—"}; подтверждён)`);
  L.push("", "## 4, 5, 7. Заметки, статусы, цвет ТЗ");
  for (const e of edits) L.push(`- ТЗ ${e.o.workOrderNumber} ${e.o.number} [${e.why.join("; ")}]`, `    было: ${e.o.notes ?? "—"}`, `    стало: ${e.notes}`, ...(e.status ? [`    статус: ${e.o.status} → ${e.status}`] : []), ...(e.color ? [`    цвет (текст): ${e.o.color} → ${e.color}`] : []));
  L.push("", "## 5. Расход ТЗ 178", `- статья «${EXPENSE_CAT}» (Производство): ${expCat ? "есть" : "создать"}; расход ${rub(EXPENSE_AMOUNT)} ₽ × 1 шт. = ${rub(EXPENSE_AMOUNT)} ₽ (с НДС 22 %, без 4 %)`);
  if (o178) {
    const mat = o178.materialUsages.reduce((s, u) => s + Number(u.totalCost), 0);
    L.push(`- ТЗ 178 сейчас: материалы по лотам ${rub(mat)}, расходов 0; работа ${rub(Number(o178.clientWorkPricePerUnit ?? 0) * Number(o178.plannedQuantity))}; после: расходы ${rub(EXPENSE_AMOUNT)}`);
  }
  L.push("", "## 6, 8. Не меняется", "- Выпуск/завершение ТЗ 169–182 не вносится (в «производство на 22092026.xlsx» нет сданных изделий по этим ТЗ).", "- Лот 300687: списания ТЗ 167 и ТЗ 176 по 30 шт. подтверждены приложениями; не меняется.");
  if (problems.length) L.push("", "## ПРОБЛЕМЫ — запись не выполняется", ...problems.map((x) => `- ${x}`));
  console.log(L.join("\n"));
  if (problems.length) { console.log(`\nНайдено проблем: ${problems.length}. Запись невозможна.`); await prisma.$disconnect(); process.exitCode = 1; return; }
  if (!APPLY) { console.log("\nПробный прогон: БД не менялась. Для записи — --apply."); await prisma.$disconnect(); return; }

  // ----- Применение -----
  if (!NO_BACKUP) { console.log("\nКопия базы перед применением: scripts/backup.sh …"); execSync("sh scripts/backup.sh", { stdio: "inherit" }); }
  const journal: Journal = { script: SCRIPT, status: "applied", at: new Date().toISOString(), batch: null, orders: [], createdCategories: [], models: [], colors: [], createdExpenseCategory: null, expenseId: null };
  await prisma.$transaction(async (tx) => {
    const batch = await tx.productionBatch.create({ data: { organizationId: orgId, number: batchNo, name: "Поставка 22", year: 2026, plannedUnits: planned, notes: "ТЗ 169–182" }, select: { id: true } });
    journal.batch = { id: batch.id };
    for (const c of catPlan) {
      const cr = await tx.categoryRef.create({ data: { organizationId: orgId, name: c.name, group: "Аксессуары", aliases: [c.alias], sortOrder: c.sortOrder, confirmed: true, note: "По названию изделия в приложении ТЗ; подтверждено владельцем 13.10.2026." }, select: { id: true } });
      journal.createdCategories.push(cr.id);
      journal.models.push({ id: c.m.id, name: c.m.name, old: { category: c.m.category, categoryRefId: c.m.categoryRefId } });
      await tx.productModel.update({ where: { id: c.m.id }, data: { category: c.name, categoryRefId: cr.id } });
    }
    for (const c of colorPlan) {
      const r = c.r!;
      journal.colors.push({ id: r.id, old: { name: r.name, aliases: r.aliases, note: r.note } });
      await tx.colorRef.update({ where: { id: r.id }, data: { name: c.to, aliases: [...new Set([...r.aliases, ...c.aliases])], note: c.note } });
    }
    const editBy = new Map(edits.map((e) => [e.o.id, e]));
    for (const o of orders) {
      const e = editBy.get(o.id);
      journal.orders.push({ id: o.id, tz: o.workOrderNumber ?? "", old: { batchId: o.batchId, notes: o.notes, status: o.status, color: o.color } });
      await tx.productionOrder.update({ where: { id: o.id }, data: { batchId: batch.id, ...(e ? { notes: e.notes, ...(e.status ? { status: e.status as never } : {}), ...(e.color ? { color: e.color } : {}) } : {}) } });
    }
    let cat = expCat;
    if (!cat) { cat = await tx.expenseCategory.create({ data: { organizationId: orgId, name: EXPENSE_CAT, kind: "PRODUCTION" } }); journal.createdExpenseCategory = cat.id; }
    const ex = await tx.productionExpense.create({
      data: { productionOrderId: o178!.id, categoryId: cat.id, amount: new Decimal(EXPENSE_AMOUNT), date: new Date("2026-08-26T00:00:00.000Z"), description: "Дополнительные материалы по приложению 178: 791,78 ₽ за единицу × 1 шт., с НДС 22 %" },
      select: { id: true },
    });
    journal.expenseId = ex.id;
  }, { timeout: 120000, maxWait: 15000 });
  writeJson(JOURNAL, journal);
  console.log(`\nПрименено. Журнал: ${JOURNAL}`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
