"use server";

import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { revalidateAll } from "@/lib/revalidate-all";
import { loadRegistry } from "@/lib/reconciliation-registry";
import {
  checkInvoiceFields, findDuplicateInvoice, groupKeyOf, invoiceKey, mskToday, parseIsoDate, parseMoney,
} from "@/lib/reconciliation-rules";

/** Ввод реестра сверки: только владелец, администратор и бухгалтер. Каждое изменение пишет журнал (AuditLog) через расширение клиента. */
const ROLES = ["OWNER", "ADMIN", "ACCOUNTANT"] as const;
export type ActionResult = { error?: string; ok?: boolean };
const fail = (error: string): ActionResult => ({ error });

const str = (fd: FormData, k: string): string => String(fd.get(k) ?? "").trim();
const strOrNull = (fd: FormData, k: string): string | null => str(fd, k) || null;
const intOrNull = (fd: FormData, k: string): number | null | "bad" => {
  const s = str(fd, k);
  if (!s) return null;
  return /^\d{1,6}$/.test(s) ? Number(s) : "bad";
};

async function ctx() {
  const session = await requireRole(...ROLES);
  const orgId = session.user.organizationId;
  const reg = await loadRegistry(orgId);
  return { session, orgId, reg, who: { createdById: session.user.id, createdByName: session.user.name ?? null }, today: mskToday() };
}
const NOT_MIGRATED = fail("Реестр ещё не перенесён в базу: правка форм станет доступна после переноса (владелец запускает скрипт переноса).");

// ----------------------------------------------------------------------------------------------- отметка «сверка выполнена»

export async function markReconChecked(fd: FormData): Promise<ActionResult> {
  const { session, orgId, who, today } = await ctx();
  await prisma.reconciliationCheck.create({
    data: { organizationId: orgId, checkedDate: new Date(`${today}T00:00:00Z`), kind: "manual", byUserId: who.createdById, byName: who.createdByName, note: strOrNull(fd, "note") },
  });
  void session;
  revalidateAll(orgId);
  return { ok: true };
}

// ----------------------------------------------------------------------------------------------- группы

const STATUSES = ["ok", "docs", "unpaid", "review", "conflict", "empty"];

export async function saveGroup(fd: FormData): Promise<ActionResult> {
  const { orgId, reg, who } = await ctx();
  if (reg.source !== "db") return NOT_MIGRATED;
  const id = str(fd, "id");
  const section = str(fd, "section");
  const title = str(fd, "title");
  if (!["purchase", "production"].includes(section)) return fail("Выберите раздел: закупки или производство");
  if (title.length < 2) return fail("Укажите название группы (например, «СП 05.25» или «Партия 12»)");
  if (title.length > 200) return fail("Название группы слишком длинное");
  const status = str(fd, "status") || "empty";
  if (!STATUSES.includes(status)) return fail("Неизвестный статус группы");
  const year = intOrNull(fd, "year");
  if (year === "bad" || (year != null && (year < 2020 || year > 2100))) return fail("Год — четыре цифры, например 2026");
  const dbBatch = intOrNull(fd, "dbBatch");
  if (dbBatch === "bad") return fail("Номер партии — целое число");
  const purchases = str(fd, "dbPurchases").split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
  if (section === "purchase" && purchases.length) {
    const found = await prisma.purchase.findMany({ where: { organizationId: orgId, number: { in: purchases } }, select: { number: true } });
    const miss = purchases.filter((n) => !found.some((f) => f.number === n));
    if (miss.length) return fail(`В базе нет закупок: ${miss.join(", ")}. Проверьте номера (формат З-2026-0001)`);
    const taken = reg.groups.filter((g) => g.dbId !== id && (g.dbLink.purchases ?? []).some((n) => purchases.includes(n)));
    if (taken.length) return fail(`Закупка уже входит в группу «${taken[0].title}»: одна закупка — одна группа`);
  }
  if (section === "production" && dbBatch != null) {
    const clash = reg.groups.find((g) => g.dbId !== id && g.section === "production" && g.dbLink.batch === dbBatch);
    if (clash) return fail(`Партия ${dbBatch} уже сверяется в группе «${clash.title}»`);
  }
  const data = {
    title, counterparty: strOrNull(fd, "counterparty"), contract: strOrNull(fd, "contract"), year, period: strOrNull(fd, "period"),
    status, note: strOrNull(fd, "note"), dbPurchases: section === "purchase" ? purchases : [], dbBatch: section === "production" ? dbBatch : null,
  };
  if (id) {
    const cur = await prisma.reconciliationGroup.findFirst({ where: { id, organizationId: orgId, deletedAt: null } });
    if (!cur) return fail("Группа не найдена: обновите страницу");
    if (cur.section !== section) return fail("Раздел существующей группы менять нельзя: создайте новую группу");
    await prisma.reconciliationGroup.update({ where: { id }, data });
  } else {
    const key = groupKeyOf(section, title);
    if (await prisma.reconciliationGroup.findUnique({ where: { organizationId_key: { organizationId: orgId, key } } })) return fail(`Группа «${title}» уже есть в этом разделе (возможно, удалённая): выберите другое название`);
    const last = await prisma.reconciliationGroup.aggregate({ where: { organizationId: orgId }, _max: { sortOrder: true } });
    await prisma.reconciliationGroup.create({
      data: { organizationId: orgId, key, section, source: "ui", sortOrder: (last._max.sortOrder ?? 0) + 1, ...who, ...data },
    });
  }
  revalidateAll(orgId);
  return { ok: true };
}

export async function deleteGroup(fd: FormData): Promise<ActionResult> {
  const { orgId, reg, who } = await ctx();
  if (reg.source !== "db") return NOT_MIGRATED;
  const id = str(fd, "id");
  const reason = str(fd, "reason");
  if (str(fd, "confirm") !== "1") return fail("Отметьте, что понимаете: группа исчезнет из сверки");
  if (reason.length < 5) return fail("Напишите причину удаления (не короче 5 символов): она сохранится в журнале");
  const g = reg.groups.find((x) => x.dbId === id);
  if (!g) return fail("Группа не найдена: обновите страницу");
  if (g.invoiceIds.length) return fail(`В группе ещё ${g.invoiceIds.length} счёт(ов): сначала удалите их или перенесите в другую группу`);
  await prisma.reconciliationGroup.update({ where: { id }, data: { deletedAt: new Date(), deletedByName: who.createdByName, deleteReason: reason } });
  revalidateAll(orgId);
  return { ok: true };
}

// ----------------------------------------------------------------------------------------------- счета

type InvoiceForm = ReturnType<typeof readInvoice>;
function readInvoice(fd: FormData, today: string) {
  const date = parseIsoDate(fd.get("date"));
  const updDate = parseIsoDate(fd.get("updDate"));
  const refBatch = intOrNull(fd, "refBatch");
  const vatS = str(fd, "vatRate");
  return {
    no: strOrNull(fd, "no"),
    date,
    updDate,
    amountRub: parseMoney(fd.get("amount")),
    vatRate: vatS === "" ? null : Number(vatS.replace(",", ".")),
    vatRub: parseMoney(fd.get("vatRub")),
    purpose: str(fd, "purpose"),
    updNo: strOrNull(fd, "updNo"),
    refPurchase: strOrNull(fd, "refPurchase"),
    refBatch,
    refTz: strOrNull(fd, "refTz"),
    note: strOrNull(fd, "note"),
    today,
  };
}

function invoiceError(f: InvoiceForm): string | null {
  if (f.date === "bad") return "Дата счёта: введите в виде ДД.ММ.ГГГГ";
  if (f.updDate === "bad") return "Дата УПД: введите в виде ДД.ММ.ГГГГ";
  if (f.refBatch === "bad") return "Партия — целое число";
  if (!f.no) return "Укажите номер счёта (если счёта нет, напишите «б/н»)";
  if (f.no.length > 60) return "Номер счёта слишком длинный";
  return checkInvoiceFields({ no: f.no, date: f.date, amountRub: f.amountRub, vatRate: f.vatRate, vatRub: f.vatRub }, f.today);
}

export async function saveInvoice(fd: FormData): Promise<ActionResult> {
  const { orgId, reg, who, today } = await ctx();
  if (reg.source !== "db") return NOT_MIGRATED;
  const f = readInvoice(fd, today);
  const err = invoiceError(f);
  if (err) return fail(err);
  const id = str(fd, "id");
  const date = f.date as string | null;
  const year = date ? Number(date.slice(0, 4)) : null;
  const common = {
    no: f.no, date: date ? new Date(`${date}T00:00:00Z`) : null, year, amountRub: (f.amountRub as number).toFixed(2),
    vatRate: f.vatRate != null ? String(f.vatRate) : null, vatRub: f.vatRub != null ? f.vatRub.toFixed(2) : null,
    purpose: f.purpose, updNo: f.updNo, updDate: f.updDate ? new Date(`${f.updDate}T00:00:00Z`) : null,
    refPurchase: f.refPurchase, refBatch: f.refBatch as number | null, refTz: f.refTz, note: f.note,
  };
  if (f.refPurchase && !(await prisma.purchase.findFirst({ where: { organizationId: orgId, number: f.refPurchase }, select: { id: true } }))) return fail(`В базе нет закупки ${f.refPurchase}`);

  if (id) {
    const inv = reg.invoices.find((i) => i.dbId === id);
    if (!inv) return fail("Счёт не найден: обновите страницу");
    const dup = findDuplicateInvoice(reg.invoices.map((i) => ({ id: i.dbId!, no: i.no, date: i.date, year: i.year, groupKeys: i.groupIds })), { id, no: f.no, date, year, groupKeys: inv.groupIds });
    if (dup) return fail(`В этой группе уже есть счёт №${dup.no} ${dup.date ? "от " + dup.date.split("-").reverse().join(".") : ""}: проверьте номер и дату`);
    await prisma.reconciliationInvoice.update({ where: { id }, data: common });
  } else {
    const gid = str(fd, "groupId");
    const g = reg.groups.find((x) => x.dbId === gid);
    if (!g) return fail("Выберите группу, в которую добавить счёт");
    const dup = findDuplicateInvoice(reg.invoices.map((i) => ({ id: i.dbId!, no: i.no, date: i.date, year: i.year, groupKeys: i.groupIds })), { no: f.no, date, year, groupKeys: [g.id] });
    if (dup) return fail(`В группе «${g.title}» уже есть счёт №${dup.no} ${dup.date ? "от " + dup.date.split("-").reverse().join(".") : ""}: проверьте номер и дату`);
    const taken = new Set((await prisma.reconciliationInvoice.findMany({ where: { organizationId: orgId }, select: { key: true } })).map((k) => k.key));
    const last = await prisma.reconciliationInvoice.aggregate({ where: { organizationId: orgId }, _max: { sortOrder: true } });
    await createInvoice(orgId, g.dbId!, g.invoiceIds.length, {
      key: invoiceKey(g.section, f.no, date, year, taken), section: g.section, sortOrder: (last._max.sortOrder ?? 0) + 1, source: "ui", ...who, ...common,
    });
  }
  revalidateAll(orgId);
  return { ok: true };
}

async function createInvoice(orgId: string, groupDbId: string, posInGroup: number, data: Record<string, unknown>) {
  return prisma.$transaction(async (tx) => {
    const inv = await tx.reconciliationInvoice.create({ data: { organizationId: orgId, ...(data as object) } as never });
    await tx.reconciliationInvoiceGroup.create({ data: { organizationId: orgId, invoiceId: inv.id, groupId: groupDbId, posInGroup, posInInvoice: 0 } });
    return inv;
  });
}

export async function deleteInvoice(fd: FormData): Promise<ActionResult> {
  const { orgId, reg, who } = await ctx();
  if (reg.source !== "db") return NOT_MIGRATED;
  const id = str(fd, "id");
  const reason = str(fd, "reason");
  if (str(fd, "confirm") !== "1") return fail("Отметьте, что понимаете: счёт исчезнет из сверки и итогов");
  if (reason.length < 5) return fail("Напишите причину удаления (не короче 5 символов): она сохранится в журнале");
  const inv = reg.invoices.find((i) => i.dbId === id);
  if (!inv) return fail("Счёт не найден: обновите страницу");
  await prisma.reconciliationInvoice.update({ where: { id }, data: { deletedAt: new Date(), deletedByName: who.createdByName, deleteReason: reason } });
  revalidateAll(orgId);
  return { ok: true };
}

// ----------------------------------------------------------------------------------------------- оплата по документам

const BASES = ["pp", "balance", "upd", "registry", "calc", "letter", "credit"];
const EVID = ["fact", "approved", "planned"];

export async function savePaidRow(fd: FormData): Promise<ActionResult> {
  const { orgId, reg, today } = await ctx();
  if (reg.source !== "db") return NOT_MIGRATED;
  const invoiceId = str(fd, "invoiceId");
  const inv = reg.invoices.find((i) => i.dbId === invoiceId);
  if (!inv) return fail("Счёт не найден: обновите страницу");
  const amount = parseMoney(fd.get("amount"));
  if (amount == null || Number.isNaN(amount) || amount <= 0) return fail("Сумма оплаты — число больше нуля");
  const date = parseIsoDate(fd.get("date"));
  if (date === "bad") return fail("Дата оплаты: введите в виде ДД.ММ.ГГГГ");
  if (date && date > today) return fail("Дата оплаты в будущем: для ожидаемого платежа выберите основание «ожидается»");
  if (date && inv.date && date < inv.date) return fail("Оплата раньше даты счёта: проверьте дату (допустима оплата по предоплате — тогда укажите дату счёта)");
  const evidence = str(fd, "evidence") || "fact";
  const basis = str(fd, "basis") || null;
  if (!EVID.includes(evidence) || (basis && !BASES.includes(basis))) return fail("Неизвестное основание оплаты");
  if (evidence === "fact" && !date && !str(fd, "dateApprox")) return fail("У подтверждённой оплаты нужна дата (или отметьте «дата неточная»)");
  if (basis === "pp" && !str(fd, "ppNo")) return fail("Для платёжки укажите номер п/п");
  const rowId = str(fd, "rowId");
  const sameAmount = inv.paid.filter((p) => p.evidence === "fact").reduce((a, p) => a + p.amountRub, 0);
  const left = inv.amountRub - sameAmount;
  if (evidence === "fact" && !rowId && amount - left > 3.96) return fail(`Оплата ${amount.toLocaleString("ru-RU")} ₽ больше остатка по счёту ${Math.max(0, left).toLocaleString("ru-RU")} ₽: проверьте сумму либо счёт`);
  const data = {
    paidAt: date ? new Date(`${date}T00:00:00Z`) : null, dateApprox: !!str(fd, "dateApprox"), amountRub: amount.toFixed(2), ppNo: strOrNull(fd, "ppNo"),
    basis, evidence, source: str(fd, "source") || "внесено вручную в форме сверки",
  };
  if (rowId) {
    const row = await prisma.reconciliationInvoicePayment.findFirst({ where: { id: rowId, invoiceId, organizationId: orgId } });
    if (!row) return fail("Строка оплаты не найдена");
    await prisma.reconciliationInvoicePayment.update({ where: { id: rowId }, data });
  } else {
    const last = await prisma.reconciliationInvoicePayment.aggregate({ where: { invoiceId }, _max: { sortOrder: true } });
    await prisma.reconciliationInvoicePayment.create({ data: { organizationId: orgId, invoiceId, sortOrder: (last._max.sortOrder ?? -1) + 1, ...data } });
  }
  revalidateAll(orgId);
  return { ok: true };
}

export async function deletePaidRow(fd: FormData): Promise<ActionResult> {
  const { orgId } = await ctx();
  const rowId = str(fd, "rowId");
  if (str(fd, "confirm") !== "1") return fail("Отметьте, что понимаете: строка оплаты исчезнет из сверки");
  const row = await prisma.reconciliationInvoicePayment.findFirst({ where: { id: rowId, organizationId: orgId } });
  if (!row) return fail("Строка оплаты не найдена");
  await prisma.reconciliationInvoicePayment.delete({ where: { id: rowId } });
  revalidateAll(orgId);
  return { ok: true };
}

// ----------------------------------------------------------------------------------------------- привязки

export async function linkPayment(fd: FormData): Promise<ActionResult> {
  const { orgId, reg, who } = await ctx();
  if (reg.source !== "db") return NOT_MIGRATED;
  const invoiceId = str(fd, "invoiceId");
  if (!reg.invoices.some((i) => i.dbId === invoiceId)) return fail("Счёт не найден: обновите страницу");
  const [kind, pid] = str(fd, "pay").split(":");
  if (!pid || (kind !== "p" && kind !== "q")) return fail("Выберите платёж из списка");
  if (kind === "p") {
    if (!(await prisma.payment.findFirst({ where: { id: pid, organizationId: orgId }, select: { id: true } }))) return fail("Платёж не найден");
    if (await prisma.reconciliationPaymentLink.findFirst({ where: { organizationId: orgId, paymentId: pid } })) return fail("Этот платёж уже привязан к счёту: сначала отвяжите");
    await prisma.reconciliationPaymentLink.create({ data: { organizationId: orgId, invoiceId, paymentId: pid, createdById: who.createdById, createdByName: who.createdByName } });
  } else {
    if (!(await prisma.productionPayment.findFirst({ where: { id: pid, organizationId: orgId }, select: { id: true } }))) return fail("Платёж не найден");
    if (await prisma.reconciliationPaymentLink.findFirst({ where: { organizationId: orgId, productionPaymentId: pid } })) return fail("Этот платёж уже привязан к счёту: сначала отвяжите");
    await prisma.reconciliationPaymentLink.create({ data: { organizationId: orgId, invoiceId, productionPaymentId: pid, createdById: who.createdById, createdByName: who.createdByName } });
  }
  revalidateAll(orgId);
  return { ok: true };
}

export async function unlinkPayment(fd: FormData): Promise<ActionResult> {
  const { orgId } = await ctx();
  const id = str(fd, "linkId");
  if (str(fd, "confirm") !== "1") return fail("Отметьте, что понимаете: платёж перестанет считаться оплатой этого счёта");
  const l = await prisma.reconciliationPaymentLink.findFirst({ where: { id, organizationId: orgId } });
  if (!l) return fail("Привязка не найдена");
  await prisma.reconciliationPaymentLink.delete({ where: { id } });
  revalidateAll(orgId);
  return { ok: true };
}

export async function linkDocument(fd: FormData): Promise<ActionResult> {
  const { orgId, reg } = await ctx();
  if (reg.source !== "db") return NOT_MIGRATED;
  const invoiceId = str(fd, "invoiceId");
  if (!reg.invoices.some((i) => i.dbId === invoiceId)) return fail("Счёт не найден: обновите страницу");
  const docId = str(fd, "documentId");
  if (!docId) {
    await prisma.reconciliationInvoice.update({ where: { id: invoiceId }, data: { refDocumentId: null } });
  } else {
    const d = await prisma.driveDocument.findFirst({ where: { id: docId, organizationId: orgId }, select: { id: true, title: true } });
    if (!d) return fail("Документ не найден");
    await prisma.reconciliationInvoice.update({ where: { id: invoiceId }, data: { refDocumentId: d.id, fileTitle: d.title } });
  }
  revalidateAll(orgId);
  return { ok: true };
}

// ----------------------------------------------------------------------------------------------- автоподхват: закупки вне групп

/** «Создать группу / счёт из закупки»: подставляет контрагента, номер, дату и сумму из закупок аукциона и привязывает закупки к группе. */
export async function createFromPurchases(fd: FormData): Promise<ActionResult> {
  const { orgId, reg, who, today } = await ctx();
  if (reg.source !== "db") return NOT_MIGRATED;
  const numbers = str(fd, "numbers").split(",").map((x) => x.trim()).filter(Boolean);
  if (!numbers.length) return fail("Не выбраны закупки");
  const purchases = await prisma.purchase.findMany({
    where: { organizationId: orgId, number: { in: numbers } },
    select: { number: true, status: true, orderDate: true, auctionSession: true, auctionId: true, exchangeRate: true, supplier: { select: { name: true } }, items: { select: { subtotal: true, vatRate: true, quantity: true, costPlan: true } }, expenses: { select: { amount: true, vatRate: true } } },
  });
  if (purchases.length !== numbers.length) return fail("Часть закупок не найдена: обновите страницу");
  const taken = reg.groups.filter((g) => (g.dbLink.purchases ?? []).some((n) => numbers.includes(n)));
  if (taken.length) return fail(`Закупка уже входит в группу «${taken[0].title}»: обновите страницу`);
  const no = strOrNull(fd, "invoiceNo");
  const f = readInvoice(fd, today);
  f.no = no;
  if (no) {
    const err = invoiceError(f);
    if (err) return fail(err);
  }
  const target = str(fd, "target"); // "new" либо dbId существующей группы
  let group = reg.groups.find((g) => g.dbId === target && g.section === "purchase");
  if (target !== "new" && !group) return fail("Группа не найдена: обновите страницу");

  if (!group) {
    const title = str(fd, "title");
    if (title.length < 2) return fail("Укажите название группы");
    const key = groupKeyOf("purchase", title);
    if (await prisma.reconciliationGroup.findUnique({ where: { organizationId_key: { organizationId: orgId, key } } })) return fail(`Группа «${title}» уже есть: выберите её в списке «Добавить в существующую»`);
    const last = await prisma.reconciliationGroup.aggregate({ where: { organizationId: orgId }, _max: { sortOrder: true } });
    const year = Math.min(...purchases.map((p) => p.orderDate.getUTCFullYear()));
    const created = await prisma.reconciliationGroup.create({
      data: {
        organizationId: orgId, key, section: "purchase", title, counterparty: strOrNull(fd, "counterparty") ?? purchases[0].supplier.name, year, status: "empty",
        sortOrder: (last._max.sortOrder ?? 0) + 1, dbPurchases: numbers, source: `purchase:${numbers[0]}`, ...who,
        details: { doc: { costRub: null, invoicesRub: null, paidRub: null }, db: { costRub: null, paidRub: null, remainingRub: null, refs: numbers.join(", ") }, checks: [], diffs: [], notes: [], files: [] },
      },
    });
    group = { dbId: created.id, id: key, title, section: "purchase", invoiceIds: [], dbLink: { purchases: numbers } } as never;
  } else {
    await prisma.reconciliationGroup.update({ where: { id: group.dbId! }, data: { dbPurchases: [...(group.dbLink.purchases ?? []), ...numbers] } });
  }

  if (no) {
    const date = f.date as string | null;
    const year = date ? Number(date.slice(0, 4)) : null;
    const dup = findDuplicateInvoice(reg.invoices.map((i) => ({ id: i.dbId!, no: i.no, date: i.date, year: i.year, groupKeys: i.groupIds })), { no, date, year, groupKeys: [group!.id] });
    if (dup) return fail(`В группе «${group!.title}» уже есть счёт №${dup.no}`);
    const keys = new Set((await prisma.reconciliationInvoice.findMany({ where: { organizationId: orgId }, select: { key: true } })).map((k) => k.key));
    const last = await prisma.reconciliationInvoice.aggregate({ where: { organizationId: orgId }, _max: { sortOrder: true } });
    await createInvoice(orgId, group!.dbId!, group!.invoiceIds.length, {
      key: invoiceKey("purchase", no, date, year, keys), section: "purchase", no, date: date ? new Date(`${date}T00:00:00Z`) : null, year,
      amountRub: (f.amountRub as number).toFixed(2), vatRate: f.vatRate != null ? String(f.vatRate) : null, vatRub: f.vatRub != null ? f.vatRub.toFixed(2) : null,
      purpose: f.purpose || `закупка ${numbers.join(", ")}`, updNo: f.updNo, updDate: f.updDate ? new Date(`${f.updDate}T00:00:00Z`) : null,
      refPurchase: numbers[0], sortOrder: (last._max.sortOrder ?? 0) + 1, source: `purchase:${numbers[0]}`, ...who,
    });
  }
  revalidateAll(orgId);
  return { ok: true };
}
