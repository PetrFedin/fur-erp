import "./stubs/server-only-shim";
(async () => {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const db = createAuditedClient("script:stock-diff");
  const { loadReportSizesState } = await import("../src/lib/import-keys");
  const { leafKeyOf } = await import("../src/lib/fw26-plan");
  const org = (await db.organization.findFirstOrThrow({ orderBy: { createdAt: "asc" } })).id;
  const cur = await loadReportSizesState(org, db);
  const v = cur!.value as { rows: { acode: string; color: string; size: string; stock: number; deliv: number; sold: number }[] };
  console.log("версия", cur!.key, "строк", v.rows.length);
  const rep = new Map<string, { stock: number; deliv: number; sold: number; name: string }>();
  for (const r of v.rows) { const k = leafKeyOf(r.acode, r.color); const a = rep.get(k) ?? { stock: 0, deliv: 0, sold: 0, name: r.acode + " · " + r.color }; a.stock += r.stock; a.deliv += r.deliv; a.sold += r.sold; rep.set(k, a); }
  const lines = await db.salesReceiptLine.findMany({ where: { organizationId: org }, select: { kind: true, article: true, colorId: true, pcs: true } });
  const app = new Map<string, { rec: number; sale: number; name: string }>();
  for (const l of lines) { const k = leafKeyOf(l.article, l.colorId); const a = app.get(k) ?? { rec: 0, sale: 0, name: l.article + " · " + (l.colorId ?? "") }; if (l.kind === "RECEIPT") a.rec += l.pcs ?? 0; else a.sale += l.pcs ?? 0; app.set(k, a); }
  let sRep = 0, sApp = 0, dRep = 0, dApp = 0, soRep = 0, soApp = 0;
  const out: string[] = [];
  for (const k of new Set([...rep.keys(), ...app.keys()])) {
    const r = rep.get(k), a = app.get(k);
    const rs = r?.stock ?? 0, as = (a?.rec ?? 0) - (a?.sale ?? 0);
    sRep += rs; sApp += as; dRep += r?.deliv ?? 0; dApp += a?.rec ?? 0; soRep += r?.sold ?? 0; soApp += a?.sale ?? 0;
    if (rs !== as || (r?.deliv ?? 0) !== (a?.rec ?? 0) || (r?.sold ?? 0) !== (a?.sale ?? 0)) out.push(`${(r?.name ?? a?.name)} | отчёт: пост ${r?.deliv ?? 0} прод ${r?.sold ?? 0} ост ${rs} | файл: пост ${a?.rec ?? 0} прод ${a?.sale ?? 0} ост ${as}`);
  }
  console.log(`Σ остаток отчёт ${sRep} · файл ${sApp}; Σ поступило отчёт ${dRep} · файл ${dApp}; Σ продано отчёт ${soRep} · файл ${soApp}`);
  console.log(out.length + " расхождений:"); out.forEach((s) => console.log(" - " + s));
  process.exit(0);
})();
