/**
 * Закрывает в «Контроль → Задачи» те «Решения владельца», на которые документы дают однозначный ответ (запись в SystemState
 * `owner-decision:<id>`, как это делает кнопка «Решено» на странице; сами данные не меняются — ответ уже отражён в базе).
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/close-owner-decisions-2026-10-14.ts [--apply] [--rollback]
 * Пробный прогон по умолчанию; --apply: scripts/backup.sh, журнал docs-inventory/corrections-journal-owner-decisions-2026-10-14.json.
 * --rollback (с --apply) удаляет только записанные этим скриптом ответы.
 */
import "./stubs/server-only-shim";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DECISIONS, DECISION_KEY_PREFIX } from "../src/lib/task-docs-catalog";

const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
const JOURNAL = path.join(__dirname, "../docs-inventory/corrections-journal-owner-decisions-2026-10-14.json");
const WHO = "по документам (скрипт close-owner-decisions-2026-10-14)";

/** id решения → выбранный вариант и основание (только то, что подтверждено документами и текущим состоянием базы). */
const ANSWERS: Record<string, { choice: string; note: string }> = {
  "beaver-0063": {
    choice: "exclude",
    note: "Решение владельца 09.10.2026: бобр — сырьё подрядчика, не наша закупка и не наш долг. Письма №100, №271, №270, №272 (07.08 и 12.02.2026): инвойс 1-2026 — продажа Веллмех → YUSUFOĞULLARI, «мы бобра не закупали, мех подрядчика». Закупки З-2026-0063 в базе нет (scripts/remove-beaver.ts), в долг Веллмех она не входит.",
  },
  "vat-contractor-lots": {
    choice: "confirm",
    note: "Счета Веллмех №235 от 04.12.2025 и №239 от 18.12.2025 — НДС 20% (З-2026-0010, 0011); счета №1 от 15.01.2026 и №7 от 04.02.2026 — НДС 22% (З-2026-0012, 0013). В базе так и стоит (docs-inventory/decisions-resolved.md §2, overpayments-check.md).",
  },
  "lot-728026": {
    choice: "grey",
    note: "Реестр и отчёт 08.06.2026: SWAKARA «GR SKY / GR DARK» (GR = grey); цвет «Серый» применён по указанию владельца 08.10.2026, в базе у лота 728026 — «Серый» (data-decisions-2.md, open-questions.md Д6).",
  },
  "lining-shift-607118": {
    choice: "keep",
    note: "Счёт №100 / УПД №109 — одна поставка подкладки на две закупки (З-2026-0032 и З-2026-0060), это не дубль. Пул лотов = 680,3 м × 2 140 = 1 455 842,00 ₽ = сумме УПД, по аукциону «Подкладка 07.25» сходится до копейки; цены позиций выровнены по УПД. Разделить один поставленный рулон по закупкам документы не позволяют.",
  },
};

type J = { key: string; at: string };

async function main() {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const prisma = createAuditedClient("script:close-owner-decisions-2026-10-14");
  const org = await prisma.organization.findFirstOrThrow();
  const j: J[] = existsSync(JOURNAL) ? JSON.parse(readFileSync(JOURNAL, "utf-8")) : [];

  if (ROLLBACK) {
    for (const e of j) {
      const cur = await prisma.systemState.findUnique({ where: { organizationId_key: { organizationId: org.id, key: e.key } } });
      const same = cur && (cur.value as { at?: string }).at === e.at;
      console.log(`${same ? "удалить" : "пропуск (изменено после скрипта)"} ${e.key}`);
      if (APPLY && same) await prisma.systemState.delete({ where: { organizationId_key: { organizationId: org.id, key: e.key } } });
    }
    if (!APPLY) console.log("пробный прогон (добавьте --apply)");
    return;
  }

  const todo: { key: string; value: Record<string, unknown>; title: string; label: string }[] = [];
  for (const [id, a] of Object.entries(ANSWERS)) {
    const d = DECISIONS.find((x) => x.id === id);
    const o = d?.options.find((x) => x.key === a.choice);
    if (!d || !o) throw new Error(`нет решения или варианта: ${id}/${a.choice}`);
    const key = DECISION_KEY_PREFIX + id;
    const have = await prisma.systemState.findUnique({ where: { organizationId_key: { organizationId: org.id, key } } });
    if (have) { console.log(`уже решено, пропуск: ${id}`); continue; }
    todo.push({ key, title: d.title, label: o.label, value: { choice: o.key, label: o.label, note: a.note.slice(0, 500), at: new Date().toISOString(), by: null, byName: WHO } });
  }
  for (const t of todo) console.log(`${t.key}\n   «${t.title}»\n   → ${t.label}`);
  if (!APPLY) return console.log("\nпробный прогон (добавьте --apply)");
  if (!todo.length) return;
  execFileSync(path.join(__dirname, "backup.sh"), { stdio: "inherit" });
  for (const t of todo) {
    await prisma.systemState.create({ data: { organizationId: org.id, key: t.key, value: t.value as never } });
    j.push({ key: t.key, at: t.value.at as string });
    writeFileSync(JOURNAL, JSON.stringify(j, null, 1));
  }
  console.log("записано", todo.length);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
