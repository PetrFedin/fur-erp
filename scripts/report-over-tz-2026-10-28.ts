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
  const models = await p.productModel.findMany({ where: { organizationId: org.id }, select: { id: true, name: true, salesCode: true, aliases: true, productionOrders: { where: { status: { not: "CANCELLED" } }, select: { number: true, color: true, plannedQuantity: true, producedQuantity: true, status: true, endDate: true }, orderBy: { number: "asc" } } } });
  const keyOf = new Map<string, string>();
  for (const m of models) for (const k of [m.name, m.salesCode, ...(m.aliases || [])]) if (k) { keyOf.set(N(k), m.id); const b = N(k.split(/[ /+]/)[0]); if (!keyOf.has(b)) keyOf.set(b, m.id); }
  const rc = await p.salesReceiptLine.findMany({ where: { organizationId: org.id, kind: "RECEIPT" }, select: { article: true, modelCode: true, date: true, pcs: true, orderNo: true }, orderBy: { date: "asc" } });
  const byModel = new Map<string, typeof rc>();
  for (const r of rc) { const id = keyOf.get(N(r.modelCode || "")) ?? keyOf.get(N(r.article.split(/[ /+]/)[0])); if (id) (byModel.get(id) ?? byModel.set(id, []).get(id)!).push(r); }
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Сверх ТЗ");
  ws.addRow(["Получено сверх объёма ТЗ (приход MVST 2025–2026 против ТЗ в системе, на 28.10.2026). «Сверх» = приход последних по дате строк после того, как набран объём ТЗ модели. Стоимость = шт. × средняя себестоимость единицы модели (с НДС). Размеров в файле прихода нет — размеры из отчёта MVST «Total – Custom Report» 27.10."]);
  ws.addRow([]);
  const head = ["Артикул", "Цвет", "Размеры: заказано MVST / пришло (по отчёту)", "В каких ТЗ (номер, цвет, шт.)", "Объём ТЗ по модели, шт.", "Получено по модели, шт.", "Получено по артикулу, шт.", "Сверх ТЗ, шт.", "Когда пришло сверх", "Стоимость сверх ТЗ, ₽ с НДС", "Комментарий"];
  ws.addRow(head);
  let tot = 0, totCost = 0;
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
    const tzText = tzs.length ? tzs.map((o) => `${o.number} (${o.color || "—"}, ${o.status === "COMPLETED" ? Number(o.producedQuantity) : Number(o.plannedQuantity)})`).join("; ") : "ТЗ на модель нет";
    for (const [art, e] of per) {
      if (e.over <= 0) continue;
      const color = art.split("/").slice(1).join("/").trim() || art;
      const sizes = rep.filter((r) => r.acode === art).map((r) => `${r.size}: ${r.conf || 0}/${r.deliv || 0}`).join("; ") || "нет в отчёте";
      const cost = unit ? Math.round(e.over * unit) : null;
      tot += e.over; if (cost) totCost += cost;
      ws.addRow([art, color, sizes, tzText, Q, R, e.got, e.over, [...e.dates].join(", "), cost ?? "нет себестоимости", tzs.length === 0 ? "ТЗ на модель нет совсем; аналог по ткани — M038" : "приход больше объёма ТЗ модели: заводить ТЗ или уточнить"]);
    }
  }
  ws.addRow([]);
  ws.addRow(["ИТОГО", "", "", "", "", "", "", tot, "", totCost]);
  ws.getRow(1).alignment = { wrapText: true, vertical: "top" }; ws.mergeCells(1, 1, 1, 11); ws.getRow(1).height = 48;
  ws.getRow(3).font = { bold: true }; ws.getRow(ws.rowCount).font = { bold: true };
  [28, 22, 44, 70, 14, 14, 14, 12, 18, 20, 52].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  ws.getColumn(4).alignment = ws.getColumn(3).alignment = { wrapText: true, vertical: "top" };
  ws.views = [{ state: "frozen", ySplit: 3 }];
  await wb.xlsx.writeFile(process.argv[2]);
  console.log("сверх ТЗ шт.", tot, "сумма", totCost);
  await p.$disconnect();
})();
