import { formatMoney } from "@/lib/utils";

export type IntakeRow = {
  /** Ключ строки в таблице мастера. */
  n: number;
  lot: string; material: string; color: string; grade: string; qty: string; price: string; vat: string; currency: string; invoice: string;
  rate: string; fee: string; dressing: string; transport: string; broker: string; transit: string; fileUnit: string; fileTotal: string;
  /** Из «Расходов партии»: таможня и упаковка ₽ за шкуру — отдельные строки расчёта (в столбец «Транспорт» не входят). */
  customs?: string; packing?: string;
  /** Состав цены, заданный целиком (приём расчёта поставщика со своими столбцами): строки «название — значение» вместо стандартных. */
  planItems?: { label: string; value: number }[];
};

export type FurDecision = { mode: "ref"; id: string } | { mode: "add" };

export type ColorDecision = { mode: "ref"; id: string } | { mode: "add" } | { mode: "keep" };

export type Decisions = { fur: Record<string, FurDecision>; color: Record<string, ColorDecision> };

export type RowCheck = {
  n: number;
  errors: string[];
  warnings: string[];
  infos: string[];
  /** Найденный материал справочника (id) или null. */
  materialId: string | null;
  /** Имя нового материала, который будет создан (решение «добавить»). */
  newMaterial: string | null;
  colorRefId: string | null;
  /** Текст цвета для записи (как в справочнике или как есть). */
  colorText: string | null;
  newColor: string | null;
};

export type UnknownRef = {
  key: string;
  text: string;
  rows: number[];
  suggestion: { id: string; name: string; reason: string } | null;
};

export type ValidationResult = {
  checks: RowCheck[];
  unknownFurs: UnknownRef[];
  unknownColors: UnknownRef[];
  errorCount: number;
  warningCount: number;
};

// ======================================================================= документы

export type DocKindKey = "AUCTION_INVOICE" | "SPECIFICATION" | "ADVANCE_INVOICE" | "CALC_SHEET" | "UPD" | "PAYMENT_PROOF" | "OTHER";

export type DocFind = { kind: DocKindKey | null; number: string | null; date: string | null; amount: number | null; amountNote: string | null };

export type Recon = {
  ok: boolean;
  diff: number; // документ − лоты (с НДС, ₽)
  message: string;
  reasons: string[];
};

export const rub = (n: number) => formatMoney(n);

// ======================================================================= данные мастера (клиент ⇄ сервер)

export type BatchHeader = {
  /** Аукцион из справочника ("" — не выбран). */
  auctionId: string;
  /** Новый аукцион: создаётся вместе с закупкой. */
  newAuction: { name: string; date: string; house: string } | null;
  supplierId: string;
  warehouseId: string;
  orderDate: string;
  currency: string;
  exchangeRate: string;
  vatDefault: string;
  /** Номер счёта, если в таблице нет столбца «Счёт аукциона №» (одна закупка). */
  invoiceNumber: string;
  /** Дата счёта (ГГГГ-ММ-ДД, необязательно): попадает в Purchase.invoiceDate и в Invoice. */
  invoiceDate?: string;
  /** Принять на склад сразу (иначе закупка остаётся черновиком — мех ещё в пути). */
  receiveNow: boolean;
  notes: string;
  /** Сумма счёта аукциона по документу (необязательно): мастер сверит её с суммой лотов. */
  invoiceAmount?: string;
  /** НДС на сборы аукциона и выделку, % ("" — по дате закупки: 22 с 2026 года, 20 раньше; 0 — иностранный аукцион, ввозной НДС внутри «Таможни»). */
  serviceVat?: string;
};

export type DocMeta = {
  /** Порядковый номер файла в отправке (индекс в FormData files). */
  idx: number;
  name: string;
  kind: DocKindKey;
  number: string;
  date: string;
  amount: string;
};

export type BatchPayload = {
  /** Ключ защиты от двойной отправки (один на «Создать»). */
  key: string;
  header: BatchHeader;
  rows: IntakeRow[];
  decisions: Decisions;
  pct: Partial<Record<"fee" | "broker", boolean>>;
  /** «Расходы партии», как введены (для журнала): пустые строки не передаются. */
  expenses?: Record<string, string>;
  docs: DocMeta[];
  /** Пользователь подтвердил, что знает о расхождениях сумм документов с лотами. */
  ackMismatch: boolean;
};

export type PurchaseTotals = {
  key: string;
  invoice: string;
  lots: number;
  qty: number;
  inclVat: number;
  exclVat: number;
  avgInclPerUnit: number;
  avgExclPerUnit: number;
  /** Средняя цена молотка в валюте закупки за шкуру (без НДС). */
  avgForeign: number | null;
  foreignExcl: number;
  auctionPart: number | null;
  vatRates: number[];
};

export type DocRecon = {
  idx: number;
  name: string;
  kind: DocKindKey;
  /** С чем сверяли: «закупка 3017» / «вся партия». */
  against: string;
  amount: number | null;
  recon: Recon | null;
  note: string | null;
};

export type BatchPreview = {
  validation: ValidationResult;
  purchases: PurchaseTotals[];
  totals: { lots: number; qty: number; inclVat: number; exclVat: number; avgInclPerUnit: number; avgExclPerUnit: number; avgForeign: number | null; foreignExcl: number };
  docs: DocRecon[];
  /** Почему нельзя создавать (пусто — можно). */
  blocking: string[];
  /** Расхождения расчёта с файлом по «себестоимости за единицу» > 1 ₽. */
  planDiffRows: number;
  debtNow: number;
  receiving: boolean;
  newMaterials: string[];
  newColors: string[];
  mismatchDocs: number;
  /** Счета этой партии, уже стоящие на других закупках того же поставщика (предупреждение, не запрет). */
  dupInvoices: { invoice: string; purchaseNumber: string }[];
};

export type BatchResult = {
  ok: true;
  duplicate: boolean;
  receiving: boolean;
  auction: { id: string | null; name: string; created: boolean };
  purchases: { id: string; number: string; invoice: string; lots: number; qty: number; inclVat: number }[];
  totals: BatchPreview["totals"];
  debt: { before: number | null; after: number };
  purchased: { before: number | null; after: number };
  stock: { material: string; before: number; after: number }[];
  docsAttached: number;
  createdMaterials: string[];
  createdColors: string[];
  tasks: { text: string; href: string; kind: "doc" | "pay" | "check" | "receive" }[];
};
