import "server-only";
import { type AttentionPriority, type AttentionSection, type AttentionKind, type AttentionEntity, type AttentionGroupId } from "./shared";

export const SECTION_LABELS: Record<AttentionSection, string> = {
  purchases: "Закупки",
  production: "Производство",
  data: "Данные",
};

export const KIND_LABELS: Record<AttentionKind, string> = {
  purchase: "Закупки",
  payment: "Оплаты поставщику",
  auction: "Аукционы",
  tz: "ТЗ",
  batch: "Партии производства",
  model: "Модели изделий",
  material: "Материалы",
  supplier: "Поставщики",
  client: "Заказчики",
};

export const KIND_ORDER: AttentionKind[] = ["purchase", "payment", "auction", "tz", "batch", "model", "material", "supplier", "client"];

export const KIND_SECTION: Record<AttentionKind, AttentionSection> = {
  purchase: "purchases", payment: "purchases", auction: "purchases",
  tz: "production", batch: "production",
  model: "data", material: "data", supplier: "data", client: "data",
};

export type AttentionGroupKind = "decision" | "bulk" | "info";

export type AttentionGroupMeta = {
  title: string;
  kind: AttentionGroupKind;
  /** Пояснение для значка «i». */
  hint: string;
  /** Куда вести: «Реестр сверки», документы или нужная страница. */
  link?: { href: string; label: string };
};

export const GROUPS: Record<AttentionGroupId, AttentionGroupMeta> = {
  "no-receipt": {
    title: "Нет платёжек", kind: "decision",
    hint: "Оплаты поставщику внесены по письму или расчёту («оплачено»), а платёжное поручение не прикреплено. Деньги по ним считаются уплаченными, поэтому долг от них не завышен. Нужна выписка банка: тогда появится п/п и точная дата.",
    link: { href: "/reconciliation", label: "Сверка" },
  },
  "advance-unlinked": {
    title: "Аванс без привязки", kind: "decision",
    hint: "Аванс есть, но не привязан ни к аукциону, ни к закупке. Он уже вычтен из долга общей суммой. В документах нет разнесения по аукционам — привяжите сами в «Оплатах» → «Привязать к аукциону» или пришлите акт сверки.",
    link: { href: "/payments", label: "Оплаты" },
  },
  "auction-unpaid": {
    title: "Принят, оплат нет", kind: "decision",
    hint: "Мех по аукциону принят, а оплат по нему нет в базе. Если оплата была — нужны документ или письмо «оплачено» с суммой.",
    link: { href: "/payments", label: "Оплаты" },
  },
  overpaid: {
    title: "Переплата", kind: "decision",
    hint: "Оплачено больше стоимости закупки или аукциона. Бывает при зачёте в другом счёте — проверьте и при необходимости перенесите сумму.",
    link: { href: "/payments", label: "Оплаты" },
  },
  "late-delivery": {
    title: "Срок поставки прошёл", kind: "decision",
    hint: "Закупка ещё не принята, а ожидаемая дата поставки уже прошла. Уточните у поставщика или поменяйте дату.",
    link: { href: "/purchases", label: "Закупки" },
  },
  "raw-overdue": {
    title: "Сырьё Веллмеха: этап просрочен", kind: "decision",
    hint: "Веллмех внёс этапы сырья (выделка, дорога, склад), а ожидаемая дата последнего этапа уже прошла, мех ещё не принят. Откройте закупку, посмотрите, где сырьё, и напишите Веллмеху — или попросите обновить даты.",
    link: { href: "/purchases", label: "Закупки" },
  },
  "tz-requisites": {
    title: "ТЗ: не хватает данных", kind: "decision",
    hint: "У ТЗ не указана партия или заказчик, нет списаний сырья (для ТЗ со склада) или у запланированного ТЗ нулевой остаток сырья — без этого не посчитать долг по работе подрядчику и остатки.",
    link: { href: "/production", label: "ТЗ" },
  },
  "suspect-date": {
    title: "Даты ТЗ похожи на шаблон", kind: "decision",
    hint: "В документах стоит дата-шаблон, похожая на копию из соседних ТЗ. Проверьте по оригиналу ТЗ.",
    link: { href: "/documents", label: "Документы" },
  },
  "model-dup": {
    title: "Модель заведена дважды", kind: "decision",
    hint: "Одна модель записана кириллицей и латиницей. Поиск и план их уже склеивают, данные не менялись — объедините карточки.",
    link: { href: "/models", label: "Модели" },
  },
  "supplier-new-article": {
    title: "Добавьте розничную цену: артикулы от Веллмеха", kind: "decision",
    hint: "Артикул завёл поставщик (Веллмех) — цен он не вносит. Откройте артикул, проверьте название, категорию, мех и подкладку, которые он прислал, и проставьте розничную цену.",
    link: { href: "/articles?src=supplier&price=no", label: "Артикулы от Веллмеха" },
  },
  "no-auction": {
    title: "Закупка без аукциона", kind: "decision",
    hint: "У закупки не указан аукцион — оплаты нельзя сверить с аукционным счётом.",
    link: { href: "/purchases", label: "Закупки" },
  },
  "tz-no-date": {
    title: "ТЗ без даты", kind: "bulk",
    hint: "В приложениях к ТЗ 1–96 стоит только шаблонная дата 16.05.2025, настоящей даты ТЗ в документах нет — заполнить без новых документов нельзя. Это одна запись на всю группу; список ниже.",
    link: { href: "/documents", label: "Документы" },
  },
  "tz-end-date": {
    title: "Нет даты выпуска (дата импорта)", kind: "bulk",
    hint: "У готовых ТЗ дата выпуска либо пустая, либо подставлена при импорте (01.10.2026). В документах дат выпуска партий нет. Одна запись на группу; список ниже.",
    link: { href: "/documents", label: "Документы" },
  },
  "batch-no-pay": {
    title: "Партии без оплат за работу", kind: "bulk",
    hint: "По этим партиям нет ни платёжки, ни письма «оплачено» от подрядчика, поэтому оплат в базе нет. Заведутся, когда появятся документы с датой. Одна запись на группу.",
    link: { href: "/reconciliation", label: "Сверка" },
  },
  "no-auction-info": {
    title: "Закупки «Нет информации» об аукционе", kind: "bulk",
    hint: "Старые закупки 2025 года Веллмеха: название аукциона в документах не указано. Одна запись на группу.",
    link: { href: "/purchases", label: "Закупки" },
  },
  "stub-lots": {
    title: "Даты закупок и лотов — дата импорта", kind: "bulk",
    hint: "Дата заказа или прихода подставлена при импорте (01.10.2026) или не указана; настоящей даты в УПД нет. Одна запись на группу.",
    link: { href: "/lots", label: "Сырьё" },
  },
  "production-status": {
    title: "Статус производства не совпадает с фактом", kind: "decision",
    hint: "ТЗ помечено как запланированное при уже указанном выпуске либо как завершённое при нулевом факте. Нужна ручная проверка статуса/количества.",
    link: { href: "/production", label: "ТЗ" },
  },
  awaiting: {
    title: "Ожидаемые поставки", kind: "info",
    hint: "Мех ещё не принят, срок не вышел — это нормальное состояние, не пробел. В число не входит.",
    link: { href: "/purchases", label: "Закупки" },
  },
  "no-usage": {
    title: "Нет списаний сырья", kind: "info",
    hint: "Сырьё заказчика или не со склада: списаний нет по природе. В число не входит.",
  },
  dict: {
    title: "Справочники", kind: "info",
    hint: "Категория материала, ИНН поставщика или заказчика не указаны. Справочно, в число не входит.",
    link: { href: "/settings", label: "Настройки" },
  },
};

export const GROUP_ORDER = Object.keys(GROUPS) as AttentionGroupId[];

export type AttentionBlock = {
  id: AttentionGroupId;
  meta: AttentionGroupMeta;
  /** Сущности блока (у каждой оставлены только проблемы этого блока). */
  entities: AttentionEntity[];
  /** Сколько записей блок вносит в число «Требует внимания»: сущности (decision), 1 (bulk), 0 (info). */
  count: number;
  /** Сумма оплат блока, ₽ (если у сущностей есть amount). */
  amount: number;
  priority: AttentionPriority;
};

/** Собирает блоки из сущностей: каждая проблема попадает ровно в один блок. */
export function buildAttentionBlocks(all: AttentionEntity[]): AttentionBlock[] {
  const blocks: AttentionBlock[] = [];
  for (const id of GROUP_ORDER) {
    const entities: AttentionEntity[] = [];
    for (const e of all) {
      const ps = e.problems.filter((p) => p.group === id);
      if (ps.length) entities.push({ ...e, problems: ps, priority: ps[0].priority });
    }
    if (entities.length === 0) continue;
    const meta = GROUPS[id];
    const priority: AttentionPriority = entities.some((e) => e.priority === "red") ? "red" : entities.some((e) => e.priority === "yellow") ? "yellow" : "gray";
    blocks.push({
      id, meta, entities, priority,
      count: meta.kind === "decision" ? entities.length : meta.kind === "bulk" ? 1 : 0,
      amount: entities.reduce((s, e) => s + (e.amount ?? 0), 0),
    });
  }
  return blocks;
}

/** Сколько записей требует решения (серые блоки «справочно» — отдельно; срочные — красные). */
export function countAttentionBlocks(blocks: AttentionBlock[]) {
  let main = 0, red = 0, info = 0;
  for (const b of blocks) {
    if (b.meta.kind === "info") { info += b.entities.length; continue; }
    main += b.count;
    if (b.priority === "red") red += b.count;
  }
  return { main, red, info };
}

// Латиница, похожая на кириллицу (после toLowerCase).
const LATIN_TO_CYR: Record<string, string> = {
  a: "а", b: "в", c: "с", e: "е", h: "н", k: "к", m: "м", o: "о", p: "р", t: "т", x: "х", y: "у",
};

export function normalizeModelName(name: string): string {
  return name
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[a-z]/g, (ch) => LATIN_TO_CYR[ch] ?? ch)
    .replace(/[^а-я0-9a-z]/g, "");
}
