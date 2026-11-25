import "server-only";
import { uniqueOrderCount } from "@/lib/tz-key";
import { orderUnits } from "@/lib/production-totals";
import { buildBatchPanel, loadProductionModel, type BatchPanelData, type Ctx } from "@/lib/production-doc-checklist";
import type { Commission4Mode } from "@/lib/commission4-mode";
import type { Group, Registry } from "@/app/(app)/reconciliation/model";
import { articleLabel } from "@/lib/article-label";
import { fmtRub, iso, NON_STOCK_RE, stampOf, templateDateIssue } from "./evidence";
import type { Blocker, ModelCtx, VerifyRow } from "./types";

// Шаг loadVerifyModel: строки ТЗ и партий (вынесено из verification.ts без изменений).

const batchGroup = (reg: Registry, n: number): Group | null => reg.groups.find((g) => g.section === "production" && g.dbLink.batch === n) ?? null;

// --------------------------------------------------------------------------------------- ТЗ и партии
export async function addProductionRows({ db, orgId, opts, only, reg0, userId, names, rows, extra, pick }: ModelCtx): Promise<void> {
  const c4: Commission4Mode = opts.c4Mode ?? "off";
  const ctx: Ctx = { c4Mode: c4, canUpload: !!opts.canUpload, canMark: !!opts.canMark };
  const m = await loadProductionModel(db, orgId);
  const batchById = new Map(m.raw.batches.map((b) => [b.id, b]));
  const orderRows = new Map<string, VerifyRow>();
  const nonCancelled = m.raw.orders.filter((o) => o.status !== "CANCELLED");

  for (const o of nonCancelled) {
    const batch = o.batchId ? batchById.get(o.batchId) : null;
    const blockers: Blocker[] = [];
    const href = `/production/${o.id}`;
    const own = m.docsByOrder.get(o.id) ?? [];
    if (!own.some((d) => d.docType === "TZ_APPENDIX"))
      blockers.push({ text: "приложение к ТЗ не прикреплено", href, upload: { action: "driveDoc", entity: "order", id: o.id, docType: "TZ_APPENDIX", label: "Прикрепить приложение ТЗ" } });
    if (!o.workOrderDate) blockers.push({ text: "даты ТЗ нет (в приложении только шаблонная дата договора) — внести по оригиналу", href });
    else {
      const t = templateDateIssue(o.workOrderNumber ?? o.number, o.workOrderDate); // номер ТЗ из документа, не внутренний П-2026-xxxx
      if (t) blockers.push({ text: t, href });
    }
    if (!batch && (o as { batchNotRequired?: boolean | null }).batchNotRequired !== true) blockers.push({ text: "партия не указана", href });
    if (!o.clientId) blockers.push({ text: "заказчик не указан", href });
    const qty = orderUnits(o);
    if (!(qty > 0)) blockers.push({ text: "количество не задано", href });
    if (!o.clientWorkPricePerUnit || !o.clientWorkPricePerUnit.greaterThan(0)) blockers.push({ text: "цена работы не задана", href });
    const nonStock = NON_STOCK_RE.test(`${o.notes ?? ""} ${o.materialDescription ?? ""}`) || (o.materialUsages.length > 0 && o.materialUsages.every((u) => !u.commission4));
    if (o.materialUsages.length === 0 && !nonStock) blockers.push({ text: "состав материалов не задан (нет списаний сырья)", href });
    if (batch) {
      const g = batchGroup(reg0, batch.number);
      const chk = g?.checks?.find((c) => /ТЗ-приложения/.test(c.label));
      if (!g) blockers.push({ text: `партии ${batch.number} нет в реестре сверки: количество и работу сверить не с чем`, href: "/reconciliation" });
      else if (!chk || !chk.ok) blockers.push({ text: `в реестре сверки партии ${batch.number}: количество/работа не совпали с приложениями ТЗ`, href: `/reconciliation#${encodeURIComponent(g.id)}` });
    }
    const st = stampOf(o.verifiedAt, o.verifiedBy, userId, names);
    const dateForYear = o.workOrderDate ?? o.endDate ?? o.startDate;
    const row: VerifyRow = {
      key: `order:${o.id}`, kind: "order", id: o.id,
      title: `ТЗ ${o.workOrderNumber ?? o.number}`, sub: `${articleLabel(o.productModel)}${o.client ? ` · ${o.client.name}` : ""} · ${qty.toString()} шт.`,
      href, group: batch ? `Партия ${batch.number}` : null, year: dateForYear ? dateForYear.getUTCFullYear() : (batch?.year ?? null),
      amountText: o.clientWorkPricePerUnit ? fmtRub(o.clientWorkPricePerUnit.mul(qty)) : null,
      verified: !!o.verifiedAt, auto: !!o.verifiedAt && st.auto, stampText: o.verifiedAt ? st.text : null, note: o.verifyNote,
      ready: blockers.length === 0, blockers,
      edit: { date: o.workOrderDate ? iso(o.workOrderDate) : "", number: o.workOrderNumber ?? "" },
      registryFact: null, members: [],
    };
    orderRows.set(o.id, row);
    extra.orderBatchNumber.set(o.id, batch?.number ?? null);
    if (pick("order") && (!only || only.id === o.id)) rows.push(row);
  }

  if (pick("batch")) {
    for (const b of m.raw.batches) {
      if (only && only.id !== b.id) continue;
      const bp: BatchPanelData | null = buildBatchPanel(m, b, ctx);
      if (!bp) continue;
      const blockers: Blocker[] = [];
      const href = `/production/batches/${b.number}`;
      const live = (m.ordersByBatch.get(b.id) ?? []).filter((o) => o.status !== "CANCELLED");
      const unverified = live.filter((o) => !orderRows.get(o.id)?.verified);
      if (unverified.length > 0) {
        const nums = unverified.map((o) => o.workOrderNumber ?? o.number);
        blockers.push({ text: `ТЗ не подтверждены: ${uniqueOrderCount(unverified)} из ${uniqueOrderCount(live)}${live.length > uniqueOrderCount(live) ? ` ТЗ · позиций ${unverified.length} из ${live.length}` : ""} (${nums.slice(0, 8).join(", ")}${nums.length > 8 ? "…" : ""})`, href: `/verify?tab=orders&q=${encodeURIComponent(`Партия ${b.number}`)}` });
      }
      for (const it of bp.panel.items) {
        if (it.key === "TZ_APPENDIX") continue; // по ТЗ — выше
        if (it.need === "required" && !it.ok) blockers.push({ text: `нет документа: ${it.label}`, href, upload: it.uploads[0] });
      }
      const pay = bp.panel.pay;
      if (pay.state !== "PAID") blockers.push({ text: `оплата за работу: ${pay.label}`, href });
      if (bp.panel.proofMissing > 0) blockers.push({ text: `оплат без платёжки/п/п: ${bp.panel.proofMissing}`, href });
      const g = batchGroup(reg0, b.number);
      if (!g) blockers.push({ text: "партии нет в реестре сверки", href: "/reconciliation" });
      else {
        for (const c of (g.checks ?? []).filter((x) => !x.ok && !/ТЗ-приложения|Остаток по документам/.test(x.label))) blockers.push({ text: `не сошлось: ${c.label}`, href: `/reconciliation#${encodeURIComponent(g.id)}` });
      }
      const st = stampOf(b.verifiedAt, b.verifiedBy, userId, names);
      rows.push({
        key: `batch:${b.id}`, kind: "batch", id: b.id,
        title: bp.panel.title, sub: bp.panel.subtitle, href, group: `Партия ${b.number}`, year: b.year ?? bp.year,
        amountText: pay.state === "NOBASE" ? null : pay.totalText,
        verified: !!b.verifiedAt, auto: !!b.verifiedAt && st.auto, stampText: b.verifiedAt ? st.text : null, note: b.verifyNote,
        ready: blockers.length === 0, blockers, edit: null, registryFact: null,
        members: live.map((o) => `${o.workOrderNumber ?? o.number}${orderRows.get(o.id)?.verified ? " ✓" : ""}`),
      });
      extra.batchNumber.set(b.id, b.number);
    }
  }
}
