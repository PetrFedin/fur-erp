/**
 * Сверка с документами: цвета ТЗ / лотов / позиций закупок, составной цвет ТЗ 78, размеры лотов, размер ТЗ.
 * Только то, что подтверждено документом; остальное — в docs-inventory/data-check-pending.json.
 *
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-data-check.ts            # пробный прогон (ничего не пишет в БД)
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-data-check.ts --apply    # применить (сначала scripts/backup.sh)
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-data-check.ts --rollback # откат по журналу
 * Журнал: docs-inventory/corrections-journal-data-check.json (идемпотентно: уже применённое пропускается).
 * Источники: приложения ТЗ (docs-inventory/extract/prod*.json), единый реестр (строки в notes ТЗ: bulk-import-registry-2026-09:row-N,
 * scripts/crosscheck-data/registry-tz-positions.json), описания лотов в УПД/спецификациях/счетах (extract/p20*.json).
 */
import { join } from "path";
import { PrismaClient } from "@prisma/client";
import { INV, ROOT, readJson, writeJson, loadPurchaseExtracts } from "./detail-common";
import { parseLotSizeGrade } from "../src/lib/lot-size";
import { orderColors, formatOrderColors } from "../src/lib/order-colors";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const JOURNAL = join(INV, "corrections-journal-data-check.json");
const PENDING = join(INV, "data-check-pending.json");
const TAG = "[data-check 2026-10-07]";

type Pending = { entity: string; id: string; label?: string; field: string; candidate: string | null; source: string; note: string };
type Change =
  | { kind: "order"; id: string; before: { color: string | null; colorRefId: string | null; size: string | null; notes: string | null }; after: Record<string, string | null> }
  | { kind: "lot"; id: string; before: { color: string | null; colorRefId: string | null; sizeGrade: string | null }; after: Record<string, string | null> }
  | { kind: "item"; id: string; before: { color: string | null; colorRefId: string | null }; after: Record<string, string | null> }
  | { kind: "orderColor"; id: string; orderId: string };
type Journal = { script: string; appliedAt?: string; rolledBackAt?: string; changes: Change[] };

// ---------- 1. Цвета ТЗ из документов (приложение ТЗ / строка единого реестра)
const REG = "единый реестр «21-08 ЕДИНЫЙ_РЕЕСТР_ПО_МЕХУ_MVST», лист «Реестр (единый)»";
const ORDER_COLOR: Array<{ num: string; color: string; source: string; note?: string }> = [
  ...["0001", "0003", "0009", "0025", "0026", "0034", "0037", "0045", "0062", "0069", "0071"].map((n) => ({
    num: `П-2026-${n}`, color: "Коричневый",
    source: "приложение ТЗ, поле «цвет»: «коричневый/Коричневый»; в реестре тот же ТЗ: «Color NATURAL», аналог «Коричневый» (см. docs-inventory/color-unification.md)",
    note: "в реестре оттенок записан как NATURAL",
  })),
  { num: "П-2026-0116", color: "Коричневый", source: `${REG}, строка 505 (ТЗ 110): «Коричневый»; базовая версия приложения ТЗ 110 — коричневый (версия +4% — бежевый, расходится)`, note: "версии приложения расходятся (базовая — коричневый, +4% — бежевый), принят цвет реестра" },
  { num: "П-2026-0123", color: "Светло-бежевый", source: `${REG}, строка 529 (ТЗ 118, MSC03): «С-Бежевый»; приложение ТЗ 118 — «разн.»` },
  { num: "П-2026-0124", color: "Бежевый", source: `${REG}, строка 532 (ТЗ 118, MSC04 пастель): «Бежевый»; расчёт доплаты партии 17: «MSC04 пастель»` },
  { num: "П-2026-0125", color: "Чёрный", source: `${REG}, строка 534 (ТЗ 118, MSC04 блек): «Черный»; расчёт доплаты партии 17: «MSC04 блек»` },
  { num: "П-2026-0126", color: "Коричневый", source: `${REG}, строка 536 (ТЗ 118, MSC05): «Коричневый»` },
];
// ТЗ 78 (П-2026-0086): составной цвет по приложению ТЗ 78 («42(синий), 46(синий), 42(черный)», «синий x2, черный x1», лоты 728002/728001 синий, 728011 чёрный)
const ORDER_78 = { num: "П-2026-0086", parts: [{ color: "Тёмно-синий", quantity: 2, sizes: "42, 46" }, { color: "Чёрный", quantity: 1, sizes: "42" }], source: "приложение ТЗ 78 «ПРИЛОЖЕНИЕ 78 (М022 каракульча)»: размеры «42(синий), 46(синий), 42(черный)», цвет «синий x2, черный x1»; расчёт доплаты партии 7: «М022 синяя» 2 шт., «М022 чёрная» 1 шт." };
// размер ТЗ: «58.58» → «58,58» (приложение ТЗ 96: размеры 58,58; кол-во 2)
const ORDER_SIZE: Array<{ num: string; from: string; to: string; source: string }> = [
  { num: "П-2026-0104", from: "58.58", to: "58,58", source: "приложение ТЗ 96 (MH06, 2 шт.): размеры «58,58»; в реестре «58.58» — слипшиеся два размера" },
];

// ---------- 2. Цвета лотов / позиций по тексту документов (описание лота в УПД/спецификации/счёте)
const COLOR_WORDS: Array<[RegExp, string]> = [
  [/лаванд|lavand|lavend/i, "Лаванда"],
  [/коричнев|браун|brown|махагон/i, "Коричневый"],
  [/черн|чёрн|блек|black/i, "Чёрный"],
  [/(?:^|[^а-яa-z])бел[аоыуи]|white|отбелен/i, "Белый"],
  [/\bgr[ea]y\b/i, "Серый"],
  [/ирис/i, "Ирис"],
  [/пастел/i, "Пастель"],
  [/жемчуг/i, "Жемчуг"],
  [/виолет/i, "Виолет"],
  [/красн/i, "Красный"],
  [/оранж/i, "Оранжевый"],
];
const DYED_TO = /краш\S*\s+в\s+чер|крашен\S*\s+в\s+чер/i;
function colorsInText(t: string): Set<string> {
  const s = new Set<string>();
  for (const [re, n] of COLOR_WORDS) if (re.test(t)) s.add(n);
  return s;
}
function lotKey(raw: unknown): string | null {
  const t = String(raw ?? "").trim();
  if (!/^\d[\d\s/,]*(?:\(.*\))?$/.test(t)) return null;
  return (t.replace(/\(.*\)/, "").match(/\d+/g) ?? []).join("/") || null;
}

async function rollback() {
  const j = readJson<Journal | null>(JOURNAL, null);
  if (!j?.changes?.length) return console.log("Журнала нет или он пуст");
  for (const c of [...j.changes].reverse()) {
    if (c.kind === "orderColor") await prisma.productionOrderColor.deleteMany({ where: { id: c.id } });
    else if (c.kind === "order") await prisma.productionOrder.update({ where: { id: c.id }, data: c.before });
    else if (c.kind === "lot") await prisma.rawMaterialLot.update({ where: { id: c.id }, data: c.before });
    else await prisma.purchaseItem.update({ where: { id: c.id }, data: c.before });
  }
  console.log(`Откат: ${j.changes.length} изменений`);
  writeJson(JOURNAL, { ...j, rolledBackAt: new Date().toISOString(), changes: [] });
}

async function main() {
  if (process.argv.includes("--rollback")) return rollback();
  const pending: Pending[] = [];
  const changes: Change[] = [];
  const stat = { ordersColor: 0, orderColors: 0, ordersSize: 0, lotsColor: 0, itemsColor: 0, lotsSize: 0 };
  const refs = await prisma.colorRef.findMany();
  const ref = (n: string) => { const r = refs.find((x) => x.name === n); if (!r) throw new Error(`нет цвета ${n}`); return r; };

  // --- ТЗ: цвет
  const orders = await prisma.productionOrder.findMany({ select: { id: true, number: true, color: true, colorRefId: true, size: true, notes: true, colors: true } });
  // состояние до первого (прерванного) запуска: значения, записанные до создания журнала, берём из снимка
  const pre = readJson<Record<string, { color: string | null; colorRefId: string | null; size: string | null }>>(join(INV, "data-check-prestate-orders.json"), {});
  const journaled = new Set(readJson<Journal>(JOURNAL, { script: "", changes: [] }).changes.filter((c) => c.kind === "order").map((c) => c.id));
  const stripTag = (n: string | null) => { const r = (n ?? "").split("\n").filter((l) => !l.startsWith(TAG)).join("\n"); return r || null; };
  for (const o of orders) {
    if ((o.notes ?? "").includes(TAG) && !journaled.has(o.id) && pre[o.number]) {
      Object.assign(o, { notes: stripTag(o.notes), ...pre[o.number] });
    }
  }
  const byNum = new Map(orders.map((o) => [o.number, o]));
  for (const p of ORDER_COLOR) {
    const o = byNum.get(p.num); if (!o) throw new Error(p.num);
    const r = ref(p.color);
    if (o.colorRefId === r.id) continue;
    if (o.colorRefId) { pending.push({ entity: "ProductionOrder", id: p.num, field: "color", candidate: p.color, source: p.source, note: `уже задан другой цвет (${o.color})` }); continue; }
    const note = `${TAG} цвет «${o.color ?? "—"}» → «${r.name}»: ${p.source}.${p.note ? " " + p.note + "." : ""}`;
    changes.push({ kind: "order", id: o.id, before: { color: o.color, colorRefId: o.colorRefId, size: o.size, notes: o.notes }, after: { color: r.name, colorRefId: r.id, notes: [o.notes, note].filter(Boolean).join("\n") } });
    stat.ordersColor++;
  }
  pending.push(
    { entity: "ProductionOrder", id: "П-2026-0183", label: "ТЗ 116 «Ремонт пальто»", field: "batchId", candidate: null, source: `${REG}, строки 520–521: колонка «партия» пуста; приложения ТЗ 116 в Drive нет; ни одно письмо/расчёт партий его не содержит`, note: "в партию не привязан: доказательств принадлежности нет, вероятно индивидуальная работа — подтвердить владельцем" },
    { entity: "ProductionOrder", id: "П-2026-0122", label: "ТЗ 117 кейп М057", field: "batchId", candidate: null, source: "приложение ТЗ 117 лежит в «2026/инд пошив кейп» (отдельно от «2026/поставки»), расчёт «расчет.xlsx» там же; реестр, строка 522: партия не указана", note: "вне партий — индивидуальный пошив (папка «инд пошив кейп»); остаётся без партии" },
    { entity: "ProductionOrder", id: "П-2026-0116", label: "ТЗ 110", field: "color", candidate: "Бежевый", source: "приложение ТЗ 110, версия +4%: «бежевый»; базовая версия и реестр (строка 505): «коричневый»", note: "записан «Коричневый» (реестр + базовая версия); версии приложения расходятся — подтвердить" },
    { entity: "ProductionOrder", id: "11 ТЗ (0001, 0003, 0009, 0025, 0026, 0034, 0037, 0045, 0062, 0069, 0071)", field: "color", candidate: "Натуральный", source: "реестр: Color «NATURAL», аналог «Коричневый»; приложения ТЗ: «Коричневый»", note: "записан «Коричневый» по приложению ТЗ (оттенок NATURAL сохранён в примечании); если владелец хочет «Натуральный» — цвет есть в справочнике (псевдоним NATURAL)" },
    { entity: "ProductionBatch", id: "7–13", field: "year", candidate: "2025", source: "папка Drive «Производство меховых изделий/2025/поставка 7 … 13»; но счета и ТЗ партий датированы 15.01–06.03.2026", note: "в БД год 2026 (по датам документов), по папке — 2025; решение владельца" },
    { entity: "ProductionBatch", id: "15, 16", field: "orders", candidate: null, source: "в Drive нет папок «поставка 15/16», в реестре и письмах партий 15/16 нет", note: "пустые, год пуст; подтверждено, что партий не существует; запись не удалена" },
    { entity: "PurchaseItem", id: "Бобр (deep blue)", field: "colorRefId", candidate: "Тёмно-синий?", source: "отчёт о закупке бобра: «Dressed beaver skin color deep blue»", note: "«deep blue» нет в справочнике (NAVY=Тёмно-синий) — решение владельца" },
  );
  // --- ТЗ 78: ProductionOrderColor
  {
    const o = byNum.get(ORDER_78.num)!;
    if (o.colors.length === 0) {
      const items = ORDER_78.parts.map((x) => ({ ref: ref(x.color), quantity: x.quantity, sizes: x.sizes }));
      const text = formatOrderColors(items.map((i) => ({ color: { id: i.ref.id, name: i.ref.name }, name: i.ref.name, quantity: i.quantity, sizes: i.sizes })));
      const note = `${TAG} составной цвет разнесён в справочник (ProductionOrderColor): ${text}. Основание: ${ORDER_78.source}.`;
      changes.push({ kind: "order", id: o.id, before: { color: o.color, colorRefId: o.colorRefId, size: o.size, notes: o.notes }, after: { color: text, colorRefId: items[0].ref.id, notes: [o.notes, note].filter(Boolean).join("\n") } });
      stat.ordersColor++;
      for (const i of items) { changes.push({ kind: "orderColor", id: `new:${i.ref.id}`, orderId: o.id }); stat.orderColors++; }
    }
  }
  // --- ТЗ: размер
  for (const s of ORDER_SIZE) {
    const o = byNum.get(s.num)!; if (o.size !== s.from) continue;
    changes.push({ kind: "order", id: o.id, before: { color: o.color, colorRefId: o.colorRefId, size: o.size, notes: o.notes }, after: { size: s.to, notes: [o.notes, `${TAG} размер «${s.from}» → «${s.to}»: ${s.source}.`].filter(Boolean).join("\n") } });
    stat.ordersSize++;
  }
  // оставшиеся ТЗ без цвета / без размера
  const planned = new Set(changes.filter((c) => c.kind === "order").map((c) => c.id));
  for (const o of orders) {
    if (planned.has(o.id)) continue;
    if (!o.colorRefId && o.colors.length === 0) pending.push({ entity: "ProductionOrder", id: o.number, field: "color", candidate: null, source: "приложения ТЗ не найдено; в реестре строки 520–521 (ТЗ 116 «Ремонт пальто», МН11, 7 ед.) без цвета; лот 10026 «норка серебристо-голубая 50 М» — это сырьё, цвет изделия не указан", note: "цвет в документах не указан" });
    if (!o.size) pending.push({ entity: "ProductionOrder", id: o.number, field: "size", candidate: null, source: "реестр строки 520–521 без размера, приложения нет", note: "размер в документах не указан" });
  }

  // --- лоты и позиции: цвет и размер
  const docDesc = new Map<string, Set<string>>();
  for (const d of loadPurchaseExtracts()) for (const l of d.lots ?? []) {
    const k = lotKey(l.lot); const desc = typeof l.description === "string" ? l.description : null;
    if (k && desc && !/^то же$/i.test(desc.trim())) { if (!docDesc.has(k)) docDesc.set(k, new Set()); docDesc.get(k)!.add(`${desc} [${d.title}]`); }
  }
  const lots = await prisma.rawMaterialLot.findMany({ include: { rawMaterial: true, purchaseItems: true } });
  const lotsBefore = { color: lots.filter((l) => l.colorRefId).length, size: lots.filter((l) => l.sizeGrade).length };
  const itemsAll = await prisma.purchaseItem.findMany({ include: { rawMaterial: true } });
  const itemsBefore = itemsAll.filter((i) => i.colorRefId).length;
  const itemDone = new Set<string>();
  for (const l of lots) {
    const k = lotKey(l.lotNumber);
    const docs = k ? [...(docDesc.get(k) ?? [])] : [];
    const texts = [l.grade ?? "", ...docs.map((d) => d.replace(/ \[.*\]$/, ""))].filter(Boolean);
    const src = (pred: (t: string) => boolean) => docs.filter((d) => pred(d)).map((d) => d.replace(/^.*\[(.*)\]$/, "$1")).slice(0, 2).join("; ");
    if (/собол/i.test(l.rawMaterial.name) && texts.some((t) => /норк/i.test(t))) {
      pending.push({ entity: "RawMaterialLot", id: l.lotNumber ?? l.id, field: "color/sizeGrade", candidate: "Коричневый (по описанию «норка коричневая»)", source: texts.join(" || "), note: "материал лота «Соболь», а в описании и в счёте SAGA 03-26 — норка: противоречие, решение владельца" });
      continue;
    }
    // цвет
    if (!l.colorRefId) {
      const hits = new Set<string>(); let dyed = false;
      for (const t of texts) { colorsInText(t).forEach((c) => hits.add(c)); if (DYED_TO.test(t)) dyed = true; }
      if (l.colorRefId === null && hits.size === 1 && !dyed && !/lining|подклад/i.test(l.rawMaterial.name)) {
        const name = [...hits][0]; const r = ref(name);
        const from = texts.find((t) => colorsInText(t).has(name))!;
        changes.push({ kind: "lot", id: l.id, before: { color: l.color, colorRefId: l.colorRefId, sizeGrade: l.sizeGrade }, after: { color: r.name, colorRefId: r.id } });
        stat.lotsColor++;
        // позиции закупок этого лота — та же строка документа
        for (const it of l.purchaseItems) if (!it.colorRefId && !itemDone.has(it.id) && l.rawMaterial.unit !== "M") {
          itemDone.add(it.id);
          changes.push({ kind: "item", id: it.id, before: { color: it.color, colorRefId: it.colorRefId }, after: { color: r.name, colorRefId: r.id } });
          stat.itemsColor++;
        }
        void from;
      } else if (hits.size > 1 || dyed) {
        pending.push({ entity: "RawMaterialLot", id: l.lotNumber ?? l.id, field: "color", candidate: [...hits].join(" / ") || null, source: texts.join(" || "), note: dyed ? "в описании «крашеная в чёрный»: цвет шкуры и цвет после крашения расходятся — решение владельца" : "в описании несколько цветов" });
      } else {
        pending.push({ entity: "RawMaterialLot", id: l.lotNumber ?? l.id, field: "color", candidate: null, source: texts.join(" || ") || "(описания нет)", note: `цвет в документах не указан${docs.some((d) => /тониров|муссон|GR SKY|GR DARK/i.test(d)) ? " (есть только название тонировки: «" + src(() => true) + "» — не цвет из справочника)" : ""}` });
      }
    }
    // размер
    if (!l.sizeGrade) {
      const sizes = new Set<string>();
      for (const t of texts) { const s = parseLotSizeGrade(t, l.rawMaterial.name); if (s) sizes.add(s); }
      if (sizes.size === 1) {
        const s = [...sizes][0];
        changes.push({ kind: "lot", id: l.id, before: { color: l.color, colorRefId: l.colorRefId, sizeGrade: l.sizeGrade }, after: { sizeGrade: s } });
        stat.lotsSize++;
      } else if (sizes.size > 1) pending.push({ entity: "RawMaterialLot", id: l.lotNumber ?? l.id, field: "sizeGrade", candidate: [...sizes].join(" / "), source: texts.join(" || "), note: "документы дают разные размеры" });
      else if (!/подклад/i.test(l.rawMaterial.name)) pending.push({ entity: "RawMaterialLot", id: l.lotNumber ?? l.id, field: "sizeGrade", candidate: null, source: texts.join(" || ") || "(описания нет)", note: "размер в документах не указан" });
    }
  }
  // позиции без лота — по собственному описанию
  for (const it of itemsAll) {
    if (it.colorRefId || itemDone.has(it.id) || it.lotId || it.rawMaterial.unit === "M") continue;
    const k = lotKey(it.lotNumber); const docs = k ? [...(docDesc.get(k) ?? [])].map((d) => d.replace(/ \[.*\]$/, "")) : [];
    const hits = new Set<string>(); let dyed = false;
    for (const t of [it.grade ?? "", ...docs]) { colorsInText(t).forEach((c) => hits.add(c)); if (DYED_TO.test(t)) dyed = true; }
    if (hits.size === 1 && !dyed) {
      const r = ref([...hits][0]);
      changes.push({ kind: "item", id: it.id, before: { color: it.color, colorRefId: it.colorRefId }, after: { color: r.name, colorRefId: r.id } });
      stat.itemsColor++; itemDone.add(it.id);
    }
  }

  // сводка
  const total = { lots: lots.length, items: itemsAll.length };
  console.log(APPLY ? "== APPLY ==" : "== DRY-RUN ==");
  console.log("ТЗ цвет:", stat.ordersColor, "(из них ProductionOrderColor строк:", stat.orderColors + ")", "| ТЗ размер:", stat.ordersSize);
  console.log(`лоты цвет: +${stat.lotsColor} (было ${lotsBefore.color} из ${total.lots}); лоты размер: +${stat.lotsSize} (было ${lotsBefore.size}); позиции закупок цвет: +${stat.itemsColor} (было ${itemsBefore} из ${total.items})`);
  console.log("pending:", pending.length);
  writeJson(PENDING, pending);
  if (process.argv.includes("--list")) for (const c of changes) if (c.kind === "lot" || c.kind === "item") console.log(c.kind, c.id, JSON.stringify(c.after));

  if (!APPLY) return;
  const done: Change[] = [];
  const prev = readJson<Journal>(JOURNAL, { script: "apply-data-check.ts", changes: [] });
  for (const c of changes) {
    if (c.kind === "order") {
      const merged = { ...c.after } as Record<string, string | null>;
      await prisma.productionOrder.update({ where: { id: c.id }, data: merged });
      done.push(c);
    } else if (c.kind === "lot") { await prisma.rawMaterialLot.update({ where: { id: c.id }, data: c.after }); done.push(c); }
    else if (c.kind === "item") { await prisma.purchaseItem.update({ where: { id: c.id }, data: c.after }); done.push(c); }
    else {
      const part = ORDER_78.parts.find((p) => `new:${ref(p.color).id}` === c.id)!;
      const row = await prisma.productionOrderColor.create({ data: { orderId: c.orderId, colorRefId: ref(part.color).id, quantity: part.quantity, sizes: part.sizes } });
      done.push({ ...c, id: row.id });
    }
  }
  writeJson(JOURNAL, { script: "apply-data-check.ts", appliedAt: new Date().toISOString(), changes: [...prev.changes, ...done] });
  console.log("Применено:", done.length);
  void ROOT; void orderColors;
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
