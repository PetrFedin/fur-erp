/**
 * Внесение «Партии 22» в реестр сверки (src/data/reconciliation.json) — ПРЕДЛОЖЕНИЕ от 13.10.2026.
 *
 *   npx tsx scripts/add-batch22-to-reconciliation-2026-10-13.ts             # пробный прогон: что будет добавлено (файл не меняется)
 *   npx tsx scripts/add-batch22-to-reconciliation-2026-10-13.ts --apply     # добавить группу «W:Партия 22» после «W:Партия 21»
 *   npx tsx scripts/add-batch22-to-reconciliation-2026-10-13.ts --rollback --apply   # убрать группу (файл становится как до)
 *
 * База не читается и не меняется. Счета (invoices) НЕ трогаются: прежние 65 счетов, «закрыто %» и итог моста «реестр → Главная» остаются как были.
 * Группа без счёта: в приложениях есть только работа (6 059 500 ₽, 14 ТЗ / 16 позиций / 77 изделий) и аванс, уже разнесённый
 * из оплаченных 06.07.2026 счетов №141 и №143 (1 362 900 ₽). Счёта на аванс/доплату по партии 22 в папке и в приложениях нет — суммы счёта нет, помечено как «ещё не выставлен».
 * Скрипт build-reconciliation.ts этот файл пересобирает целиком из docs-inventory (и уже отстаёт от ручных правок) — после его запуска группу надо добавить заново этим скриптом.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const FILE = join(__dirname, "..", "src", "data", "reconciliation.json");
const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
const ID = "W:Партия 22";

const GROUP = {
  id: ID,
  section: "production",
  title: "Партия 22",
  house: "партия 22",
  status: "review",
  doc: { costRub: 6059500, invoicesRub: 0, paidRub: 1362900 },
  db: { costRub: 6059500, paidRub: 1362900, remainingRub: 4696600, refs: "ТЗ 169–182 (заказы П-2026-0184…0199)" },
  checks: [
    { label: "ТЗ-приложения = база", ok: true },
    { label: "Счёт выставлен", ok: false },
    { label: "Оплата = документы", ok: false },
    { label: "Остаток по документам 0", ok: false },
  ],
  diffs: [
    {
      what: "Счёт на аванс/доплату по партии 22",
      doc: "не выставлен: в приложениях к ТЗ 169–182 и в папке «мех» счёта нет",
      db: "платежей по счёту партии нет",
      why: "Сумму счёта не указываем, пока нет документа. Работа партии — по подписанным приложениям к ТЗ.",
    },
    {
      what: "Аванс 70%, разнесённый из оплаченных 06.07.2026 счетов №141 и №143",
      doc: "1362900",
      db: "1362900 (8 строк разнесения по ТЗ 169, 171, 174, 178, 179, 182)",
      why: "№141: ТЗ 169 — 168 000, ТЗ 171 — 196 000, ТЗ 174 — 672 000 (итого 1 036 000); №143: ТЗ 178 — 11 200, ТЗ 179 — 84 000, ТЗ 182 — 98 000 + 98 000 + 35 700 (итого 326 900). По ТЗ 170, 172, 173, 175–177, 180, 181 в списках авансов №141/№143 позиций нет.",
    },
  ],
  notes: [
    "Работа по приложениям к ТЗ 169–182: 6 059 500 ₽ (14 ТЗ, 16 позиций заказов, 77 изделий; ТЗ 182 — три позиции: МН06 ×20, МН06 ×20, МН07 ×6 = 331 000 ₽).",
    "Дата ТЗ 26.08.2026, у ТЗ 181 — 15.09.2026. Договор подряда № 1605 от 16.05.2025.",
  ],
  files: [] as { title: string; fileId: string }[],
  year: 2026,
  invoiceIds: [] as string[],
  dbLink: { batch: 22 },
  agreements: [] as { date: string | null; by: string; note: string }[],
  advanceRub: 1362900,
  manualReview: [
    "Когда будет выставлен счёт на аванс/доплату по партии 22 — внести его в реестр (номер, дата, сумма) и сверить с работой 6 059 500 ₽.",
    "Остальной аванс 70% по ТЗ партии 22 (кроме 1 362 900 ₽, разнесённых из №141 и №143) — найти счёт/платёж или подтвердить, что его ещё нет.",
  ],
};

type Data = { groups: { id: string }[]; invoices: unknown[] };
const raw = readFileSync(FILE, "utf8");
const data = JSON.parse(raw) as Data;
const ser = (d: unknown) => JSON.stringify(d, null, 1) + "\n";
if (ser(data) !== raw) {
  console.error("Формат reconciliation.json не совпал с JSON.stringify(…, null, 1) — файл правили вручную в другом формате; скрипт отказывается его переписывать.");
  process.exit(1);
}
const has = data.groups.some((g) => g.id === ID);
console.log(`Групп: ${data.groups.length}, счетов: ${data.invoices.length}; «${ID}» ${has ? "есть" : "нет"} в реестре.`);

if (ROLLBACK) {
  if (!has) { console.log("Откатывать нечего."); process.exit(0); }
  if (!APPLY) { console.log("Пробный откат: группа будет удалена (добавьте --apply)."); process.exit(0); }
  data.groups = data.groups.filter((g) => g.id !== ID);
  writeFileSync(FILE, ser(data));
  console.log(`Группа удалена. Групп: ${data.groups.length}, счетов: ${data.invoices.length}.`);
  process.exit(0);
}

if (has) { console.log("Группа уже внесена — ничего не делаем."); process.exit(0); }
const at = data.groups.findIndex((g) => g.id === "W:Партия 21");
if (at < 0) { console.error("Не найдена «W:Партия 21» — некуда вставлять."); process.exit(1); }
console.log(JSON.stringify(GROUP, null, 1));
if (!APPLY) { console.log("\nПробный прогон: файл не изменён (добавьте --apply)."); process.exit(0); }
data.groups.splice(at + 1, 0, GROUP);
writeFileSync(FILE, ser(data));
console.log(`\nГруппа добавлена после «W:Партия 21». Групп: ${data.groups.length}, счетов: ${data.invoices.length} (без изменений).`);
