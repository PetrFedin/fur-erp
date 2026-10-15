// Перенос «параметров артикула» из SystemState (`article-params:<id>`) в колонку ProductModel.attributes.
// Нужен, если параметры появились в SystemState уже после миграции 20261026090000_product_model_attributes (она делает тот же перенос один раз).
// По умолчанию пробный прогон: только печатает, что будет перенесено. Идемпотентно: заполненное поле не перезаписывается.
//   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/migrate-article-params.ts            # пробный
//   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/migrate-article-params.ts --apply    # записать
//   ... --apply --delete-legacy   # дополнительно удалить перенесённые записи SystemState
import "./stubs/server-only-shim";
import { PrismaClient } from "@prisma/client";
import { PARAM_KEY_PREFIX, readParams } from "../src/lib/article-params";

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");
const delLegacy = process.argv.includes("--delete-legacy");

(async () => {
  const rows = await prisma.systemState.findMany({ where: { key: { startsWith: PARAM_KEY_PREFIX } }, select: { id: true, organizationId: true, key: true, value: true } });
  let moved = 0, kept = 0, empty = 0, missing = 0;
  for (const r of rows) {
    const id = r.key.slice(PARAM_KEY_PREFIX.length);
    const params = readParams(r.value);
    const m = await prisma.productModel.findFirst({ where: { id, organizationId: r.organizationId }, select: { id: true, name: true, attributes: true } });
    if (!m) { missing++; console.log(`  ? нет артикула ${id}`); continue; }
    if (!params.length) { empty++; continue; }
    if (m.attributes !== null) { kept++; console.log(`  = ${m.name}: поле уже заполнено, не трогаю`); if (apply && delLegacy) await prisma.systemState.delete({ where: { id: r.id } }); continue; }
    console.log(`  + ${m.name}: ${params.map((p) => `${p.name}=${p.value}`).join("; ")}`);
    moved++;
    if (apply) {
      await prisma.productModel.update({ where: { id: m.id }, data: { attributes: params } });
      if (delLegacy) await prisma.systemState.delete({ where: { id: r.id } });
    }
  }
  console.log(`${apply ? "ПЕРЕНЕСЕНО" : "ПРОБНЫЙ ПРОГОН (ничего не записано)"}: переносится ${moved}, уже заполнено ${kept}, пустых ${empty}, без артикула ${missing}`);
  await prisma.$disconnect();
})();
