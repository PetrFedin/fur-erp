/** Один лист: артикулы, полученные сверх объёма ТЗ (приход MVST против ТЗ в системе). node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/report-over-tz-2026-10-28.ts <файл.xlsx> */
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
  const models = await p.productModel.findMany({ where: { organizationId: org.id }, select: { id: true, name: true, salesCode: true, aliases: true, productionOrders: { where: { status: { not: "CANCELLED" } }, select: { number: true, color: true, size: true, plannedQuantity: true, producedQuantity: true, status: true, endDate: true }, orderBy: { number: "asc" } } } });
  const keyOf = new Map<string, string>();
  for (const m of models) for (const k of [m.name, m.salesCode, ...(m.aliases || [])]) if (k) { keyOf.set(N(k), m.id); const b = N(k.split(/[ /+]/)[0]); if (!keyOf.has(b)) keyOf.set(b, m.id); }
  const rc = await p.salesReceiptLine.findMany({ where: { organizationId: org.id, kind: "RECEIPT" }, select: { article: true, modelCode: true, date: true, pcs: true, orderNo: true }, orderBy: { date: "asc" } });
  const byModel = new Map<string, typeof rc>();
  for (const r of rc) { const id = keyOf.get(N(r.modelCode || "")) ?? keyOf.get(N(r.article.split(/[ /+]/)[0])); if (id) (byModel.get(id) ?? byModel.set(id, []).get(id)!).push(r); }
  const MAP: Record<string, string[]> = { BGL: ["блэкглама", "чёрн", "черн"], BLACK: ["чёрн", "черн"], BROWN: ["коричнев"], LVD: ["лаванд"], IRIS: ["ирис"], PEARL: ["жемчуг", "перл", "беж"], BORDEAUX: ["бордов"], WHITE: ["бел"], TORTORA: ["беж", "тортора"], NATURAL: ["коричнев", "натурал"] };
  const ruOf = (art: string) => { const t = art.toUpperCase(); return [...new Set(Object.entries(MAP).filter(([k]) => t.includes(k)).flatMap(([, v]) => v))]; };
  const sizeTokens = (s: string | null) => (s ?? "").replace(/единый размер/gi, "NS").split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean).map((x) => (/^(ns|един)/i.test(x) ? "NS" : x));
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Сверх ТЗ");
  ws.addRow(["16 шт., полученных сверх объёма ТЗ (на 28.10.2026): по артикулам и размерам. Разница = заказано MVST по размеру − в ТЗ по размеру (чего не хватает в ТЗ). Размеры берутся из отчёта MVST: в файле прихода размеров нет, а «пришло» по размерам в отчёте меньше, чем в файле прихода."]);
  ws.addRow([]);
  ws.addRow(["Артикул", "Размер", "В каких ТЗ (номер: шт.)", "В ТЗ, шт.", "Заказано MVST, шт.", "Пришло (отчёт), шт.", "Разница: заказано − в ТЗ", "Пришло сверх ТЗ (по файлу прихода)"]);
  let tot = 0, totCost = 0;
  const bold: number[] = [];
  for (const m of models) {
    const lines = byModel.get(m.id) || [];
    const tzs = m.productionOrders;
    const Q = tzs.reduce((a, o) => a + (o.status === "COMPLETED" ? Number(o.producedQuantity) : Number(o.plannedQuantity)), 0);
    const R = lines.reduce((a, r) => a + (r.pcs || 0), 0);
    if (R <= Q) continue;
    const unit = costs.get(normCode(m.name))?.unitIncl ?? null;
    let cum = 0;
    const per = new Map<string, { over: number; dates: Set<string>; got: number }>();
    for (const r of lines) { const q = r.pcs || 0, before = cum; cum += q; const ex = q > 0 ? Math.max(0, Math.min(q, cum - Math.max(Q, before))) : 0; const e = per.get(r.article) ?? { over: 0, dates: new Set<string>(), got: 0 }; e.got += q; if (ex > 0) { e.over += ex; e.dates.add(r.date.toISOString().slice(0, 10)); } per.set(r.article, e); }
    for (const [art, e] of per) {
      if (e.over <= 0) continue;
      const ru = ruOf(art);
      const colorTz = tzs.filter((o) => ru.some((t) => (o.color || "").toLowerCase().includes(t)));
      const useTz = colorTz.length ? colorTz : tzs;
      const colorName = ru.length ? `${art.split("/").slice(1).join("/").trim()} (${[...new Set(useTz.map((o) => o.color).filter(Boolean))].join(", ") || "—"})` : art.split("/").slice(1).join("/").trim() || art;
      const tzBy = new Map<string, { n: number; docs: string[] }>();
      for (const o of useTz) {
        const toks = sizeTokens(o.size), qty = o.status === "COMPLETED" ? Number(o.producedQuantity) : Number(o.plannedQuantity);
        const list = toks.length === qty ? toks : toks.length === 1 ? Array(qty).fill(toks[0]) : Array(qty).fill("не указан");
        const c = new Map<string, number>(); for (const t of list) c.set(t, (c.get(t) ?? 0) + 1);
        for (const [t, n] of c) { const x = tzBy.get(t) ?? { n: 0, docs: [] }; x.n += n; x.docs.push(`${o.number}: ${n}`); tzBy.set(t, x); }
      }
      const repBy = new Map<string, { conf: number; deliv: number }>();
      for (const r of rep.filter((r) => r.acode === art)) { const k = /^(ns|един)/i.test(String(r.size)) ? "NS" : String(r.size); const x = repBy.get(k) ?? { conf: 0, deliv: 0 }; x.conf += r.conf || 0; x.deliv += r.deliv || 0; repBy.set(k, x); }
      const sizes = [...new Set([...tzBy.keys(), ...repBy.keys()])].sort((a, b) => (Number(a) || 999) - (Number(b) || 999) || a.localeCompare(b));
      const cost = unit ? Math.round(e.over * unit) : null;
      tot += e.over; if (cost) totCost += cost;
      const hr = ws.addRow([art + (colorName && !art.includes(colorName) ? ` — ${colorName}` : ""), "итого", `ТЗ: ${useTz.length ? useTz.map((o) => o.number).join(", ") : "нет"}`, [...tzBy.values()].reduce((a, x) => a + x.n, 0), [...repBy.values()].reduce((a, x) => a + x.conf, 0), [...repBy.values()].reduce((a, x) => a + x.deliv, 0), "", `${e.over} шт., ${[...e.dates].join(", ")}`]);
      hr.font = { bold: true }; hr.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFEFEF" } };
      for (const sz of sizes) {
        const t = tzBy.get(sz), r = repBy.get(sz), inTz = t?.n ?? 0, dl = r?.deliv ?? 0, cf = r?.conf ?? 0;
        const over = Math.max(0, dl - inTz);
        const where = tzs.length === 0 ? "ТЗ на модель нет" : over > 0 ? (inTz === 0 ? `размера ${sz} нет ни в одном ТЗ` : `пришло ${dl}, в ТЗ ${inTz}`) : (cf > inTz && cf > 0 ? `заказано MVST ${cf}, в ТЗ ${inTz}: ТЗ не хватает на ${cf - inTz}` : "");
        const row = ws.addRow(["", sz, t ? t.docs.join("; ") : "в ТЗ нет", inTz, cf, dl, cf - inTz > 0 ? cf - inTz : ""]);
        if (cf - inTz > 0) row.getCell(7).font = { bold: true, color: { argb: "FFB00020" } };
      }
    }
  }
  ws.addRow([]);
  const total = ws.addRow(["ИТОГО сверх ТЗ", "", "", "", "", "", "", `${tot} шт.`]); total.font = { bold: true };
  ws.getRow(1).alignment = { wrapText: true, vertical: "top" }; ws.mergeCells(1, 1, 1, 8); ws.getRow(1).height = 60;
  ws.getRow(3).font = { bold: true }; ws.getRow(3).alignment = { wrapText: true };
  [40, 10, 60, 10, 16, 16, 18, 28].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  ws.getColumn(3).alignment = { wrapText: true, vertical: "top" };
  ws.views = [{ state: "frozen", ySplit: 3 }];
  await wb.xlsx.writeFile(process.argv[2]);
  console.log("сверх ТЗ шт.", tot, "сумма", totCost);
  await p.$disconnect();
})();
