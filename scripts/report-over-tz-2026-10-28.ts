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
  ws.addRow(["Получено сверх объёма ТЗ: по артикулу, цвету и размеру (приход MVST 2025–2026 против ТЗ в системе, на 28.10.2026). Приход по размерам в файле прихода не указан, поэтому по размерам взят отчёт MVST «Total – Custom Report» 27.10 (Conf — заказано, Delivery — пришло). Размеры ТЗ — из поля «Размер» ТЗ (по одному на изделие). «Сверх ТЗ» по размеру = пришло по отчёту − в ТЗ, если больше нуля. Итог по артикулу — по файлу прихода: он полнее отчёта (в отчёте «пришло» по размерам меньше, чем в файле прихода, поэтому 16 шт. сверх ТЗ видны в строке артикула, а по размерам главный сигнал — колонка «Где именно больше»: сколько заказал MVST и чего не хватает в ТЗ)."]);
  ws.addRow([]);
  ws.addRow(["Артикул", "Цвет", "Размер", "В каких ТЗ (номер: шт. этого размера)", "В ТЗ, шт.", "Заказано MVST (отчёт), шт.", "Пришло (отчёт), шт.", "Сверх ТЗ, шт.", "Где именно больше, чем в ТЗ", "Когда пришло сверх (по файлу прихода)", "Стоимость сверх ТЗ, ₽ с НДС"]);
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
      const hr = ws.addRow([art, colorName, "", `ТЗ модели: ${useTz.length ? useTz.map((o) => o.number).join(", ") : "нет"}`, [...tzBy.values()].reduce((a, x) => a + x.n, 0), [...repBy.values()].reduce((a, x) => a + x.conf, 0), [...repBy.values()].reduce((a, x) => a + x.deliv, 0), e.over, "итого по артикулу (по файлу прихода)", [...e.dates].join(", "), cost ?? "нет себестоимости"]);
      hr.font = { bold: true }; hr.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFEFEF" } };
      for (const sz of sizes) {
        const t = tzBy.get(sz), r = repBy.get(sz), inTz = t?.n ?? 0, dl = r?.deliv ?? 0, cf = r?.conf ?? 0;
        const over = Math.max(0, dl - inTz);
        const where = tzs.length === 0 ? "ТЗ на модель нет" : over > 0 ? (inTz === 0 ? `размера ${sz} нет ни в одном ТЗ` : `пришло ${dl}, в ТЗ ${inTz}`) : (cf > inTz && cf > 0 ? `заказано MVST ${cf}, в ТЗ ${inTz}: ТЗ не хватает на ${cf - inTz}` : "");
        const row = ws.addRow(["", "", sz, t ? t.docs.join("; ") : "в ТЗ этого размера нет", inTz, cf, dl, over || "", where]);
        if (over > 0) row.getCell(8).font = row.getCell(9).font = { bold: true, color: { argb: "FFB00020" } };
      }
    }
  }
  ws.addRow([]);
  const total = ws.addRow(["ИТОГО по файлу прихода", "", "", "", "", "", "", tot, "", "", totCost]); total.font = { bold: true };
  ws.getRow(1).alignment = { wrapText: true, vertical: "top" }; ws.mergeCells(1, 1, 1, 11); ws.getRow(1).height = 96;
  ws.getRow(3).font = { bold: true }; ws.getRow(3).alignment = { wrapText: true };
  [30, 30, 10, 62, 10, 14, 12, 10, 40, 20, 20].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  ws.getColumn(4).alignment = { wrapText: true, vertical: "top" };
  ws.views = [{ state: "frozen", ySplit: 3 }];
  await wb.xlsx.writeFile(process.argv[2]);
  console.log("сверх ТЗ шт.", tot, "сумма", totCost);
  await p.$disconnect();
})();
