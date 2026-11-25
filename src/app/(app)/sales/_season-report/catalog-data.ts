// Данные каталога «как в магазине» и отчёта «по артикулам» из дерева сезонов (вынесено из renderCatalog в SeasonReport без изменений).
import type { CatalogItem } from "../catalog-cards";
import type { ReportLeaf } from "../catalog-report";
import type { ReportSizeRow } from "@/lib/margin-tree";
import { MU_EUR_RATE } from "@/lib/mu-rate";
import { furRuLabel } from "@/lib/sales-receipts-core";
import { leafStockEur } from "@/lib/stock-money";
import { DASH, money, moneyC, n0, pct, x2 } from "../sales-fmt";
import type { PhotoIdx } from "../sales-tree";
import { apportion, FUR_REPORT, mkG, mkS, plus, priceG, priceS, SEASON_LABEL, SEASONS, soA, soS, zero, type Level, type M, type Node, type Season } from "./metrics";

export function catalogItems({ articles, photos, seasons, costLine, nowRange, nowPrice, keyOf, mu, eurU }: {
  articles: Node[];
  photos: PhotoIdx;
  seasons: Season[];
  costLine: (n: Node) => number | null;
  nowRange: (n: Node) => string | null;
  nowPrice: (r: ReportSizeRow) => number | null;
  keyOf: (r: ReportSizeRow, l: Level) => string;
  mu: (price: number | null, cost: number | null) => string | null;
  eurU: (v: number) => string;
}): CatalogItem[] {
  const items: CatalogItem[] = articles.map((n) => {
    const ph = n.modelCode ? photos[n.modelCode] : undefined;
    // Фото: сначала цвет этого артикула, потом остальные цвета модели.
    const own = ph ? ph.photos.filter((x) => x.variant.trim().toUpperCase() === (n.variant ?? "").trim().toUpperCase()) : [];
    const rest = ph ? ph.photos.filter((x) => !own.includes(x)) : [];
    // MU current — от максимальной текущей цены прайса: цена ÷ 110 ÷ себестоимость в € (правило владельца).
    const cost = costLine(n), now = nowRange(n), nowNum = (() => { const v = n.rows.map(nowPrice).filter((x): x is number => x !== null); return v.length ? Math.max(...v) : null; })();
    const first = n.rows[0];
    const seasonsOf = seasons.filter((s) => n.m[s].conf || n.m[s].deliv || n.m[s].ssn || n.m[s].allG || n.m[s].stock);
    // Продано товара сезона = в свой сезон + позже (в календаре SS26 и в календаре FW26); целые штуки, сумма сходится с «Продано товара сезона».
    const partsOf = (m: M) => { const total = Math.round(m.allG), own = Math.min(Math.round(m.ssn), total), [a, b] = apportion(total - own, [m.lSS26, m.lFW26]); return { own, a, b }; };
    const parts = Object.fromEntries(seasonsOf.map((x) => [x, partsOf(n.m[x])])) as Record<Season, { own: number; a: number; b: number }>;
    // Цена остатка сейчас, ₽/шт.: средневзвешенная текущая цена по остатку размеров (цена прайса × остаток размера ÷ остаток).
    const stockPrice = (() => { const v: number[] = []; for (const r of n.rows) { const pr = nowPrice(r); if (pr !== null && (r.stock ?? 0) > 0) v.push(pr); } if (!v.length) return null; const lo = Math.min(...v), hi = Math.max(...v); return lo === hi ? money(lo) : `${moneyC(lo)}–${moneyC(hi)}`; })();
    return {
      id: n.id, title: n.label, fur: keyOf(first, "fur"), category: keyOf(first, "cat2"), cls: (first?.cls ?? "other") as CatalogItem["cls"],
      modelId: ph?.modelId ?? null, photos: [...own, ...rest].map((x) => ({ id: x.id, variant: x.variant })),
      retailNow: now, markupNow: mu(nowNum, cost),
      facts: [["Цена сейчас", now ?? DASH], ["Себестоимость", cost ? eurU(cost) : DASH], ["MU current", mu(nowNum, cost) ?? DASH]] ,
      seasons: seasonsOf.map((s) => {
        const m = n.m[s], rub1 = (v: number | null) => (v == null ? DASH : Math.round(v).toLocaleString("ru-RU")), kr = (v: number | null) => (v == null || Math.abs(v) < 0.5 ? DASH : Math.round(v).toLocaleString("ru-RU")), live = s === "FW26/27";
        const common: [string, string][] = [["Заказано, шт.", n0(m.conf)], ["Получено, шт.", n0(m.deliv)], ...(live && m.conf - m.deliv > 0 ? [["В производстве, шт.", n0(m.conf - m.deliv)] as [string, string]] : [])];
        // Одна база для всех строк: товар сезона. «Продано товара сезона» (за всё время) · SO STD · остаток сезона = получено − продано;
        // ниже — то, что продано в его собственном календаре (SSN): шт., NS, цена, MU. Итого = сумма сезонов, без смешения календаря и товара.
        // Те же мини-группы, что в «Заказ, поступление и продажи по сезонам»: в свой сезон → товар сезона за всё время → остаток.
        const G1 = "Сезонный товар в свой сезон", G2 = "Товар сезона за всё время", G3 = "Остаток";
        const row = (k: string, label: string, g: string, v: string) => ({ k, label, group: g, ssn: v, ttl: v });
        const pairs = [
          row("own", "Продано, шт.", G1, n0(parts[s].own)),
          row("soas", "SO AS, %", G1, pct(soS(m))),
          row("nsOwn", "NS ₽", G1, kr(m.rubS)),
          row("priceOwn", "Цена до скидки, ₽/шт.", G1, rub1(priceS(m))),
          row("muOwn", "MU", G1, x2(mkS(m))),
          row("all", "Продано, шт.", G2, n0(m.allG)),
          // Где продано всё количество: по календарным сезонам продажи (в свой сезон и позже); сумма трёх строк = «Продано».
          row("later_fw25", "В сезоне FW25, шт.", G2, s === "FW25/26" ? n0(parts[s].own) : DASH),
          row("later_ss26", "В сезоне SS26, шт.", G2, s === "FW25/26" ? n0(parts[s].a) : s === "SS26" ? n0(parts[s].own) : DASH),
          row("later_fw26", "В сезоне FW26, шт.", G2, s === "FW26/27" ? n0(parts[s].own) : n0(parts[s].b)),
          row("sostd", "SO STD, %", G2, pct(soA(m))),
          row("nsAll", "NS ₽", G2, kr(m.rubG)),
          row("priceAll", "Цена до скидки, ₽/шт.", G2, rub1(priceG(m))),
          row("muAll", "MU", G2, x2(mkG(m))),
          row("stock", "Остаток сезона, шт.", G3, n0(Math.max(0, m.stock))),
          row("stockPrice", "Цена остатка, ₽/шт.", G3, m.stock > 0.5 ? (stockPrice ?? DASH) : DASH),
        ];
        return { key: s, label: SEASON_LABEL[s], short: s === "FW26/27" ? "FW26" : s === "SS26" ? "SS26" : "FW25", conf: m.conf, deliv: m.deliv, sold: m.allG, stock: Math.max(0, m.stock), rubK: m.rubA / 1000, showTtl: !live && pairs.some((p) => p.ssn !== p.ttl), common, pairs };
      }),
      total: (() => {
        if (seasonsOf.length < 2) return null;
        const t = seasonsOf.reduce((a, s) => plus(a, n.m[s]), zero()), rub1 = (v: number | null) => (v == null ? DASH : Math.round(v).toLocaleString("ru-RU")), kr = (v: number | null) => (v == null || Math.abs(v) < 0.5 ? DASH : Math.round(v).toLocaleString("ru-RU"));
        return { common: [["Заказано, шт.", n0(t.conf)], ["Получено, шт.", n0(t.deliv)], ...(t.conf - t.deliv > 0 && seasonsOf.includes("FW26/27") ? [["В производстве, шт.", n0(t.conf - t.deliv)] as [string, string]] : [])] as [string, string][], pairs: [{ k: "own", v: n0(seasonsOf.reduce((x, y) => x + parts[y].own, 0)) }, { k: "soas", v: pct(soS(t)) }, { k: "nsOwn", v: kr(t.rubS) }, { k: "priceOwn", v: rub1(priceS(t)) }, { k: "muOwn", v: x2(mkS(t)) }, { k: "all", v: n0(t.allG) }, { k: "later_fw25", v: n0(seasonsOf.reduce((x, y) => x + (y === "FW25/26" ? parts[y].own : 0), 0)) }, { k: "later_ss26", v: n0(seasonsOf.reduce((x, y) => x + (y === "FW25/26" ? parts[y].a : y === "SS26" ? parts[y].own : 0), 0)) }, { k: "later_fw26", v: n0(seasonsOf.reduce((x, y) => x + (y === "FW26/27" ? parts[y].own : parts[y].b), 0)) }, { k: "sostd", v: pct(soA(t)) }, { k: "nsAll", v: kr(t.rubG) }, { k: "priceAll", v: rub1(priceG(t)) }, { k: "muAll", v: x2(mkG(t)) }, { k: "stock", v: n0(Math.max(0, t.stock)) }, { k: "stockPrice", v: t.stock > 0.5 ? (stockPrice ?? DASH) : DASH }] };
      })(),
      // Цвета и размеры: штуки целые, сумма по размерам = итог цвета (раньше размеры были дробными долями файла продаж и после округления давали 4 вместо 3).
      colors: n.children.map((c) => {
        const sm = (nd: Node) => { const t = seasonsOf.reduce((a, s) => plus(a, nd.m[s]), zero()); return { conf: t.conf, deliv: t.deliv, sold: t.allG, stock: t.stock }; };
        const cs = sm(c), deliv = Math.round(cs.deliv), sold = Math.round(cs.sold);
        const zs = c.children.map((z) => ({ z, v: sm(z) }));
        const repDelivW = zs.map(({ z }) => Math.max(0, z.rows.reduce((t, r) => t + seasonsOf.reduce((u, s) => u + (r.seas?.[s]?.deliv ?? 0), 0), 0)));
        const confI = zs.map(({ z }) => z.rows.reduce((t, r) => t + seasonsOf.reduce((u, s) => { const x = r.seas?.[s]; return x ? u + (s !== "FW26/27" ? x.conf ?? x.deliv ?? 0 : x.conf ?? 0) : u; }, 0), 0));
        const delivI = apportion(deliv, repDelivW);
        const soldW = zs.map((x) => x.v.sold), soldCap = apportion(sold, soldW, delivI), soldI = soldCap.reduce((a, x) => a + x, 0) < sold ? apportion(sold, soldW) : soldCap; // продано сверх прихода (остаток < 0) не теряем
        const sizes = zs.map((x, i) => ({ label: x.z.label, conf: confI[i], deliv: delivI[i], sold: soldI[i], stock: Math.max(0, delivI[i] - soldI[i]) })).filter((z) => z.conf || z.deliv || z.sold || z.stock);
        return { label: c.label, conf: Math.round(cs.conf), deliv, sold, stock: Math.max(0, deliv - sold), sizes };
      }).filter((c) => c.conf || c.deliv || c.sold || c.stock),
    };
  });
  return items;
}

export function reportLeavesOf({ articles, costLine, nowPrice, eurRate, keyOf }: {
  articles: Node[];
  costLine: (n: Node) => number | null;
  nowPrice: (r: ReportSizeRow) => number | null;
  eurRate: number;
  keyOf: (r: ReportSizeRow, l: Level) => string;
}): ReportLeaf[] {
  // Строки отчёта «по артикулам»: по сезонам — заказ/приход (шт., €), продано (шт.), NS, цена и маркап проданного, остаток (шт.) и его цена/маркап по прайсу.
  const SES: Season[] = [...SEASONS];
  const reportLeaves: ReportLeaf[] = articles.map((n) => {
    const first = n.rows[0], cost = costLine(n), price = n.rows.map(nowPrice).find((x) => x !== null) ?? null;
    const by: ReportLeaf["by"] = {};
    for (const k of SES) {
      const m = n.m[k];
      // Продажи товара прошлых сезонов (олды) в календаре этого сезона (в FW25 их не было): шт. и маркап (NS EUR + Discount EUR) ÷ SC EUR; остаток всех сезонов до этого включительно.
      const old = k === "FW25/26" ? { n: 0, g: 0, c: 0, ri: 0, re: 0, ei: 0, ee: 0 } : n.rows.reduce((o, r) => { const c = r.seas?.[k]; return { n: o.n + Math.max(0, c?.soldOld ?? 0), g: o.g + ((c?.rubOld ?? 0) + (c?.discOld ?? 0)) / MU_EUR_RATE, c: o.c + (c?.scOld ?? 0), ri: o.ri + (c?.rubOld ?? 0), re: o.re + (c?.rubExOld ?? 0), ei: o.ei + (c?.eurOld ?? 0), ee: o.ee + (c?.eurExOld ?? 0) }; }, { n: 0, g: 0, c: 0, ri: 0, re: 0, ei: 0, ee: 0 });
      const totalStock = SES.reduce((t, x) => t + (n.m[x].deliv - n.m[x].allG), 0); // остаток всех сезонов: получено − продано товара
      // FW26/27: получено и остаток товара сезона — по отчёту (как в Excel и «Поставки»), а не по файлу поступлений.
      const repDeliv = m.deliv, repStock = m.deliv - m.allG;
      const tStock = k === "FW26/27" ? totalStock : k === "SS26" ? Math.max(0, totalStock - n.m["FW26/27"].stock) : 0;
      // Остаток: цена сейчас (₽) и MU = цена сейчас в € ÷ себестоимость в € (приход € ÷ шт., иначе заказ € ÷ шт.).
      const pE = price && eurRate ? price / eurRate : 0;
      by[k] = { oSold: old.n, oGross: old.g, oCost: old.c, oRubIn: old.ri, oRubEx: old.re, oEurIn: old.ei, oEurEx: old.ee,
        tStock, tRetail: price ? price * tStock : 0, tPriced: price ? tStock : 0, tRetailBoth: pE && cost ? pE * tStock : 0, tCostBoth: pE && cost ? cost * tStock : 0,
        conf: m.conf, confEur: m.confEur, deliv: repDeliv, delivEur: m.delivEur, sold: m.ssn, nsRubIn: m.rubSIn, nsRubEx: m.rubSEx, nsEurIn: m.eurSIn, nsEurEx: m.eurSEx, gross: m.grossS, cost: m.costS, stock: repStock,
        sRetail: price ? price * m.stock : 0, sPriced: price ? m.stock : 0, sRetailBoth: pE && cost ? pE * m.stock : 0, sCostBoth: pE && cost ? cost * m.stock : 0 };
    }
    return { cls: (first?.cls ?? "other") as ReportLeaf["cls"], cat1: first?.l2 || "(без категории)", fur: first?.fur ? furRuLabel(first.fur, FUR_REPORT) : keyOf(first, "fur"), cat2: first?.l4 || first?.l5 || "(без категории)", model: n.modelCode ?? n.label, by, ...(() => { const ks = Object.keys(by) as string[], f = by["FW26/27"], ttlDeliv = ks.reduce((a, k) => a + by[k].deliv, 0), ttlDelivEur = ks.reduce((a, k) => a + by[k].delivEur, 0), tc = ks.reduce((a, k) => a + by[k].conf, 0), te = ks.reduce((a, k) => a + by[k].confEur, 0); const uFw = f && f.deliv > 0 && f.delivEur > 0 ? f.delivEur / f.deliv : f && f.conf > 0 && f.confEur > 0 ? f.confEur / f.conf : 0, uAll = tc > 0 && te > 0 ? te / tc : uFw; return { ttlDeliv, ttlDelivEur, stockEur: leafStockEur(n.rows).fw, stockEurTtl: leafStockEur(n.rows).all }; })(), ttlConf: (Object.keys(by) as string[]).reduce((a, k) => a + by[k].conf, 0), ttlConfEur: (Object.keys(by) as string[]).reduce((a, k) => a + by[k].confEur, 0) };
  });
  return reportLeaves;
}
