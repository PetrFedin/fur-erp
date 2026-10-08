import "server-only";
import { Decimal } from "@prisma/client/runtime/library";
import type { Prisma, PrismaClient } from "@prisma/client";
import { colorKey, matchColorRef, PROPOSED_MARK } from "@/lib/color-ref";
import { candidatesFromList } from "@/lib/article-key";
import { loadArticleList } from "@/lib/article-ref";
import { defaultCommission4 } from "@/lib/commission4-const";
import { lineCostWith4 } from "@/lib/commission4";
import { draftQty, duplicateNumbers, parseColors, parseMaterialLines, sizesTotal, toNum, type TzDraft } from "@/lib/tz-import-core";

type Db = PrismaClient | Prisma.TransactionClient;

export type TzIssue = { level: "error" | "warn"; field: "number" | "article" | "colors" | "batch" | "client" | "materials" | "sum" | "qty" | "price"; text: string };

export type TzLotUse = { lotId: string; lotNumber: string; material: string; qty: number; unitCost: number; vatRate: number; c4: boolean; remaining: number };

export type TzAnalysis = {
  key: string;
  issues: TzIssue[];
  blocking: boolean;
  qty: number | null;
  articleId: string | null;
  articleName: string | null;
  colorRefIds: (string | null)[];
  batchId: string | null;
  clientId: string | null;
  lots: TzLotUse[];
  costBase: number;
  costWith4: number;
  work: number;
};

export type TzOptions = { createRefs: boolean };

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const nameKey = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();

/**
 * Проверка черновиков ТЗ по справочникам и остаткам. Только чтение. Один и тот же лот в нескольких ТЗ набора суммируется:
 * остаток проверяется по сумме всех ТЗ, а не по каждому отдельно.
 */
export async function analyzeDrafts(db: Db, orgId: string, drafts: TzDraft[], opts: TzOptions): Promise<TzAnalysis[]> {
  const [articles, colorRefs, batches, clients, lots, existing] = await Promise.all([
    loadArticleList(orgId),
    db.colorRef.findMany({ where: { organizationId: orgId } }),
    db.productionBatch.findMany({ where: { organizationId: orgId }, select: { id: true, number: true } }),
    db.client.findMany({ where: { organizationId: orgId }, select: { id: true, name: true } }),
    db.rawMaterialLot.findMany({
      where: { organizationId: orgId, lotNumber: { not: null }, quantityRemaining: { gt: 0 } },
      include: { rawMaterial: { select: { name: true } } },
    }),
    db.productionOrder.findMany({ where: { organizationId: orgId }, select: { number: true, workOrderNumber: true } }),
  ]);
  const lotsByNo = new Map<string, typeof lots>();
  for (const l of lots) lotsByNo.set(l.lotNumber!.trim().toLowerCase(), [...(lotsByNo.get(l.lotNumber!.trim().toLowerCase()) ?? []), l]);
  const taken = new Set(existing.flatMap((o) => [o.workOrderNumber, o.number]).filter(Boolean).map((x) => String(x).trim().toLowerCase()));
  const dups = duplicateNumbers(drafts);
  const need = new Map<string, number>();
  const out: TzAnalysis[] = [];

  for (const d of drafts) {
    const issues: TzIssue[] = [];
    const err = (field: TzIssue["field"], text: string) => issues.push({ level: "error", field, text });
    const warn = (field: TzIssue["field"], text: string) => issues.push({ level: "warn", field, text });

    const no = d.number.trim();
    if (!no) err("number", "не указан № ТЗ");
    else if (taken.has(no.toLowerCase())) err("number", `ТЗ № ${no} уже есть в базе (дубль)`);
    else if (dups.has(no.toLowerCase())) err("number", `№ ТЗ ${no} повторяется в этой загрузке`);

    let articleId: string | null = null;
    let articleName: string | null = null;
    if (!d.article.trim()) err("article", "не указан артикул / модель");
    else {
      const c = candidatesFromList(articles, d.article);
      if (c.length === 1) {
        articleId = c[0].id;
        articleName = c[0].name;
      } else if (c.length > 1) err("article", `артикул «${d.article}» неоднозначен: ${c.map((x) => x.name).join(", ")}`);
      else if (opts.createRefs) warn("article", `артикула «${d.article}» нет в справочнике — будет создан`);
      else err("article", `артикула «${d.article}» нет в справочнике — включите «создавать недостающее» или исправьте`);
    }

    const colorRefIds: (string | null)[] = [];
    const cols = parseColors(d.colors);
    if (cols.length === 0) warn("colors", "цвет не указан");
    for (const c of cols) {
      const m = matchColorRef(c.name, colorRefs);
      colorRefIds.push(m?.id ?? null);
      if (!m) {
        const proposed = colorRefs.find((r) => colorKey(r.name) === colorKey(c.name));
        if (proposed) warn("colors", `цвет «${c.name}» в справочнике ещё не подтверждён`);
        else if (opts.createRefs) warn("colors", `цвета «${c.name}» нет в справочнике — будет предложен новый`);
        else err("colors", `цвета «${c.name}» нет в справочнике`);
      }
    }
    if (cols.length > 1 && new Set(cols.map((c) => colorKey(c.name))).size !== cols.length) err("colors", "один цвет указан дважды");

    const qty = draftQty(d);
    if (!Number.isFinite(qty)) err("qty", "не удаётся определить количество изделий (укажите «Кол-во» или размеры с количеством)");
    else {
      const st = sizesTotal(d.sizes);
      if (toNum(d.qty) > 0 && st > 0 && st !== toNum(d.qty)) warn("qty", `по размерам ${st} шт., указано ${d.qty}`);
      const ct = cols.reduce((s, c) => s + (c.qty ?? 0), 0);
      if (ct > 0 && ct > qty) err("qty", `по цветам ${ct} шт. больше количества ТЗ ${qty}`);
    }

    let batchId: string | null = null;
    let batchNumber: number | null = null;
    if (d.batch.trim()) {
      const n = Number(d.batch.trim().replace(/^партия\s*/i, ""));
      const b = Number.isInteger(n) ? batches.find((x) => x.number === n) : undefined;
      if (b) {
        batchId = b.id;
        batchNumber = b.number;
      } else err("batch", `партии «${d.batch}» нет в справочнике партий`);
    }

    let clientId: string | null = null;
    if (d.client.trim()) {
      const c = clients.find((x) => nameKey(x.name) === nameKey(d.client));
      if (c) clientId = c.id;
      else if (opts.createRefs) warn("client", `заказчика «${d.client}» нет — будет создан`);
      else err("client", `заказчика «${d.client}» нет в справочнике`);
    }

    let work = 0;
    if (d.price.trim()) {
      const p = toNum(d.price);
      if (!Number.isFinite(p) || p < 0) err("price", `цена работы «${d.price}» — не число`);
      else work = r2(p * (Number.isFinite(qty) ? qty : 0));
    } else warn("price", "цена работы не указана — оплату по ТЗ определить нельзя");

    const mats = parseMaterialLines(d.materials);
    for (const e of mats.errors) err("materials", e);
    const uses: TzLotUse[] = [];
    for (const ln of mats.lines) {
      const cands = lotsByNo.get(ln.lot.toLowerCase()) ?? [];
      if (cands.length === 0) {
        err("materials", `строка ${ln.line}: лот ${ln.lot} не найден (или нет остатка)`);
        continue;
      }
      if (cands.length > 1) {
        err("materials", `строка ${ln.line}: лот ${ln.lot} неоднозначен (${cands.length} лотов с таким номером)`);
        continue;
      }
      const lot = cands[0];
      const total = (need.get(lot.id) ?? 0) + ln.qty;
      const rem = Number(lot.quantityRemaining);
      if (total > rem + 1e-9) {
        err("materials", `строка ${ln.line}: лот ${ln.lot} — остаток ${rem}, с учётом других ТЗ этой загрузки нужно ${total}`);
        continue;
      }
      need.set(lot.id, total);
      uses.push({
        lotId: lot.id,
        lotNumber: ln.lot,
        material: lot.rawMaterial.name,
        qty: ln.qty,
        unitCost: Number(lot.unitCost),
        vatRate: Number(lot.vatRate),
        c4: ln.c4 ?? defaultCommission4(batchNumber),
        remaining: rem,
      });
    }
    if (mats.lines.length === 0 && mats.errors.length === 0) warn("materials", "нет списаний сырья — ТЗ создастся как «Запланирован»");

    const costBase = r2(uses.reduce((s, u) => s + u.unitCost * u.qty, 0));
    const costWith4 = r2(uses.reduce((s, u) => s + lineCostWith4(u.unitCost * u.qty, u.vatRate, u.c4), 0));
    if (d.calcTotal.trim() && uses.length) {
      const t = toNum(d.calcTotal);
      if (!Number.isFinite(t)) err("sum", `сумма расчёта «${d.calcTotal}» — не число`);
      else if (Math.abs(t - costBase) > 1 && Math.abs(t - costWith4) > 1) warn("sum", `сумма расчёта ${t.toLocaleString("ru-RU")} ₽ ≠ сумме списаний ${costBase.toLocaleString("ru-RU")} ₽ (с 4%: ${costWith4.toLocaleString("ru-RU")} ₽)`);
    }

    out.push({
      key: d.key,
      issues,
      blocking: issues.some((i) => i.level === "error"),
      qty: Number.isFinite(qty) ? qty : null,
      articleId,
      articleName,
      colorRefIds,
      batchId,
      clientId,
      lots: uses,
      costBase,
      costWith4,
      work,
    });
  }
  return out;
}

export { PROPOSED_MARK };
export const decimal = (n: number) => new Decimal(n);
