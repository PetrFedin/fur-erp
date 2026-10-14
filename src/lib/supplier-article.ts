/**
 * Изделия для внешнего поставщика (Веллмех): что из данных артикула ему можно показать и как собирать то, что он вносит.
 * Описание артикула (description) у нас бывает с путём каталога и ценами («Цены по реестру…»), поэтому поставщику
 * описание целиком не показывается никогда — только название, очищенное здесь, и строки «Мех:», «Подкладка:», которые вносит он сам.
 */

const PRICEY = /₽|руб|цен[аы]|наценк|себестоим|\d{1,3}(?:[\s ]\d{3})+|\d{6,}|\/\s*ед/i;

/** Название для поставщика: salesName, иначе тип изделия из описания (последний сегмент «Каталог: …»), иначе null. Цены не пропускает. */
export function supplierArticleTitle(salesName: string | null | undefined, description: string | null | undefined): string | null {
  const s = (salesName ?? "").replace(/\s+/g, " ").trim();
  if (s && !PRICEY.test(s)) return s;
  const d = (description ?? "").replace(/\r/g, "").trim();
  if (!d) return null;
  if (/^Каталог\s*:/i.test(d)) {
    const segs = d.replace(/^Каталог\s*:/i, "").split(/\s\/\s/).map((x) => x.trim()).filter((x) => x && !/^Цены/i.test(x) && !PRICEY.test(x));
    return segs.length > 1 ? segs[segs.length - 1] : null;
  }
  if (/^Цены/i.test(d)) return null;
  const first = d.split(/\n|\.\s/)[0].trim();
  if (!first || first.length > 120 || PRICEY.test(first) || /^(Мех|Подкладка|Размеры|Цвета)\s*:/i.test(first)) return null;
  return first;
}

const LABELS = { fur: "Мех", lining: "Подкладка", sizes: "Размеры", colors: "Цвета" } as const;
export type SupplierDescFields = { fur: string; lining: string; sizes: string; colors: string; note: string };

/** Разбор описания, которое собрала форма поставщика: строки «Мех: …», «Подкладка: …», «Размеры: …», «Цвета: …», остальное — примечание. */
export function parseSupplierDescription(description: string | null | undefined): SupplierDescFields {
  const out: SupplierDescFields = { fur: "", lining: "", sizes: "", colors: "", note: "" };
  const rest: string[] = [];
  for (const line of (description ?? "").replace(/\r/g, "").split("\n")) {
    const m = line.match(/^(Мех|Подкладка|Размеры|Цвета)\s*:\s*(.*)$/i);
    if (m) {
      const key = (Object.keys(LABELS) as (keyof typeof LABELS)[]).find((k) => LABELS[k].toLowerCase() === m[1].toLowerCase())!;
      if (!out[key]) out[key] = m[2].trim();
    } else rest.push(line);
  }
  out.note = rest.join("\n").trim();
  return out;
}

export function composeSupplierDescription(f: Partial<SupplierDescFields>): string {
  const clean = (v?: string) => (v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
  return [
    clean(f.fur) && `${LABELS.fur}: ${clean(f.fur)}`,
    clean(f.lining) && `${LABELS.lining}: ${clean(f.lining)}`,
    clean(f.sizes) && `${LABELS.sizes}: ${clean(f.sizes)}`,
    clean(f.colors) && `${LABELS.colors}: ${clean(f.colors)}`,
    (f.note ?? "").trim().slice(0, 1000),
  ].filter(Boolean).join("\n");
}

/** Текст «мех» / «подкладка» из ТЗ: первая строка, без заглушек («нет», «-», null) и без скобок с деньгами. */
export function supplierSafeText(v: string | null | undefined, max = 80): string | null {
  let t = (v ?? "").split(/\r?\n/)[0] ?? "";
  t = t.replace(/\([^)]*(?:сырьё подрядчика|\/\s*ед|руб|₽|цен)[^)]*\)/gi, "").replace(/\s+/g, " ").trim();
  if (!t || /^(нет|null|-|—|1|2|3|4|5|6|7|8|9)$/i.test(t) || PRICEY.test(t)) return null;
  return t.slice(0, max);
}
