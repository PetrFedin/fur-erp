/** Один лист: артикулы, полученные сверх объёма ТЗ по цвету (приход MVST против ТЗ). Размеры: пришедшие размеры — по отчёту MVST, остаток раскладывается по размерам ТЗ.
 *  node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/report-over-tz-2026-10-28.ts <файл.xlsx> */
import "./stubs/server-only-shim";
(async () => {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const { loadModelCosts } = await import("../src/lib/margin-server");
  const { normCode } = await import("../src/lib/sales-receipts-core");
  const ExcelJS = (await import("exceljs")).default;
  const p = createAuditedClient("script:report-over-tz");
  const org = await p.organization.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
  const N = (s: string) => s.replace(/[-\s_/.]/g, "").toUpperCase();
  const costs = await loadModelCosts(org.id, "on" as never);
  const st: any = await p.systemState.findFirst({ where: { key: "sales-report-sizes:2026-10-27" } });
  const rep = st.value.rows as any[];
  const models = await p.productModel.findMany({ where: { organizationId: org.id }, select: { id: true, name: true, salesCode: true, aliases: true, productionOrders: { where: { status: { not: "CANCELLED" } }, select: { number: true, color: true, size: true, plannedQuantity: true, producedQuantity: true, status: true }, orderBy: { number: "asc" } } } });
  const keyOf = new Map<string, string>();
  for (const m of models) for (const k of [m.name, m.salesCode, ...(m.aliases || [])]) if (k) { keyOf.set(N(k), m.id); const b = N(k.split(/[ /+]/)[0]); if (!keyOf.has(b)) keyOf.set(b, m.id); }
  const rc = await p.salesReceiptLine.findMany({ where: { organizationId: org.id, kind: "RECEIPT" }, select: { article: true, modelCode: true, date: true, pcs: true }, orderBy: { date: "asc" } });
  const MAP: Record<string, string[]> = { BGL: ["блэкглама", "чёрн", "черн"], BLACK: ["чёрн", "черн"], BROWN: ["коричнев"], LVD: ["лаванд"], IRIS: ["ирис"], PEARL: ["жемчуг", "перл", "беж"], BORDEAUX: ["бордов"], WHITE: ["бел"], TORTORA: ["беж", "тортора"], NATURAL: ["коричнев", "натурал"] };
  const ruOf = (art: string) => [...new Set(Object.entries(MAP).filter(([k]) => art.toUpperCase().includes(k)).flatMap(([, v]) => v))];
  const tok = (s: string | null) => (s ?? "").replace(/единый размер/gi, "NS").split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean).map((x) => (/^(ns|един)/i.test(x) ? "NS" : x));
  const sortSz = (a: string, b: string) => (Number(a) || 999) - (Number(b) || 999) || a.localeCompare(b);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Сверх ТЗ");
  ws.addRow(["Полученное сверх ТЗ по артикулу и цвету (на 28.10.2026). Сверх ТЗ = пришло по артикулу − объём ТЗ этого цвета, если больше нуля. Разница только в размере — не сверх: пришедшие размеры вписаны как пришли (по отчёту MVST), остаток прихода без известного размера положен на свободные размеры ТЗ. Размеров в файле прихода нет."]);
  ws.addRow([]);
  ws.addRow(["Артикул / размер", "В каких ТЗ (номер: шт.)", "В ТЗ, шт.", "Пришло, шт.", "Разница (пришло − в ТЗ)", "Когда пришло сверх", "Стоимость сверх ТЗ, ₽ с НДС"]);
  let tot = 0, totCost = 0;
  for (const m of models) {
    const lines = rc.filter((r) => (keyOf.get(N(r.modelCode || "")) ?? keyOf.get(N(r.article.split(/[ /+]/)[0]))) === m.id);
    if (!lines.length) continue;
    const unit = costs.get(normCode(m.name))?.unitIncl ?? null;
    const arts = new Map<string, typeof lines>();
    for (const r of lines) (arts.get(r.article) ?? arts.set(r.article, []).get(r.article)!).push(r);
    for (const [art, ls] of arts) {
      const ru = ruOf(art);
      const colorTz = m.productionOrders.filter((o) => ru.some((t) => (o.color || "").toLowerCase().includes(t)));
      const useTz = ru.length && colorTz.length ? colorTz : m.productionOrders;
      const qtyOf = (o: (typeof useTz)[number]) => (o.status === "COMPLETED" ? Number(o.producedQuantity) : Number(o.plannedQuantity));
      const tzQty = useTz.reduce((a, o) => a + qtyOf(o), 0);
      const got = ls.reduce((a, r) => a + (r.pcs || 0), 0);
      const over = Math.max(0, got - tzQty);
      if (over <= 0) continue;
      const lastDates = new Set<string>(); { let c = 0; for (const r of ls) { const q = r.pcs || 0, b = c; c += q; if (q > 0 && c > Math.max(tzQty, b)) lastDates.add(r.date.toISOString().slice(0, 10)); } }
      const tzBy = new Map<string, { n: number; docs: string[] }>();
      for (const o of useTz) { const q = qtyOf(o), t = tok(o.size); const list = t.length === q ? t : t.length === 1 ? Array(q).fill(t[0]) : Array(q).fill("не указан"); const c = new Map<string, number>(); for (const x of list) c.set(x, (c.get(x) ?? 0) + 1); for (const [x, n] of c) { const e = tzBy.get(x) ?? { n: 0, docs: [] }; e.n += n; e.docs.push(`${o.number}: ${n}`); tzBy.set(x, e); } }
      const arrived = new Map<string, number>();
      for (const r of rep.filter((r) => r.acode === art)) { const k = /^(ns|един)/i.test(String(r.size)) ? "NS" : String(r.size); arrived.set(k, (arrived.get(k) ?? 0) + (r.deliv || 0)); }
      let known = [...arrived.values()].reduce((a, x) => a + x, 0);
      if (known > got) { // отчёт полнее файла прихода (редко): режем с конца
        let cut = known - got; for (const k of [...arrived.keys()].reverse()) { const d = Math.min(cut, arrived.get(k)!); arrived.set(k, arrived.get(k)! - d); cut -= d; if (!cut) break; } known = got;
      }
      let rest = got - known; const unk: string[] = [];
      const sizes = [...new Set([...tzBy.keys(), ...arrived.keys()])].sort(sortSz);
      const shown = new Map<string, number>(arrived);
      for (const k of [...tzBy.keys()].sort(sortSz)) { const free = Math.max(0, (tzBy.get(k)?.n ?? 0) - (shown.get(k) ?? 0)); const take = Math.min(free, rest); if (take > 0) { shown.set(k, (shown.get(k) ?? 0) + take); rest -= take; } }
      const cost = unit ? Math.round(over * unit) : null;
      tot += over; if (cost) totCost += cost;
      const colorName = art.split("/").slice(1).join("/").trim();
      const hr = ws.addRow([`${art}${ru.length && useTz.length ? ` (${[...new Set(useTz.map((o) => o.color).filter(Boolean))].join(", ")})` : ""}`, useTz.length ? useTz.map((o) => o.number).join(", ") : "ТЗ на модель нет", tzQty, got, `+${over}`, [...lastDates].join(", "), cost ?? "нет себестоимости"]);
      hr.font = { bold: true }; hr.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFEFEF" } };
      for (const k of sizes) {
        const t = tzBy.get(k)?.n ?? 0, a = shown.get(k) ?? 0;
        if (t === 0 && a === 0) continue;
        const row = ws.addRow([`   размер ${k}`, tzBy.get(k) ? tzBy.get(k)!.docs.join("; ") : "в ТЗ этого размера нет", t, a, a - t === 0 ? "" : a - t > 0 ? `+${a - t}` : `${a - t}`]);
        if (a > t) row.getCell(5).font = { bold: true, color: { argb: "FFB00020" } };
      }
      if (rest > 0) { const row = ws.addRow(["   размер неизвестен (пришло сверх всех размеров ТЗ)", "", 0, rest, `+${rest}`]); row.getCell(5).font = { bold: true, color: { argb: "FFB00020" } }; }
      void colorName; void unk;
    }
  }
  ws.addRow([]);
  const total = ws.addRow(["ИТОГО сверх ТЗ (по артикулу и цвету)", "", "", "", `+${tot}`, "", totCost]); total.font = { bold: true };
  ws.addRow(["Примечание: на Главной «получено сверх ТЗ» 16 шт. считается по модели целиком: у M012 по другим цветам ТЗ получены не полностью (−1), поэтому там 6, а здесь по цвету BGL 7. Деньги здесь по цвету, на Главной по модели."]);
  ws.getRow(1).alignment = { wrapText: true, vertical: "top" }; ws.mergeCells(1, 1, 1, 7); ws.getRow(1).height = 75;
  ws.getRow(3).font = { bold: true }; ws.getRow(3).alignment = { wrapText: true };
  [48, 60, 10, 12, 18, 20, 22].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  ws.getColumn(2).alignment = { wrapText: true, vertical: "top" };
  ws.views = [{ state: "frozen", ySplit: 3 }];
  await wb.xlsx.writeFile(process.argv[2]);
  console.log("сверх ТЗ шт.", tot, "сумма", totCost);
  await p.$disconnect();
})();
