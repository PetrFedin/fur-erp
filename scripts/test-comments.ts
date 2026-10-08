/**
 * Проверка «Оставить комментарий» на КОПИИ БД (боевую не трогает): создание, права, статусы, ответы, счётчики,
 * изоляция организаций, журнал изменений, лимит частоты, выгрузка .md/.csv.
 *
 *   docker exec fur-erp-db-1 psql -U fur_erp -d postgres -c 'CREATE DATABASE fur_erp_comments_test'
 *   docker exec fur-erp-db-1 pg_dump -U fur_erp --no-owner fur_erp | docker exec -i fur-erp-db-1 psql -q -U fur_erp -d fur_erp_comments_test
 *   COMMENTS_TEST_URL=postgresql://fur_erp:fur_erp@localhost:5436/fur_erp_comments_test \
 *     node --env-file=.env node_modules/.bin/tsx scripts/test-comments.ts
 *   docker exec fur-erp-db-1 psql -U fur_erp -d postgres -c 'DROP DATABASE fur_erp_comments_test'
 *
 * Скрипт отказывается работать, если в адресе нет «comments_test».
 */
import { createAuditedClient } from "../src/lib/prisma";
import { addReply, createComment, deleteComment, pageCounts, pageThread, resetRateLimit, setStatus, updateComment, type CommentActor, type Db } from "../src/lib/comments-service";
import { buildTasksCsv, buildTasksMarkdown, commentWhere, entityFromPath, parseCommentFilters, rateAllow, type ExportComment } from "../src/lib/comments-core";

const url = process.env.COMMENTS_TEST_URL ?? "";
if (!url.includes("comments_test")) {
  console.error("Задайте COMMENTS_TEST_URL на scratch-базу (имя содержит comments_test).");
  process.exit(2);
}
const prisma = createAuditedClient({ source: "script:test-comments", id: "u-test", name: "Тест", role: "OWNER" }, { url }) as unknown as Db;
const raw = (prisma as unknown as { $rawBase: Db }).$rawBase;

let fails = 0;
const ok = (c: unknown, m: string) => {
  if (c) console.log("  ok  ", m);
  else {
    fails++;
    console.log("  FAIL", m);
  }
};

async function main() {
  const org = await raw.organization.findFirstOrThrow();
  const purchase = await raw.purchase.findFirstOrThrow({ where: { organizationId: org.id } });
  const org2 = await raw.organization.create({ data: { name: "Тест-орг комментарии", slug: "comments-test-" + Date.now() } });
  const mk = (id: string, role: string, orgId = org.id): CommentActor => ({ id, name: `Тест ${role}`, role, organizationId: orgId });
  const owner = mk("u-owner", "OWNER");
  const viewer = mk("u-viewer", "VIEWER");
  const purch = mk("u-purch", "PURCHASER");
  const other = mk("u-other", "OWNER", org2.id);
  const base = { pagePath: "/lots?tab=fur&year=2026", pageTitle: "Сырьё" };

  console.log("маршруты");
  ok(entityFromPath("/purchases/abc")?.type === "Purchase", "закупка по маршруту");
  ok(entityFromPath("/purchases/new") === null, "new — не запись");
  ok(entityFromPath("/production/batches/7")?.key === "7", "партия по номеру");
  ok(entityFromPath("/lots") === null, "список — не запись");

  console.log("создание");
  const r1 = await createComment(prisma, viewer, { ...base, text: "<script>alert(1)</script> цифра не сходится", kind: "BUG", priority: "HIGH", anchor: "table:fur", context: { anchorLabel: "Таблица меха", params: { tab: ["fur"] }, viewport: "1200x800" } }, { year: "2026", vat: "incl", commission4: "on" });
  ok(r1.ok, "Наблюдатель может создать");
  if (!r1.ok) throw new Error(r1.error);
  const c1 = await raw.comment.findUniqueOrThrow({ where: { id: r1.id } });
  ok(c1.text.startsWith("<script>"), "текст хранится как есть (экранирует вывод React)");
  ok((c1.context as { year?: string }).year === "2026" && (c1.context as { vat?: string }).vat === "incl", "снимок: год и НДС с сервера");
  ok((c1.context as { role?: string }).role === "VIEWER", "снимок: роль");
  ok(!(await createComment(prisma, viewer, { ...base, text: "   " })).ok, "пустой текст отклонён");
  ok(!(await createComment(prisma, viewer, { ...base, text: "x".repeat(4001) })).ok, "больше 4000 знаков отклонён");
  ok(!(await createComment(prisma, viewer, { pagePath: "//evil.example", text: "a" })).ok, "чужой адрес отклонён");
  const r2 = await createComment(prisma, purch, { pagePath: `/purchases/${purchase.id}`, pageTitle: "Закупка", text: "К записи", entityType: "Purchase", entityKey: purchase.id });
  ok(r2.ok, "комментарий к записи");
  const c2 = r2.ok ? await raw.comment.findUniqueOrThrow({ where: { id: r2.id } }) : null;
  ok(c2?.entityId === purchase.id && /Закупка/.test(c2.entityLabel ?? ""), `подпись записи: ${c2?.entityLabel}`);
  ok(!(await createComment(prisma, other, { pagePath: `/purchases/${purchase.id}`, text: "чужая", entityType: "Purchase", entityKey: purchase.id })).ok, "запись другой организации не находится");
  ok(!(await createComment(prisma, owner, { ...base, text: "a", entityType: "NoSuch", entityKey: "1" })).ok, "неизвестный тип записи отклонён");

  console.log("журнал изменений");
  const logged = await raw.auditLog.count({ where: { model: "Comment", recordId: r1.id, action: "create" } });
  ok(logged === 1, "создание записано в AuditLog");

  console.log("права и статусы");
  ok(!(await setStatus(prisma, viewer, [r1.id], "DONE")).ok, "Наблюдатель не меняет статус");
  ok(!(await setStatus(prisma, purch, [r1.id], "DONE")).ok, "Закупщик не меняет статус");
  ok(!(await setStatus(prisma, other, [r1.id], "DONE")).ok || (await raw.comment.findUniqueOrThrow({ where: { id: r1.id } })).status === "OPEN", "чужая организация не меняет статус");
  const s1 = await setStatus(prisma, owner, [r1.id, r2.ok ? r2.id : ""], "DONE", "Исправлено в ТЗ-19");
  ok(s1.ok && s1.changed === 2, "владелец отметил учтёнными (массово)");
  const d1 = await raw.comment.findUniqueOrThrow({ where: { id: r1.id } });
  ok(d1.status === "DONE" && d1.resolutionNote === "Исправлено в ТЗ-19" && d1.resolvedAt && d1.resolvedById === "u-owner", "пометка «как учтено», кто и когда");
  ok((await raw.auditLog.count({ where: { model: "Comment", recordId: r1.id, action: "update" } })) >= 1, "смена статуса записана в AuditLog");
  await setStatus(prisma, owner, [r1.id], "OPEN");
  ok((await raw.comment.findUniqueOrThrow({ where: { id: r1.id } })).resolvedAt === null, "возврат в открытые чистит пометку");

  console.log("правка и удаление");
  ok((await updateComment(prisma, viewer, r1.id, { text: "правка автора" })).ok, "автор правит в течение 15 минут");
  ok(!(await updateComment(prisma, purch, r1.id, { text: "чужая правка" })).ok, "чужой не правит");
  await raw.comment.update({ where: { id: r1.id }, data: { createdAt: new Date(Date.now() - 20 * 60_000) } });
  ok(!(await updateComment(prisma, viewer, r1.id, { text: "поздно" })).ok, "через 15 минут автор уже не правит");
  ok((await updateComment(prisma, owner, r1.id, { text: "правка владельца" })).ok, "владелец правит всегда");
  ok(!(await deleteComment(prisma, purch, r1.id)).ok, "чужой не удаляет");
  const r3 = await createComment(prisma, viewer, { ...base, text: "удалить меня" });
  if (!r3.ok) throw new Error(r3.error);
  ok((await deleteComment(prisma, viewer, r3.id)).ok, "автор удаляет, пока открыт");
  const r4 = await createComment(prisma, viewer, { ...base, text: "учтён — не удалить автору" });
  if (!r4.ok) throw new Error(r4.error);
  await setStatus(prisma, owner, [r4.id], "DONE");
  ok(!(await deleteComment(prisma, viewer, r4.id)).ok, "автор не удаляет учтённый");
  ok((await deleteComment(prisma, owner, r4.id)).ok, "владелец удаляет чужой");
  ok((await raw.auditLog.count({ where: { model: "Comment", recordId: r4.id, action: "delete" } })) === 1, "удаление записано в AuditLog");

  console.log("ответы и счётчики");
  const rep = await addReply(prisma, purch, r1.id, "Посмотрим");
  ok(rep.ok, "любой отвечает");
  ok(!(await addReply(prisma, other, r1.id, "чужой ответ")).ok, "другая организация не отвечает");
  const th = await pageThread(prisma, owner, "/lots?tab=x", { anchor: "table:fur" });
  ok(th.length === 1 && th[0].replies.length === 1 && th[0].canManage, "ветка блока: комментарий + ответ + права");
  ok((await pageThread(prisma, other, "/lots", {})).length === 0, "другая организация ветку не видит");
  const cnt = await pageCounts(prisma, org.id, "/lots", null);
  ok(cnt.blocks["table:fur"]?.open === 1 && cnt.page.total >= 1, "счётчик блока и страницы (путь без фильтров)");
  const cnt2 = await pageCounts(prisma, org.id, `/purchases/${purchase.id}`, { type: "Purchase", id: purchase.id });
  ok(cnt2.entity?.total === 1, "счётчик записи");

  console.log("лимит частоты");
  const store = new Map<string, number[]>();
  let allowed = 0;
  for (let i = 0; i < 40; i++) if (rateAllow(store, "u", 1000)) allowed++;
  ok(allowed === 30, "30 в минуту, остальные отклонены");
  ok(rateAllow(store, "u", 1000 + 61_000), "через минуту снова можно");
  resetRateLimit();
  let created = 0;
  for (let i = 0; i < 32; i++) if ((await createComment(prisma, purch, { ...base, text: "поток " + i })).ok) created++;
  ok(created === 30, `в сервисе тоже 30 (создано ${created})`);
  await raw.comment.deleteMany({ where: { text: { startsWith: "поток " } } });

  console.log("выгрузка и фильтры");
  const f = parseCommentFilters({ status: ["OPEN", "HACK"], kind: "BUG", q: "цифра" });
  ok(f.status.length === 1 && f.status[0] === "OPEN", "недопустимое значение фильтра отброшено");
  const rows = (await raw.comment.findMany({ where: commentWhere(org.id, parseCommentFilters({})), include: { replies: true } })) as unknown as ExportComment[];
  ok(rows.length >= 2 && rows.every((r) => r.pagePath), "выборка организации");
  ok((await raw.comment.count({ where: commentWhere(org2.id, parseCommentFilters({})) })) === 0, "организация 2 пуста (изоляция)");
  const md = buildTasksMarkdown(rows, { origin: "http://localhost:3200" });
  ok(md.includes("## Страница: Сырьё") && md.includes("### Блок: Таблица меха (`table:fur`)") && md.includes("запись: Закупка") && md.includes("#cm=table%3Afur."), "Markdown: страница → блок → запись → ссылка");
  ok(md.includes("год: 2026") && md.includes("НДС: с НДС"), "Markdown: контекст");
  const csv = buildTasksCsv([{ ...rows[0], text: "=HYPERLINK(\"x\")" }], "http://x");
  ok(csv.startsWith("﻿") && csv.includes("'=HYPERLINK"), "CSV: BOM и защита от формул");

  // уборка тестовых данных
  await raw.comment.deleteMany({ where: { organizationId: { in: [org.id, org2.id] } } });
  await raw.auditLog.deleteMany({ where: { model: { in: ["Comment", "CommentReply"] } } });
  await raw.organization.delete({ where: { id: org2.id } });
  console.log(fails === 0 ? "\nВсе проверки пройдены." : `\nПровалено: ${fails}`);
  process.exit(fails ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
