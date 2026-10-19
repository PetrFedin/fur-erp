/**
 * Журнал изменений: чистая логика без доступа к БД и без server-only (используется расширением клиента
 * в src/lib/prisma.ts, страницей /history и скриптом-проверкой).
 */
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";

/** Какие операции журналируются по каждой модели (белый список). */
type Op = "create" | "update" | "delete";
const ALL: Op[] = ["create", "update", "delete"];
export const AUDITED_MODELS: Record<string, Op[]> = {
  Purchase: ALL,
  PurchaseItem: ALL,
  PurchaseExpense: ALL,
  RawMaterialLot: ALL,
  Payment: ALL,
  ProductionPayment: ALL,
  ProductionPaymentOrder: ALL,
  PaymentAllocation: ALL,
  ProductionOrder: ALL,
  ProductionMaterialUsage: ALL,
  ProductionExpense: ALL,
  ProductionBatch: ALL,
  ProductionOrderColor: ALL,
  ProductModel: ALL,
  ColorRef: ALL,
  FurAttrRef: ALL,
  Auction: ALL,
  FurRef: ALL,
  Season: ALL,
  ProductionPlan: ALL,
  ProductionPlanSize: ALL,
  CalendarEvent: ALL,
  Supplier: ALL,
  Client: ALL,
  User: ALL,
  CustomField: ALL,
  DriveDocument: ALL,
  PurchaseDocument: ALL,
  Shipment: ALL,
  ShipmentLine: ALL,
  ShipmentEvent: ALL,
  ShipmentEventLine: ALL,
  SupplierRawStage: ALL,
  Fitting: ALL,
  SupplyPlanEntry: ALL,
  FinishedGoodsStock: ["create", "delete"],
  FinishedGoodsMovement: ["create", "delete"],
  Comment: ALL,
  CommentReply: ALL,
  SystemState: ALL,
  SupplierInbox: ALL,
  SupplierInboxFile: ALL,
  SupplierCalcTemplate: ALL,
  ReconciliationGroup: ALL,
  ReconciliationInvoice: ALL,
  ReconciliationInvoiceGroup: ALL,
  ReconciliationInvoicePayment: ALL,
  ReconciliationPaymentLink: ALL,
  ReconciliationCheck: ALL,
};

/**
 * Поля, которые не пишем никогда: технические и секреты. driveFileId / drivePath / viewUrl — служебный ключ файла
 * и внешние пути/ссылки прежних импортов (с 16.10.2026 не показываются и не хранятся в журнале).
 */
export const IGNORED_FIELDS = new Set(["updatedAt", "passwordHash", "driveFileId", "drivePath", "viewUrl"]);

/** Дочерние строки, которые уходят каскадом при удалении, — кладём в снимок удалённого, чтобы можно было восстановить вручную. */
export const DELETE_CHILDREN: Record<string, Record<string, true>> = {
  Purchase: { items: true, expenses: true },
  ProductionOrder: { materialUsages: true, expenses: true, paymentAllocations: true, payShares: true, colors: true },
  ProductionPlan: { sizes: true },
  Shipment: { lines: true, events: true },
  ShipmentEvent: { lines: true },
  Fitting: { photos: true },
  ProductModel: { materials: true },
  ProductionPayment: { orders: true, allocations: true },
};

const MAX_STR = 2000;

type FieldMeta = { scalars: Set<string>; json: Set<string> };
let META: Map<string, FieldMeta> | null = null;
function meta(model: string): FieldMeta {
  if (!META) {
    META = new Map();
    try {
      for (const m of Prisma.dmmf.datamodel.models) {
        META.set(m.name, {
          scalars: new Set(m.fields.filter((f) => f.kind === "scalar" || f.kind === "enum").map((f) => f.name)),
          json: new Set(m.fields.filter((f) => f.type === "Json").map((f) => f.name)),
        });
      }
    } catch {
      /* без dmmf — эвристика ниже */
    }
  }
  return META.get(model) ?? { scalars: new Set(), json: new Set() };
}

function isDecimal(v: unknown): v is Prisma.Decimal {
  return typeof v === "object" && v !== null && Prisma.Decimal.isDecimal(v);
}

/** Стабильная строка для сравнения значений (ключи объектов отсортированы). */
function stable(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (v instanceof Date) return JSON.stringify(v.toISOString());
  if (isDecimal(v)) return JSON.stringify(v.toString());
  if (typeof v === "bigint") return JSON.stringify(v.toString());
  if (Array.isArray(v)) return "[" + v.map(stable).join(",") + "]";
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return "{" + Object.keys(o).sort().map((k) => JSON.stringify(k) + ":" + stable(o[k])).join(",") + "}";
  }
  return JSON.stringify(v);
}

/** Значение для хранения в журнале: Decimal/Date → строка, длинные строки и Json усечены. */
export function serValue(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (isDecimal(v)) return v.toString();
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "string") return v.length > MAX_STR ? v.slice(0, MAX_STR) + `…[ещё ${v.length - MAX_STR} симв.]` : v;
  if (Array.isArray(v) || typeof v === "object") {
    const s = stable(v);
    if (s.length <= MAX_STR) return JSON.parse(s);
    return { _truncated: true, length: s.length, sha1: createHash("sha1").update(s).digest("hex"), preview: s.slice(0, 500) };
  }
  return v;
}

/** Плоская копия строки: только скалярные поля, без технических и секретных. */
export function snapshot(model: string, row: Record<string, unknown>): Record<string, unknown> {
  const m = meta(model);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (IGNORED_FIELDS.has(k)) continue;
    if (m.scalars.size > 0) {
      if (!m.scalars.has(k)) continue;
    } else if (v !== null && typeof v === "object" && !(v instanceof Date) && !isDecimal(v) && !Array.isArray(v)) continue;
    out[k] = serValue(v);
  }
  return out;
}

/** Снимок удаляемой строки вместе с каскадными дочерними (ключ `_children`). */
export function deleteSnapshot(model: string, row: Record<string, unknown>): Record<string, unknown> {
  const out = snapshot(model, row);
  const kids = DELETE_CHILDREN[model];
  if (kids) {
    const children: Record<string, unknown[]> = {};
    for (const rel of Object.keys(kids)) {
      const arr = row[rel];
      if (Array.isArray(arr)) children[rel] = arr.map((r) => snapshot("", r as Record<string, unknown>));
    }
    out._children = children;
  }
  return out;
}

/** {поле: [было, стало]} только по изменившимся полям. */
export function diffRows(model: string, before: Record<string, unknown>, after: Record<string, unknown>): Record<string, [unknown, unknown]> {
  const m = meta(model);
  const d: Record<string, [unknown, unknown]> = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of keys) {
    if (IGNORED_FIELDS.has(k)) continue;
    if (m.scalars.size > 0 && !m.scalars.has(k)) continue;
    const a = before[k];
    const b = after[k];
    if (isDecimal(a) && isDecimal(b)) {
      if (a.equals(b)) continue;
    } else if (stable(a) === stable(b)) continue;
    d[k] = [serValue(a), serValue(b)];
  }
  return d;
}

function money(v: unknown): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v ?? "");
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(n).replace(/ | /g, " ") + " ₽";
}
function day(v: unknown): string {
  if (!v) return "";
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${d.getUTCFullYear()}`;
}

export const MODEL_TITLES: Record<string, string> = {
  ReconciliationGroup: "Группа сверки",
  ReconciliationInvoice: "Счёт в сверке",
  ReconciliationInvoiceGroup: "Счёт в группе сверки",
  ReconciliationInvoicePayment: "Оплата счёта по документам",
  ReconciliationPaymentLink: "Привязка платежа к счёту",
  ReconciliationCheck: "Отметка «сверка выполнена»",
  Purchase: "Закупка",
  PurchaseItem: "Позиция закупки",
  PurchaseExpense: "Расход закупки",
  RawMaterialLot: "Лот сырья",
  Payment: "Оплата поставщику",
  ProductionPayment: "Оплата производства",
  ProductionPaymentOrder: "Привязка оплаты к ТЗ",
  PaymentAllocation: "Разнесение оплаты",
  ProductionOrder: "ТЗ",
  ProductionMaterialUsage: "Списание материала",
  ProductionExpense: "Расход ТЗ",
  ProductionBatch: "Партия",
  ProductionOrderColor: "Цвет ТЗ",
  ProductModel: "Модель / артикул",
  ColorRef: "Цвет",
  FurAttrRef: "Признак меха",
  Auction: "Аукцион",
  FurRef: "Мех",
  Season: "Сезон",
  ProductionPlan: "План заказа",
  ProductionPlanSize: "Размер плана",
  CalendarEvent: "Событие календаря",
  Supplier: "Поставщик",
  Client: "Заказчик",
  User: "Пользователь",
  CustomField: "Свой столбец",
  DriveDocument: "Документ",
  PurchaseDocument: "Документ закупки",
  Shipment: "Отгрузка",
  ShipmentLine: "Строка отгрузки",
  ShipmentEvent: "Этап отгрузки",
  ShipmentEventLine: "Строка этапа отгрузки",
  SupplierRawStage: "Этап сырья",
  Fitting: "Примерка",
  SupplyPlanEntry: "План поставок",
  FinishedGoodsStock: "Остаток готовой продукции",
  FinishedGoodsMovement: "Движение готовой продукции",
  Comment: "Комментарий",
  CommentReply: "Ответ на комментарий",
  SystemState: "Служебная отметка (решение владельца)",
  BatchIntake: "Новая партия закупки",
  ArticlePhoto: "Фото артикула",
};

/** Понятное название записи: «Закупка З-2026-0014», «ТЗ 19», «Оплата 34 825 000 ₽ 28.02.2025». */
export function labelFor(model: string, r: Record<string, unknown>): string {
  const s = (k: string) => (r[k] === null || r[k] === undefined || r[k] === "" ? null : String(r[k]));
  const t = MODEL_TITLES[model] ?? model;
  switch (model) {
    case "Purchase": return `Закупка ${s("number") ?? ""}`.trim();
    case "ProductionOrder": return `ТЗ ${s("workOrderNumber") ?? s("number") ?? ""}`.trim();
    case "ProductionBatch": return `Партия №${s("number") ?? ""}${s("name") ? " " + s("name") : ""}`.trim();
    case "Payment": return `Оплата ${money(r.amount)} ${day(r.paidAt)}`.trim() + (s("auctionSession") ? ` · ${s("auctionSession")}` : "");
    case "ProductionPayment": return `Оплата производства ${money(r.amount)} ${day(r.paidAt)}`.trim();
    case "RawMaterialLot": return `Лот ${s("lotNumber") ?? "без номера"}${s("color") ? " " + s("color") : ""}`.trim();
    case "FinishedGoodsMovement": return `Движение готовой продукции${r.date ? " от " + day(r.date) : ""}`.trim();
    case "PaymentAllocation": return `Разнесение оплаты ${money(r.amount)}`.trim();
    case "PurchaseItem": return `Позиция закупки${s("lotNumber") ? " лот " + s("lotNumber") : ""} ${money(r.subtotal)}`.trim();
    case "ProductModel": return `Модель ${s("name") ?? ""}${s("sku") ? " (" + s("sku") + ")" : ""}`.trim();
    case "Auction": return `Аукцион ${s("name") ?? ""}`.trim();
    case "ColorRef": return `Цвет ${s("name") ?? ""}`.trim();
    case "FurAttrRef": return `Признак меха ${s("name") ?? ""}`.trim();
    case "FurRef": return `Мех ${s("name") ?? ""}`.trim();
    case "Season": return `Сезон ${s("code") ?? ""}`.trim();
    case "ProductionPlan": return `План заказа ${s("articleCode") ?? ""}`.trim();
    case "ProductionPlanSize": return `Размер плана ${s("size") ?? ""}: ${s("quantity") ?? ""}`.trim();
    case "CalendarEvent": return `Календарь: ${s("action") ?? ""} ${s("articleCode") ?? ""} ${day(r.date)}`.trim();
    case "Supplier": return `Поставщик ${s("name") ?? ""}`.trim();
    case "Client": return `Заказчик ${s("name") ?? ""}`.trim();
    case "User": return `Пользователь ${s("name") ?? s("email") ?? ""}`.trim();
    case "CustomField": return `Столбец ${s("name") ?? ""}`.trim();
    case "DriveDocument": return `Документ ${s("title") ?? ""}`.trim();
    case "PurchaseDocument": return `Документ ${s("title") ?? ""}`.trim();
    case "Shipment": return s("name") ? `Отгрузка «${s("name")}»` : `Отгрузка ${day(r.plannedDate)}`.trim();
    case "ShipmentLine": return `Строка отгрузки${s("color") ? " " + s("color") : ""}${s("size") ? " р." + s("size") : ""} ×${s("quantity") ?? ""}`.trim();
    case "SupplierRawStage": return `Этап сырья «${s("stage") ?? ""}»${s("place") ? " · " + s("place") : ""} (${s("status") ?? ""})`;
    case "ShipmentEvent": return `Этап отгрузки «${s("title") ?? ""}» ${day(r.occurredAt)}`.trim();
    case "ShipmentEventLine": return `Строка этапа: принято ${s("accepted") ?? "—"}, не принято ${s("rejected") ?? "—"}, возвращено ${s("returned") ?? "—"}`;
    case "Fitting": return `Примерка ${day(r.fittingDate)}`.trim();
    case "SupplyPlanEntry": return `План поставок ${day(r.month)}`.trim();
    case "PurchaseExpense": return `Расход закупки ${money(r.amount)}${s("description") ? " · " + s("description") : ""}`.trim();
    case "ProductionMaterialUsage": return `Списание материала ${s("quantity") ?? ""}`.trim();
    case "ProductionExpense": return `Расход ТЗ ${money(r.amount)}`.trim();
    case "Comment": return `Комментарий: ${(s("text") ?? "").slice(0, 60)}${s("pageTitle") ? " · " + s("pageTitle") : ""}`.trim();
    case "CommentReply": return `Ответ: ${(s("text") ?? "").slice(0, 60)}`.trim();
    case "ReconciliationGroup": return `Группа сверки ${s("title") ?? ""}`.trim();
    case "ReconciliationInvoice": return `Счёт в сверке №${s("no") ?? "—"} ${money(r.amountRub)}${s("date") ? " от " + day(r.date) : ""}`.trim();
    case "ReconciliationInvoicePayment": return `Оплата счёта по документам ${money(r.amountRub)}${r.paidAt ? " " + day(r.paidAt) : ""}`.trim();
    case "ReconciliationCheck": return `Сверка выполнена ${day(r.checkedDate)}`.trim();
    case "SystemState": return `Решение владельца: ${(s("key") ?? "").replace("owner-decision:", "")}`.trim();
    default: return `${t} ${s("id") ?? ""}`.trim();
  }
}

/** Русские названия полей для страницы /history; нет в списке — показываем имя поля как есть. */
export const FIELD_LABELS: Record<string, string> = {
  amountRub: "сумма, ₽", no: "номер счёта", counterparty: "контрагент", contract: "договор / акт", period: "период",
  vatRub: "НДС, ₽", updNo: "УПД №", updDate: "дата УПД", refPurchase: "закупка", refBatch: "партия", refTz: "ТЗ",
  refDocumentId: "документ", dbPurchases: "закупки базы", dbBatch: "партия базы", deletedAt: "удалено", deleteReason: "причина удаления",
  ppNo: "п/п №", evidence: "основание оплаты", checkedDate: "дата сверки", shareRub: "доля, ₽",
  number: "номер", name: "название", status: "статус", amount: "сумма", paidAt: "дата оплаты", notes: "заметка",
  quantity: "количество", plannedQuantity: "план, шт", producedQuantity: "произведено (факт), шт", size: "размер", color: "цвет",
  supplierId: "поставщик", clientId: "заказчик", purchaseId: "закупка", currency: "валюта", exchangeRate: "курс",
  auctionSession: "аукцион", invoiceNumber: "номер счёта", transferDocument: "УПД", orderDate: "дата заказа",
  expectedDate: "ожидаемая дата", receivedDate: "дата получения", verifiedAt: "подтверждено (когда)",
  verifiedBy: "подтвердил", verifyNote: "примечание к подтверждению", confirmed: "платёжка есть", confirmedAt: "подтверждена (когда)",
  confirmedBy: "подтвердил оплату", docRef: "основание/п-п", documentId: "документ", method: "способ оплаты", kind: "вид",
  percent: "процент", paymentType: "тип оплаты", unitPrice: "цена", subtotal: "сумма позиции", vatRate: "НДС, %",
  lotNumber: "номер лота", grade: "сорт", sizeGrade: "размерный сорт", unitCost: "цена за ед.", totalCost: "стоимость",
  quantityReceived: "принято", quantityRemaining: "остаток", workOrderNumber: "номер ТЗ", workOrderDate: "дата ТЗ",
  contractNumber: "договор", clientWorkPricePerUnit: "цена работы за шт", retailPrice: "розничная цена", materialCost: "материалы",
  expenseCost: "расходы", unitCost2: "себестоимость шт", startDate: "начало", endDate: "окончание", batchId: "партия",
  productModelId: "модель", seasonId: "сезон", sellingPrice: "цена продажи", sku: "артикул", isActive: "активен", role: "роль",
  email: "почта", aliases: "синонимы", title: "название", date: "дата", description: "описание", articleCode: "артикул",
  action: "действие", plannedDate: "плановая дата", shippedDate: "дата отгрузки", comment: "комментарий", fittingDate: "дата примерки",
  costPlan: "расчёт стоимости", costBreakdown: "состав себестоимости", extra: "свои столбцы", lining: "подкладка",
  materialDescription: "материал", plannedUnits: "план, шт", year: "год", month: "месяц", eventDate: "дата события",
  position: "порядок", type: "тип", entity: "сущность", commission4: "4%", lotId: "лот", rawMaterialId: "материал",
  text: "текст", pagePath: "страница", pageTitle: "заголовок страницы", anchor: "блок", entityLabel: "запись", priority: "приоритет",
  attributes: "параметры артикула", resolutionNote: "как учтено", resolvedAt: "учтено (когда)", resolvedById: "закрыл",
};
FIELD_LABELS.colorRefId ??= "цвет (справочник)";
FIELD_LABELS.title ??= "название этапа";
FIELD_LABELS.occurredAt ??= "дата и время этапа";
FIELD_LABELS.timeKnown ??= "время известно";
FIELD_LABELS.responsibleName ??= "ответственный (внешний)";
FIELD_LABELS.responsibleUserId ??= "ответственный";
FIELD_LABELS.place ??= "место";
FIELD_LABELS.details ??= "детализация";
FIELD_LABELS.docLinks ??= "ссылки на документы";
FIELD_LABELS.expected ??= "ожидаемый этап";
FIELD_LABELS.accepted ??= "принято";
FIELD_LABELS.rejected ??= "не принято";
FIELD_LABELS.returned ??= "возвращено";
FIELD_LABELS.furKind ??= "вид меха";
export const fieldLabel = (k: string) => FIELD_LABELS[k] ?? k;

/** Короткое отображение значения в журнале. */
export function showValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "да" : "нет";
  if (typeof v === "string") {
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(v)) {
      const d = day(v);
      const hhmm = v.slice(11, 16);
      return hhmm === "00:00" ? d : `${d} ${hhmm}`;
    }
    return v === "" ? "«»" : v.length > 120 ? v.slice(0, 120) + "…" : v;
  }
  if (typeof v === "object") {
    const s = JSON.stringify(v);
    return s.length > 120 ? s.slice(0, 120) + "…" : s;
  }
  return String(v);
}
