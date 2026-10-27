// Презентация закупки FW27/28 («MVST FUR RUS FW27.pdf»): фото моделей по слайдам и штуки «N pcs». Чистые функции (без базы) — для сверки с планом Budget PCS.
export type Fw27Item = { id: string; file: string; pcs: number | null; pcsText: string | null; caption: string | null; /** Версия фото: метка времени замены (сброс кэша браузера). */ v?: number };
export type Fw27Slide = { page: number; title: string; kind: "CO" | "NEW" | null; fur: string | null; cat: string | null; len: "Short" | "Regular" | "Long" | null; lenInherited?: boolean; items: Fw27Item[] };
export type Fw27Data = { source: string; asOf: string; slides: Fw27Slide[] };
export const FW27_STATE = "fw27-presentation";
export const LEN_LABEL: Record<string, string> = { Short: "Short", Regular: "Regular", Long: "Long" };
export const photoSrc = (it: { file: string; v?: number }) => `/api/fw27-photo/${it.file}${it.v ? `?v=${it.v}` : ""}`;
export const KIND_LABEL: Record<string, string> = { CO: "CO (прошлые модели)", NEW: "Новые модели" };

export type Crit = { fur?: string; cat?: string; len?: string };
/** Слайды под узел плана: мех и категория совпадают; слайд без длины относится ко всем длинам категории. */
export function slidesFor(d: Fw27Data | null, c: Crit): Fw27Slide[] {
  if (!d) return [];
  return d.slides.filter((s) => (!c.fur || s.fur === c.fur) && (!c.cat || s.cat === c.cat) && (!c.len || !s.len || s.len === c.len));
}
export const slidePcs = (s: Fw27Slide) => s.items.reduce((t, i) => t + (i.pcs ?? 0), 0);
export const photoCount = (slides: Fw27Slide[]) => slides.reduce((t, s) => t + s.items.length, 0);

export type PlanRow = { block: string; fur: string; cat: string; len: string; pcs: number };
export type CompareRow = { key: string; fur: string; cat: string; len: string | null; plan: number; file: number; photos: number; noNumber: number; sub: CompareRow[]; crit: Crit };
/** Сверка плана (RTW) с презентацией: по мех × категория, внутри — по длинам (где длина названа в слайде). */
export function compareWithPlan(d: Fw27Data | null, rows: PlanRow[]): CompareRow[] {
  if (!d) return [];
  const plan = rows.filter((r) => r.block === "RTW");
  const pairs: string[] = [];
  for (const k of [...d.slides.map((s) => (s.fur && s.cat ? `${s.fur}|${s.cat}` : "")), ...plan.map((r) => `${r.fur}|${r.cat}`)]) if (k && !pairs.includes(k)) pairs.push(k);
  const out: CompareRow[] = [];
  for (const k of pairs) {
    const [fur, cat] = k.split("|");
    const slides = d.slides.filter((s) => s.fur === fur && s.cat === cat);
    const planRows = plan.filter((r) => r.fur === fur && r.cat === cat);
    const planTotal = planRows.reduce((t, r) => t + r.pcs, 0);
    const fileTotal = slides.reduce((t, s) => t + slidePcs(s), 0);
    if (planTotal === 0 && fileTotal === 0 && slides.length === 0) continue;
    const lens = ["Short", "Regular", "Long"].filter((l) => planRows.some((r) => r.len === l && r.pcs > 0) || slides.some((s) => s.len === l));
    const subRow = (len: string | null): CompareRow => {
      const ss = slides.filter((s) => (len === null ? s.len === null : s.len === len));
      return { key: `${k}|${len ?? "–"}`, fur, cat, len, plan: len === null ? 0 : planRows.filter((r) => r.len === len).reduce((t, r) => t + r.pcs, 0), file: ss.reduce((t, s) => t + slidePcs(s), 0), photos: photoCount(ss), noNumber: ss.reduce((t, s) => t + s.items.filter((i) => i.pcs === null).length, 0), sub: [], crit: { fur, cat, ...(len ? { len } : {}) } };
    };
    const sub = [...lens.map(subRow), ...(slides.some((s) => s.len === null) ? [subRow(null)] : [])];
    out.push({ key: k, fur, cat, len: null, plan: planTotal, file: fileTotal, photos: photoCount(slides), noNumber: slides.reduce((t, s) => t + s.items.filter((i) => i.pcs === null).length, 0), sub, crit: { fur, cat } });
  }
  const order = ["Соболь", "Норка+Соболь", "Норка", "Лиса", "Каракульча", "Рысь"];
  return out.sort((a, b) => (order.indexOf(a.fur) + 1 || 99) - (order.indexOf(b.fur) + 1 || 99) || a.cat.localeCompare(b.cat, "ru"));
}
