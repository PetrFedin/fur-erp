/**
 * Даты ТЗ и выпуска партий — ТОЛЬКО по документам (Drive «мех», единый реестр, БД).
 *
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-dates-from-documents.ts            # DRY-RUN (в БД не пишем)
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-dates-from-documents.ts --apply    # запись (до этого: scripts/backup.sh)
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-dates-from-documents.ts --rollback docs-inventory/corrections-journal-dates.json
 *
 * Что делает (идемпотентно, повторный прогон = 0 операций):
 *   1. Строит docs-inventory/dates-audit.json|md (по каждому ТЗ и партии: дата → источник → уверенность)
 *      и docs-inventory/dates-pending.json (очередь ручной проверки для страницы /verify).
 *   2. endDate (дата выпуска/поставки партии):
 *        - партия с подтверждённой датой (уверенность two/direct) → ставим на строках, где поле пусто или равно дате импорта 01.10.2026;
 *        - иначе, если стоит дата импорта 01.10.2026 (технический артефакт импорта, не факт) → NULL.
 *          Поле nullable; все потребители (year-scope, attention, analytics, doc-checklist) null-безопасны, год берётся из партии.
 *      В notes строки дописывается основание. verifiedAt/verifiedBy/verifyNote НЕ трогаются.
 *   3. workOrderDate НЕ меняется: новых документальных дат ТЗ нет (шаблон 16.05.2025 и повторяющаяся 12.01.2026 — не факт).
 *   4. Журнал docs-inventory/corrections-journal-dates.json; --rollback возвращает значения (пропуская изменённое после скрипта).
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const ROOT = resolve(__dirname, "..");
const INV = join(ROOT, "docs-inventory");
const JOURNAL = join(INV, "corrections-journal-dates.json");
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const rbIdx = args.indexOf("--rollback");
const ROLLBACK = rbIdx >= 0 ? args[rbIdx + 1] : null;
const MARK = "[даты из документов 2026-10-04]";
const IMPORT_DAY = "2026-10-01";

type Conf = "two" | "direct" | "indirect" | "none";
const CONF_LABEL: Record<Conf, string> = {
  two: "подтверждена двумя независимыми источниками",
  direct: "один прямой документ",
  indirect: "косвенный источник / предположение",
  none: "нет источника",
};

// ------------------------------------------------------------------ знания по партиям (дата выпуска/поставки)
type BatchEv = { cand: string | null; conf: Conf; source: string; alt?: string; note: string; state: "existing" | "apply" | "pending" | "na" };
const D_BAL = "баланс 040226.xlsx (id 16uxtGDeePNXqZ8HeHPx5ofgyZpKUpbSh)";
const BATCH: Record<number, BatchEv> = {
  1: { cand: "2025-09-22", conf: "two", state: "existing", source: `${D_BAL} «отгрузка 41 изделий» 22.09.2025 + расчёт доплаты 22.09.2025 + счёт №147 от 22.09.2025`, note: "Уже стоит в БД (apply-drive-production-payments-dates). В треде «ТЗ финальные» часть изделий отгружена на склад 19.09.2025 — дата партии = дата расчёта/баланса." },
  2: { cand: "2025-09-29", conf: "two", state: "existing", source: `${D_BAL} «отгрузка» 29.09.2025 (4 049 170) + УПД №171 от 30.09.2025 (на пошив) + счёт №170 30.09.2025; даты файлов папки 24.09–07.10.2025`, alt: "22.09.2025 — заголовок расчёта в «Расчет по оплатам» (копия партии 1)", note: "Поставлено apply-dates-from-drive-meta.ts (два источника ±1 день)." },
  3: { cand: "2025-10-10", conf: "two", state: "existing", source: `${D_BAL} отгрузка 10.10.2025 + «расчёт доплаты за пошив партия 3 10.10.2025»`, note: "Уже в БД. Счёт №181 — 17.10.2025." },
  4: { cand: "2025-11-14", conf: "two", state: "existing", source: `${D_BAL} отгрузка 14.11.2025 + расчёт 14.11.2025 + счёт №203 от 14.11.2025`, note: "Уже в БД." },
  5: { cand: "2025-12-04", conf: "indirect", state: "pending", source: "расчёт, счёт №235 и письмо 04.12.2025; файлы ТЗ партии 02–04.12.2025", alt: `${D_BAL} «отгрузка» 18.11.2025 (8 124 720)`, note: "Два кандидата расходятся на 16 дней (18.11 в балансе против 04.12 в расчёте/счёте/письме); письма 04–15.12 — спор о шкурах подрядчика. Не ставим: нужна дата приёмки." },
  6: { cand: "2025-12-18", conf: "two", state: "existing", source: `${D_BAL} отгрузка 18.12.2025 + расчёт 18.12.2025 + счёт №239 от 18.12.2025`, note: "Уже в БД." },
  7: { cand: "2026-01-15", conf: "two", state: "existing", source: `${D_BAL} отгрузка 15.01.2026 + счёт №1 от 15.01.2026 + расчёт 14.01.2026`, note: "Уже в БД (расчёт 25.12.2025 был первоначальным)." },
  8: { cand: "2026-01-27", conf: "two", state: "existing", source: "заголовок расчёта 26.01.2026 + баланс 040226 «выслан 27.01.2026» + файлы расчёта 28.01.2026, приложения ТЗ 22–26.01.2026", alt: "баланс: «отгрузка 12/29/2025» (1 215 575,39) — опечатка (раньше партии 7 от 15.01.2026)", note: "Поставлено apply-dates-from-drive-meta.ts; ±3 дня (26–29.01.2026)." },
  9: { cand: "2026-02-04", conf: "two", state: "existing", source: `${D_BAL} отгрузка 04.02.2026 + счёт №7 от 04.02.2026 + письмо 04.02.2026`, note: "Уже в БД." },
  10: { cand: "2026-02-18", conf: "two", state: "existing", source: "расчёт и счёт №41 от 18.02.2026 + письмо 18.02 (согласовано 19.02.2026) + файлы 18.02.2026", note: "Поставлено apply-dates-from-drive-meta.ts: дата расчёта/счёта партии = дата сдачи, как в партиях 1,3,4,6,7,9; акта поставки нет. ТЗ П-2026-0164 (ТЗ 97, 9 шт.) не завершено — нет списаний." },
  11: { cand: "2026-02-24", conf: "two", state: "existing", source: "счёт №51 от 24.02.2026 + письмо 24.02.2026 (подтверждено 26–27.02) + файлы 24.02.2026", alt: "20.02.2026 — заголовок расчёта", note: "Поставлено apply-dates-from-drive-meta.ts; акта поставки нет. ТЗ П-2026-0165 (ТЗ 104, 1 шт.) не завершено — нет списаний." },
  12: { cand: "2026-03-02", conf: "two", state: "existing", source: "счета №63 и №65 от 02.03.2026 + письмо 20.04.2026: «отгружены в начале марта 2026» + файлы 02.03.2026", note: "Поставлено apply-dates-from-drive-meta.ts." },
  13: { cand: "2026-03-06", conf: "two", state: "existing", source: "счёт №71 от 06.03.2026 + расчёт 06.03.2026 + письмо 20.04.2026: «отгружены в марте 2026» + файлы 05–06.03.2026", note: "Поставлено apply-dates-from-drive-meta.ts." },
  14: { cand: "2026-07-06", conf: "direct", state: "existing", source: "письмо «Партия 14» 03.07.2026: «поставка 06.07.2026» (счёт №121 от 24.06.2026)", note: "Уже в БД." },
  15: { cand: null, conf: "none", state: "na", source: "в партии нет ТЗ и документов", note: "Пустая партия (нет ТЗ, года, количества)." },
  16: { cand: null, conf: "none", state: "na", source: "в партии нет ТЗ и документов", note: "Пустая партия (нет ТЗ, года, количества)." },
  17: { cand: "2026-07-03", conf: "indirect", state: "pending", source: "письмо 03.07.2026 («КИЗ активируем ≈2 ч, затем привезём в ЦУМ») + письмо 12.08.2026 «срочная поставка 4 ед. для съёмки»", alt: "16.07.2026 — расчёт и счёт №207", note: "Не ставлю: приёмка не подтверждена, аванс оплачен 06.07 (после «поставки»)." },
  18: { cand: "2026-09-02", conf: "indirect", state: "pending", source: "письмо 01.09.2026: «поставка завтра — 02 сентября 2026» (ранее 31.08); счёт №237 от 25.08.2026", note: "Это план, письма/акта о приёмке нет (в отличие от партий 19 и 20)." },
  19: { cand: "2026-09-17", conf: "direct", state: "existing", source: "письмо «Партия 19 (41 изделие)» 18.09.2026: «поставка принята 17.09.2026»; счёт №257 от 15.09.2026", note: "Уже в БД." },
  20: { cand: "2026-09-25", conf: "direct", state: "existing", source: "письмо «Партия 20 (68 изделий)» 25.09.2026: «поставка принята 25.09.2026»; счёт №265 от 22.09.2026", note: "Дата принятия поставки; ТЗ 152–162 завершены 04.10.2026 (complete-delivered-orders.ts), кроме П-2026-0172 (нет списаний)." },
  21: { cand: null, conf: "none", state: "pending", source: "расчёт доплаты 23.09.2026, счёт №275 от 01.10.2026; приёмка поставки в документах не найдена", alt: "кандидатов нет", note: "Поставка не подтверждена." },
};

// ТЗ без партии
const NOBATCH: Record<number, { cand: string | null; conf: Conf; source: string; note: string }> = {
  116: { cand: null, conf: "none", source: "только единый реестр (строка «Ремонт пальто», без даты и партии)", note: "Создан по реестру, документов с датами нет." },
  117: { cand: null, conf: "none", source: "счёт №145 от 21.05.2026 (срок 15.06), письмо 26.05.2026 об оплате индивидуального кейпа", note: "Акта сдачи нет; дата выпуска не подтверждена." },
};

// ------------------------------------------------------------------ знания по датам ТЗ (workOrderDate)
const REG = "единый реестр «21-08 ЕДИНЫЙ_РЕЕСТР_ПО_МЕХУ_MVST 2.xlsx» (лист «Реестр (единый)»): колонки даты ТЗ нет, даны только номер ТЗ и партия";
function tzDateEv(tz: number, db: string | null, batch: number | null): { cand: string | null; conf: Conf; source: string; note: string; state: string } {
  if (tz <= 96 || tz === 116)
    return {
      cand: null, conf: "none", state: "pending",
      source: tz === 116 ? "нет (ТЗ создан по реестру)" : "в приложении ТЗ только шаблонная 16.05.2025 (= дата договора №1605)",
      note: `Реальной даты ТЗ в документах нет. Шаблонную 16.05.2025 не ставим.${batch && BATCH[batch]?.cand ? ` Для ориентира: партия ${batch} сдана ${BATCH[batch].cand} — ТЗ не позже.` : ""} Проставить вручную по подписанному ТЗ. Даты файлов приложений ТЗ партии (dates-drive-meta.md) — пакетная загрузка, не дата запуска.`,
    };
  if (tz >= 97 && tz <= 115)
    return {
      cand: "2026-01-12", conf: "indirect", state: "pending",
      source: "шапка приложений ТЗ 97–115 (одна и та же дата 12.01.2026 у 19 разных ТЗ партий 10–14, сданных с февраля по июль 2026)",
      note: "Дата одинакова у многих ТЗ — вероятнее шаблон, чем факт. В БД стоит; подтвердить или заменить по подписанному ТЗ.",
    };
  if (tz === 117)
    return { cand: db, conf: "direct", state: "existing", source: "шапка приложения ТЗ 117: 18.05.2026 (уникальная; не противоречит счёту №145 от 21.05.2026)", note: "Один документ, не шаблон." };
  if (tz === 118)
    return {
      cand: db, conf: "indirect", state: "pending",
      source: "шапка приложения ТЗ 118: 17.03.2026; поставка 03.07.2026, счёт №207 от 16.07.2026",
      note: "Дата ТЗ почти за 4 месяца до поставки срочных аксессуаров — подозрительно; гипотеза 17.06.2026 (не подтверждена, не ставим).",
    };
  if (tz >= 119 && tz <= 168)
    return { cand: db, conf: "direct", state: "existing", source: "шапка приложения ТЗ (25–27.08.2026, три разные даты по группам ТЗ — не шаблон)", note: "Один документ; не противоречит расчётам партий 18–21 и письму 21.08.2026 о правках ТЗ." };
  return { cand: null, conf: "none", state: "pending", source: REG, note: "" };
}

const fmtD = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

async function rollback(file: string) {
  const j = JSON.parse(readFileSync(file, "utf8")) as { changes: { id: string; number: string; field: string; before: string | null; after: string | null }[] };
  let ok = 0, skip = 0;
  for (const c of j.changes.slice().reverse()) {
    const o = await prisma.productionOrder.findUnique({ where: { id: c.id }, select: { endDate: true, notes: true } });
    if (!o) { skip++; continue; }
    const cur = c.field === "endDate" ? (o.endDate ? o.endDate.toISOString() : null) : o.notes;
    if (cur !== c.after) { console.log(`пропуск ${c.number}.${c.field}: изменено после скрипта`); skip++; continue; }
    const data = c.field === "endDate" ? { endDate: c.before ? new Date(c.before) : null } : { notes: c.before };
    await prisma.productionOrder.update({ where: { id: c.id }, data });
    ok++;
  }
  console.log(`ОТКАТ: возвращено ${ok}, пропущено ${skip}`);
}

async function main() {
  console.log(`${APPLY ? "ПРИМЕНЕНИЕ" : ROLLBACK ? "ОТКАТ" : "DRY-RUN (в БД не пишем)"}`);
  if (ROLLBACK) return rollback(ROLLBACK);

  const orders = await prisma.productionOrder.findMany({
    select: { id: true, number: true, workOrderNumber: true, workOrderDate: true, endDate: true, status: true, notes: true, batch: { select: { number: true, year: true } }, verifiedAt: true },
    orderBy: { number: "asc" },
  });

  // ---------- аудит по строкам
  const rows: Record<string, unknown>[] = [];
  const changes: { id: string; number: string; field: string; before: string | null; after: string | null; label: string }[] = [];
  for (const o of orders) {
    const tz = Number(o.workOrderNumber);
    const bn = o.batch?.number ?? null;
    const wdb = fmtD(o.workOrderDate);
    const wev = tzDateEv(tz, wdb, bn);
    const endDb = fmtD(o.endDate);
    const bev = bn ? BATCH[bn] : NOBATCH[tz] ? { ...NOBATCH[tz], state: "pending" as const } : undefined;
    const isImport = endDb === IMPORT_DAY;
    // решение по endDate
    let endAction: "keep" | "set" | "null" | "none" = "none";
    let endAfter: string | null = endDb;
    const confirmed = bev && (bev.conf === "two" || bev.conf === "direct") && bev.cand;
    if (confirmed && bev.state === "apply" && (endDb === null || isImport)) { endAction = "set"; endAfter = bev.cand!; }
    else if (isImport) { endAction = "null"; endAfter = null; }
    else if (endDb) endAction = "keep";

    rows.push({
      order: o.number, tz, batch: bn, status: o.status,
      workOrderDate: { db: wdb, candidate: wev.cand, state: wev.state, confidence: wev.conf, confidenceLabel: CONF_LABEL[wev.conf], source: wev.source, note: wev.note },
      endDate: {
        dbBefore: endDb, dbAfter: endAfter, action: endAction === "none" ? (o.status === "COMPLETED" ? "нет даты" : "не требуется (ТЗ не завершено)") : endAction,
        candidate: bev?.cand ?? null, confidence: bev?.conf ?? "none", confidenceLabel: CONF_LABEL[bev?.conf ?? "none"], source: bev?.source ?? "", note: bev?.note ?? "",
      },
    });

    if (endAction === "set" || endAction === "null") {
      if (o.notes?.includes(MARK)) continue; // уже применено
      const why = endAction === "set"
        ? `endDate ${bev!.cand} (партия ${bn}): ${bev!.source}`
        : `endDate 01.10.2026 был датой импорта, а не фактом — убран (дата выпуска не подтверждена, ждёт ручной проверки${bev?.cand ? `; кандидат ${bev.cand}` : ""}).`;
      const newNotes = `${o.notes ? o.notes + "\n" : ""}${MARK} ${why}`;
      changes.push({ id: o.id, number: o.number, field: "endDate", before: o.endDate ? o.endDate.toISOString() : null, after: endAfter ? new Date(endAfter + "T00:00:00.000Z").toISOString() : null, label: why });
      changes.push({ id: o.id, number: o.number, field: "notes", before: o.notes, after: newNotes, label: "основание в notes" });
    }
  }

  // ---------- очередь ручной проверки
  type P = { tz?: number; batch?: number; orders: string[]; field: string; candidate: string | null; alt?: string; source: string; confidence: Conf; confidenceLabel: string; note: string };
  const pending: P[] = [];
  const byTz = new Map<number, typeof orders>();
  for (const o of orders) { const t = Number(o.workOrderNumber); byTz.set(t, [...(byTz.get(t) ?? []), o]); }
  for (const [tz, os] of [...byTz.entries()].sort((a, b) => a[0] - b[0])) {
    const bn = os[0].batch?.number ?? null;
    const ev = tzDateEv(tz, fmtD(os[0].workOrderDate), bn);
    if (ev.state === "pending") pending.push({ tz, orders: os.map((x) => x.number), field: "workOrderDate", candidate: ev.cand, source: ev.source, confidence: ev.conf, confidenceLabel: CONF_LABEL[ev.conf], note: ev.note });
  }
  for (const nb of Object.keys(NOBATCH).map(Number)) {
    const os = byTz.get(nb) ?? [];
    if (os.some((o) => o.status === "COMPLETED") || os.some((o) => !o.endDate))
      pending.push({ tz: nb, orders: os.map((x) => x.number), field: "endDate", candidate: NOBATCH[nb].cand, source: NOBATCH[nb].source, confidence: NOBATCH[nb].conf, confidenceLabel: CONF_LABEL[NOBATCH[nb].conf], note: NOBATCH[nb].note });
  }
  for (const [bs, ev] of Object.entries(BATCH)) {
    const b = Number(bs);
    if (ev.state !== "pending") continue;
    const os = orders.filter((o) => o.batch?.number === b);
    pending.push({ batch: b, orders: os.map((x) => x.number), field: "endDate", candidate: ev.cand, alt: ev.alt, source: ev.source, confidence: ev.conf, confidenceLabel: CONF_LABEL[ev.conf], note: ev.note });
  }

  // ---------- файлы аудита
  const after = (r: Record<string, any>) => r.endDate.dbAfter as string | null;
  const stat = {
    orders: orders.length,
    importDateBefore: orders.filter((o) => fmtD(o.endDate) === IMPORT_DAY).length,
    endDateSet: rows.filter((r: any) => r.endDate.action === "set").length,
    endDateNulled: rows.filter((r: any) => r.endDate.action === "null").length,
    endDateKeptReal: rows.filter((r: any) => r.endDate.action === "keep").length,
    endDateNoneNotRequired: rows.filter((r: any) => String(r.endDate.action).startsWith("не требуется")).length,
    workOrderDateEmptyOrTemplateOrSuspect: rows.filter((r: any) => r.workOrderDate.state === "pending").length,
    workOrderDateConfirmedOneDoc: rows.filter((r: any) => r.workOrderDate.state === "existing").length,
    pendingEntries: pending.length,
  };
  void after;
  const batches = Object.entries(BATCH).map(([b, ev]) => ({
    batch: Number(b), year: orders.find((o) => o.batch?.number === Number(b))?.batch?.year ?? null, orders: orders.filter((o) => o.batch?.number === Number(b)).length,
    endDate: ev.cand, state: ev.state, confidence: ev.conf, confidenceLabel: CONF_LABEL[ev.conf], source: ev.source, alt: ev.alt ?? null, note: ev.note,
  }));
  const sources = {
    registry: REG + ". Все 29 листов просмотрены (в т.ч. скрытые): дат запуска/выпуска/отгрузки/примерки нет; «Дата заказа» на листе «Лист13» — даты заказов закупки ЦУМ по артикулам (2024–2026), не ТЗ. Номера партий по ТЗ 1–115 совпали с БД (115 из 115).",
    driveFilesWithDates: [
      "баланс 040226.xlsx (16uxtGDeePNXqZ8HeHPx5ofgyZpKUpbSh) — «отгрузка» партий 1–9",
      "счета/расчёты доплат партий 1–21 (даты в названиях) и письма «Партия 14/19/20», «поставка 18», «партия 12», расчёт партии 17",
      "мод дат сдачи (1).xlsx (1fIwrHL57v2B9oHBielQlO1GdSgh7FwXp) — плановый график 01.09–15.11.2025 по моделям, не по ТЗ и не факт: не использован",
      "план производства.xlsx (1l3Pn5LYbVgEaN3Zs2aw1rRm9BGL9Z328) — запуск 01.06–26.10.2026 по модели/цвету/размеру без номеров ТЗ: к ТЗ не привязан",
      "даты файлов Drive по партиям: docs-inventory/dates-drive-meta.md — «дата выпуска по документам и датам файлов Drive» (scripts/apply-dates-from-drive-meta.ts, docs-inventory/dates-drive-meta.md)",
      "приложения ТЗ (шапка): 1–96 — только шаблон 16.05.2025; 97–115 — 12.01.2026 (повтор); 117 — 18.05.2026; 118 — 17.03.2026; 119–168 — 25–27.08.2026",
    ],
    shipmentFitting: "таблицы Shipment и Fitting в БД пусты (0 строк) — дат фактов нет",
    thirdSourceTzFinal: "тред «ТЗ финальные» 17–19.09.2025: финальные ТЗ партий 1–2 высланы 17.09.2025 — только интервал, дату каждого ТЗ не даёт",
  };
  writeFileSync(join(INV, "dates-audit.json"), JSON.stringify({ generated: "2026-10-04", stat, sources, batches, rows }, null, 1));
  writeFileSync(join(INV, "dates-pending.json"), JSON.stringify(pending, null, 1));
  writeFileSync(join(INV, "dates-audit.md"), buildMd(stat, sources, batches, rows as any[], pending));

  console.log(JSON.stringify(stat, null, 1));
  console.log(`операций (изменений полей): ${changes.length} (${changes.filter((c) => c.field === "endDate").length} строк)`);
  for (const c of changes.filter((c) => c.field === "endDate").slice(0, 8)) console.log(`  ${c.number}: ${c.before?.slice(0, 10) ?? "∅"} → ${c.after?.slice(0, 10) ?? "∅"}`);

  if (APPLY && changes.length) {
    const prev = existsSync(JOURNAL) ? (JSON.parse(readFileSync(JOURNAL, "utf8")).changes ?? []) : [];
    for (const c of changes) {
      const data = c.field === "endDate" ? { endDate: c.after ? new Date(c.after) : null } : { notes: c.after };
      await prisma.productionOrder.update({ where: { id: c.id }, data });
    }
    writeFileSync(JOURNAL, JSON.stringify({ script: "apply-dates-from-documents.ts", time: new Date().toISOString(), changes: [...prev, ...changes] }, null, 1));
    console.log(`ГОТОВО. Журнал ${JOURNAL}. Откат: --rollback ${JOURNAL}`);
  } else if (APPLY) console.log("Нечего применять (идемпотентно).");
}

function buildMd(stat: any, sources: any, batches: any[], rows: any[], pending: any[]) {
  const L: string[] = [];
  L.push("# Аудит дат ТЗ и партий (срез 2026-10-04)", "");
  L.push("Уверенность: **two** — два независимых источника; **direct** — один прямой документ; **indirect** — косвенный источник/предположение; **none** — нет. Ставятся и подтверждаются только two/direct; остальное — в очереди ручной проверки (`dates-pending.json`).", "");
  L.push("## Итоги", "");
  for (const [k, v] of Object.entries(stat)) L.push(`- ${k}: ${v}`);
  L.push("", "## Источники", "", `- Реестр: ${sources.registry}`);
  for (const s of sources.driveFilesWithDates) L.push(`- Drive: ${s}`);
  L.push(`- ${sources.shipmentFitting}`, `- ${sources.thirdSourceTzFinal}`, "");
  L.push("## Партии 1–21: дата выпуска/поставки", "", "| Партия | Год | ТЗ | Дата | Состояние | Уверенность | Источник | Альтернатива / примечание |", "|---|---|---|---|---|---|---|---|");
  for (const b of batches) L.push(`| ${b.batch} | ${b.year ?? "—"} | ${b.orders} | ${b.endDate ?? "—"} | ${b.state} | ${b.confidence} | ${b.source} | ${[b.alt, b.note].filter(Boolean).join("; ")} |`);
  L.push("", "## ТЗ: дата ТЗ и дата выпуска (по строкам ТЗ)", "", "| Строка | ТЗ | Партия | Дата ТЗ в БД | Уверенность даты ТЗ | Дата выпуска до → после | Уверенность выпуска |", "|---|---|---|---|---|---|---|");
  for (const r of rows) L.push(`| ${r.order} | ${r.tz} | ${r.batch ?? "—"} | ${r.workOrderDate.db ?? "—"} | ${r.workOrderDate.confidence} (${r.workOrderDate.state}) | ${r.endDate.dbBefore ?? "—"} → ${r.endDate.dbAfter ?? "—"} (${r.endDate.action}) | ${r.endDate.confidence} |`);
  L.push("", `## Очередь ручной проверки: ${pending.length} записей — см. dates-pending.json`, "");
  return L.join("\n") + "\n";
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
