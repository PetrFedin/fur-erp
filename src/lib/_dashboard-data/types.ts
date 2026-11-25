// Типы данных Сводки (вынесены из dashboard-data.ts без изменений).
import type { FlowFigures, FurLot } from "@/lib/fur-table";
import type { ClientDebt, ClientDebtRow } from "@/lib/payment-alloc";
import type { SupplierDebt } from "@/lib/supplier-debt";
import type { ControlCounts } from "@/lib/control-counts";
import type { Commission4Mode } from "@/lib/commission4-mode";
import type { Pair, ProdTotals } from "@/lib/dashboard-calc";
import type { getFilterOptions } from "@/lib/filter-options";

/** Девять чисел строки «куплено / использовано / остаток»: шт, ₽, средневзвешенная ₽/шт. */
export type Cells = {
  rq: number; rv: number; ra: number | null; uq: number; uv: number; ua: number | null; mq: number; mv: number; ma: number | null;
  /** «Использовано» в ПРОТИВОПОЛОЖНОЙ базе 4% (режим «с 4%» → без 4%, и наоборот): сумма и средневзвешенная. «Куплено» и «Остаток» всегда без 4%. */
  uo: number; uoa: number | null;
};
export type CellsPair = Pair<Cells>;

/** Заказано, но ещё не получено (состав закупки): шт. и сумма с НДС / без НДС. */
export type Ordered = { qty: number; incl: number; excl: number };
export type RawTableRow = { key: string; label: string; kind: "fur" | "lining"; cells: CellsPair; /** Заказано, но не получено (в «Куплено» не входит): штуки и сумма, чтобы вид без лотов (рысь) не выглядел пустым. */ ordered?: Ordered; /** Оплачено и долг по виду: оплаты и остаток аукционов делятся по доле вида в стоимости лотов аукциона. */ paid: number; due: number; /** Средняя цена в долларах (куплено / использовано / остаток); у подкладки нет. */ usd: { bought: number | null; used: number | null; rem: number | null }; auctions: { key: string; label: string; cells: CellsPair; paid: number; due: number }[]; /** Те же цифры по годам закупки лота (для окон цен). */ years: { year: number; cells: CellsPair; usd: { bought: number | null; used: number | null; rem: number | null } }[]; lots: number; /** Id лотов ткани подкладки — для перехода в карточку лота (у меха не заполняется). */ lotIds?: string[] };
export type YearRow = {
  key: string;
  label: string;
  fur: CellsPair;
  lining: CellsPair;
  prod: { qty: number; costIncl: number; costExcl: number; work: number };
  paid: number;
  debt: number;
  /** Оплачено и задолженность года отдельно по меху и подкладке (в сумме — paid и debt). */
  money: { fur: { paid: number; debt: number }; lining: { paid: number; debt: number } };
};

/** НДС по ставкам, ₽: ключ — ставка в процентах («20», «22»). Это сумма НДС, лежащая внутри цен с НДС (с НДС − без НДС), от режима «С НДС / без НДС» шапки не зависит. */
export type VatByRate = Record<string, number>;
export type VatTriple = { recv: VatByRate; used: VatByRate; rem: VatByRate };

export type DashboardData = {
  c4: Commission4Mode;
  raw: { fur: Pair<FlowFigures>; lining: Pair<FlowFigures>; lots: number };
  /** Мех «Куплено» по источнику (слайды «На аукционах» / «У поставщика» блока «Сырьё»): те же flowOf/figures; заказанное, но не полученное — к аукционам, шкуры подрядчика — к поставщику. Сумма двух = raw.fur. */
  rawSources: { auction: Pair<FlowFigures>; supplier: Pair<FlowFigures> };
  /** Мех по источнику × типу: «Вся закупка» / «На аукционах» / «У поставщика» → итог источника + типы меха, у которых есть данные (виджет «Мех» блока «Сырьё»). Сумма типов = итог источника, auction + supplier = all. */
  rawFurBySource: Record<"all" | "auction" | "supplier", { total: Pair<FlowFigures>; types: { name: string; pair: Pair<FlowFigures> }[] }>;
  /** НДС по ставкам внутри плиток сырья (куплено / использовано / остаток; использовано — без 4%) и в себестоимости (по строкам списаний + шкуры подрядчика, без НДС на надбавку 4%). */
  vat: { fur: VatTriple; lining: VatTriple; cost: VatByRate };
  prod: { done: ProdTotals; work: ProdTotals; /** Все ТЗ года: уникальные номера ТЗ считаются по всему набору, а не суммой «завершённые + в работе». */ all: ProdTotals };
  rawTable: RawTableRow[];
  rawTableTotal: CellsPair;
  years: YearRow[];
  /** Мех по годам закупки для источника «На аукционах» / «У поставщика» (заказанное — к аукционам, шкуры подрядчика — к поставщику): ключ года → пара ячеек. Оплаты и долг по источнику не делятся. */
  yearsFurBySrc: Record<"auction" | "supplier", { key: string; fur: CellsPair }[]>;
  /** Источник строки аукциона в «Динамике по сырью» (ключ строки → аукцион / поставщик). */
  auctionSrc: Record<string, "auction" | "supplier">;
  debt: SupplierDebt;
  supplierCashPaid: number;
  /** Переплаты аукционов/закупок сверх их стоимости: входят в supplierCashPaid и зачтены в долг. */
  supplierOverpaid: number;
  /** Оплачено по статьям: сырьё (мех / подкладка), услуги по УПД (закупки без позиций сырья), работа подрядчику (в ней неразнесённый аванс), расчётная надбавка 4%. */
  paidByItem: { fur: number; lining: number; services: number; work: number };
  /** Оплачено по типам платежа (аванс, доплата, окончательный расчёт, прочее): сумма и число платежей; Σ = fur + lining + services + work без фильтров. */
  /** Оплачено за мех по источнику (как в Cashflow): аукционы и поставщик; доплата подрядчику (НДС по сырью) — в «поставщик». */
  paidFurBySource: { auction: number; supplier: number };
  paidByType: { type: "ADVANCE" | "PARTIAL" | "FINAL" | "OTHER"; amount: number; count: number }[];
  /** Оплаты сырья по типам платежа отдельно для меха и подкладки (страница «Сырьё»). */
  paidByTypeFur: { type: "ADVANCE" | "PARTIAL" | "FINAL" | "OTHER"; amount: number; count: number }[];
  paidByTypeLining: { type: "ADVANCE" | "PARTIAL" | "FINAL" | "OTHER"; amount: number; count: number }[];
  /** Платёжек (п/п) среди всех строк оплат: одна п/п бывает разнесена на несколько строк (сырьё и работа, партии, ТЗ). */
  paidSlips: { slips: number; rows: number };
  /** Осталось оплатить: сырьё (долг поставщику) и производство (долг по работе подрядчику) — те же числа, что в «Оплаты → Все». */
  left: { raw: number; fur: number; lining: number; services: number; prod: number };
  /**
   * Аванс подрядчику (неразнесённый): оплачено по ТЗ, которых ещё нет в базе (авансы на будущие партии). Он входит в «Оплачено» (paidByItem.work),
   * но НЕ вычитается из «К оплате»: left.prod — остаток работы по заведённым ТЗ, не меньше нуля. Без фильтров панели; при фильтрах — 0.
   */
  advance: number;
  /** Оплачено и долг по сырью — итог строки «Всего» в «Динамике по сырью» (те же числа, что в «Оплатах»). */
  /** Аукционы с переплатой: учтены в долге по сырью (зачтены поставщиком). */
  overpaid: { name: string; amount: number }[];
  /** Шкуры подрядчика (оплачены в составе пошива): входят в мех «Использовано» и в себестоимость. */
  hides: { incl: number; excl: number };
  /** Заказано, но ещё не получено (нет лотов): шт. и сумма — входит в «Куплено» и «Остаток» меха. */
  ordered: Ordered;
  /** Часть заказанного, учтённая в «Куплено» (рысь); остальное заказанное в «Куплено» не входит. */
  orderedBought: Ordered;
  /** Заказанный, но не полученный мех и шкуры подрядчика как «лоты» для страницы «Сырьё»: таблица там сходится с Главной. */
  syntheticLots: FurLot[];
  /** Оплачено и к оплате по каждому лоту (id → ₽ с НДС): доля оплат и долга аукциона по стоимости лота. Нужны таблице «Сырьё» для плиток оплат при фильтрах. */
  lotMoney: Record<string, { paid: number; due: number }>;
  rawMoneyTotal: { paid: number; due: number; /** Оплаты и остаток по закупкам, где лотов ещё нет (мех не получен). */ unreceived: { paid: number; due: number; names: string[]; /** Тот же остаток по видам меха закупок, где лотов ещё нет (по составу заказа). */ byFur: { label: string; names: string[]; paid: number; due: number; ordered: Ordered }[] } };
  clientDebts: ClientDebtRow[];
  /** Разнесение оплат заказчиков: разнесено на ТЗ, неразнесённые авансы (по виду), учтены ли они в остатке. */
  clientDebtInfo: Pick<ClientDebt, "allocated" | "unallocated" | "unallocatedAll" | "unallocatedApplied" | "unallocatedByKind">;
  invoiceDeadlines: { auction: string; date: string; amount: number }[];
  control: ControlCounts | null;
  options: Awaited<ReturnType<typeof getFilterOptions<"auction" | "fur" | "color" | "attr" | "batch">>>;
  noColorLots: number;
  /** ТЗ без группы категории (все годы): ремонт и прочие — подпись пункта «Без группы» в фильтре. */
  noGroup: { repair: number; other: number };
  /** ID выбранных ТЗ (для окна «стоимость производства»). */
  orderIds: string[];
  furTotalLots: number;
  /** Лоты меха выбранного года и фильтров (те же, что дают «Куплено» меха): для виджета «Из чего складывается стоимость меха». */
  priceLots: FurLot[];
  /** «Мост» между блоками (пояснения у цифр): всё в рублях. */
  bridge: {
    /** Мех + подкладка, использованные по лотам Сводки, БЕЗ 4% (то, что сравнивается с сырьём в ТЗ). */
    usedBase: Pair<number>;
    /** Совпадает ли «Использовано» блока «Сырьё» с сырьём в ТЗ: нет при годе шапки (разные правила года) и при фильтрах по лотам (ТЗ берутся целиком). */
    usedComparable: boolean;
    /** Закупки года с НДС, без отменённых: мех получен (= лоты «Куплено») и ещё не получен (черновики). */
    purchases: { received: number; draft: number };
    /** Работа по ТЗ с заказчиком: завершённые, в работе, и работа по ТЗ без заказчика (в «Долг по работе подрядчику» не входит). */
    clientWork: { done: number; work: number; noClient: number };
  };
};
