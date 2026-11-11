/**
 * Пересборка единой витрины данных (dm_*) по организации и печать контрольных сумм.
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/mart-refresh.ts
 */
import "./stubs/server-only-shim";

(async () => {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const { buildMart } = await import("../src/lib/mart/build");
  const db = createAuditedClient("script:mart-refresh");
  const org = (await db.organization.findFirstOrThrow({ orderBy: { createdAt: "asc" } })).id;
  const t0 = Date.now();
  const s = await buildMart(db as never, org);
  console.log(`Витрина пересобрана за ${((Date.now() - t0) / 1000).toFixed(1)} с: изделий ${s.skus}, партий ${s.parties}, движений ${s.movements}`);
  for (const c of s.checks) console.log(`${c.status === "ok" ? "OK  " : c.status === "fail" ? "FAIL" : c.status.toUpperCase().padEnd(4)} ${c.label}: ожидалось ${c.expected === null ? "—" : Math.round(c.expected).toLocaleString("ru-RU")}, получилось ${c.actual === null ? "—" : Math.round(c.actual).toLocaleString("ru-RU")}${c.note ? " · " + c.note : ""}`);
  process.exit(s.checks.some((c) => c.status === "fail") ? 2 : 0);
})().catch((e) => { console.error(String(e).slice(0, 1200)); process.exit(1); });
