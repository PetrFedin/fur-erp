/**
 * Все 159 записей FinishedGoodsMovement PRODUCTION_IN («Приход
 * (производство)») созданы массовым импортом реестра 25.09.2026 — эта дата
 * это день импорта, а не день фактического прихода/выпуска (у ТЗ вообще нет
 * даты завершения). Владелец: «это неправда — у нас приходит оповещение об
 * отгрузке». Записи не удаляем (на них держится остаток и себестоимость
 * готовой продукции), а помечаем в notes, чтобы интерфейс не показывал их
 * как реальные движения. Идемпотентно: трогает только строки без notes.
 *
 * Run with: node --env-file=.env node_modules/.bin/tsx scripts/mark-imported-fg-movements.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const MARK = "Импорт из реестра: фактическая дата прихода неизвестна";

async function main() {
  const r = await prisma.finishedGoodsMovement.updateMany({
    where: { type: "PRODUCTION_IN", notes: null, date: { lt: new Date("2026-09-26T00:00:00Z") } },
    data: { notes: MARK },
  });
  console.log(`Помечено записей: ${r.count}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
