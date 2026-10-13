"use server";

import { randomUUID } from "node:crypto";
import { Decimal } from "@prisma/client/runtime/library";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { ACCESS, hasRole } from "@/lib/access";
import { PRODUCTION_EDIT_ROLES } from "@/lib/production-access";
import { parseDateInput } from "@/lib/input";
import { revalidateAll } from "@/lib/revalidate-all";
import { removeStoredFiles } from "@/lib/fitting-files";
import { isPickedFile, readDocumentFiles, writeDocumentFiles, type ReadDoc } from "@/lib/purchase-files";
import { writeDriveFile } from "@/lib/drive-files";
import { auctionName, lockAuction, loadAuctionSummaries, PAY_EPS } from "@/lib/auction-payments";
import { purchaseTotalInclVat } from "@/lib/purchase-totals";
import { loadSupplierDebt } from "@/lib/supplier-debt";
import { resetVerification } from "@/lib/verification";
import { allocatedCentsByOrder, orderWorkCents } from "@/lib/payment-alloc";
import { fromCents, toCents } from "@/lib/payment-alloc-core";
import { refFromField, extractDocRefs } from "@/lib/source-docs";
import { PAY_KINDS, SAVED_LATER_NOTE, canConfirm, docRefOf, kindNote, type DocRole, type PayKind } from "@/lib/payment-form-core";
import { normRef, type SupTarget, type WorkTarget } from "@/lib/payment-wizard-core";
import { formatMoney } from "@/lib/utils";

/**
 * Мастер «Внести оплату и разнести»: данные для шагов и ЕДИНАЯ запись оплаты вместе с разнесением в одной транзакции.
 * Поставщику: оплата делится на несколько строк Payment (аукцион / закупка без аукциона), остаток — аванс без привязки
 * (как «Привязать» у аванса). По работе: ProductionPayment + строки PaymentAllocation (MANUAL) по ТЗ, остаток не разнесён.
 * Журнал изменений пишет клиент БД автоматически (та же транзакция). Прежние формы оплаты не затронуты.
 */

const SUPPLIER_ROLES = ACCESS.supplierPayments as readonly string[];
const WORK_ROLES = PRODUCTION_EDIT_ROLES as readonly string[];
const d2 = (n: Decimal) => Number(n.toFixed(2));
const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "");

export type WizardData = {
  canSupplier: boolean;
  canWork: boolean;
  suppliers: { id: string; name: string }[];
  supTargets: SupTarget[];
  clients: { id: string; name: string }[];
  workTargets: WorkTarget[];
  debtNow: number | null;
};

export async function getWizardData(): Promise<WizardData | { error: string }> {
  const session = await requireSession();
  const orgId = session.user.organizationId;
  const canSupplier = hasRole(session.user.role, SUPPLIER_ROLES);
  const canWork = hasRole(session.user.role, WORK_ROLES);
  if (!canSupplier && !canWork) return { error: "Недостаточно прав для внесения оплаты" };
  const out: WizardData = { canSupplier, canWork, suppliers: [], supTargets: [], clients: [], workTargets: [], debtNow: null };
  if (canSupplier) {
    const [sums, purchases, suppliers, debt] = await Promise.all([
      loadAuctionSummaries(prisma, orgId),
      prisma.purchase.findMany({
        where: { organizationId: orgId, status: { not: "CANCELLED" } },
        include: { items: true, expenses: true, payments: { where: { status: "COMPLETED" }, select: { amount: true } } },
        orderBy: { orderDate: "asc" },
      }),
      prisma.supplier.findMany({ where: { organizationId: orgId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
      loadSupplierDebt(prisma, orgId),
    ]);
    out.suppliers = suppliers;
    out.debtNow = d2(debt.debt);
    const refsOfPurchase = (p: (typeof purchases)[number]) => {
      const r: string[] = [normRef(p.number)];
      const inv = refFromField("AUCTION_INVOICE", p.invoiceNumber);
      if (inv?.number) r.push(normRef(inv.number));
      const upd = refFromField("UPD", p.transferDocument);
      if (upd?.number) r.push(normRef(upd.number));
      for (const x of extractDocRefs(p.notes)) if (x.number && (x.docType === "SPECIFICATION" || x.docType === "PAYMENT_INVOICE" || x.docType === "UPD")) r.push(normRef(x.number));
      return r.filter(Boolean);
    };
    for (const s of sums.filter((x) => x.purchases > 0)) {
      const ps = purchases.filter((p) => auctionName(p.auctionSession) === s.name);
      out.supTargets.push({
        key: `a:${s.name}`,
        label: `Аукцион «${s.name}»`,
        supplierIds: s.suppliers.map((x) => x.id),
        totalCents: toCents(s.total.toFixed(2)),
        paidCents: toCents(s.paid.toFixed(2)),
        refs: [...new Set([normRef(s.name), ...ps.flatMap(refsOfPurchase)])],
        date: iso(ps[0]?.orderDate),
      });
    }
    for (const p of purchases.filter((x) => !auctionName(x.auctionSession))) {
      const paid = p.payments.reduce((x, y) => x.add(y.amount), new Decimal(0));
      out.supTargets.push({ key: `p:${p.id}`, label: `Закупка ${p.number}`, supplierIds: [p.supplierId], totalCents: toCents(purchaseTotalInclVat(p).toFixed(2)), paidCents: toCents(paid.toFixed(2)), refs: refsOfPurchase(p), date: iso(p.orderDate) });
    }
  }
  if (canWork) {
    const orders = await prisma.productionOrder.findMany({
      where: { organizationId: orgId, status: { not: "CANCELLED" }, clientId: { not: null } },
      select: { id: true, number: true, workOrderNumber: true, status: true, plannedQuantity: true, producedQuantity: true, clientWorkPricePerUnit: true, clientId: true, client: { select: { name: true } }, batch: { select: { number: true } } },
      orderBy: { createdAt: "asc" },
    });
    const alloc = await allocatedCentsByOrder(prisma, orgId, orders.map((o) => o.id));
    const clients = new Map<string, string>();
    for (const o of orders) {
      if (o.clientId && o.client) clients.set(o.clientId, o.client.name);
      out.workTargets.push({
        id: o.id,
        label: `ТЗ ${o.workOrderNumber ?? o.number}${o.workOrderNumber && o.workOrderNumber !== o.number ? ` (${o.number})` : ""}${o.batch ? ` · партия ${o.batch.number}` : ""}`,
        clientId: o.clientId,
        batch: o.batch?.number ?? null,
        workCents: orderWorkCents(o),
        paidCents: alloc.get(o.id) ?? 0,
        refs: [o.workOrderNumber, o.number].filter((v): v is string => !!v).map(normRef),
      });
    }
    out.clients = [...clients].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "ru"));
  }
  return out;
}

export type WizardResult = {
  error?: string;
  confirm?: string;
  ok?: boolean;
  paymentIds?: string[];
  summary?: { lines: string[]; debtBefore: number | null; debtAfter: number | null };
};

type Payload = {
  side: "supplier" | "work";
  kind: PayKind;
  paidAt: string;
  amount: string;
  ppNo: string;
  basis: string;
  note: string;
  method: string;
  supplierId?: string;
  clientId?: string;
  markConfirmed: boolean;
  confirmOverpay: boolean;
  parts: { key: string; amount: string }[];
};

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const cents = (s: unknown): number => {
  const t = String(s ?? "").replace(/[\s  ]/g, "").replace(",", ".");
  return /^[+]?(\d+\.?\d*|\.\d+)$/.test(t) ? Math.round(Number(t) * 100) : NaN;
};

export async function saveWizardPayment(formData: FormData): Promise<WizardResult> {
  const session = await requireSession();
  const orgId = session.user.organizationId;
  const userId = session.user.id as string;
  let p: Payload;
  try {
    p = JSON.parse(String(formData.get("payload") ?? "")) as Payload;
  } catch {
    return { error: "Не удалось прочитать данные формы — обновите страницу" };
  }
  const side = p.side === "work" ? "work" : "supplier";
  if (!hasRole(session.user.role, side === "supplier" ? SUPPLIER_ROLES : WORK_ROLES)) return { error: "Недостаточно прав для внесения такой оплаты" };
  const kindDef = PAY_KINDS.find((k) => k.v === p.kind);
  if (!kindDef || kindDef.supplierOnly) return { error: "Выберите вид оплаты" };
  const paidAt = parseDateInput(String(p.paidAt ?? "").trim());
  if (!paidAt) return { error: "Укажите дату оплаты" };
  if (paidAt.getUTCFullYear() < 2020 || paidAt.getUTCFullYear() > 2100) return { error: "Дата вне допустимого диапазона (2020–2100)" };
  const paidIso = paidAt.toISOString().slice(0, 10);
  const amountC = cents(p.amount);
  if (!Number.isFinite(amountC) || amountC < 1) return { error: "Сумма оплаты: укажите положительное число" };
  const ppNo = String(p.ppNo ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 40);
  const basis = String(p.basis ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 300);
  const noteIn = String(p.note ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 600);
  if (p.kind === "OTHER" && noteIn.length < 3) return { error: "Для вида «Другое» напишите пометку — что это за платёж" };
  const method = (["CASH", "BANK_TRANSFER", "CARD", "OTHER"].includes(p.method) ? p.method : "BANK_TRANSFER") as "CASH" | "BANK_TRANSFER" | "CARD" | "OTHER";
  const warns: string[] = [];
  if (paidIso > todayIso()) warns.push(`Дата оплаты (${paidIso}) в будущем.`);

  const parts = (Array.isArray(p.parts) ? p.parts : []).map((x) => ({ key: String(x.key), c: cents(x.amount) }));
  if (parts.length > 40) return { error: "Не больше 40 строк разнесения" };
  if (parts.some((x) => !Number.isFinite(x.c) || x.c < 1)) return { error: "В таблице разнесения у каждой строки сумма должна быть больше нуля (пустые строки уберите)" };
  if (new Set(parts.map((x) => x.key)).size !== parts.length) return { error: "Одна и та же цель указана в таблице дважды — объедините строки" };
  const sumC = parts.reduce((s, x) => s + x.c, 0);
  if (sumC > amountC) return { error: `Разнесено ${formatMoney(sumC / 100)} — больше суммы оплаты ${formatMoney(amountC / 100)}. Уменьшите суммы в таблице.` };
  const restC = amountC - sumC;

  // файлы: платёжка / счёт / письмо / другое
  const entries = formData.getAll("files").filter(isPickedFile);
  const roles = formData.getAll("fileRoles").map(String);
  const docs: { doc: ReadDoc; role: DocRole }[] = [];
  if (entries.length > 10) return { error: "За один раз можно приложить не больше 10 файлов" };
  for (let i = 0; i < entries.length; i++) {
    const r = await readDocumentFiles([entries[i]]);
    if ("error" in r) return { error: r.error };
    docs.push({ doc: r.files[0], role: (["PAYMENT_PROOF", "PAYMENT_INVOICE", "APPROVAL_EMAIL", "OTHER"].includes(roles[i]) ? roles[i] : "OTHER") as DocRole });
  }
  const hasProof = docs.some((d) => d.role === "PAYMENT_PROOF");
  if (p.markConfirmed && !canConfirm({ hasProofFile: hasProof, ppNo, paidAt: paidIso, amount: amountC / 100 })) {
    return { error: "«Подтверждено» можно отметить, только если указан № п/п (с датой и суммой) или приложена платёжка." };
  }

  const stored: string[] = [];
  const storedDrive: string[] = [];
  const debtBefore = side === "supplier" ? d2((await loadSupplierDebt(prisma, orgId)).debt) : null;
  let result: WizardResult;
  try {
    result = await prisma.$transaction(
      async (tx): Promise<WizardResult> => {
        const warn = [...warns];
        const lines: string[] = [];
        const docRef = docRefOf(ppNo, paidIso);
        const kindLabel = kindDef.label;
        const baseNotes = [kindNote(p.kind), basis ? `Основание: ${basis}` : "", noteIn, "внесена в мастере оплаты"].filter(Boolean);
        const proof = docs.find((d) => d.role === "PAYMENT_PROOF");
        const others = docs.filter((d) => d !== proof);
        const confirmedFlag = p.markConfirmed || !!proof;
        const confirmStamp = p.markConfirmed ? { confirmedAt: new Date(), confirmedBy: userId } : {};
        const dupSince = new Date(Date.now() - 2 * 60 * 1000);

        if (side === "supplier") {
          const supplierId = String(p.supplierId ?? "");
          if (!supplierId || !(await tx.supplier.findFirst({ where: { id: supplierId, organizationId: orgId }, select: { id: true } }))) return { error: "Выберите поставщика" };
          const keys = parts.map((x) => x.key);
          for (const k of [...keys.map((x) => (x.startsWith("p:") ? "purchase:" + x.slice(2) : x.slice(2))), "advance:" + supplierId].sort()) await lockAuction(tx, orgId, k);
          const links: { key: string; c: number; link: { auctionSession: string | null; purchaseId: string | null }; title: string; purchaseForDoc: string | null; auction: string | null }[] = [];
          const overpay: string[] = [];
          for (const x of parts) {
            const m = /^([ap]):([\s\S]+)$/.exec(x.key);
            if (!m) return { error: "Неизвестная цель разнесения — обновите страницу" };
            if (m[1] === "a") {
              const [s] = await loadAuctionSummaries(tx, orgId, [m[2]]);
              if (!s || s.purchases === 0) return { error: `Аукцион «${m[2]}» не найден или в нём нет действующих закупок` };
              if (!s.suppliers.some((y) => y.id === supplierId)) return { error: `Аукцион «${m[2]}» оформлен на другого поставщика` };
              const after = s.paid.add(x.c / 100);
              if (after.sub(s.total).greaterThan(PAY_EPS)) overpay.push(`«${m[2]}»: оплачено станет ${formatMoney(after.toString())} при стоимости ${formatMoney(s.total.toString())}`);
              links.push({ key: x.key, c: x.c, link: { auctionSession: m[2], purchaseId: null }, title: `Аукцион «${m[2]}»`, purchaseForDoc: null, auction: m[2] });
            } else {
              const pu = await tx.purchase.findFirst({ where: { id: m[2], organizationId: orgId }, include: { items: true, expenses: true, payments: { where: { status: "COMPLETED" }, select: { amount: true } } } });
              if (!pu || pu.status === "CANCELLED") return { error: "Закупка не найдена или отменена" };
              if (pu.auctionSession) return { error: `Закупка ${pu.number} входит в аукцион — разнесите на аукцион` };
              if (pu.supplierId !== supplierId) return { error: `Закупка ${pu.number} оформлена на другого поставщика` };
              const after = pu.payments.reduce((a, b) => a.add(b.amount), new Decimal(0)).add(x.c / 100);
              if (after.sub(purchaseTotalInclVat(pu)).greaterThan(PAY_EPS)) overpay.push(`закупка ${pu.number}: оплачено станет ${formatMoney(after.toString())} при стоимости ${formatMoney(purchaseTotalInclVat(pu).toString())}`);
              links.push({ key: x.key, c: x.c, link: { auctionSession: null, purchaseId: pu.id }, title: `Закупка ${pu.number}`, purchaseForDoc: pu.id, auction: null });
            }
          }
          if (overpay.length) warn.push(`Переплата: ${overpay.join("; ")}.`);
          const dup = await tx.payment.count({ where: { organizationId: orgId, supplierId, amount: new Decimal(amountC / 100), paidAt, createdAt: { gte: dupSince } } });
          if (dup > 0) warn.push("Такая же оплата (сумма, дата, поставщик) только что уже записана — возможно, это двойная отправка.");
          if (warn.length > 0 && !p.confirmOverpay) return { confirm: `${warn.join(" ")} Всё равно записать?` };

          let documentId: string | null = null;
          if (proof) {
            const w = await writeDocumentFiles(orgId, "payments", [proof.doc]);
            stored.push(w[0].storagePath);
            const first = links[0];
            const pd = await tx.purchaseDocument.create({ data: { organizationId: orgId, purchaseId: first?.purchaseForDoc ?? null, batch: first?.auction ?? null, kind: "PAYMENT_PROOF", title: `Платёжка: ${kindLabel} ${paidIso}`, ...w[0] } });
            documentId = pd.id;
          }
          const rows = [...links.map((l) => ({ c: l.c, ...l.link, title: l.title })), ...(restC > 0 ? [{ c: restC, auctionSession: null, purchaseId: null, title: "Аванс без привязки (остаток)" }] : [])];
          const ids: string[] = [];
          for (let i = 0; i < rows.length; i++) {
            const r = rows[i];
            const pay = await tx.payment.create({
              data: {
                organizationId: orgId, supplierId, purchaseId: r.purchaseId, auctionSession: r.auctionSession, amount: new Decimal(r.c / 100),
                currency: "RUB", method, status: "COMPLETED", paidAt, kind: kindDef.db,
                notes: [...baseNotes, rows.length > 1 ? `часть ${i + 1} из ${rows.length} оплаты ${formatMoney(amountC / 100)}` : "", !r.purchaseId && !r.auctionSession ? SAVED_LATER_NOTE : ""].filter(Boolean).join(" · ").slice(0, 1000),
                documentId, docRef, confirmed: confirmedFlag, ...confirmStamp,
              },
            });
            ids.push(pay.id);
            lines.push(`${r.title}: ${formatMoney(r.c / 100)}`);
          }
          for (const s of others) {
            const f = await writeDriveFile(orgId, s.doc);
            storedDrive.push(f.storagePath);
            await tx.driveDocument.create({ data: { organizationId: orgId, driveFileId: `local-${randomUUID()}`, title: `${s.role === "PAYMENT_INVOICE" ? "Счёт" : s.role === "APPROVAL_EMAIL" ? "Письмо-согласование" : "Документ"}: ${s.doc.originalName}`.slice(0, 200), docType: s.role, mimeType: f.storedMime, sizeBytes: f.storedSize, ...f, storedAt: new Date(), paymentId: ids[0], purchaseId: links[0]?.purchaseForDoc ?? null } });
          }
          await resetVerification(tx, orgId, { auctions: links.map((l) => l.auction), purchaseIds: links.map((l) => l.purchaseForDoc), paymentIds: ids });
          return { ok: true, paymentIds: ids, summary: { lines, debtBefore, debtAfter: null } };
        }

        // ---- по работе (ТЗ)
        const orderIds = parts.map((x) => x.key);
        const orders = orderIds.length
          ? await tx.productionOrder.findMany({ where: { id: { in: orderIds }, organizationId: orgId }, select: { id: true, number: true, workOrderNumber: true, status: true, plannedQuantity: true, producedQuantity: true, clientWorkPricePerUnit: true, clientId: true, batchId: true } })
          : [];
        if (orders.length !== orderIds.length) return { error: "Одно из ТЗ не найдено — обновите страницу" };
        if (orders.some((o) => o.status === "CANCELLED")) return { error: "ТЗ отменено — на него нельзя разнести оплату" };
        const clientId = String(p.clientId ?? "") || orders.find((o) => o.clientId)?.clientId || null;
        if (clientId && !(await tx.client.findFirst({ where: { id: clientId, organizationId: orgId }, select: { id: true } }))) return { error: "Заказчик не найден" };
        if (orders.some((o) => o.clientId && clientId && o.clientId !== clientId)) return { error: "Среди ТЗ есть ТЗ другого заказчика — выберите ТЗ одного заказчика" };
        const others0 = await allocatedCentsByOrder(tx, orgId, orderIds);
        const over = parts.map((x) => {
          const o = orders.find((y) => y.id === x.key)!;
          return { o, extra: x.c - (orderWorkCents(o) - (others0.get(o.id) ?? 0)) };
        }).filter((x) => x.extra > 1);
        if (over.length) warn.push(`Разнесено больше остатка работы: ${over.slice(0, 3).map((x) => `ТЗ ${x.o.workOrderNumber ?? x.o.number} (+${fromCents(x.extra)} ₽)`).join(", ")}${over.length > 3 ? " и др." : ""} — переплата.`);
        if (parts.length > 0 && orders.some((o) => orderWorkCents(o) === 0)) warn.push("У части ТЗ не задана цена работы — оплата по ним возможна только как аванс.");
        const dup = await tx.productionPayment.count({ where: { organizationId: orgId, amount: new Decimal(amountC / 100), paidAt, createdAt: { gte: dupSince }, ...(clientId ? { clientId } : {}) } });
        if (dup > 0) warn.push("Такая же оплата (сумма, дата, заказчик) только что уже записана — возможно, это двойная отправка.");
        if (warn.length > 0 && !p.confirmOverpay) return { confirm: `${warn.join(" ")} Всё равно записать?` };

        const pay = await tx.productionPayment.create({
          data: {
            organizationId: orgId, clientId, amount: new Decimal(amountC / 100), paymentType: kindDef.db === "OTHER" ? "PARTIAL" : kindDef.db, method, status: "COMPLETED", paidAt,
            notes: [...baseNotes, restC > 0 ? `не разнесено ${formatMoney(restC / 100)}` : ""].filter(Boolean).join(" · ").slice(0, 1000), docRef, confirmed: confirmedFlag, ...confirmStamp,
            orders: { create: orderIds.map((productionOrderId) => ({ productionOrderId })) },
          },
        });
        if (parts.length) {
          await tx.paymentAllocation.createMany({ data: parts.map((x) => ({ organizationId: orgId, productionPaymentId: pay.id, productionOrderId: x.key, amount: fromCents(x.c), source: "MANUAL" as const, note: "Разнесено в мастере оплаты" })) });
        }
        for (const s of docs) {
          const f = await writeDriveFile(orgId, s.doc);
          storedDrive.push(f.storagePath);
          await tx.driveDocument.create({ data: { organizationId: orgId, driveFileId: `local-${randomUUID()}`, title: `${s.role === "PAYMENT_PROOF" ? "Платёжка" : s.role === "PAYMENT_INVOICE" ? "Счёт" : s.role === "APPROVAL_EMAIL" ? "Письмо-согласование" : "Документ"}: ${s.doc.originalName}`.slice(0, 200), docType: s.role, mimeType: f.storedMime, sizeBytes: f.storedSize, ...f, storedAt: new Date(), productionPaymentId: pay.id } });
        }
        await resetVerification(tx, orgId, { orderIds, batchIds: orders.map((o) => o.batchId).filter((x): x is string => !!x), prodPaymentIds: [pay.id] });
        for (const x of parts) {
          const o = orders.find((y) => y.id === x.key)!;
          lines.push(`ТЗ ${o.workOrderNumber ?? o.number}: ${formatMoney(x.c / 100)}`);
        }
        if (restC > 0) lines.push(`Не разнесено (аванс заказчика): ${formatMoney(restC / 100)}`);
        return { ok: true, paymentIds: [pay.id], summary: { lines, debtBefore: null, debtAfter: null } };
      },
      { timeout: 60000, maxWait: 15000 },
    );
  } catch (e) {
    await removeStoredFiles([...stored, ...storedDrive]);
    return { error: e instanceof Error ? e.message : "Не удалось сохранить оплату" };
  }
  if (!result.ok) {
    await removeStoredFiles([...stored, ...storedDrive]);
    return result;
  }
  if (side === "supplier" && result.summary) result.summary.debtAfter = d2((await loadSupplierDebt(prisma, orgId)).debt);
  revalidateAll(orgId);
  return result;
}
