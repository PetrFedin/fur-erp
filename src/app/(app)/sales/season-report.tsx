"use client";

// «Продажи и остатки» → главная вкладка: заказ, поступление и продажи по сезонам из отчёта «заказ и продажи» (FW26/27, SS26, FW25/26).
// Дерево: мех → категория → артикул (с фото) → цвет → размер; сезоны рядом для сравнения. Карточки с фото: итоги, цена продажи и маркап по сезонам.
// Цена продажи = (выручка ₽ + скидка ₽) ÷ продано шт. (с НДС) — по какой цене продавали до скидки; маркап = цена ÷ себестоимость изделия из ТЗ (с НДС).
import { Fragment, useMemo, useState } from "react";
import { InfoHint } from "@/components/info-hint";
import { CatalogCards, type CatalogItem } from "./catalog-cards";
import type { ReportLeaf } from "./catalog-report";
import type { SupplyLeaf } from "@/lib/supply-report";
import { PhotoGalleryButton } from "@/components/photo-gallery";
import type { ReportSizeRow } from "@/lib/margin-tree";
import type { ModelCost, RetailRow } from "@/lib/margin";
import { articleKey, CAT_LABEL, colorOfLine, furKeyOfReportRow as furKeyOfRow, furRuLabel, seasonOfDate, variantOfArticle } from "@/lib/sales-receipts-core";
import type { Cat, SLine } from "@/lib/sales-section";
import { DASH, btn, money, moneyC, n0, pct, seg, segGroup, x2 } from "./sales-fmt";
import type { PhotoIdx } from "./sales-tree";
import { SeasonReceipts, type TzAwait } from "./season-receipts";

const SEASONS = ["FW25/26", "SS26", "FW26/27"] as const;
type Season = (typeof SEASONS)[number];
const SEASON_LABEL: Record<Season, string> = { "FW26/27": "FW 26/27", SS26: "SS 2026", "FW25/26": "FW 25/26" };
/** Сезон строки файла → ключ отчёта. */
const SALES_TO_REPORT: Record<string, Season> = { "FW 25/26": "FW25/26", "SS 2026": "SS26", "FW 26/27": "FW26/27" };
const SEASON_BG: Record<Season, string> = { "FW26/27": "bg-sky-50/60", SS26: "bg-amber-50/60", "FW25/26": "bg-emerald-50/50" };
type Level = "fur" | "cat1" | "cat2" | "article" | "color" | "size";
/** Два порядка разворота (04.11.2026, владелец): мех → кат.1 → кат.2 или кат.1 → кат.2 → мех; дальше артикул → цвет → размер. */
const HIER = { fur: ["fur", "cat1", "cat2", "article", "color", "size"] as Level[], cat: ["cat1", "fur", "cat2", "article", "color", "size"] as Level[] };
const LEVEL_LABEL: Record<Level, string> = { fur: "Мех", cat1: "Категория 1", cat2: "Категория 2", article: "Артикул", color: "Цвет", size: "Размер" };

const FUR_RU: Record<string, string> = { SABLE: "Соболь", MINK: "Норка", FOX: "Лиса", SWAKARA: "Каракульча", LYNX: "Рысь", BEAVER: "Бобр", CHINCHILLA: "Шиншилла" };
const furRu = (k: string) => furRuLabel(k, FUR_RU);
export { furKeyOfReportRow as furKeyOfRow } from "@/lib/sales-receipts-core";

/** Показатели сезона. По SS26 и FW25 заказ закрыт: заказано = поступило (правило владельца 21.10.2026). */
type M = {
  /** Артикулов сезона: разные артикулы, у которых есть заказ, приход или продажи. */
  arts: number;
  conf: number; confEur: number; deliv: number; delivEur: number;
  /** За сезон: товар этого сезона, проданный в календаре этого же сезона. */
  ssn: number; rubS: number; rubSIn: number; rubSEx: number; eurSIn: number; eurSEx: number; discS: number; grossS: number; costS: number;
  /** Всего в календаре сезона: товар сезона (SSN) + олды — товар прошлых сезонов, проданный в этом календаре. По отчёту: FW25 94, SS26 13 + 41 = 54, FW26 60 + 51 = 111. */
  all: number; rubA: number; rubAIn: number; discA: number; grossA: number; costA: number;
  /** Остаток товара сезона = поступило − продано товара сезона за всё время (allG). */
  stock: number;
  /** Товар сезона, проданный за всё время (в свой сезон и позже) — для SO сейчас и остатка. */
  allG: number;
  /** Штуки отчёта (для весов цены и маркапа: выручка и скидка тоже из отчёта). */
  ssnR: number; allR: number;
};
const MKEYS = ["arts", "conf", "confEur", "deliv", "delivEur", "ssn", "rubS", "rubSIn", "rubSEx", "eurSIn", "eurSEx", "discS", "grossS", "costS", "all", "rubA", "rubAIn", "discA", "grossA", "costA", "stock", "allG", "ssnR", "allR"] as const;
const zero = (): M => Object.fromEntries(MKEYS.map((k) => [k, 0])) as M;
const plus = (a: M, b: M): M => Object.fromEntries(MKEYS.map((k) => [k, a[k] + b[k]])) as M;
/** SO за сезон: продано за сезон ÷ заказано (итог сезона). SO сейчас: товар сезона, проданный за всё время, ÷ заказано. */
const soS = (m: M) => (m.conf > 0 ? m.ssn / m.conf : null);
const soA = (m: M) => (m.conf > 0 ? m.allG / m.conf : null);
/** Средневзвешенная цена продажи до скидки = (выручка + скидка) ÷ шт.; маркап = то же ÷ себестоимость проданного. */
const priceS = (m: M) => (m.ssnR > 0 ? (m.rubSIn + m.discS) / m.ssnR : null);
const priceA = (m: M) => (m.allR > 0 ? (m.rubAIn + m.discA) / m.allR : null);
const mkS = (m: M) => (m.costS > 0 ? m.grossS / m.costS : null);
const mkA = (m: M) => (m.costA > 0 ? m.grossA / m.costA : null);
/** Значение столбца для сортировки (пустое → самые маленькие). */
const numOf = (m: M, key: string): number => ({ arts: m.arts, conf: m.conf, deliv: m.deliv, wait: Math.max(0, m.conf - m.deliv), ssn: m.ssn, soS: soS(m) ?? -1, all: m.all, soA: soA(m) ?? -1, left: m.stock, rubS: m.rubS, rubA: m.rubA, priceS: priceS(m) ?? -1, priceA: priceA(m) ?? -1, mkS: mkS(m) ?? -1, mkA: mkA(m) ?? -1 } as Record<string, number>)[key] ?? 0;
const eur = (v: number) => (Math.abs(v) < 0.5 ? DASH : Math.round(v).toLocaleString("ru-RU") + " €");

type Col = { key: string; label: string; short: string; hint: string; get: (m: M, s: Season) => string; /** Мелкая подпись под значением (проценты). */ sub?: (m: M) => string; strong?: boolean; full?: boolean };
const COLS: Col[] = [
  { key: "arts", label: "Заказано, артикулов", short: "Заказ, арт.", hint: "Сколько разных артикулов в сезоне: есть заказ, приход или продажи. «Вместе» — каждый артикул один раз, включая те, что есть только на остатке.", get: (m) => n0(m.arts) },
  { key: "conf", label: "Заказано, шт.", short: "Заказ, шт.", hint: "Подтверждённый заказ по отчёту. По закрытым сезонам заказано = поступило.", get: (m) => n0(m.conf) },
  { key: "deliv", label: "Получено, шт.", short: "Получено, шт.", hint: "Получено в рознице по этому сезону (файл «поступления и продажи»).", get: (m) => n0(m.deliv) },
  { key: "wait", label: "Ждём, шт.", short: "Ждём, шт.", hint: "Заказано − поступило (только FW26).", get: (m, s) => (s === "FW26/27" ? n0(Math.max(0, m.conf - m.deliv)) : DASH), full: true },
  { key: "ssn", label: "Продано за сезон, шт.", short: "Прод. за сезон, шт.", hint: "Товара ЭТОГО сезона продано в календаре этого же сезона (FW — август–январь, SS — февраль–июль).", get: (m) => n0(m.ssn), strong: true },
  { key: "soS", label: "SO за сезон, %", short: "SO сезона", hint: "Продано за сезон ÷ заказано: итоговый SO по сезону.", get: (m) => pct(soS(m)) },
  { key: "all", label: "Продано всего, шт.", short: "Прод. всего, шт.", hint: "Весь календарь сезона: товар этого сезона (SSN) + олды, то есть товар прошлых сезонов, проданный в этом календаре.", get: (m) => n0(m.all), strong: true },
  { key: "soA", label: "SO сейчас, %", short: "SO сейчас", hint: "Товар этого сезона, проданный за всё время (в свой сезон и позже), ÷ заказано. Олды в календаре сезона в SO не входят.", get: (m) => pct(soA(m)) },
  { key: "left", label: "Остаток сезона, шт.", short: "Остаток сезона, шт.", hint: "Товар, заказанный на этот сезон: поступило − продано за всё время = остаток.", get: (m) => n0(m.stock), strong: true },
  { key: "rubS", label: "Выручка за сезон, ₽", short: "Выручка сезон", hint: "Выручка с продаж товара этого сезона в его календарь: после скидки. С НДС или без — как в шапке.", get: (m) => moneyC(m.rubS), strong: true },
  { key: "rubA", label: "Выручка всего, ₽", short: "Выручка всего", hint: "Выручка всего календаря сезона: товар сезона + олды. С НДС или без — как в шапке.", get: (m) => moneyC(m.rubA), strong: true },
  { key: "after", label: "Продано олдов, шт.", short: "Олды, шт.", hint: "Товар прошлых сезонов, проданный в календаре этого сезона: продано всего − продано за сезон.", get: (m) => n0(Math.max(0, m.all - m.ssn)) },
  { key: "rubAfter", label: "Выручка олдов, ₽", short: "Выручка олдов", hint: "Выручка с продаж олдов в календаре этого сезона: выручка всего − выручка за сезон. С НДС или без — как в шапке.", get: (m) => moneyC(Math.max(0, m.rubA - m.rubS)), strong: true },
  { key: "priceS", label: "Цена за сезон, ₽/шт.", short: "Цена сезон", hint: "Средневзвешенная: (выручка + скидка) ÷ продано за сезон, с НДС — по какой цене продавали до скидки.", get: (m) => moneyC(priceS(m)), full: true },
  { key: "priceA", label: "Цена всего, ₽/шт.", short: "Цена всего", hint: "Средневзвешенная: (выручка + скидка) ÷ продано всего (с олдами), с НДС.", get: (m) => moneyC(priceA(m)), full: true },
  { key: "mkS", label: "Маркап за сезон", short: "Маркап сезон", hint: "Средневзвешенный: цена до скидки ÷ себестоимость изделия из ТЗ (с НДС), по проданным за сезон штукам, у которых есть себестоимость.", get: (m) => x2(mkS(m)) },
  { key: "mkA", label: "Маркап всего", short: "Маркап всего", hint: "Средневзвешенный по всем проданным в календаре сезона штукам (товар сезона и олды), у которых есть себестоимость.", get: (m) => x2(mkA(m)) },
];
const TCOLS = COLS;
const cellNode = (c: Col, m: M, s: Season) => { const sub = c.sub?.(m); return <>{c.get(m, s)}{sub ? <span className="block text-[11px] font-normal leading-tight text-neutral-600">{sub}</span> : null}</>; };

type Node = { id: string; level: Level; label: string; sub?: string; modelCode: string | null; variant: string | null; rows: ReportSizeRow[]; m: Record<Season, M>; stock: number; children: Node[] };

export function SeasonReport({ controls, sizes, photos, cat, ex, reportDate, fabricByArt, prices, costs, lines, tzAwait, catalog = false, onVat, supply }: { /** Данные отчёта по заказу и поставкам (каталог). */ supply?: SupplyLeaf[]; /** Переключатель НДС каталога (кнопки в панели). */ onVat?: (ex: boolean) => void; /** Каталог «как в магазине» (раздел «Телефон»): вместо таблицы и фильтров отчёта — карточки с фото. */ catalog?: boolean; /** НДС и «Одежда / Аксессуары»: живут в разделе, показываются ниже основных переключателей. */ controls?: React.ReactNode; sizes: ReportSizeRow[]; photos: PhotoIdx; cat: Cat; ex: boolean; reportDate?: string; fabricByArt: Record<string, string>; prices: RetailRow[]; costs: [string, ModelCost][]; lines: SLine[]; tzAwait: TzAwait[] }) {
  const [pick, setPick] = useState<Season[]>([...SEASONS]);
  const [view, setView] = useState<"tree" | "cards" | "receipts">("tree");
  const [hier, setHier] = useState<"fur" | "cat">("fur");
  const [detail, setDetail] = useState(false);
  /** Показатели «продано / SO / выручка / цена / маркап»: за сезон (в календаре этого же сезона) или всего (за всё время). Общий для итогов, таблицы и карточек. */
  /** Сортировка по клику на подпись столбца (сезон + показатель) или на первую колонку («label»): порядок строк на каждом уровне дерева. Повторный клик — обратный порядок, третий — снимает. */
  const [colSort, setColSort] = useState<{ s: Season | "label" | "stock"; key: string; dir: "asc" | "desc" } | null>(null);
  const clickSort = (sk: Season | "label" | "stock", key: string) => setColSort((c) => (c && c.s === sk && c.key === key ? (c.dir === "asc" ? { s: sk, key, dir: "desc" } : null) : { s: sk, key, dir: "asc" }));
  const [basis, setBasis] = useState<"season" | "all">("all");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [sumOpen, setSumOpen] = useState<Set<string>>(new Set());
  /** Выбранная строка сводки «Итого»: карточки ниже ограничены этим сезоном / мехом / категорией. id пустой — сама строка сезона. */
  const [pickNode, setPickNode] = useState<{ s: Season | "all"; id: string } | null>(null);
  const [q, setQ] = useState("");
  const [furPick, setFurPick] = useState<string>("all");
  const [sort, setSort] = useState("rub");
  const seasons = SEASONS.filter((s) => pick.includes(s));
  const seasonsKey = seasons.join(",");
  const full = detail || seasons.length === 1;
  // Кратко: артикулы, заказ, получено, продано, SO, остаток сезона, выручка и маркап выбранной базы; «Все показатели» — все столбцы обеих баз (цена — только там).
  const compactKeys = ["arts", "conf", "deliv", basis === "season" ? "ssn" : "all", basis === "season" ? "soS" : "soA", "left", basis === "season" ? "rubS" : "rubA", "after", "rubAfter", basis === "season" ? "mkS" : "mkA"];
  const cols = TCOLS.filter((c) => (full || compactKeys.includes(c.key)) && (full || !c.full));

  const costOf = useMemo(() => new Map(costs), [costs]);
  const priceIdx = useMemo(() => { const m = new Map<string, number>(); for (const p of prices) { const k = `${p.acode}|${p.color}|${p.size}`; if (!m.has(k)) m.set(k, p.price); } return m; }, [prices]);
  const nowPrice = (r: ReportSizeRow) => priceIdx.get(`${r.acode}|${r.color}|${r.size}`) ?? null;

  const LEVELS = HIER[hier];
  const rows = useMemo(() => sizes.filter((r) => r.seas && (cat === "all" || r.cls === cat)), [sizes, cat]);
  const keyOf = (r: ReportSizeRow, l: Level) => l === "fur" ? furRu(furKeyOfRow(r, fabricByArt)) : l === "cat1" ? (r.l3 || "(без категории)") : l === "cat2" ? (r.l4 || r.l5 || "(без категории)") : l === "article" ? r.acode : l === "color" ? colorOfLine(r.color) : r.size || "(без размера)";
  const furs = useMemo(() => [...new Set(rows.map((r) => keyOf(r, "fur")))].sort(), [rows, fabricByArt]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Продажи товара сезона позже его календаря (из строк файла): артикул+цвет → период продажи → сезон товара → показатели. Период = сезон даты, сезон товара = сезон партии строки. */
  type Agg = { pcs: number; rubIn: number; rubEx: number; disc: number; grossC: number; costS: number };
  const crossIdx = useMemo(() => {
    const m = new Map<string, Map<Season, Map<Season, Agg>>>();
    for (const l of lines) {
      if (l.kind !== "SALE" || !l.pcs) continue;
      const per = SALES_TO_REPORT[seasonOfDate(l.iso)], g = SALES_TO_REPORT[l.season];
      if (!per || !g || per === g) continue;
      const k = `${articleKey(l.article)}|${(l.colorId ?? "").toUpperCase()}`;
      const byPer = m.get(k) ?? m.set(k, new Map()).get(k)!, byG = byPer.get(per) ?? byPer.set(per, new Map()).get(per)!;
      const a = byG.get(g) ?? byG.set(g, { pcs: 0, rubIn: 0, rubEx: 0, disc: 0, grossC: 0, costS: 0 }).get(g)!;
      const cost = l.modelCode ? costOf.get(l.modelCode)?.unitIncl ?? 0 : 0;
      a.pcs += l.pcs; a.rubIn += l.retailRub; a.rubEx += l.retailRubExVat; a.disc += l.discountRub;
      if (cost > 0) { a.grossC += l.retailRub + l.discountRub; a.costS += l.pcs * cost; }
    }
    return m;
  }, [lines, costOf]);
  /** Приход и продажи товара по сезонам из файла «поступления и продажи» (как в «Обзоре»): артикул+цвет → сезон партии → получено / продано за сезон / продано всего. */
  type LAgg = Record<Season, { deliv: number; ssn: number; all: number }>;
  const lineIdx = useMemo(() => {
    const m = new Map<string, LAgg>();
    for (const l of lines) {
      const g = SALES_TO_REPORT[l.season];
      if (!g || !l.pcs || (l.kind !== "RECEIPT" && l.kind !== "SALE")) continue;
      const k = `${articleKey(l.article)}|${(l.colorId ?? "").toUpperCase()}`;
      const a = m.get(k) ?? m.set(k, Object.fromEntries(SEASONS.map((x) => [x, { deliv: 0, ssn: 0, all: 0 }])) as LAgg).get(k)!;
      if (l.kind === "RECEIPT") a[g].deliv += l.pcs;
      else { a[g].all += l.pcs; if (SALES_TO_REPORT[seasonOfDate(l.iso)] === g) a[g].ssn += l.pcs; }
    }
    return m;
  }, [lines]);
  /** Ключ строки отчёта в индексе продаж. Отчёт пишет «MSC-01 MINK BLACK/MINK BLACK» (артикул/мех), в продажах «MSC-01 MINK BLACK»: если полного ключа нет, пробуем часть до «/». */
  const oldKey = (r: ReportSizeRow) => {
    const c = (r.color ?? "").toUpperCase(), full = `${articleKey(r.acode)}|${c}`;
    if (lineIdx.has(full)) return full;
    // Отчёт пишет артикул иначе, чем файл продаж: «…/МЕХ» в конце, размер «200X30» внутри, «WILD SABLE» вместо «SABLE WILD».
    const a = r.acode, cut = a.lastIndexOf("/");
    const variants = [a.slice(0, a.indexOf("/") < 0 ? a.length : a.indexOf("/")), cut > 0 ? a.slice(0, cut) : a, a.replace(/\/?\d+X\d+\/?/gi, "/"), a.replace(/WILD SABLE/gi, "SABLE WILD")];
    for (const v of variants) { const k = `${articleKey(v)}|${c}`; if (lineIdx.has(k)) return k; }
    return full;
  };
  /** Веса разбивки по размерам: поступило по строкам отчёта (резерв — число строк). Нужны, чтобы на уровне размера делить цифры файла продаж, где размера нет. */
  const keyW = useMemo(() => {
    const m = new Map<string, { n: number; d: Record<Season, number> }>();
    for (const r of sizes) { const k = oldKey(r); const a = m.get(k) ?? m.set(k, { n: 0, d: { "FW26/27": 0, SS26: 0, "FW25/26": 0 } }).get(k)!; a.n++; for (const s of SEASONS) a.d[s] += Math.max(0, r.seas?.[s]?.deliv ?? 0); }
    return m;
  }, [sizes, lineIdx]); // eslint-disable-line react-hooks/exhaustive-deps
  const mOf = (rs: ReportSizeRow[]) => {
    const out = Object.fromEntries(SEASONS.map((s) => [s, zero()])) as Record<Season, M>;
    const artSet = Object.fromEntries(SEASONS.map((x) => [x, new Set<string>()])) as Record<Season, Set<string>>;
    type OldAgg = { n: number; rubIn: number; rubEx: number; disc: number };
    const oldBy = new Map<string, Record<Season, OldAgg>>();
    const cal = Object.fromEntries(SEASONS.map((x) => [x, { n: 0, rIn: 0, rEx: 0, d: 0, g: 0, c: 0 }])) as Record<Season, { n: number; rIn: number; rEx: number; d: number; g: number; c: number }>;
    const grp = new Map<string, { n: number; d: Record<Season, number>; rep: Record<Season, { deliv: number; ssn: number; all: number }> }>();
    for (const r of rs) {
      const k = oldKey(r);
      { const z = (): OldAgg => ({ n: 0, rubIn: 0, rubEx: 0, disc: 0 }); const acc = oldBy.get(k) ?? oldBy.set(k, { "FW26/27": z(), SS26: z(), "FW25/26": z() }).get(k)!; for (const s of SEASONS) { const c = r.seas?.[s]; if (!c) continue; acc[s].n += Math.max(0, c.soldOld ?? 0); acc[s].rubIn += c.rubOld ?? 0; acc[s].rubEx += c.rubExOld ?? 0; acc[s].disc += c.discOld ?? 0; } }
      const g = grp.get(k) ?? grp.set(k, { n: 0, d: { "FW26/27": 0, SS26: 0, "FW25/26": 0 }, rep: Object.fromEntries(SEASONS.map((x) => [x, { deliv: 0, ssn: 0, all: 0 }])) as Record<Season, { deliv: number; ssn: number; all: number }> }).get(k)!;
      g.n++;
      for (const s of SEASONS) {
        const c = r.seas?.[s]; if (!c) continue;
        const m = out[s], closed = s !== "FW26/27";
        m.conf += closed ? c.conf ?? c.deliv ?? 0 : c.conf ?? 0;
        m.confEur += closed ? c.confEur ?? c.delivEur ?? 0 : c.confEur ?? 0;
        m.delivEur += c.delivEur ?? 0;
        if ((closed ? c.conf ?? c.deliv ?? 0 : c.conf ?? 0) > 0 || (c.deliv ?? 0) > 0 || (c.soldSsn ?? 0) > 0) artSet[s].add(r.acode);
        const n = c.soldSsn ?? 0, rIn = c.rubSsn ?? 0, rEx = c.rubExSsn ?? 0, dS = c.discSsn ?? 0;
        g.d[s] += Math.max(0, c.deliv ?? 0); g.rep[s].deliv += c.deliv ?? 0; g.rep[s].ssn += n; g.rep[s].all += n;
        // За сезон: товар сезона, проданный в его календаре (SSN отчёта) — выручка, скидка, себестоимость; он же первая часть «всего».
        m.ssnR += n; m.rubS += ex ? rEx : rIn; m.rubSIn += rIn; m.rubSEx += rEx; m.eurSIn += c.eurSsn ?? 0; m.eurSEx += c.eurExSsn ?? 0; m.discS += dS;
        m.allR += n; m.rubA += ex ? rEx : rIn; m.rubAIn += rIn; m.discA += dS;
        // Маркап продаж по отчёту: (NS EUR + Discount EUR) ÷ SC EUR — полная розничная цена продажи с учётом скидки к себестоимости продаж в €.
        { const gE = (c.eurSsn ?? 0) + (c.discEurSsn ?? 0), scE = c.scSsn ?? 0; m.grossS += gE; m.costS += scE; m.grossA += gE; m.costA += scE; }
        // Олды: товар прошлых сезонов, проданный в календаре этого сезона (Old отчёта).
        const nO = Math.max(0, c.soldOld ?? 0), rInO = c.rubOld ?? 0;
        cal[s].n += nO; cal[s].rIn += rInO; cal[s].rEx += c.rubExOld ?? 0; cal[s].d += c.discOld ?? 0;
        cal[s].g += (c.eurOld ?? 0) + (c.discEurOld ?? 0); cal[s].c += c.scOld ?? 0;
      }
    }
    // Штуки (получено, продано за сезон, продано всего) — из файла поступлений и продаж, как в «Обзоре»; на уровне размера делим по поступлению строк отчёта. Нет артикула в файле — берём отчёт.
    for (const [k, g] of grp) {
      const L = lineIdx.get(k), W = keyW.get(k);
      for (const s of SEASONS) {
        if (!L || !W) { out[s].deliv += g.rep[s].deliv; out[s].ssn += g.rep[s].ssn; out[s].all += g.rep[s].all; continue; }
        const f = W.d[s] > 0 ? g.d[s] / W.d[s] : g.n / W.n;
        out[s].deliv += L[s].deliv * f; out[s].ssn += L[s].ssn * f; out[s].all += L[s].all * f;
      }
    }
    // Вторая часть «всего»: товар сезона, проданный позже как «не сезон». Штуки и деньги периода берём из отчёта (итог сходится с отчётом до рубля),
    // строки продаж только делят их по сезонам товара (по долям штук). Маркап считаем по строкам продаж.
    for (const [k, R] of oldBy) for (const per of SEASONS) {
      const need = R[per].n; if (need <= 0) continue;
      const O = crossIdx.get(k)?.get(per); if (!O) continue;
      const tot = [...O.values()].reduce((x, y) => x + y.pcs, 0); if (tot <= 0) continue;
      const f = tot <= need ? 1 : need / tot;
      for (const [g, a] of O) {
        const share = a.pcs / tot, o = out[g];
        o.allR += need * share;
        o.rubA += (ex ? R[per].rubEx : R[per].rubIn) * share; o.rubAIn += R[per].rubIn * share; o.discA += R[per].disc * share;
        o.grossA += a.grossC * f; o.costA += a.costS * f;
      }
    }
    // «За сезон» — товар сезона в его календаре (SSN отчёта); «Всего» — весь календарь сезона: SSN + олды (Old). Штуки и деньги — из отчёта, как у владельца:
    // FW25 94, SS26 13 + 41 = 54, FW26 60 + 51 = 111, вместе 259. Товар сезона, проданный за всё время (в свой сезон и позже), нужен для SO сейчас и остатка (allG).
    for (const s of SEASONS) {
      const o = out[s], c = cal[s];
      o.allG = o.allR; o.ssn = o.ssnR;
      o.all = o.ssnR + c.n; o.allR = o.all;
      o.rubA = o.rubS + (ex ? c.rEx : c.rIn); o.rubAIn = o.rubSIn + c.rIn; o.discA = o.discS + c.d;
      o.grossA = o.grossS + c.g; o.costA = o.costS + c.c;
    }
    for (const s of SEASONS) { out[s].arts = artSet[s].size; if (s !== "FW26/27") out[s].conf = out[s].deliv; out[s].stock = Math.max(0, out[s].deliv - out[s].allG); }
    return out;
  };
  const filtered = useMemo(() => rows.filter((r) => (furPick === "all" || keyOf(r, "fur") === furPick) && (!q || `${r.acode} ${keyOf(r, "fur")} ${keyOf(r, "cat1")} ${keyOf(r, "cat2")} ${r.color} ${r.size}`.toLowerCase().includes(q.toLowerCase()))), [rows, furPick, q, fabricByArt]); // eslint-disable-line react-hooks/exhaustive-deps
  const sortVal = (n: Node) => seasons.reduce((a, s) => a + (sort === "rub" ? n.m[s].rubA : sort === "all" ? n.m[s].all : sort === "conf" ? n.m[s].conf : sort === "so" ? soA(n.m[s]) ?? 0 : sort === "markup" ? mkA(n.m[s]) ?? 0 : n.m[s].ssn), 0);
  const tree = useMemo(() => {
    const build = (rs: ReportSizeRow[], depth: number, path: string): Node[] => {
      if (depth >= LEVELS.length) return [];
      const l = LEVELS[depth];
      const g = new Map<string, ReportSizeRow[]>();
      for (const r of rs) { const k = keyOf(r, l); (g.get(k) ?? g.set(k, []).get(k)!).push(r); }
      return [...g].map(([k, list]) => {
        const id = `${path}/${l}:${k}`, first = list[0];
        const node: Node = { id, level: l, label: k, sub: l === "article" ? `${keyOf(first, "fur")} · ${keyOf(first, "cat1")}` : undefined, modelCode: first.modelCode, variant: variantOfArticle(first.acode), rows: list, m: mOf(list), stock: list.reduce((a, r) => a + r.stock, 0), children: [] };
        node.children = build(list, depth + 1, id);
        return node;
      }).filter((n) => seasons.some((s) => n.m[s].conf || n.m[s].deliv || n.m[s].all) || n.stock).sort((a, b) => (colSort ? (colSort.dir === "desc" ? -1 : 1) * (colSort.s === "label" ? (l === "size" ? (Number(a.label) || 1e6) - (Number(b.label) || 1e6) : a.label.localeCompare(b.label, "ru", { numeric: true })) : colSort.s === "stock" ? a.stock - b.stock : numOf(a.m[colSort.s], colSort.key) - numOf(b.m[colSort.s], colSort.key)) || a.label.localeCompare(b.label) : l === "size" ? (Number(a.label) || 1e6) - (Number(b.label) || 1e6) : sortVal(b) - sortVal(a) || a.label.localeCompare(b.label)));
    };
    return build(filtered, 0, "");
  }, [filtered, sort, ex, seasonsKey, costOf, hier, colSort]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = useMemo(() => mOf(filtered), [filtered, ex, costOf]); // eslint-disable-line react-hooks/exhaustive-deps
  const totalAll = useMemo(() => mOf(rows), [rows, ex, costOf]); // eslint-disable-line react-hooks/exhaustive-deps
  const stockAll = filtered.reduce((a, r) => a + r.stock, 0);
  const articles = useMemo(() => { const out: Node[] = []; const walk = (ns: Node[]) => ns.forEach((n) => (n.level === "article" ? out.push(n) : walk(n.children))); walk(tree); return out.sort((a, b) => sortVal(b) - sortVal(a)); }, [tree]); // eslint-disable-line react-hooks/exhaustive-deps
  const picked = useMemo(() => {
    if (!pickNode) return null;
    const chain: Node[] = [];
    const find = (ns: Node[]): boolean => ns.some((n) => { chain.push(n); if (n.id === pickNode.id || (pickNode.id && find(n.children))) return true; chain.pop(); return false; });
    if (pickNode.id && !find(tree)) return null;
    const node = chain[chain.length - 1];
    const base: Node[] = [];
    const walk = (ns: Node[]) => ns.forEach((n) => (n.level === "article" ? base.push(n) : walk(n.children)));
    if (node) walk([node]); else walk(tree);
    const list = pickNode.s === "all" ? base : base.filter((n) => n.m[pickNode.s as Season].conf || n.m[pickNode.s as Season].deliv || n.m[pickNode.s as Season].all);
    const label = [pickNode.s === "all" ? "Вместе" : SEASON_LABEL[pickNode.s], ...chain.map((n) => n.label)].join(" › ");
    return { list: list.sort((x, y) => sortVal(y) - sortVal(x)), label };
  }, [pickNode, tree]); // eslint-disable-line react-hooks/exhaustive-deps
  const shownArticles = picked ? picked.list : articles;
  const selectNode = (s: Season | "all", id: string) => setPickNode((p) => (p && p.s === s && p.id === id ? null : { s, id }));

  const toggle = (s: Season) => setPick((p) => (p.includes(s) ? (p.length > 1 ? p.filter((x) => x !== s) : p) : [...p, s]));
  const expandTo = (lvl: number) => { const ids = new Set<string>(); const walk = (ns: Node[], d: number) => ns.forEach((n) => { if (d < lvl) { ids.add(n.id); walk(n.children, d + 1); } }); walk(tree, 0); setOpen(ids); };
  const flip = (id: string) => setOpen((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const nowRange = (n: Node) => { const v = n.rows.map(nowPrice).filter((x): x is number => x !== null); if (!v.length) return null; const lo = Math.min(...v), hi = Math.max(...v); return lo === hi ? money(lo) : `${moneyC(lo)}–${moneyC(hi)}`; };
  // Курс ₽ за € из файла продаж (NS RUR ÷ NS EUR): цену сейчас (₽) переводим в €, чтобы считать маркап к себестоимости в €.
  const eurRate = (() => { const sr = lines.filter((l) => l.kind === "SALE" && l.retailEur && l.retailRub); return sr.length ? sr.reduce((a, l) => a + l.retailRub, 0) / sr.reduce((a, l) => a + l.retailEur, 0) : 0; })();
  // Себестоимость изделия в €: приход € ÷ приход шт. (если приход был), иначе заказ € ÷ заказ шт. (по отчёту заказа и поставок).
  const costLine = (n: Node): number | null => {
    const t = SEASONS.reduce((a, s) => plus(a, n.m[s]), zero());
    return t.deliv > 0 && t.delivEur > 0 ? t.delivEur / t.deliv : t.conf > 0 && t.confEur > 0 ? t.confEur / t.conf : null;
  };
  const mu = (price: number | null, cost: number | null) => (price && cost && eurRate ? x2(price / eurRate / cost) : null);
  const eurU = (v: number) => `${Math.round(v).toLocaleString("ru-RU")} €`;

  if (!rows.length) return <p className="rounded-lg border border-neutral-300 bg-white p-3 text-sm text-neutral-800">Сезонных данных нет: загрузите отчёт «заказ и продажи» (Настройки → Загрузка данных → Прайс и размеры).</p>;

  if (catalog) {
    const items: CatalogItem[] = articles.map((n) => {
      const ph = n.modelCode ? photos[n.modelCode] : undefined;
      // Фото: сначала цвет этого артикула, потом остальные цвета модели.
      const own = ph ? ph.photos.filter((x) => x.variant.trim().toUpperCase() === (n.variant ?? "").trim().toUpperCase()) : [];
      const rest = ph ? ph.photos.filter((x) => !own.includes(x)) : [];
      const cost = costLine(n), now = nowRange(n), nowNum = n.rows.map(nowPrice).find((x) => x !== null) ?? null;
      const first = n.rows[0];
      const seasonsOf = seasons.filter((s) => n.m[s].conf || n.m[s].deliv || n.m[s].ssn || n.m[s].allG || n.m[s].stock);
      return {
        id: n.id, title: n.label, fur: keyOf(first, "fur"), category: keyOf(first, "cat2"), cls: (first?.cls ?? "other") as CatalogItem["cls"],
        modelId: ph?.modelId ?? null, photos: [...own, ...rest].map((x) => ({ id: x.id, variant: x.variant })),
        retailNow: now, markupNow: mu(nowNum, cost),
        facts: [["Цена сейчас", now ?? DASH], ["Себестоимость", cost ? eurU(cost) : DASH], ["MU", mu(nowNum, cost) ?? DASH], ["Остаток", `${n0(n.stock)} шт.`]],
        seasons: seasonsOf.map((s) => {
          const m = n.m[s], rub1 = (v: number | null) => (v == null ? DASH : Math.round(v).toLocaleString("ru-RU")), kr = (v: number | null) => (v == null || Math.abs(v) < 500 ? DASH : Math.round(v / 1000).toLocaleString("ru-RU")), live = s === "FW26/27";
          const common: [string, string][] = [["Заказано, шт.", n0(m.conf)], ["Получено, шт.", n0(m.deliv)], ...(live && m.conf - m.deliv > 0 ? [["В производстве, шт.", n0(m.conf - m.deliv)] as [string, string]] : [])];
          const pairs = [
            { k: "Продано, шт.", ssn: n0(m.ssn), ttl: n0(m.all) },
            { k: "SO, %", ssn: pct(soS(m)), ttl: pct(soA(m)) },
            { k: "Остаток, шт.", ssn: n0(m.stock), ttl: n0(m.stock) },
            { k: "NS 000'₽", ssn: kr(m.rubS), ttl: kr(m.rubA) },
            { k: "Retail Price, ₽", ssn: rub1(priceS(m)), ttl: rub1(priceA(m)) },
            { k: "MU продаж", ssn: x2(mkS(m)), ttl: x2(mkA(m)) },
          ];
          return { key: s, label: SEASON_LABEL[s], short: s === "FW26/27" ? "FW26" : s === "SS26" ? "SS26" : "FW25", conf: m.conf, deliv: m.deliv, sold: m.allG, stock: m.stock, rubK: m.rubA / 1000, showTtl: !live && pairs.some((p) => p.ssn !== p.ttl), common, pairs };
        }),
        total: (() => {
          if (seasonsOf.length < 2) return null;
          const t = seasonsOf.reduce((a, s) => plus(a, n.m[s]), zero()), rub1 = (v: number | null) => (v == null ? DASH : Math.round(v).toLocaleString("ru-RU")), kr = (v: number | null) => (v == null || Math.abs(v) < 500 ? DASH : Math.round(v / 1000).toLocaleString("ru-RU"));
          return { common: [["Заказано, шт.", n0(t.conf)], ["Получено, шт.", n0(t.deliv)], ...(t.conf - t.deliv > 0 && seasonsOf.includes("FW26/27") ? [["В производстве, шт.", n0(t.conf - t.deliv)] as [string, string]] : [])] as [string, string][], pairs: [{ k: "Продано, шт.", v: n0(t.all) }, { k: "SO, %", v: pct(soA(t)) }, { k: "Остаток, шт.", v: n0(t.stock) }, { k: "NS 000'₽", v: kr(t.rubA) }, { k: "Retail Price, ₽", v: rub1(priceA(t)) }, { k: "MU продаж", v: x2(mkA(t)) }] };
        })(),
        colors: n.children.map((c) => { const sm = (nd: Node) => { const t = seasonsOf.reduce((a, s) => plus(a, nd.m[s]), zero()); return { conf: t.conf, deliv: t.deliv, sold: t.allG, stock: t.stock }; }; return { label: c.label, ...sm(c), sizes: c.children.map((z) => ({ label: z.label, ...sm(z) })).filter((z) => z.conf || z.deliv || z.sold || z.stock) }; }).filter((c) => c.conf || c.deliv || c.sold || c.stock),
      };
    });
    // Строки отчёта «по артикулам»: по сезонам — заказ/приход (шт., €), продано (шт.), NS, цена и маркап проданного, остаток (шт.) и его цена/маркап по прайсу.
    const SES: Season[] = [...SEASONS];
    const reportLeaves: ReportLeaf[] = articles.map((n) => {
      const first = n.rows[0], cost = costLine(n), price = n.rows.map(nowPrice).find((x) => x !== null) ?? null;
      const by: ReportLeaf["by"] = {};
      for (const k of SES) {
        const m = n.m[k];
        // Продажи товара прошлых сезонов (олды) в календаре этого сезона (в FW25 их не было): шт. и маркап (NS EUR + Discount EUR) ÷ SC EUR; остаток всех сезонов до этого включительно.
        const old = k === "FW25/26" ? { n: 0, g: 0, c: 0 } : n.rows.reduce((o, r) => { const c = r.seas?.[k]; return { n: o.n + Math.max(0, c?.soldOld ?? 0), g: o.g + (c?.eurOld ?? 0) + (c?.discEurOld ?? 0), c: o.c + (c?.scOld ?? 0) }; }, { n: 0, g: 0, c: 0 });
        const totalStock = n.rows.reduce((t, r) => t + Math.max(0, r.stock ?? 0), 0);
        const tStock = k === "FW26/27" ? totalStock : k === "SS26" ? Math.max(0, totalStock - n.m["FW26/27"].stock) : 0;
        // Остаток: цена сейчас (₽) и MU = цена сейчас в € ÷ себестоимость в € (приход € ÷ шт., иначе заказ € ÷ шт.).
        const pE = price && eurRate ? price / eurRate : 0;
        by[k] = { oSold: old.n, oGross: old.g, oCost: old.c,
          tStock, tRetail: price ? price * tStock : 0, tPriced: price ? tStock : 0, tRetailBoth: pE && cost ? pE * tStock : 0, tCostBoth: pE && cost ? cost * tStock : 0,
          conf: m.conf, confEur: m.confEur, deliv: m.deliv, delivEur: m.delivEur, sold: m.ssn, nsRubIn: m.rubSIn, nsRubEx: m.rubSEx, nsEurIn: m.eurSIn, nsEurEx: m.eurSEx, gross: m.grossS, cost: m.costS, stock: m.stock,
          sRetail: price ? price * m.stock : 0, sPriced: price ? m.stock : 0, sRetailBoth: pE && cost ? pE * m.stock : 0, sCostBoth: pE && cost ? cost * m.stock : 0 };
      }
      return { cls: (first?.cls ?? "other") as ReportLeaf["cls"], cat1: first?.l2 || "(без категории)", fur: keyOf(first, "fur"), cat2: first?.l4 || first?.l5 || "(без категории)", model: n.modelCode ?? n.label, by };
    });
    return <CatalogCards items={items} seasonOptions={SEASONS.map((x) => ({ key: x, label: SEASON_LABEL[x] }))} picked={pick} onToggleSeason={(k) => toggle(k as Season)} furs={furs} furPick={furPick} onFur={setFurPick} q={q} onQ={setQ} vatEx={ex} onVat={onVat} report={{ leaves: reportLeaves, eurRate, ex }} supply={supply} />;
  }

  const thumb = (n: Node, big = false) => {
    const p = n.modelCode ? photos[n.modelCode] : undefined;
    const v = p ? p.photos.filter((x) => x.variant.trim().toUpperCase() === (n.variant ?? "").trim().toUpperCase()) : [];
    const list = v.length ? v : p?.photos.filter((x) => !x.variant.trim()) ?? [];
    const use = list.length ? list : p?.photos ?? [];
    return p && use.length ? <PhotoGalleryButton modelId={p.modelId} photos={use} title={n.label} compact thumbOnly big={big} /> : <span role="img" aria-label="Фото нет" className={(big ? "h-28 w-20" : "size-11") + " inline-flex shrink-0 items-center justify-center rounded border border-dashed border-neutral-300 text-center text-[11px] leading-tight text-neutral-600"}>нет фото</span>;
  };
  const rowCells = (m: Record<Season, M>, bold = false) => seasons.map((s) => <Fragment key={s}>{cols.map((c, i) => <td key={c.key} className={`px-2 py-2 text-right tabular-nums whitespace-nowrap ${SEASON_BG[s]} ${i === 0 ? "border-l border-neutral-300" : ""} ${c.strong || bold ? "font-semibold" : ""}`}>{cellNode(c, m[s], s)}</td>)}</Fragment>);

  const renderNode = (n: Node, depth: number): React.ReactNode => {
    const isOpen = open.has(n.id), can = n.children.length > 0;
    return (
      <Fragment key={n.id}>
        <tr className="border-t border-neutral-200 hover:bg-neutral-50">
          <td className="sticky left-0 z-[5] bg-white px-2 py-1.5" style={{ paddingLeft: 8 + depth * 14 }}>
            <div className="flex min-w-56 items-center gap-2">
              {can ? <button type="button" onClick={() => flip(n.id)} aria-expanded={isOpen} aria-label={`${isOpen ? "Свернуть" : "Развернуть"}: ${n.label}`} className="inline-flex size-11 shrink-0 items-center justify-center rounded-md border border-neutral-300 text-base hover:bg-neutral-100">{isOpen ? "−" : "+"}</button> : <span className="inline-block size-11 shrink-0" />}
              {n.level === "article" ? thumb(n) : null}
              <div className="min-w-0">
                <p className={"truncate " + (depth === 0 ? "font-semibold" : "font-medium")} title={n.label}>{n.label}</p>
                <p className="text-xs text-neutral-700">{n.sub ? `${n.sub} · ` : ""}{LEVEL_LABEL[n.level]}{n.level === "article" && nowRange(n) ? ` · цена сейчас ${nowRange(n)}` : ""}</p>
              </div>
            </div>
          </td>
          {rowCells(n.m)}
          <td className="border-l border-neutral-300 px-2 py-2 text-right tabular-nums">{n0(n.stock)}</td>
        </tr>
        {isOpen ? n.children.map((c) => renderNode(c, depth + 1)) : null}
      </Fragment>
    );
  };
  /** Разные артикулы по выбранным сезонам: в «Вместе» один артикул из двух сезонов считается один раз. */
  const artsDistinct = (rs: ReportSizeRow[]) => new Set(rs.filter((r) => (seasons.length === SEASONS.length && r.stock > 0) || seasons.some((s) => (r.seas?.[s]?.conf ?? 0) > 0 || (r.seas?.[s]?.deliv ?? 0) > 0 || (r.seas?.[s]?.soldAll ?? 0) > 0)).map((r) => r.acode)).size;
  const sumAll = { ...seasons.reduce((a, s) => plus(a, totalAll[s]), zero()), arts: artsDistinct(rows) };
  /** Строки сводки «Итого» по сезонам: сезон (или «Вместе») разворачивается по выбранному порядку (мех/кат.1/кат.2), три уровня. */
  const flipSum = (id: string) => setSumOpen((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const mFor = (n: Node, s: Season | "all"): M => (s === "all" ? { ...seasons.reduce((a, x) => plus(a, n.m[x]), zero()), arts: artsDistinct(n.rows) } : n.m[s]);
  const sumCells = (m: M, s: Season | "all", fw: M, bold = false) => cols.map((c) => <td key={c.key} className={"px-2 py-1.5 text-right tabular-nums whitespace-nowrap " + (c.strong || bold ? "font-semibold" : "")}>{c.key === "wait" ? (s === "FW26/27" || (s === "all" && seasons.includes("FW26/27")) ? n0(Math.max(0, fw.conf - fw.deliv)) : DASH) : cellNode(c, m, s === "all" ? "FW25/26" : s)}</td>);
  const sumNodes = (s: Season | "all", ns: Node[], depth: number): React.ReactNode =>
    ns.map((n) => {
      const m = mFor(n, s);
      if (!(m.conf || m.deliv || m.all)) return null;
      const id = `${s}|${n.id}`, can = depth < 2 && n.children.length > 0, isOpen = sumOpen.has(id);
      return (
        <Fragment key={id}>
          <tr className="border-t border-neutral-200 bg-white">
            <td className="px-2 py-1.5" style={{ paddingLeft: 8 + (depth + 1) * 16 }}>
              <div className="flex items-center gap-2">
                {can ? <button type="button" onClick={() => flipSum(id)} aria-expanded={isOpen} aria-label={`${isOpen ? "Свернуть" : "Развернуть"}: ${n.label}`} className="inline-flex size-11 shrink-0 items-center justify-center rounded-md border border-neutral-300 text-neutral-700">{isOpen ? "−" : "+"}</button> : <span className="inline-block size-11 shrink-0" />}
                <button type="button" onClick={() => selectNode(s, n.id)} aria-pressed={pickNode?.s === s && pickNode.id === n.id} title="Показать карточки этого узла" className={"min-h-11 rounded-md px-2 text-left hover:bg-neutral-100 " + (pickNode?.s === s && pickNode.id === n.id ? "bg-neutral-200 font-semibold" : "")}><span className="text-[11px] text-neutral-600">{LEVEL_LABEL[n.level]} · </span>{n.label}</button>
              </div>
            </td>
            {sumCells(m, s, n.m["FW26/27"], false)}
          </tr>
          {can && isOpen ? sumNodes(s, n.children, depth + 1) : null}
        </Fragment>
      );
    });
  const sumRow = (s: Season | "all", m: M, fw: M, bg: string, bold: boolean, per?: Record<Season, M>) => {
    const id = `${s}|`, isOpen = sumOpen.has(id);
    return (
      <Fragment key={id}>
        <tr className={`border-t ${bold ? "border-t-2 border-neutral-400 font-semibold" : "border-neutral-200"} ${bg}`}>
          <td className="px-2 py-1.5 font-medium">
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => flipSum(id)} aria-expanded={isOpen} aria-label={`${isOpen ? "Свернуть" : "Развернуть"}: ${s === "all" ? "Вместе" : SEASON_LABEL[s]}`} className="inline-flex size-11 shrink-0 items-center justify-center rounded-md border border-neutral-300 bg-white text-neutral-700">{isOpen ? "−" : "+"}</button>
              <button type="button" onClick={() => selectNode(s, "")} aria-pressed={pickNode?.s === s && pickNode.id === ""} title="Показать карточки этого сезона" className={"min-h-11 rounded-md px-2 text-left hover:bg-white/70 " + (pickNode?.s === s && pickNode.id === "" ? "bg-white font-semibold ring-1 ring-neutral-400" : "")}>{s === "all" ? "Вместе" : SEASON_LABEL[s]}</button>
            </div>
          </td>
          {sumCells(m, s, fw, bold)}
        </tr>
        {isOpen ? sumNodes(s, tree, 0) : null}
      </Fragment>
    );
  };
  /** Строки итогов: общая часть + показатели выбранной базы (за сезон / всего); «Заказано, €» — только в «Все показатели». */
  const byKey = Object.fromEntries(COLS.map((c) => [c.key, c])) as Record<string, Col>;
  const BASIS_LABEL: Record<string, string> = { ssn: "Продано, шт.", all: "Продано, шт.", soS: "SO, %", soA: "SO, %", rubS: "Выручка, ₽", rubA: "Выручка, ₽", priceS: "Цена, ₽/шт.", priceA: "Цена, ₽/шт.", mkS: "Маркап", mkA: "Маркап" };
  const bk = (a: string, b: string) => byKey[basis === "season" ? a : b];
  const eurCol: Col = { key: "confEur", label: "Заказано, €", short: "", hint: "Conf EUR отчёта — закупочная стоимость заказа; по SS 2026 и FW 25/26 — поступило в €.", get: (m: M) => eur(m.confEur) };
  const SUMMARY: Col[] = [byKey.arts, byKey.conf, ...(detail ? [eurCol] : []), byKey.deliv, byKey.wait, bk("ssn", "all"), bk("soS", "soA"), byKey.left, bk("rubS", "rubA"), byKey.after, byKey.rubAfter, bk("priceS", "priceA"), bk("mkS", "mkA")]
    .map((c) => (BASIS_LABEL[c.key] ? { ...c, label: BASIS_LABEL[c.key] } : c));

  return (
    <section aria-label="Сезоны: заказ и продажи" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold">Заказ, поступление и продажи по сезонам</h2>
        <InfoHint label="Откуда цифры" wide>
          <p>Отчёт «заказ и продажи» на {reportDate ?? "дату загрузки"}. По каждому сезону: заказано и поступило; продажи за период сезона (FW — август–январь, SS — февраль–июль): своего сезона и прошлых. {CAT_LABEL[cat]}; выручка {ex ? "без НДС" : "с НДС"}.</p>
          <p className="mt-1">Цена продажи = (выручка + скидка) ÷ продано, с НДС. Маркап = цена продажи ÷ себестоимость изделия по ТЗ (с НДС). «Цена сейчас» — текущий прайс розницы.</p>
        </InfoHint>
      </div>

      <div role="group" aria-label="Сезоны для сравнения" className={segGroup + " self-start"}>
        {SEASONS.map((s) => <button key={s} type="button" aria-pressed={pick.includes(s)} onClick={() => toggle(s)} className={seg(pick.includes(s))}>{SEASON_LABEL[s]}</button>)}
        <button type="button" aria-pressed={pick.length === SEASONS.length} onClick={() => setPick([...SEASONS])} className={seg(pick.length === SEASONS.length)}>Сравнить все</button>
      </div>
      <div role="group" aria-label="База показателей: продано, SO, выручка, цена, маркап" className={segGroup + " self-start"}>
        <button type="button" aria-pressed={basis === "season"} onClick={() => setBasis("season")} title="Товар этого сезона, проданный в календаре этого же сезона" className={seg(basis === "season")}>За сезон</button>
        <button type="button" aria-pressed={basis === "all"} onClick={() => setBasis("all")} title="Товар этого сезона, проданный за всё время (в свой сезон и позже)" className={seg(basis === "all")}>Всего</button>
      </div>

      {/* Итоги по сезонам */}
      <div className="overflow-x-auto rounded-lg border border-neutral-300 bg-white">
        <table className="w-full min-w-[520px] text-sm">
          <thead className="bg-neutral-50"><tr><th className="px-3 py-2 text-left text-xs font-semibold">Итоги · {CAT_LABEL[cat]}</th>{seasons.map((s) => <th key={s} className={`px-3 py-2 text-right text-xs font-semibold ${SEASON_BG[s]}`}>{SEASON_LABEL[s]}</th>)}{seasons.length > 1 ? <th className="px-3 py-2 text-right text-xs font-semibold">Вместе</th> : null}</tr></thead>
          <tbody>
            {SUMMARY.map((c) => (
              <tr key={c.key} className="border-t border-neutral-200">
                <td className={"px-3 py-2 " + (c.strong ? "font-semibold" : "")}>{c.label}<span className="ml-1 inline-flex align-middle [&_.info-i]:!h-5 [&_.info-i]:!min-h-0 [&_.info-i]:!w-5 [&_.info-i]:!min-w-0"><InfoHint label={c.label}><p>{c.hint}</p></InfoHint></span></td>
                {seasons.map((s) => <td key={s} data-season={s} data-metric={c.key} className={`px-3 py-2 text-right tabular-nums ${SEASON_BG[s]} ${c.strong ? "font-semibold" : ""}`}>{c.key === "rubS" || c.key === "rubA" ? money(totalAll[s][c.key]) : c.get(totalAll[s], s)}</td>)}
                {seasons.length > 1 ? <td className="px-3 py-2 text-right tabular-nums text-neutral-800">{c.key === "wait" ? (seasons.includes("FW26/27") ? n0(Math.max(0, totalAll["FW26/27"].conf - totalAll["FW26/27"].deliv)) : DASH) : c.key === "rubS" || c.key === "rubA" ? money(sumAll[c.key]) : c.get(sumAll, "FW25/26")}</td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      

      {/* Панель: вид, мех, поиск, сортировка */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg bg-white/95 py-1 backdrop-blur xl:sticky xl:top-0 xl:z-[15]">
        {controls}
        <div role="group" aria-label="Вид" className={segGroup}>
          <button type="button" aria-pressed={view === "tree"} onClick={() => setView("tree")} className={seg(view === "tree")}>Мех → артикул → размер</button>
          <button type="button" aria-pressed={view === "cards"} onClick={() => setView("cards")} className={seg(view === "cards")}>Карточки с фото</button>
          <button type="button" aria-pressed={view === "receipts"} onClick={() => setView("receipts")} className={seg(view === "receipts")}>Приход по месяцам</button>
        </div>
        {view !== "receipts" ? (
          <div role="group" aria-label="Порядок разворота" className={segGroup}>
            <button type="button" aria-pressed={hier === "fur"} onClick={() => setHier("fur")} className={seg(hier === "fur")}>Мех → кат. 1 → кат. 2</button>
            <button type="button" aria-pressed={hier === "cat"} onClick={() => setHier("cat")} className={seg(hier === "cat")}>Кат. 1 → мех → кат. 2</button>
          </div>
        ) : null}
        <label className="flex items-center gap-1 text-xs text-neutral-700">Мех
          <select value={furPick} onChange={(e) => setFurPick(e.target.value)} className="min-h-11 rounded-md border border-neutral-300 bg-white px-2 text-sm" aria-label="Мех">
            <option value="all">все</option>{furs.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1 text-xs text-neutral-700">Сортировка
          <select value={sort} onChange={(e) => setSort(e.target.value)} className="min-h-11 rounded-md border border-neutral-300 bg-white px-2 text-sm" aria-label="Сортировка">
            <option value="rub">по выручке</option><option value="all">по продажам</option><option value="ssn">по продажам сезонного</option><option value="so">по SO</option><option value="markup">по маркапу</option><option value="conf">по заказу</option>
          </select>
        </label>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Артикул, мех, категория, цвет" aria-label="Поиск" className="min-h-11 w-full min-w-0 rounded-md border border-neutral-300 px-3 text-sm sm:w-72" />
        {seasons.length > 1 && view !== "receipts" ? <button type="button" aria-pressed={detail} onClick={() => setDetail((v) => !v)} className={seg(detail)}>{detail ? "Кратко" : "Все показатели"}</button> : null}
      </div>

      {view === "receipts" ? (
        <SeasonReceipts sizes={rows} lines={cat === "all" ? lines : lines.filter((l) => l.cls === cat)} tzAwait={cat === "all" ? tzAwait : tzAwait.filter((t) => t.cls === cat)} />
      ) : view === "tree" ? (
        <>
          <div className="flex flex-wrap items-center gap-1 text-sm">
            <span className="text-xs text-neutral-700">Развернуть до:</span>
            {LEVELS.slice(1).map((l, i) => <button key={l} type="button" onClick={() => expandTo(i + 1)} className={btn}>{LEVEL_LABEL[l]}</button>)}
            <button type="button" onClick={() => setOpen(new Set())} className={btn}>Свернуть</button>
          </div>
          <div className="max-h-[75vh] overflow-auto overscroll-contain rounded-lg border border-neutral-300 bg-white">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-neutral-50">
                <tr>
                  <th rowSpan={2} className="sticky left-0 z-20 bg-neutral-50 px-2 py-2 text-left text-xs font-semibold"><button type="button" onClick={() => clickSort("label", "label")} aria-label="Сортировать по названию" className="inline-flex min-h-11 items-center gap-0.5 text-left hover:underline">Позиция<span aria-hidden className="inline-block w-3 text-[11px] text-[color:var(--ui-accent)]">{colSort?.s === "label" ? (colSort.dir === "asc" ? "▲" : "▼") : ""}</span></button></th>
                  {seasons.map((s) => <th key={s} colSpan={cols.length} className={`border-l border-neutral-300 px-2 py-1 text-center text-xs font-semibold ${SEASON_BG[s]}`}>{SEASON_LABEL[s]}</th>)}
                  <th rowSpan={2} className="border-l border-neutral-300 px-2 py-1 text-right text-[11px] font-semibold"><button type="button" onClick={() => clickSort("stock", "stock")} aria-label="Сортировать по остатку сейчас" title="Остаток по отчёту «заказ и продажи» на дату загрузки. В «Итогах» остаток считается как получено − продано по файлу поступлений: разница в несколько штук — возвраты и корректировки." className="inline-flex min-h-11 items-center gap-0.5 hover:underline">Остаток сейчас, шт.<span aria-hidden className="inline-block w-2.5 text-[10px] text-[color:var(--ui-accent)]">{colSort?.s === "stock" ? (colSort.dir === "asc" ? "▲" : "▼") : ""}</span></button></th>
                </tr>
                <tr>{seasons.map((s) => <Fragment key={s}>{cols.map((c, i) => <th key={c.key} title={c.hint} className={`px-2 py-1 text-right text-[11px] font-semibold whitespace-nowrap ${SEASON_BG[s]} ${i === 0 ? "border-l border-neutral-300" : ""}`}><button type="button" onClick={() => clickSort(s, c.key)} aria-label={`Сортировать ${SEASON_LABEL[s]}: ${c.label}`} className="inline-flex min-h-11 items-center gap-0.5 whitespace-nowrap hover:underline">{c.short}<span aria-hidden className="inline-block w-2.5 text-[10px] text-[color:var(--ui-accent)]">{colSort && colSort.s === s && colSort.key === c.key ? (colSort.dir === "asc" ? "▲" : "▼") : ""}</span></button></th>)}</Fragment>)}</tr>
              </thead>
              <tbody>{tree.map((n) => renderNode(n, 0))}</tbody>
              <tfoot className="sticky bottom-0 bg-neutral-100">
                <tr className="border-t-2 border-neutral-400 font-semibold"><td className="sticky left-0 bg-neutral-100 px-2 py-2">Всего{q || furPick !== "all" ? " (по фильтру)" : ""}</td>{rowCells(total, true)}<td className="border-l border-neutral-300 px-2 py-2 text-right tabular-nums">{n0(stockAll)}</td></tr>
              </tfoot>
            </table>
          </div>
        </>
      ) : (
        <>
          {/* Итоги по показанным карточкам */}
          <div className="overflow-x-auto rounded-lg border border-neutral-400 bg-neutral-50">
            <table className="w-full min-w-[600px] text-sm">
              <thead><tr className="text-xs text-neutral-700"><th className="px-2 py-1.5 text-left font-semibold">Итого · {articles.length} артикулов</th>{cols.map((c) => <th key={c.key} title={c.hint} className="px-2 py-1.5 text-right font-semibold whitespace-nowrap">{c.short}</th>)}</tr></thead>
              <tbody>
                {seasons.map((s) => sumRow(s, total[s], total[s], SEASON_BG[s], false))}
                {seasons.length > 1 ? (() => { const sum = { ...seasons.reduce((a, s) => plus(a, total[s]), zero()), arts: artsDistinct(filtered) }; return sumRow("all", sum, total["FW26/27"], "", true, total); })() : null}
              </tbody>
            </table>
          </div>
          {picked ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-xs text-neutral-700">Карточки: <b>{picked.label}</b> · {shownArticles.length} арт.</span>
              <button type="button" onClick={() => setPickNode(null)} className={btn}>Показать все</button>
            </div>
          ) : null}
          {(["clothes", "acc", "other"] as const).map((cl) => {
            const list = shownArticles.filter((n) => (n.rows[0]?.cls ?? "other") === cl);
            if (!list.length) return null;
            return (
          <Fragment key={cl}>
          <h3 className="mt-1 text-sm font-semibold">{CAT_LABEL[cl]} · {list.length} арт.</h3>
          <ul className="grid grid-cols-1 gap-3 2xl:grid-cols-2">
            {list.map((n) => {
              const cost = costLine(n), now = nowRange(n), sum = seasons.reduce((a, s) => plus(a, n.m[s]), zero());
              const nowNum = n.rows.map(nowPrice).find((x) => x !== null) ?? null;
              return (
                <li key={n.id} className="flex flex-col gap-3 rounded-xl border border-neutral-300 bg-white p-3 xl:flex-row">
                  <div className="flex items-start gap-3 xl:w-72 xl:shrink-0">
                    {thumb(n, true)}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold leading-snug" title={n.label}>{n.label}</p>
                      <p className="text-xs text-neutral-700">{n.sub}</p>
                      <dl className="mt-1.5 grid max-w-sm grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-xs">
                        <dt className="text-neutral-700">Цена сейчас</dt><dd className="text-right font-semibold tabular-nums">{now ?? DASH}</dd>
                        <dt className="text-neutral-700">Себестоимость</dt><dd className="text-right tabular-nums">{cost ? eurU(cost) : DASH}</dd>
                        <dt className="text-neutral-700">MU</dt><dd className="text-right tabular-nums">{mu(nowNum, cost) ?? DASH}</dd>
                        <dt className="text-neutral-700">Остаток</dt><dd className="text-right tabular-nums">{n0(n.stock)} шт.</dd>
                      </dl>
                    </div>
                  </div>
                  <div className="min-w-0 flex-1 overflow-x-auto">
                    <table className={"w-full text-sm " + (detail ? "min-w-[900px]" : "min-w-[780px]")}>
                      <thead><tr className="text-neutral-700"><th className="py-1 text-left font-normal">Сезон</th>{cols.filter((c) => c.key !== "arts").map((c) => <th key={c.key} title={c.hint} className="px-1 text-right font-normal whitespace-nowrap">{c.short}</th>)}</tr></thead>
                      <tbody>
                        {seasons.filter((s) => n.m[s].conf || n.m[s].deliv || n.m[s].all || n.m[s].allG || n.m[s].stock).map((s) => <tr key={s} className={`border-t border-neutral-200 tabular-nums ${SEASON_BG[s]}`}><td className="whitespace-nowrap py-1.5 pl-1 pr-2">{SEASON_LABEL[s]}</td>{cols.filter((c) => c.key !== "arts").map((c) => <td key={c.key} className={"px-1 text-right whitespace-nowrap " + (c.strong ? "font-semibold" : "")}>{c.get(n.m[s], s)}</td>)}</tr>)}
                        {seasons.length > 1 ? <tr className="border-t-2 border-neutral-400 font-semibold tabular-nums"><td className="py-1.5 pl-1">Итого</td>{cols.filter((c) => c.key !== "arts").map((c) => <td key={c.key} className="px-1 text-right whitespace-nowrap">{c.key === "wait" ? (seasons.includes("FW26/27") ? n0(Math.max(0, n.m["FW26/27"].conf - n.m["FW26/27"].deliv)) : DASH) : c.get(sum, "FW25/26")}</td>)}</tr> : null}
                      </tbody>
                    </table>
                  </div>
                </li>
              );
            })}
          </ul>
          </Fragment>
            );
          })}
        </>
      )}
    </section>
  );
}
