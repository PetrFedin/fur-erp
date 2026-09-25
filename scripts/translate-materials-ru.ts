/**
 * The FW26 purchase report (an international auction document) is in
 * English; scripts/import-fw26.ts used its fur descriptions verbatim as
 * RawMaterial names. Renames them to Russian, matching every other
 * material in the system, while keeping the auction grading codes
 * (size class XXL/XL, silvering grade SIL.1-6, color/quality class like
 * "2-1.1", finish codes REG/VELV1/VELV2/C1/C2/...) as-is: those are
 * international fur-trade notation that Russian traders use verbatim too
 * (see e.g. "SWAKARA NUT" already used untranslated in the historical
 * registry) — translating them would risk misrepresenting a real
 * commercial grading rather than just relabeling the material.
 *
 * Idempotent: renaming a name that no longer exists is a no-op.
 *
 * Run with: node --env-file=.env node_modules/.bin/tsx scripts/translate-materials-ru.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function translateSable(name: string): string {
  let rest = name.replace(/^Sable\s+wild raw Barguzinsky\s*/i, "").trim();
  const isSilvery = /^Silvery\b/i.test(rest);
  if (isSilvery) rest = rest.replace(/^Silvery\s*/i, "").trim();
  const prefix = isSilvery ? "Соболь баргузинский дикий серебристый сырец" : "Соболь баргузинский дикий сырец";
  return rest ? `${prefix} ${rest}` : prefix;
}

const EXPLICIT_MAP: Record<string, string> = {
  "AM. MINK BLACK M REG BLACK_ ROYB C1 VELV2": "Норка американская чёрная, самец, REG BLACK ROYB C1 VELV2",
  "AM. MINK BROWN M REG XD GOLD C1/2 VELV1": "Норка американская коричневая, самец, REG XD GOLD C1/2 VELV1",
  "BROWN M REG DK SR C2 VELV2": "Норка коричневая, самец, REG DK SR C2 VELV2",
  "Blue Iris mink F": "Норка голубой ирис, самка",
  "Pastel mink F": "Норка пастель, самка",
  "SWAKARA WHITE REG_FLAT_GOLD": "Свакара (каракуль) белая, REG FLAT GOLD",
  "SWAKARA WHITE REG_FLAT_PLAT": "Свакара (каракуль) белая, REG FLAT PLAT",
  "SWAKARA WHITE REG_FLAT_SILV": "Свакара (каракуль) белая, REG FLAT SILV",
  "lynx cat": "Рысь",
  // These four kept a Cyrillic С in "С1"/"С2" (copy-paste artifact from the
  // source spreadsheet), which made the "contains Cyrillic" check used to
  // find translation candidates miss them on the first pass.
  "MINK BROWN F REG DK SR С1 VELV1": "Норка коричневая, самка, REG DK SR C1 VELV1",
  "MINK BROWN F REG DK SR С2 VELV1": "Норка коричневая, самка, REG DK SR C2 VELV1",
  "MINK BROWN F REG MED SR С2 VELV1": "Норка коричневая, самка, REG MED SR C2 VELV1",
  "MINK BROWN M REG XD SAGA C2 LNAP (+ под роспуск)": "Норка коричневая, самец, REG XD SAGA C2 LNAP (+ под роспуск)",
};

async function main() {
  const materials = await prisma.rawMaterial.findMany({ select: { id: true, name: true } });
  let renamed = 0;

  for (const m of materials) {
    let translated: string | null = null;
    if (m.name in EXPLICIT_MAP) {
      translated = EXPLICIT_MAP[m.name];
    } else if (/^Sable\s+wild raw Barguzinsky/i.test(m.name)) {
      translated = translateSable(m.name);
    }
    if (translated && translated !== m.name) {
      await prisma.rawMaterial.update({ where: { id: m.id }, data: { name: translated } });
      renamed++;
    }
  }
  console.log(`Translated ${renamed} material names to Russian.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
