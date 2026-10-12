// «Откуда пришёл»: параметр ?from=<внутренний путь> на карточках. Принимаем только безопасный
// внутренний путь («/…», не «//…», без обратных косых, управляющих символов и /api).
export function safeFrom(raw: string | null | undefined): string | null {
  if (!raw || raw.length > 600) return null;
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) return null;
  if (raw.startsWith("/api/") || raw.startsWith("/login") || raw.startsWith("/register")) return null;
  return raw;
}

/** Карточки, на которые ведут из разных мест: к ссылке на них добавляется ?from=. */
export const CARD_PATH =
  /^\/(purchases\/(?!new$|batch$|lining)[^/?#]+|production\/(?!new$|import$|batches$)[^/?#]+(?!\/print)|production\/batches\/[^/?#]+|lots\/lining\/[^/?#]+|lots\/fur\/[^/?#]+|analytics\/raw\/lot\/[^/?#]+|models\/(?!new$)[^/?#]+|suppliers\/(?!new$)[^/?#]+)\/?$/;

const LABELS: [RegExp, string][] = [
  [/^\/dashboard/, "Главная"],
  [/^\/payments/, "Оплаты"],
  [/^\/purchases\/[^/]+/, "Закупка"],
  [/^\/purchases/, "Закупки"],
  [/^\/lots\/lining\/[^/]+/, "Партия подкладки"],
  [/^\/lots\/fur\/[^/]+/, "Вид меха"],
  [/^\/lots\/contractor-hides/, "Шкуры подрядчика"],
  [/^\/lots/, "Сырьё"],
  [/^\/analytics\/raw\/lot\/[^/]+/, "Лот"],
  [/^\/analytics\/raw\/recon/, "Сверка лотов"],
  [/^\/analytics\/raw/, "Аналитика сырья"],
  [/^\/analytics\/products/, "Аналитика изделий"],
  [/^\/analytics\/pricing/, "Цены"],
  [/^\/production\/batches\/[^/]+/, "Партия пошива"],
  [/^\/production\/batches/, "Партии пошива"],
  [/^\/production\/(?!new|import)[^/]+/, "ТЗ"],
  [/^\/production/, "ТЗ"],
  [/^\/models\/[^/]+/, "Артикул"],
  [/^\/articles/, "Изделия"],
  [/^\/suppliers\/[^/]+/, "Поставщик"],
  [/^\/suppliers/, "Поставщики"],
  [/^\/documents/, "Документы"],
  [/^\/verify/, "Подтверждения"],
  [/^\/attention/, "Контроль"],
  [/^\/reconciliation/, "Сверка"],
  [/^\/history/, "История"],
  [/^\/calendar/, "Календарь"],
  [/^\/budget/, "Бюджет"],
  [/^\/plan/, "План заказа"],
  [/^\/supply-plan/, "План поставок"],
  [/^\/shipments/, "Отгрузки"],
  [/^\/fittings/, "Примерки"],
  [/^\/repair/, "Ремонт"],
  [/^\/finished-stock/, "Готовая продукция"],
  [/^\/settings/, "Настройки"],
  [/^\/clients/, "Заказчики"],
  [/^\/materials/, "Материалы"],
];

export function fromLabel(path: string): string {
  const p = path.split(/[?#]/)[0];
  for (const [re, label] of LABELS) if (re.test(p)) return label;
  return "предыдущая страница";
}
