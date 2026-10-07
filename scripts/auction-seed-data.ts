/** Предложения справочника аукционов (все confirmed=false). Ключ — прежнее написание Purchase.auctionSession. */
export type SeedAuction = {
  name: string;
  fullName: string;
  house: string;
  kind: "FUR" | "LINING" | "MATERIALS" | "OTHER";
  year: number | null;
  month: number | null;
  auctionDate?: string; // YYYY-MM-DD, если дата аукциона есть в документах
  /** Прежние написания Purchase.auctionSession, из которых собран аукцион. */
  aliases: string[];
  /** Если задано — закупки привязываются по номерам (а не по алиасу). */
  purchaseNumbers?: string[];
  isService?: boolean;
  note: string;
};

const P = "Предложено системой, ждёт подтверждения. ";

export const SEED_AUCTIONS: SeedAuction[] = [
  { name: "СП 03.25", fullName: "Союзпушнина, аукцион март 2025 (УПД № 78)", house: "Союзпушнина", kind: "FUR", year: 2025, month: 3, aliases: ["СП 03.25"], note: P + "Исходное написание совпадает." },
  { name: "РП 03.25", fullName: "Русьпушнина, аукцион март 2025 (УПД № 77)", house: "Русьпушнина", kind: "FUR", year: 2025, month: 3, aliases: ["РП 03.25"], note: P + "Исходное написание совпадает." },
  { name: "СП 05.25", fullName: "Союзпушнина, аукцион май 2025 (УПД № 143)", house: "Союзпушнина", kind: "FUR", year: 2025, month: 5, aliases: ["СП 05.25"], note: P },
  { name: "РП 05.25", fullName: "Русьпушнина, аукцион май 2025 (УПД № 143)", house: "Русьпушнина", kind: "FUR", year: 2025, month: 5, aliases: ["РП 05.25"], note: P },
  { name: "СП 12.25", fullName: "Союзпушнина, аукцион декабрь 2025, соболь (счёт аукциона 4014, УПД № 283)", house: "Союзпушнина", kind: "FUR", year: 2025, month: 12, aliases: ["СП 12.25"], note: P },
  { name: "SAGA 03.25", fullName: "SAGA Furs, аукцион март 2025 (УПД № 103)", house: "SAGA", kind: "FUR", year: 2025, month: 3, aliases: ["SAGA 03-25"], note: P + "Написание «03-25» заменено на «03.25» в едином формате." },
  { name: "SAGA 06.25", fullName: "SAGA Furs, аукцион июнь 2025 (УПД № 127)", house: "SAGA", kind: "FUR", year: 2025, month: 6, aliases: ["SAGA 06-25"], note: P },
  { name: "SAGA 03.26", fullName: "SAGA Furs, аукцион март 2026 (УПД № 229, спецификация № 18)", house: "SAGA", kind: "FUR", year: 2026, month: 3, aliases: ["SAGA 03-26"], note: P },
  { name: "РП 04.26", fullName: "Русьпушнина, 24-й аукцион 22.04.2026 (УПД № 201)", house: "Русьпушнина", kind: "FUR", year: 2026, month: 4, auctionDate: "2026-04-22", aliases: ["Закупка меха 04-26"], note: P + "Раньше называлось «Закупка меха 04-26»; по документам Drive это Русьпушнина." },
  { name: "СП 05.26", fullName: "Союзпушнина, 233-й аукцион 20.05.2026 (УПД № 199)", house: "Союзпушнина", kind: "FUR", year: 2026, month: 5, auctionDate: "2026-05-20", aliases: ["СОЮЗПУШНИНА 05-26"], note: P },
  { name: "AME 05.26", fullName: "AME, аукцион май 2026 (УПД № 253)", house: "AME", kind: "FUR", year: 2026, month: 5, aliases: ["AME 05-26"], note: P },
  { name: "FH 06.26", fullName: "Fur Harvesters, аукцион июнь 2026", house: "Fur Harvesters", kind: "FUR", year: 2026, month: 6, aliases: ["FH 06-26"], note: P },
  { name: "СП 09.26", fullName: "Союзпушнина, аукцион 29–30.09.2026 (расчёт в долларах)", house: "Союзпушнина", kind: "FUR", year: 2026, month: 9, auctionDate: "2026-09-29", aliases: ["СП 09-26"], note: P },
  { name: "КФХ Дуденко 07.25", fullName: "КФХ Дуденко Л. Н. (закупки у фермы, июль–август 2025)", house: "КФХ / ферма", kind: "FUR", year: 2025, month: 7, aliases: ["КФХ Дуденко Л. Н."], note: P },
  { name: "Бобр 08.26", fullName: "Invoice 1-2026, бобр выделанный (Yusufoğulları Tekstil Deri)", house: "Прочее", kind: "FUR", year: 2026, month: 8, aliases: ["Invoice 1-2026 (бобр)"], note: P },
  { name: "Подкладка 07.25", fullName: "Подкладка, спецификация № 7 (УПД № 109 от 11.07.2025)", house: "Подкладка / ткани", kind: "LINING", year: 2025, month: 7, aliases: ["Подкладка Спец. 7 (УПД 109)"], note: P },
  { name: "Подкладка 05.26", fullName: "Подкладка, спецификация № 13", house: "Подкладка / ткани", kind: "LINING", year: 2026, month: 5, aliases: ["Подкладка Спец. 13"], note: P },
  { name: "Доп. материалы 06.26", fullName: "Дополнительные материалы, спецификация № 16", house: "Подкладка / ткани", kind: "MATERIALS", year: 2026, month: 6, aliases: ["Доп. материалы Спец. 16"], note: P },
  // «Нет информации» — заглушка импорта. Закупки с этим текстом разнесены по номерам; сама заглушка — служебный аукцион.
  { name: "Белая норка №80", fullName: "Белая норка, УПД № 80 от 04.06.2025", house: "Прочее", kind: "FUR", year: 2025, month: 6, aliases: [], purchaseNumbers: ["З-2026-0008"], note: P + "Раньше «Нет информации»; название по номеру УПД, уточнить." },
  { name: "Белая норка №96", fullName: "Белая норка, УПД № 96 от 15.07.2025", house: "Прочее", kind: "FUR", year: 2025, month: 7, aliases: [], purchaseNumbers: ["З-2026-0009"], note: P + "Раньше «Нет информации»; название по номеру УПД, уточнить." },
  { name: "Сырьё подрядчика (партии 5–9)", fullName: "Дополнительная закупка сырья подрядчика, партии 5, 6, 7, 9", house: "Прочее", kind: "OTHER", year: 2025, month: 6, aliases: [], purchaseNumbers: ["З-2026-0010", "З-2026-0011", "З-2026-0012", "З-2026-0013"], note: P + "Раньше «Нет информации»." },
  { name: "Без аукциона", fullName: "Заглушка импорта: аукцион не указан", house: "Прочее", kind: "OTHER", year: null, month: null, aliases: ["Нет информации", "Не в реестре остатков", "Подкладочные материалы", "Доп закупка"], isService: true, note: P + "Служебное значение; такие закупки показываются как «Без аукциона»." },
];
