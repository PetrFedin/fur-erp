/**
 * Бобр: факты из архива почты (docs-inventory/backup-mail, папка «мех», 392 письма) — только то, что подтверждено документом
 * и не спорит с решением владельца от 09.10.2026 («бобр — сырьё подрядчика, закупки З-2026-0063 в системе нет», scripts/remove-beaver.ts).
 *
 * Что делает (поля, никаких сумм/долгов/оплат/лотов):
 *  1) ТЗ №97 (П-2026-0164) и №104 (П-2026-0165): подкладка «100% кашемир №9» и материал «бобр черный стриженный, кашемир №5» —
 *     дословно из приложений 97/104 (письма №271, №243); в notes — расход шкуры, цены и расчёты доплаты по письмам.
 *  2) Артикул MH17: описание (материалы по ТЗ 97/104 и 99/103, прежнее название МН10 в расчётах).
 *  3) Справочник «Вид меха» → Бобр: синонимы (бобер, бобёр, dressed beaver, beaver skin) и примечание с цветами/лотом/источниками.
 * НЕ делает: не создаёт закупку/поставщика/вид сырья «Бобр»/лоты/списания/оплаты (см. docs-inventory/beaver-mail-findings-2026-10-12.md).
 *
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-beaver-mail-facts.ts            # пробный прогон (ничего не пишет)
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-beaver-mail-facts.ts --apply    # перед этим бэкап базы
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-beaver-mail-facts.ts --rollback [--apply]
 * Идемпотентно (метка TAG в notes/описании). Журнал: docs-inventory/corrections-journal-beaver-mail.json.
 */
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const ROLLBACK = args.includes("--rollback");
const JOURNAL = join(__dirname, "..", "docs-inventory", "corrections-journal-beaver-mail.json");
const TAG = "[mail-beaver:2026-10-12]";

type Entry = { time: string; entity: string; id: string; field: string; before: unknown; after: unknown; source: string };

const TZ = [
  {
    number: "П-2026-0164",
    tz: 97,
    materialDescription: "бобр черный стриженный, кашемир №5",
    lining: "100% кашемир №9",
    note:
      `${TAG} Приложение №97 к Договору подряда №1605 (письма №271, №274): 9 ушанок МН17, бобр черный стриженный + кашемир №5, подкладка 100% кашемир №9, ` +
      `размеры 62, 61, 60, 59×3, 58×2, 57; 16 980 ₽/ед. (в т.ч. НДС 22%), итого 152 820 ₽; аванс 70%, срок завершения работ не позднее 25.02.2026; блок «Заказчик передал» пуст. ` +
      `Василий 12.02.2026 (письмо «Партия 10»): «по ТЗ 97 отгрузка не нужна» — шкуры от ММ подрядчику не передаются. Коношенко 12.02.2026 (№271): «мы бобра не закупали, мех подрядчика», ` +
      `для удобства всё сложено в стоимость работ. Расчёт «МГУ» (мужские аксессуары MVST, №271/№312/№340): МН10(=МН17) бобр черный стр., кашемир, лот 10572/6, расход 1 шкура на изделие, ` +
      `10 изд. (9 по ТЗ 97 + 1 по ТЗ 104); версия 25.11.2025 — работа 16 700 ₽, шкура 0; версия 12.02.2026 — работа 9 700 + шкура 7 000 = 16 700 ₽. ` +
      `Расчёт доплаты за пошив 18.02.2026 (партия 10, №248): 9 × 16 980 = 152 820, оплачено аванс 3 580, к доплате 149 240, счёт №41 от 18.02.2026.`,
  },
  {
    number: "П-2026-0165",
    tz: 104,
    materialDescription: "бобр черный стриженный, кашемир №5",
    lining: "100% кашемир №9",
    note:
      `${TAG} Приложение №104 к Договору подряда №1605 (письма №243, №246, №247): 1 ушанка МН17, бобр черный стриженный + кашемир №5, подкладка 100% кашемир №9, размер 61; ` +
      `16 980 ₽ (в т.ч. НДС 22%), аванс 70%, срок завершения работ не позднее 25.03.2026; блок «Заказчик передал» пуст. Расход бобра — 1 шкура на изделие (расчёт «МГУ», лот 10572/6; ` +
      `по письму Коношенко 12.02.2026 №271 шкуры не наши, мех подрядчика, всё сложено в стоимость работ). Расчёт доплаты за пошив 20.02.2026 (партия 11, №245): 1 × 16 980 = 16 980, к доплате 16 980, счёт №51 от 24.02.2026 (по партии 347 895).`,
  },
] as const;

const MH17_DESC =
  `${TAG} Головной убор (ушанка). По приложениям к договору подряда №1605: бобр черный стриженный + кашемир №5, подкладка 100% кашемир №9 (ТЗ 97 — 9 шт., ТЗ 104 — 1 шт.; ` +
  `16 980 ₽/ед. с НДС 22%); норка блэкглама + шелк технический (ТЗ 99, 103: 8 845 ₽/ед.). Размеры 57–62. Расход меха — 1 шкура на изделие (расчёт «МГУ»). ` +
  `В ранних версиях расчёта Василия модель называлась МН10 (письмо Денисюк А. В. 29.12.2025, №312: «MH10 бобр черный стр./кашемир — соответствует MH17»).`;

const FUR_ALIASES = ["бобер", "бобёр", "dressed beaver", "beaver skin"];
const FUR_NOTE =
  `${TAG} Бобр выделанный (Dressed beaver skin, Веллмех): цвета по документам — black (черный стриженный 15 мм), brown (коричневый), deep blue (темно-синий), фондю (стриженный), торторо; ` +
  `лот 10572/6 (расчёт «МГУ» и Спец. 15); ориентир цены 7 000 ₽/шкура (расчёт «МГУ» 12.02.2026, Спец. 15, расчёт Василия 06.08.2026: 7 000 / 7 000 / 6 200). Закупки бобра ММ в системе нет: Invoice Nr 1-2026 от 06.08.2026 ` +
  `(WELLFUR LLC → YUSUFOĞULLARI, 587 шт., 4 490 080 ₽) — сырьё подрядчика (решение владельца 09.10.2026). В изделиях МН17 (ТЗ 97, 104) бобр входит в 16 980 ₽ за ед. ` +
  `Подробно: docs-inventory/beaver-mail-findings-2026-10-12.md.`;

function readJournal(): Entry[] {
  return existsSync(JOURNAL) ? (JSON.parse(readFileSync(JOURNAL, "utf-8")) as Entry[]) : [];
}

async function rollback() {
  const entries = readJournal().filter((e) => !(e as Entry & { rolledBack?: boolean }).rolledBack);
  if (!entries.length) return console.log("Журнал пуст — откатывать нечего");
  const rev = [...entries].reverse();
  for (const e of rev) console.log(`  откат ${e.entity} ${e.id}.${e.field}`);
  if (!APPLY) return console.log("DRY-RUN: ничего не изменено. Добавьте --apply.");
  for (const e of rev) {
    const data = { [e.field]: e.before } as Record<string, unknown>;
    if (e.entity === "ProductionOrder") await prisma.productionOrder.update({ where: { id: e.id }, data });
    else if (e.entity === "ProductModel") await prisma.productModel.update({ where: { id: e.id }, data });
    else if (e.entity === "FurRef") await prisma.furRef.update({ where: { id: e.id }, data });
  }
  writeFileSync(JOURNAL, JSON.stringify(readJournal().map((e) => ({ ...e, rolledBack: true })), null, 1));
  console.log("Откат выполнен");
}

async function main() {
  console.log(`${ROLLBACK ? "ОТКАТ" : APPLY ? "ПРИМЕНЕНИЕ" : "DRY-RUN"}; БД: ${(process.env.DATABASE_URL ?? "").replace(/:\/\/[^@]*@/, "://***@")}`);
  if (ROLLBACK) return rollback();
  const org = await prisma.organization.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
  const time = new Date().toISOString();
  const J: Entry[] = [];
  const set = <T extends Record<string, unknown>>(entity: string, id: string, label: string, cur: T, field: keyof T & string, after: unknown, source: string) => {
    const before = cur[field] ?? null;
    if (JSON.stringify(before) === JSON.stringify(after)) return false;
    console.log(`  ${label}.${field}: ${JSON.stringify(before)?.slice(0, 90)} -> ${JSON.stringify(after)?.slice(0, 110)}`);
    J.push({ time, entity, id, field, before, after, source });
    return true;
  };

  for (const t of TZ) {
    const o = await prisma.productionOrder.findFirstOrThrow({ where: { organizationId: org.id, number: t.number } });
    if (!/бобр/i.test(o.materialDescription ?? "")) throw new Error(`${t.number}: материал не «бобр» — остановка`);
    if (o.notes?.includes(TAG)) { console.log(`  ${t.number}: уже внесено — пропуск`); continue; }
    const src = `письма backup.pst (приложение ${t.tz}, расчёты партий 10/11)`;
    set("ProductionOrder", o.id, `ТЗ ${t.tz}`, o, "materialDescription", t.materialDescription, src);
    set("ProductionOrder", o.id, `ТЗ ${t.tz}`, o, "lining", t.lining, src);
    set("ProductionOrder", o.id, `ТЗ ${t.tz}`, o, "notes", `${o.notes ?? ""}\n${t.note}`.trim(), src);
  }
  const m = await prisma.productModel.findFirstOrThrow({ where: { organizationId: org.id, name: "MH17" } });
  if (!m.description) set("ProductModel", m.id, "MH17", m, "description", MH17_DESC, "письма №271, №312, №243, расчёт МГУ");
  else console.log(`  MH17: описание уже заполнено — пропуск`);
  const f = await prisma.furRef.findFirstOrThrow({ where: { organizationId: org.id, name: "Бобр" } });
  if (!(f.note ?? "").includes(TAG)) {
    const aliases = Array.from(new Set([...f.aliases, ...FUR_ALIASES]));
    set("FurRef", f.id, "Вид меха Бобр", f, "aliases", aliases, "письма №101, №172, №271");
    set("FurRef", f.id, "Вид меха Бобр", f, "note", FUR_NOTE, "письма №101, №172, №271");
  } else console.log("  Вид меха Бобр: уже внесено — пропуск");

  if (!J.length) return console.log("Нечего менять");
  if (!APPLY) return console.log(`DRY-RUN: изменений ${J.length}, в БД ничего не записано.`);
  await prisma.$transaction(async (tx) => {
    for (const e of J) {
      const data = { [e.field]: e.after } as Record<string, unknown>;
      if (e.entity === "ProductionOrder") await tx.productionOrder.update({ where: { id: e.id }, data });
      else if (e.entity === "ProductModel") await tx.productModel.update({ where: { id: e.id }, data });
      else if (e.entity === "FurRef") await tx.furRef.update({ where: { id: e.id }, data });
    }
  });
  writeFileSync(JOURNAL, JSON.stringify([...readJournal(), ...J], null, 1));
  console.log(`Применено изменений: ${J.length}. Журнал: ${JOURNAL}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
