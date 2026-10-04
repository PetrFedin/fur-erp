/**
 * Дата выпуска (endDate) партий по ДАТАМ ФАЙЛОВ Drive «мех» (modifiedTime из drive-manifest.json — это исходные даты
 * файлов, createdTime у всех = день копирования 01.10.2026 и не информативен) + документам: баланс 040226,
 * «Расчет по оплатам», расчёты/счета доплат, письма партий.
 *
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-dates-from-drive-meta.ts            # DRY-RUN (пишет только docs-inventory/dates-drive-meta.*)
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-dates-from-drive-meta.ts --apply    # запись endDate (до этого scripts/backup.sh)
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-dates-from-drive-meta.ts --rollback docs-inventory/corrections-journal-dates-drive-meta.json
 *
 * Правило: дату ставим, где ≥2 независимых источника согласны ±7 дней ИЛИ один прямой документ с явной датой события.
 * Дата ТЗ (workOrderDate) НЕ ставится: файлы приложений ТЗ одной партии имеют одну и ту же дату изменения (пакетная загрузка),
 * а у партий 3, 7 она позже даты отгрузки — это не дата запуска. Кандидаты — в dates-drive-meta.md и dates-pending.json.
 * Пишет только ProductionOrder.endDate (+строка-основание в notes), только у COMPLETED без endDate. verifiedAt не трогает.
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const ROOT = resolve(__dirname, "..");
const INV = join(ROOT, "docs-inventory");
const JOURNAL = join(INV, "corrections-journal-dates-drive-meta.json");
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const rb = args.indexOf("--rollback");
const MARK = "[дата выпуска по документам и датам файлов Drive 2026-10-04]";

type Ev = { date: string; conf: "two" | "direct"; sources: string };
/** Партии, где дата подтверждена (ставится). */
export const SET: Record<number, Ev> = {
  2: { date: "2025-09-29", conf: "two", sources: "баланс 040226 «отгрузка» 29.09.2025 (4 049 170) + УПД №171 от 30.09.2025 (на пошив) + счёт №170 от 30.09.2025; файлы папки «поставка 2» изменены 24.09–07.10.2025. Расчёт 22.09.2025 в «Расчет по оплатам» — заголовок-копия партии 1." },
  8: { date: "2026-01-27", conf: "two", sources: "заголовок расчёта «расчёт доплаты за пошив 26.01.2026 (ПАРТИЯ 8)» + баланс 040226 примечание «выслан 27.01.2026» + файлы «расчет пошива 8 партии» / «расчет производства партии 8» изменены 28.01.2026, приложения ТЗ 84–89 — 22–26.01.2026. Строка баланса «отгрузка 12/29/2025» противоречит партии 7 (15.01.2026) и расчёту — принята за опечатку (29.01.2026)." },
  10: { date: "2026-02-18", conf: "two", sources: "расчёт доплаты партии 10 «18.02.2026» + счёт №41 от 18.02.2026 + письмо Василия 18.02.2026 («расчёт доплаты по партии 10 + счёт», 26 ед.) с согласованием 19.02.2026; файлы расчёта и счёта изменены 18.02.2026, приложения ТЗ 97–100 — 12–18.02.2026." },
  11: { date: "2026-02-24", conf: "two", sources: "счёт №51 от 24.02.2026 + письмо Василия 24.02.2026 («расчёт доплаты по партии 11 + счёт», 14 ед.), подтверждено 26–27.02.2026; файлы расчёта/счёта изменены 24.02.2026, приложения ТЗ 101–104 — 20–24.02.2026." },
  12: { date: "2026-03-02", conf: "two", sources: "счета №63 и №65 от 02.03.2026 + письмо 17–20.04.2026: «все изделия отгружены в начале марта 2026» (прямое указание месяца) ; файлы расчёта/счетов изменены 02.03.2026, приложения ТЗ 105–110 — 27.02–02.03.2026." },
  13: { date: "2026-03-06", conf: "two", sources: "счёт №71 от 06.03.2026 + расчёт 06.03.2026 + письмо 17–20.04.2026: «весь товар отгружен в марте 2026» ; файлы изменены 05–06.03.2026." },
};
/** Партии, где дата НЕ ставится — кандидаты и причина. */
export const PENDING: Record<number, { cand: string; why: string }> = {
  5: { cand: "2025-11-18 / 2025-12-04", why: "баланс 040226 «отгрузка» 18.11.2025 против расчёта, счёта №235 и письма 04.12.2025 (разрыв 16 дней, файлы ТЗ партии изменены 02–04.12.2025); письма 04–15.12 — спор о шкурах подрядчика. Источники не согласны ±7 дней." },
  17: { cand: "2026-07-03", why: "письмо 03.07.2026: «КИЗ получили, после активации (≈2 ч) привезём в ЦУМ»; письмо 12.08.2026 «произведены 4 ед. в срочном порядке для съёмки»; счёт №207 и расчёт 16.07.2026. Факт приёмки датой не подтверждён." },
  18: { cand: "2026-09-02", why: "письмо 01.09.2026: «поставка завтра — 02 сентября» (раньше 31.08); согласование доплаты — «в день поставки и приёмки по браку». Это план, акта/письма о приёмке нет; файлы партии изменены 25.08–01.09.2026." },
  21: { cand: "—", why: "расчёт и счёт №275 от 01.10.2026 (файлы 01.10.2026); ТЗ в работе (выпуск 0), поставка не подтверждена." },
};

const D_FOLDER = /поставк[аи]\s*(\d+)|партия\s*(\d+)/i;
function build() {
  type F = { id: string; path: string; title: string; mimeType: string; modifiedTime: string };
  const m: F[] = JSON.parse(readFileSync(join(INV, "drive-manifest.json"), "utf8"));
  const by: Record<number, Record<string, string[]>> = {};
  const kind = (t: string) =>
    /^ПРИЛОЖЕНИЕ/i.test(t) ? "ТЗ" : /^УПД/i.test(t) ? "УПД" : /^Счет/i.test(t) ? "счёт" : /\.msg$/i.test(t) ? "письмо" : /расчет|баланс/i.test(t) ? "расчёт" : "прочее";
  for (const f of m) {
    if (!f.path.includes("Производство") || f.mimeType === "application/vnd.google-apps.folder") continue;
    const seg = f.path.split("/").find((s) => /^(поставка|партия)\s*\d+/i.test(s));
    const n = seg ? Number((seg.match(/\d+/) ?? [])[0]) : NaN;
    if (!n) continue;
    ((by[n] ??= {})[kind(f.title)] ??= []).push(f.modifiedTime.slice(0, 10));
  }
  const rng = (a?: string[]) => (a?.length ? (new Set(a).size === 1 ? a[0] : `${[...a].sort()[0]}…${[...a].sort().at(-1)}`) + ` (${a.length})` : "—");
  const rows = Object.keys(by).map(Number).sort((a, b) => a - b).map((n) => ({
    batch: n, tz: rng(by[n]["ТЗ"]), calc: rng(by[n]["расчёт"]), invoice: rng(by[n]["счёт"]), upd: rng(by[n]["УПД"]), mail: rng(by[n]["письмо"]),
    decision: SET[n] ? `ставится ${SET[n].date}` : PENDING[n] ? `не ставится, кандидат ${PENDING[n].cand}` : "уже в БД / нет данных",
  }));
  return rows;
}

async function rollback(file: string) {
  const j = JSON.parse(readFileSync(file, "utf8")) as { changes: { id: string; number: string; endBefore: string | null; endAfter: string; notesBefore: string | null; notesAfter: string }[] };
  let ok = 0, skip = 0;
  for (const c of j.changes.slice().reverse()) {
    const o = await prisma.productionOrder.findUnique({ where: { id: c.id }, select: { endDate: true, notes: true } });
    if (!o || o.endDate?.toISOString() !== c.endAfter || o.notes !== c.notesAfter) { console.log("пропуск", c.number, "(изменено после скрипта)"); skip++; continue; }
    await prisma.productionOrder.update({ where: { id: c.id }, data: { endDate: c.endBefore ? new Date(c.endBefore) : null, notes: c.notesBefore } });
    ok++;
  }
  console.log(`ОТКАТ: ${ok}, пропущено ${skip}`);
}

async function main() {
  if (rb >= 0) return rollback(args[rb + 1]);
  console.log(APPLY ? "ПРИМЕНЕНИЕ" : "DRY-RUN");
  const rows = build();
  writeFileSync(join(INV, "dates-drive-meta.json"), JSON.stringify({ generated: "2026-10-04", set: SET, pending: PENDING, filesByBatch: rows }, null, 1));
  const md = [
    "# Даты файлов Drive «мех» по партиям (modifiedTime) и решения по дате выпуска", "",
    "modifiedTime = исходная дата файла (createdTime у всех файлов = 01.10.2026, день копирования в «— копия», не информативен). Слабый источник: одна дата файла не доказывает событие; учитывается только вместе с письмом/расчётом/счётом.", "",
    "| Партия | Файлы приложений ТЗ (n) | Расчёты / баланс | Счета | УПД | Письма | Решение по дате выпуска |", "|---|---|---|---|---|---|---|",
    ...rows.map((r) => `| ${r.batch} | ${r.tz} | ${r.calc} | ${r.invoice} | ${r.upd} | ${r.mail} | ${r.decision} |`), "",
    "## Ставится (≥2 источника или прямой документ)", "", ...Object.entries(SET).map(([b, e]) => `- **Партия ${b}: ${e.date}** (${e.conf}) — ${e.sources}`), "",
    "## Не ставится", "", ...Object.entries(PENDING).map(([b, e]) => `- **Партия ${b}**: кандидат ${e.cand} — ${e.why}`), "",
    "## Дата ТЗ (запуск) — не ставится", "",
    "- Приложения ТЗ партии имеют одинаковую дату изменения (пакет): партия 1 — 09.09.2025 (все 18), 2 — 25.09–07.10, 3 — 13.10 и 21.10.2025 (позже отгрузки 10.10!), 4 — 12–13.11, 5 — 02–04.12 и 16.12.2025, 6 — 15–16.12, 7 — 25.12.2025–14.01.2026. Это дата подготовки/правки файла, а не запуска; в тексте приложений 1–96 стоит шаблон 16.05.2025.",
    "- Единый реестр (все 29 листов, в т.ч. 15 скрытых, прочитаны построчно): колонок «запуск/пошив/сдача/отгрузка/примерка» нет; даты есть только в счетах закупки сырья (№80…№143, «Дата заказа» 19.02.2025). Номер партии у ТЗ 1–115 совпадает с БД.",
    "- «план производства.xlsx» (07.08.2026): плановые даты запуска по модели/цвету/размеру без номеров ТЗ (01.06–26.10.2026) — не факт и не привязано к ТЗ.",
    "- «ТЗ финальные.msg» (17.09.2025): финальные ТЗ партий 1–2 высланы 17.09.2025 — единственная общая дата для партий 1–2 (кандидат на «дату согласования ТЗ», не запуска).",
  ];
  writeFileSync(join(INV, "dates-drive-meta.md"), md.join("\n") + "\n");

  const changes: { id: string; number: string; endBefore: string | null; endAfter: string; notesBefore: string | null; notesAfter: string }[] = [];
  for (const [bs, ev] of Object.entries(SET)) {
    const orders = await prisma.productionOrder.findMany({ where: { batch: { number: Number(bs) }, status: "COMPLETED", endDate: null }, select: { id: true, number: true, notes: true } });
    for (const o of orders) {
      if (o.notes?.includes(MARK)) continue;
      const notesAfter = `${o.notes ? o.notes + "\n" : ""}${MARK} endDate ${ev.date} (партия ${bs}): ${ev.sources}`;
      changes.push({ id: o.id, number: o.number, endBefore: null, endAfter: new Date(ev.date + "T00:00:00.000Z").toISOString(), notesBefore: o.notes, notesAfter });
    }
    console.log(`партия ${bs}: ${ev.date} → ${orders.length} ТЗ`);
  }
  console.log(`всего ТЗ к записи: ${changes.length}`);
  if (APPLY && changes.length) {
    const prev = existsSync(JOURNAL) ? JSON.parse(readFileSync(JOURNAL, "utf8")).changes : [];
    for (const c of changes) await prisma.productionOrder.update({ where: { id: c.id }, data: { endDate: new Date(c.endAfter), notes: c.notesAfter } });
    writeFileSync(JOURNAL, JSON.stringify({ script: "apply-dates-from-drive-meta.ts", time: new Date().toISOString(), changes: [...prev, ...changes] }, null, 1));
    console.log(`ГОТОВО. Откат: --rollback ${JOURNAL}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
