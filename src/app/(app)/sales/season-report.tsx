"use client";

// «Продажи и остатки» → главная вкладка: заказ, поступление и продажи по сезонам из отчёта «заказ и продажи» (FW26/27, SS26, FW25/26).
// Дерево: мех → категория → артикул (с фото) → цвет → размер; сезоны рядом для сравнения. Карточки с фото: итоги, цена продажи и маркап по сезонам.
// Цена продажи = (выручка ₽ + скидка ₽) ÷ продано шт. (с НДС) — по какой цене продавали до скидки; маркап = цена ÷ себестоимость изделия из ТЗ (с НДС).
import { Fragment, useMemo, useState } from "react";
import { InfoHint } from "@/components/info-hint";
import { PhotoGalleryButton } from "@/components/photo-gallery";
import type { ReportSizeRow } from "@/lib/margin-tree";
import type { ModelCost, RetailRow } from "@/lib/margin";
import { CAT_LABEL, colorOfLine, furKeyOfReportRow as furKeyOfRow, variantOfArticle } from "@/lib/sales-receipts-core";
import type { Cat } from "@/lib/sales-section";
import { DASH, btn, money, moneyC, n0, pct, seg, segGroup, x2 } from "./sales-fmt";
import type { PhotoIdx } from "./sales-tree";

const SEASONS = ["FW26/27", "SS26", "FW25/26"] as const;
type Season = (typeof SEASONS)[number];
const SEASON_LABEL: Record<Season, string> = { "FW26/27": "FW26", SS26: "SS26", "FW25/26": "FW25" };
const SEASON_BG: Record<Season, string> = { "FW26/27": "bg-sky-50/60", SS26: "bg-amber-50/60", "FW25/26": "bg-emerald-50/50" };
type Level = "fur" | "cat" | "article" | "color" | "size";
const LEVELS: Level[] = ["fur", "cat", "article", "color", "size"];
const LEVEL_LABEL: Record<Level, string> = { fur: "Мех", cat: "Категория", article: "Артикул", color: "Цвет", size: "Размер" };

const FUR_RU: Record<string, string> = { SABLE: "Соболь", MINK: "Норка", FOX: "Лиса", SWAKARA: "Каракульча (свакара)", LYNX: "Рысь", BEAVER: "Бобр", CHINCHILLA: "Шиншилла" };
const furRu = (k: string) => FUR_RU[k] ?? (k === "Не указан" ? k : k.charAt(0) + k.slice(1).toLowerCase());
export { furKeyOfReportRow as furKeyOfRow } from "@/lib/sales-receipts-core";

/** Показатели сезона. По SS26 и FW25 заказ закрыт: заказано = поступило (правило владельца 21.10.2026). */
type M = { conf: number; confEur: number; deliv: number; ssn: number; old: number; all: number; rub: number; rubIn: number; disc: number; grossC: number; costSold: number };
const zero = (): M => ({ conf: 0, confEur: 0, deliv: 0, ssn: 0, old: 0, all: 0, rub: 0, rubIn: 0, disc: 0, grossC: 0, costSold: 0 });
const plus = (a: M, b: M): M => ({ conf: a.conf + b.conf, confEur: a.confEur + b.confEur, deliv: a.deliv + b.deliv, ssn: a.ssn + b.ssn, old: a.old + b.old, all: a.all + b.all, rub: a.rub + b.rub, rubIn: a.rubIn + b.rubIn, disc: a.disc + b.disc, grossC: a.grossC + b.grossC, costSold: a.costSold + b.costSold });
const so = (m: M) => (m.deliv > 0 ? m.ssn / m.deliv : null);
const priceOf = (m: M) => (m.all > 0 ? (m.rubIn + m.disc) / m.all : null);
const markupOf = (m: M) => (m.costSold > 0 ? m.grossC / m.costSold : null);
const eur = (v: number) => (Math.abs(v) < 0.5 ? DASH : Math.round(v).toLocaleString("ru-RU") + " €");

type Col = { key: string; label: string; short: string; hint: string; get: (m: M, s: Season) => string; strong?: boolean; full?: boolean };
const COLS: Col[] = [
  { key: "conf", label: "Заказано, шт.", short: "Заказ", hint: "Conf отчёта. По SS26 и FW25 заказ закрыт — заказано = поступило.", get: (m) => n0(m.conf) },
  { key: "deliv", label: "Поступило, шт.", short: "Пришло", hint: "Поступило в розницу по этому сезону.", get: (m) => n0(m.deliv) },
  { key: "wait", label: "Ждём, шт.", short: "Ждём", hint: "Заказано − поступило (только FW26).", get: (m, s) => (s === "FW26/27" ? n0(Math.max(0, m.conf - m.deliv)) : DASH), full: true },
  { key: "ssn", label: "Продано сезонного, шт.", short: "Сезон.", hint: "SSN: продано товара этого сезона в его период.", get: (m) => n0(m.ssn), full: true },
  { key: "so", label: "SO сезона", short: "SO", hint: "Продано сезонного ÷ поступило этого сезона.", get: (m) => pct(so(m)), full: true },
  { key: "old", label: "Продано не сезонного, шт.", short: "Не сез.", hint: "Old: в период сезона продано товара прошлых сезонов.", get: (m) => n0(m.old), full: true },
  { key: "all", label: "Продано всего, шт.", short: "Продано", hint: "Сезонного + не сезонного за период сезона.", get: (m) => n0(m.all), strong: true },
  { key: "rub", label: "Выручка, ₽", short: "Выручка", hint: "Net sales RUR за период сезона: после скидки, возвраты минус. С НДС или без — как в шапке.", get: (m) => moneyC(m.rub), strong: true },
  { key: "price", label: "Цена продажи, ₽/шт.", short: "Цена", hint: "(Выручка ₽ + скидка ₽) ÷ продано шт., с НДС — по какой цене продавали до скидки.", get: (m) => moneyC(priceOf(m)), full: true },
  { key: "markup", label: "Маркап", short: "Маркап", hint: "Цена продажи до скидки ÷ себестоимость изделия из ТЗ (с НДС), по проданным штукам, у которых есть себестоимость.", get: (m) => x2(markupOf(m)) },
];

type Node = { id: string; level: Level; label: string; sub?: string; modelCode: string | null; variant: string | null; rows: ReportSizeRow[]; m: Record<Season, M>; stock: number; children: Node[] };

export function SeasonReport({ sizes, photos, cat, ex, reportDate, fabricByArt, prices, costs }: { sizes: ReportSizeRow[]; photos: PhotoIdx; cat: Cat; ex: boolean; reportDate?: string; fabricByArt: Record<string, string>; prices: RetailRow[]; costs: [string, ModelCost][] }) {
  const [pick, setPick] = useState<Season[]>([...SEASONS]);
  const [view, setView] = useState<"tree" | "cards">("tree");
  const [detail, setDetail] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [furPick, setFurPick] = useState<string>("all");
  const [sort, setSort] = useState("rub");
  const seasons = SEASONS.filter((s) => pick.includes(s));
  const seasonsKey = seasons.join(",");
  const full = detail || seasons.length === 1;
  const cols = COLS.filter((c) => full || !c.full);

  const costOf = useMemo(() => new Map(costs), [costs]);
  const priceIdx = useMemo(() => { const m = new Map<string, number>(); for (const p of prices) { const k = `${p.acode}|${p.color}|${p.size}`; if (!m.has(k)) m.set(k, p.price); } return m; }, [prices]);
  const nowPrice = (r: ReportSizeRow) => priceIdx.get(`${r.acode}|${r.color}|${r.size}`) ?? null;

  const rows = useMemo(() => sizes.filter((r) => r.seas && (cat === "all" || r.cls === cat)), [sizes, cat]);
  const keyOf = (r: ReportSizeRow, l: Level) => l === "fur" ? furRu(furKeyOfRow(r, fabricByArt)) : l === "cat" ? (r.l4 || r.l5 || "(без категории)") : l === "article" ? r.acode : l === "color" ? colorOfLine(r.color) : r.size || "(без размера)";
  const furs = useMemo(() => [...new Set(rows.map((r) => keyOf(r, "fur")))].sort(), [rows, fabricByArt]); // eslint-disable-line react-hooks/exhaustive-deps

  const mOf = (rs: ReportSizeRow[]) => {
    const out = Object.fromEntries(SEASONS.map((s) => [s, zero()])) as Record<Season, M>;
    for (const r of rs) {
      const cost = r.modelCode ? costOf.get(r.modelCode)?.unitIncl ?? 0 : 0;
      for (const s of SEASONS) {
        const c = r.seas?.[s]; if (!c) continue;
        const m = out[s], closed = s !== "FW26/27";
        m.conf += closed ? c.conf ?? c.deliv ?? 0 : c.conf ?? 0;
        m.confEur += closed ? c.confEur ?? c.delivEur ?? 0 : c.confEur ?? 0;
        m.deliv += c.deliv ?? 0; m.ssn += c.soldSsn ?? 0; m.old += c.soldOld ?? 0; m.all += c.soldAll ?? 0;
        m.rub += (ex ? c.rubExAll : c.rubAll) ?? 0; m.rubIn += c.rubAll ?? 0; m.disc += c.discAll ?? 0;
        if (cost > 0 && (c.soldAll ?? 0) > 0) { m.grossC += (c.rubAll ?? 0) + (c.discAll ?? 0); m.costSold += (c.soldAll ?? 0) * cost; }
      }
    }
    return out;
  };
  const filtered = useMemo(() => rows.filter((r) => (furPick === "all" || keyOf(r, "fur") === furPick) && (!q || `${r.acode} ${keyOf(r, "fur")} ${keyOf(r, "cat")} ${r.color} ${r.size}`.toLowerCase().includes(q.toLowerCase()))), [rows, furPick, q, fabricByArt]); // eslint-disable-line react-hooks/exhaustive-deps
  const sortVal = (n: Node) => seasons.reduce((a, s) => a + (sort === "rub" ? n.m[s].rub : sort === "all" ? n.m[s].all : sort === "conf" ? n.m[s].conf : sort === "so" ? so(n.m[s]) ?? 0 : sort === "markup" ? markupOf(n.m[s]) ?? 0 : n.m[s].ssn), 0);
  const tree = useMemo(() => {
    const build = (rs: ReportSizeRow[], depth: number, path: string): Node[] => {
      if (depth >= LEVELS.length) return [];
      const l = LEVELS[depth];
      const g = new Map<string, ReportSizeRow[]>();
      for (const r of rs) { const k = keyOf(r, l); (g.get(k) ?? g.set(k, []).get(k)!).push(r); }
      return [...g].map(([k, list]) => {
        const id = `${path}/${l}:${k}`, first = list[0];
        const node: Node = { id, level: l, label: k, sub: l === "article" ? `${keyOf(first, "fur")} · ${keyOf(first, "cat")}` : undefined, modelCode: first.modelCode, variant: variantOfArticle(first.acode), rows: list, m: mOf(list), stock: list.reduce((a, r) => a + r.stock, 0), children: [] };
        node.children = build(list, depth + 1, id);
        return node;
      }).filter((n) => seasons.some((s) => n.m[s].conf || n.m[s].deliv || n.m[s].all) || n.stock).sort((a, b) => (l === "size" ? (Number(a.label) || 1e6) - (Number(b.label) || 1e6) : sortVal(b) - sortVal(a) || a.label.localeCompare(b.label)));
    };
    return build(filtered, 0, "");
  }, [filtered, sort, ex, seasonsKey, costOf]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = useMemo(() => mOf(filtered), [filtered, ex, costOf]); // eslint-disable-line react-hooks/exhaustive-deps
  const totalAll = useMemo(() => mOf(rows), [rows, ex, costOf]); // eslint-disable-line react-hooks/exhaustive-deps
  const stockAll = filtered.reduce((a, r) => a + r.stock, 0);
  const articles = useMemo(() => { const out: Node[] = []; const walk = (ns: Node[]) => ns.forEach((n) => (n.level === "article" ? out.push(n) : walk(n.children))); walk(tree); return out.sort((a, b) => sortVal(b) - sortVal(a)); }, [tree]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (s: Season) => setPick((p) => (p.includes(s) ? (p.length > 1 ? p.filter((x) => x !== s) : p) : [...p, s]));
  const expandTo = (lvl: number) => { const ids = new Set<string>(); const walk = (ns: Node[], d: number) => ns.forEach((n) => { if (d < lvl) { ids.add(n.id); walk(n.children, d + 1); } }); walk(tree, 0); setOpen(ids); };
  const flip = (id: string) => setOpen((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const nowRange = (n: Node) => { const v = n.rows.map(nowPrice).filter((x): x is number => x !== null); if (!v.length) return null; const lo = Math.min(...v), hi = Math.max(...v); return lo === hi ? money(lo) : `${moneyC(lo)}–${moneyC(hi)}`; };
  const costLine = (n: Node) => (n.modelCode ? costOf.get(n.modelCode)?.unitIncl ?? null : null);

  if (!rows.length) return <p className="rounded-lg border border-neutral-300 bg-white p-3 text-sm text-neutral-800">Сезонных данных нет: загрузите отчёт «заказ и продажи» (Настройки → Загрузка данных → Прайс и размеры).</p>;

  const thumb = (n: Node, big = false) => {
    const p = n.modelCode ? photos[n.modelCode] : undefined;
    const v = p ? p.photos.filter((x) => x.variant.trim().toUpperCase() === (n.variant ?? "").trim().toUpperCase()) : [];
    const list = v.length ? v : p?.photos.filter((x) => !x.variant.trim()) ?? [];
    const use = list.length ? list : p?.photos ?? [];
    return p && use.length ? <PhotoGalleryButton modelId={p.modelId} photos={use} title={n.label} compact thumbOnly big={big} /> : <span role="img" aria-label="Фото нет" className={(big ? "h-28 w-20" : "size-11") + " inline-flex shrink-0 items-center justify-center rounded border border-dashed border-neutral-300 text-center text-[11px] leading-tight text-neutral-600"}>нет фото</span>;
  };
  const rowCells = (m: Record<Season, M>, bold = false) => seasons.map((s) => <Fragment key={s}>{cols.map((c, i) => <td key={c.key} className={`px-2 py-2 text-right tabular-nums whitespace-nowrap ${SEASON_BG[s]} ${i === 0 ? "border-l border-neutral-300" : ""} ${c.strong || bold ? "font-semibold" : ""}`}>{c.get(m[s], s)}</td>)}</Fragment>);

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
  const sumAll = seasons.reduce((a, s) => plus(a, totalAll[s]), zero());
  const SUMMARY: Col[] = [...COLS.slice(0, 2), { key: "confEur", label: "Заказано, €", short: "", hint: "Conf EUR отчёта — закупочная стоимость заказа; по SS26 и FW25 — поступило в €.", get: (m: M) => eur(m.confEur) }, ...COLS.slice(2)];

  return (
    <section aria-label="Сезоны: заказ и продажи" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold">Заказ, поступление и продажи по сезонам</h2>
        <InfoHint label="Откуда цифры" wide>
          <p>Отчёт «заказ и продажи» на {reportDate ?? "дату загрузки"}. По каждому сезону: заказано (Conf) и поступило; продажи за период сезона (FW — август–январь, SS — февраль–июль): своего сезона (SSN) и прошлых (Old). {CAT_LABEL[cat]}; выручка {ex ? "без НДС" : "с НДС"}.</p>
          <p className="mt-1">Цена продажи = (выручка + скидка) ÷ продано, с НДС. Маркап = цена продажи ÷ себестоимость изделия по ТЗ (с НДС). «Цена сейчас» — текущий прайс розницы.</p>
        </InfoHint>
      </div>

      <div role="group" aria-label="Сезоны для сравнения" className={segGroup + " self-start"}>
        {SEASONS.map((s) => <button key={s} type="button" aria-pressed={pick.includes(s)} onClick={() => toggle(s)} className={seg(pick.includes(s))}>{SEASON_LABEL[s]}</button>)}
        <button type="button" aria-pressed={pick.length === SEASONS.length} onClick={() => setPick([...SEASONS])} className={seg(pick.length === SEASONS.length)}>Сравнить все</button>
      </div>

      {/* Итоги по сезонам */}
      <div className="overflow-x-auto rounded-lg border border-neutral-300 bg-white">
        <table className="w-full min-w-[520px] text-sm">
          <thead className="bg-neutral-50"><tr><th className="px-3 py-2 text-left text-xs font-semibold">Итоги · {CAT_LABEL[cat]}</th>{seasons.map((s) => <th key={s} className={`px-3 py-2 text-right text-xs font-semibold ${SEASON_BG[s]}`}>{SEASON_LABEL[s]}</th>)}{seasons.length > 1 ? <th className="px-3 py-2 text-right text-xs font-semibold">Вместе</th> : null}</tr></thead>
          <tbody>
            {SUMMARY.map((c) => (
              <tr key={c.key} className="border-t border-neutral-200">
                <td className={"px-3 py-2 " + (c.strong ? "font-semibold" : "")}>{c.label}<InfoHint label={c.label}><p>{c.hint}</p></InfoHint></td>
                {seasons.map((s) => <td key={s} data-season={s} data-metric={c.key} className={`px-3 py-2 text-right tabular-nums ${SEASON_BG[s]} ${c.strong ? "font-semibold" : ""}`}>{c.key === "rub" ? money(totalAll[s].rub) : c.get(totalAll[s], s)}</td>)}
                {seasons.length > 1 ? <td className="px-3 py-2 text-right tabular-nums text-neutral-800">{c.key === "wait" ? n0(Math.max(0, totalAll["FW26/27"].conf - totalAll["FW26/27"].deliv)) : c.key === "rub" ? money(sumAll.rub) : c.get(sumAll, "FW25/26")}</td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Панель: вид, мех, поиск, сортировка */}
      <div className="sticky top-0 z-[15] flex flex-wrap items-center gap-2 rounded-lg bg-white/95 py-1 backdrop-blur">
        <div role="group" aria-label="Вид" className={segGroup}>
          <button type="button" aria-pressed={view === "tree"} onClick={() => setView("tree")} className={seg(view === "tree")}>Мех → артикул → размер</button>
          <button type="button" aria-pressed={view === "cards"} onClick={() => setView("cards")} className={seg(view === "cards")}>Карточки с фото</button>
        </div>
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
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Артикул, мех, категория, цвет" aria-label="Поиск" className="min-h-11 w-56 max-w-full rounded-md border border-neutral-300 px-3 text-sm" />
        {seasons.length > 1 && view === "tree" ? <button type="button" aria-pressed={detail} onClick={() => setDetail((v) => !v)} className={seg(detail)}>{detail ? "Кратко" : "Все показатели"}</button> : null}
      </div>

      {view === "tree" ? (
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
                  <th rowSpan={2} className="sticky left-0 z-20 bg-neutral-50 px-2 py-2 text-left text-xs font-semibold">Мех → категория → артикул → цвет → размер</th>
                  {seasons.map((s) => <th key={s} colSpan={cols.length} className={`border-l border-neutral-300 px-2 py-1 text-center text-xs font-semibold ${SEASON_BG[s]}`}>{SEASON_LABEL[s]}</th>)}
                  <th rowSpan={2} className="border-l border-neutral-300 px-2 py-1 text-right text-[11px] font-semibold">Остаток сейчас, шт.</th>
                </tr>
                <tr>{seasons.map((s) => <Fragment key={s}>{cols.map((c, i) => <th key={c.key} title={c.hint} className={`px-2 py-1 text-right text-[11px] font-semibold whitespace-nowrap ${SEASON_BG[s]} ${i === 0 ? "border-l border-neutral-300" : ""}`}>{c.short}</th>)}</Fragment>)}</tr>
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
              <thead><tr className="text-xs text-neutral-700"><th className="px-2 py-1.5 text-left font-semibold">Итого · {articles.length} артикулов</th>{COLS.map((c) => <th key={c.key} title={c.hint} className="px-2 py-1.5 text-right font-semibold whitespace-nowrap">{c.short}</th>)}</tr></thead>
              <tbody>
                {seasons.map((s) => <tr key={s} className={`border-t border-neutral-200 ${SEASON_BG[s]}`}><td className="px-2 py-1.5 font-medium">{SEASON_LABEL[s]}</td>{COLS.map((c) => <td key={c.key} className={"px-2 py-1.5 text-right tabular-nums whitespace-nowrap " + (c.strong ? "font-semibold" : "")}>{c.get(total[s], s)}</td>)}</tr>)}
                {seasons.length > 1 ? (() => { const sum = seasons.reduce((a, s) => plus(a, total[s]), zero()); return <tr className="border-t-2 border-neutral-400 font-semibold"><td className="px-2 py-1.5">Вместе</td>{COLS.map((c) => <td key={c.key} className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">{c.key === "wait" ? n0(Math.max(0, total["FW26/27"].conf - total["FW26/27"].deliv)) : c.get(sum, "FW25/26")}</td>)}</tr>; })() : null}
              </tbody>
            </table>
            <p className="px-2 pb-1.5 text-xs text-neutral-700">Остаток сейчас: <b className="tabular-nums">{n0(stockAll)}</b> шт.</p>
          </div>
          <ul className="grid grid-cols-1 gap-3 2xl:grid-cols-2">
            {articles.map((n) => {
              const cost = costLine(n), now = nowRange(n), sum = seasons.reduce((a, s) => plus(a, n.m[s]), zero());
              const nowNum = n.rows.map(nowPrice).find((x) => x !== null) ?? null;
              return (
                <li key={n.id} className="flex flex-col gap-3 rounded-xl border border-neutral-300 bg-white p-3 md:flex-row">
                  <div className="flex items-start gap-3 md:w-72 md:shrink-0">
                    {thumb(n, true)}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold leading-snug" title={n.label}>{n.label}</p>
                      <p className="text-xs text-neutral-700">{n.sub}</p>
                      <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-xs">
                        <dt className="text-neutral-700">Цена сейчас</dt><dd className="text-right font-semibold tabular-nums">{now ?? DASH}</dd>
                        <dt className="text-neutral-700">Себестоимость</dt><dd className="text-right tabular-nums">{cost ? money(cost) : DASH}</dd>
                        <dt className="text-neutral-700">Маркап по цене сейчас</dt><dd className="text-right tabular-nums">{cost && nowNum ? x2(nowNum / cost) : DASH}</dd>
                        <dt className="text-neutral-700">Остаток сейчас</dt><dd className="text-right tabular-nums">{n0(n.stock)} шт.</dd>
                      </dl>
                    </div>
                  </div>
                  <div className="min-w-0 flex-1 overflow-x-auto">
                    <table className="w-full min-w-[440px] text-sm">
                      <thead><tr className="text-neutral-700"><th className="py-1 text-left font-normal">Сезон</th><th className="text-right font-normal">Заказ</th><th className="text-right font-normal">Пришло</th><th className="text-right font-normal">Сез.</th><th className="text-right font-normal">Не сез.</th><th className="text-right font-normal">Всего</th><th className="text-right font-normal">Выручка</th><th className="text-right font-normal">Цена</th><th className="text-right font-normal">Маркап</th></tr></thead>
                      <tbody>
                        {seasons.map((s) => { const m = n.m[s]; return <tr key={s} className={`border-t border-neutral-200 tabular-nums ${SEASON_BG[s]}`}><td className="py-1.5 pl-1">{SEASON_LABEL[s]}</td><td className="text-right">{n0(m.conf)}</td><td className="text-right">{n0(m.deliv)}</td><td className="text-right">{n0(m.ssn)}</td><td className="text-right">{n0(m.old)}</td><td className="text-right font-semibold">{n0(m.all)}</td><td className="text-right">{moneyC(m.rub)}</td><td className="text-right">{moneyC(priceOf(m))}</td><td className="text-right">{x2(markupOf(m))}</td></tr>; })}
                        {seasons.length > 1 ? <tr className="border-t-2 border-neutral-400 font-semibold tabular-nums"><td className="py-1.5 pl-1">Итого</td><td className="text-right">{n0(sum.conf)}</td><td className="text-right">{n0(sum.deliv)}</td><td className="text-right">{n0(sum.ssn)}</td><td className="text-right">{n0(sum.old)}</td><td className="text-right">{n0(sum.all)}</td><td className="text-right">{moneyC(sum.rub)}</td><td className="text-right">{moneyC(priceOf(sum))}</td><td className="text-right">{x2(markupOf(sum))}</td></tr> : null}
                      </tbody>
                    </table>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
