import Module from "module";
import { join } from "path";
const M = Module as unknown as { _resolveFilename: (...a: unknown[]) => string };
const o = M._resolveFilename;
M._resolveFilename = function (this: unknown, r: unknown, ...x: unknown[]) { if (r === "server-only") return join(__dirname, "stubs", "empty.js"); return o.call(this, r, ...x); };
(async () => {
  const { PrismaClient } = await import("@prisma/client");
  const { loadVerifyModel } = await import("@/lib/verification");
  const prisma = new PrismaClient();
  const org = await prisma.organization.findFirst();
  const m = await loadVerifyModel(prisma, org!.id, { c4Mode: "off" });
  const want = process.argv.slice(2);
  for (const r of m.rows) {
    if (want.some((w) => r.key.startsWith(w) || r.title.includes(w) || (r.sub ?? "").includes(w) || (r.group ?? "") === w)) console.log(r.key, r.title, r.ready, "\n   ", r.blockers.map((b) => b.text).join("\n    "));
  }
  const cnt: Record<string, number> = {};
  for (const r of m.rows) for (const b of r.blockers) { const k = r.kind + ": " + b.text.replace(/\d[\d\s,.]*/g, "N").slice(0, 70); cnt[k] = (cnt[k] ?? 0) + 1; }
  if (!want.length) console.log(Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 45));
  await prisma.$disconnect();
})();
