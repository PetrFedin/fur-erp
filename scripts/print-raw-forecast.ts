import "./stubs/server-only-shim";
import { PrismaClient } from "@prisma/client";
(async () => {
  const org = (await new PrismaClient().organization.findFirst())!.id;
  const { loadRawForecast } = await import("../src/lib/raw-forecast");
  const r = await loadRawForecast(org);
  console.log(r.asOf, r.leftPcs);
  for (const f of r.furs) console.log(f.fur, "остаток", Math.round(f.stock), "нужно", Math.round(f.need), "итог", Math.round(f.rest), "арт.", f.articles.length);
  console.log("без данных", JSON.stringify(r.noData));
  process.exit(0);
})();
