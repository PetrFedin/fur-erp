/**
 * Завести 14 новых ТЗ 169–182 (приложения к Договору подряда №1605, ООО «Меркури Мода» → ООО «Веллмех») со списанием меха и подкладки.
 * Источник: 14 файлов «ПРИЛОЖЕНИЕ 169…182» (папка Загрузки; файлы в приложение НЕ загружаются). Данные ниже перенесены из таблиц приложений
 * и сверены: каждая строка «количество × цена × 1,22 = сумма строки» и «работа + материалы = итого ТЗ» проверяется при запуске.
 *
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-tz-169-182-2026-10-13.ts            # пробный прогон (БД не меняется): таблица ТЗ → поля → списания → себестоимость, остатки лотов до/после
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-tz-169-182-2026-10-13.ts --apply    # применить (перед этим scripts/backup.sh; --no-backup — без копии, только для тестовой БД)
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-tz-169-182-2026-10-13.ts --rollback            # откат по журналу (пробный)
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-tz-169-182-2026-10-13.ts --rollback --apply    # откат: удаляет ТОЛЬКО созданные скриптом записи и возвращает остатки лотов
 *
 * Как заведено (повторяет схему ТЗ 152–168, scripts/apply-drive-production-corrections.ts + apply-new-lining-usage.ts):
 *   • ProductionOrder: номер П-2026-NNNN подряд, workOrderNumber = № ТЗ, договор «№ 1605 от 16.05.2025» (как у 150 из 167 ТЗ), клиент — ООО Меркури Мода,
 *     дата ТЗ из приложения, цена работы за ед. (с НДС 22%), размеры через пробел, цвет — ColorRef (нового цвета нет → «предложенный», как в мастере «Загрузить ТЗ»).
 *     Статус IN_PROGRESS, если есть списание (иначе PLANNED); произведено 0. Партия НЕ присваивается (в документах и переписке не указана) — решает владелец.
 *   • Списание: consumeFromLot (StockMovement PRODUCTION_OUT по цене лота) + ProductionMaterialUsage, commission4=true (4% — только сырьё и подкладка), vatRate NULL («как в лоте»).
 *   • Лот меха определяется по номеру лота из приложения + материалу + цене: цена в приложении = цена лота без НДС × 1,04 (проверяется до 0,3 ₽). Номера «СП0526.N» и
 *     «РП0426.N» — это лоты «N» / «FW26-N» поставок 05.26/04.26 (различаются ценой). Подкладка «№N/130» по 3 848,85 = лот 05.26 (4 515 ₽/м с НДС); №41 по 1 854,66 — прежний пул 2 140 ₽/м.
 *   • Журнал: docs-inventory/corrections-journal-tz-169-182-2026-10-13.json (созданные id, списанные количества). Откат не трогает ничего чужого.
 */
import Module from "module";
import { join } from "path";
import { execSync } from "child_process";
import type { Decimal as DecimalT } from "@prisma/client/runtime/library";
const M = Module as unknown as { _resolveFilename: (...a: unknown[]) => string };
const orig = M._resolveFilename;
M._resolveFilename = function (this: unknown, req: unknown, ...rest: unknown[]) {
  if (req === "server-only") return join(__dirname, "stubs", "empty.js");
  return orig.call(this, req, ...rest);
};

const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
const NO_BACKUP = process.argv.includes("--no-backup");
const SCRIPT = "apply-tz-169-182-2026-10-13.ts";
const CONTRACT = "№ 1605 от 16.05.2025";
const VAT_DOC = 1.22; // ставка НДС в приложениях 2026 года
const NEW_LINING_UNIT = 4515; // лот подкладки поставки 05.26, ₽/м с НДС 22%

type Mat = "Соболь" | "Норка" | "Лиса" | "Свакара";
/** Строка меха из блока «Заказчик передал». docUnit — цена за шт. «без НДС» из документа; docTotal — сумма строки с НДС 22% из документа. */
type Fur = { doc: string; lot: string; mat: Mat; purchase?: string; qty: number; docUnit: number; docTotal: number; basis?: "ex4" | "incl"; note?: string };
/** Подкладка: pick "new" — лот поставки 05.26 (22%, 4 515 ₽/м), "pool20" — прежний пул ткани (НДС 20%). */
type Lin = { fabric: string; doc: string; meters: number; docUnit: number; docTotal: number; pick: "new" | "pool20" };
type Ord = {
  model: string; color: string; size: string; qty: number; material: string; lining: string; price: number;
  fur: Fur[]; lin: Lin[]; extra?: string; note?: string; docOrderTotal?: number;
};
type Tz = { tz: number; date: string; file: string; docTotal: number; extraPerUnit?: number; orders: Ord[] };

const TZS: Tz[] = [
  {
    tz: 169, date: "2026-08-26", file: "ПРИЛОЖЕНИЕ 169 (М001Е - арк.лиса).docx", docTotal: 392256,
    orders: [{
      model: "M001E", color: "Белый", size: "38", qty: 1, material: "шкура лиса арктическая", lining: "94% шерсть, 6% шёлк", price: 240000,
      fur: [{ doc: "шкура лиса арктическая 40", lot: "160045", mat: "Лиса", qty: 6, docUnit: 20800, docTotal: 152256 }], lin: [],
      note: "Подкладка в блоке «Заказчик передал» не указана — списание подкладки не заведено.",
    }],
  },
  {
    tz: 170, date: "2026-08-26", file: "ПРИЛОЖЕНИЕ 170 (М028 - 1 шт).docx", docTotal: 2492626.33,
    orders: [{
      model: "М028", color: "Коричневый", size: "48", qty: 1, material: "Соболь дикий выделанный", lining: "100% Шелк", price: 263000,
      fur: [
        { doc: "XXI 3-1 2 лот СП0526.20", lot: "FW26-20", mat: "Соболь", purchase: "З-2026-0047", qty: 29, docUnit: 29819.14, docTotal: 1055001.17 },
        { doc: "XXI 3-2 1 лот СП0526.22", lot: "22", mat: "Соболь", purchase: "З-2026-0047", qty: 2, docUnit: 28995.86, docTotal: 70749.9 },
        { doc: "XXI 3-2 1 лот СП0526.23", lot: "FW26-23", mat: "Соболь", purchase: "З-2026-0047", qty: 2, docUnit: 28995.86, docTotal: 70749.9 },
        { doc: "XXI 3-2 2 лот СП0526.24", lot: "24", mat: "Соболь", purchase: "З-2026-0047", qty: 6, docUnit: 28995.86, docTotal: 212249.7 },
        { doc: "XXI 3-2 2 лот СП0526.25", lot: "25", mat: "Соболь", purchase: "З-2026-0047", qty: 4, docUnit: 28995.86, docTotal: 141499.8 },
        { doc: "XXI 3-2 2 лот СП0526.26", lot: "FW26-26", mat: "Соболь", purchase: "З-2026-0047", qty: 10, docUnit: 28995.86, docTotal: 353749.49 },
        { doc: "XXI 3-2 2 лот СП0526.27", lot: "FW26-27", mat: "Соболь", purchase: "З-2026-0047", qty: 5, docUnit: 28995.86, docTotal: 176874.75 },
        { doc: "XXI 3а 1 1 лот СП0526.39", lot: "39", mat: "Соболь", purchase: "З-2026-0047", qty: 4, docUnit: 28172.58, docTotal: 137482.19 },
      ],
      lin: [{ fabric: "Подкладочная ткань №24", doc: "№24/130", meters: 2.4, docUnit: 3848.85, docTotal: 11269.43, pick: "new" }],
    }],
  },
  {
    tz: 171, date: "2026-08-26", file: "ПРИЛОЖЕНИЕ 171 (М023 - 1 шт).docx", docTotal: 1953441.89,
    orders: [{
      model: "М023", color: "Бежевый", size: "42", qty: 1, material: "Соболь дикий выделанный", lining: "100% нейлон", price: 280000,
      fur: [
        { doc: "лавандер лот 3485", lot: "3485", mat: "Соболь", purchase: "З-2026-0028", qty: 37, docUnit: 26951.6, docTotal: 1216595.22 },
        { doc: "лавандер лот 3486", lot: "3486", mat: "Соболь", purchase: "З-2026-0028", qty: 13, docUnit: 28804.96, docTotal: 456846.67 },
      ], lin: [],
      note: "Подкладка в блоке «Заказчик передал» не указана (в таблице ТЗ — 100% нейлон) — списание подкладки не заведено.",
    }],
  },
  {
    tz: 172, date: "2026-08-26", file: "ПРИЛОЖЕНИЕ 172 (М002 - 1 собол).docx", docTotal: 3812374.22,
    orders: [{
      model: "М002", color: "Бежевый", size: "48", qty: 1, material: "Соболь дикий выделанный", lining: "100% Шелк", price: 408500,
      fur: [
        { doc: "лот 3635", lot: "3635", mat: "Соболь", purchase: "З-2026-0028", qty: 3, docUnit: 31585.06, docTotal: 115601.32 },
        { doc: "лот 3748", lot: "3748", mat: "Соболь", purchase: "З-2026-0028", qty: 4, docUnit: 19538.14, docTotal: 95346.12 },
        { doc: "лот 3958", lot: "3958", mat: "Соболь", purchase: "З-2026-0028", qty: 3, docUnit: 17684.76, docTotal: 64726.22 },
        { doc: "лот 3961", lot: "3961", mat: "Соболь", purchase: "З-2026-0028", qty: 3, docUnit: 17684.76, docTotal: 64726.22 },
        { doc: "лот 4051", lot: "4051", mat: "Соболь", purchase: "З-2026-0028", qty: 5, docUnit: 17684.68, docTotal: 107876.55 },
        { doc: "лот 4053", lot: "4053", mat: "Соболь", purchase: "З-2026-0028", qty: 3, docUnit: 16758.04, docTotal: 61334.43 },
        { doc: "РП0426.2005", lot: "2005", mat: "Соболь", purchase: "З-2026-0045", qty: 17, docUnit: 33009.14, docTotal: 684609.56 },
        { doc: "РП0426.2016", lot: "2016", mat: "Соболь", purchase: "З-2026-0045", qty: 5, docUnit: 32143.91, docTotal: 196077.85 },
        { doc: "РП0426.2067", lot: "2067", mat: "Соболь", purchase: "З-2026-0045", qty: 2, docUnit: 28682.95, docTotal: 69986.4 },
        { doc: "РП0426.2070", lot: "2070", mat: "Соболь", purchase: "З-2026-0045", qty: 6, docUnit: 28682.94, docTotal: 209959.12 },
        { doc: "РП0426.2077", lot: "2077", mat: "Соболь", purchase: "З-2026-0046", qty: 3, docUnit: 32143.9, docTotal: 117646.67 },
        { doc: "РП0426.2125", lot: "2125", mat: "Соболь", purchase: "З-2026-0046", qty: 5, docUnit: 29548.18, docTotal: 180243.9 },
        { doc: "РП0426.2126", lot: "2126", mat: "Соболь", purchase: "З-2026-0046", qty: 12, docUnit: 29548.18, docTotal: 432585.36 },
        { doc: "РП0426.2135", lot: "2135", mat: "Соболь", purchase: "З-2026-0046", qty: 2, docUnit: 32143.9, docTotal: 78431.12 },
        { doc: "РП0426.2137", lot: "2137", mat: "Соболь", purchase: "З-2026-0046", qty: 7, docUnit: 34739.63, docTotal: 296676.44 },
        { doc: "РП0426.2138", lot: "2138", mat: "Соболь", purchase: "З-2026-0046", qty: 4, docUnit: 34739.63, docTotal: 169529.39 },
        { doc: "РП0426.2144", lot: "2144", mat: "Соболь", purchase: "З-2026-0046", qty: 4, docUnit: 34739.63, docTotal: 169529.39 },
        { doc: "РП0426.2145", lot: "2145", mat: "Соболь", purchase: "З-2026-0046", qty: 2, docUnit: 34739.63, docTotal: 84764.7 },
        { doc: "РП0426.2175", lot: "2175", mat: "Соболь", purchase: "З-2026-0046", qty: 5, docUnit: 32143.9, docTotal: 196077.79 },
      ],
      lin: [{ fabric: "Подкладочная ткань №41", doc: "№41", meters: 3.6, docUnit: 1854.66, docTotal: 8145.67, pick: "pool20" }],
    }],
  },
  {
    tz: 173, date: "2026-08-26", file: "ПРИЛОЖЕНИЕ 173 (М009 - 1 шт. браун).docx", docTotal: 366397.8,
    orders: [{
      model: "M009", color: "Коричневый", size: "44", qty: 1, material: "выделанная шкурка норки коричневой", lining: "100% Шелк", price: 200000,
      fur: [
        { doc: "норка коричневая 503134 (сага 03-26)", lot: "503134", mat: "Норка", qty: 11, docUnit: 8407.29, docTotal: 112825.83 },
        { doc: "норка коричневая 300235 (сага 03-26)", lot: "300235", mat: "Норка", qty: 3, docUnit: 11814.66, docTotal: 43241.66 },
      ],
      lin: [{ fabric: "Подкладочная ткань №24", doc: "№24/130", meters: 2.2, docUnit: 3848.85, docTotal: 10330.31, pick: "new" }],
    }],
  },
  {
    tz: 174, date: "2026-08-26", file: "ПРИЛОЖЕНИЕ_174_М026_4_шт_норка_белая.docx", docTotal: 2548367.3,
    orders: [{
      model: "М026", color: "Белый", size: "42 44 46 48", qty: 4, material: "Шкура норка белая", lining: "100% Шелк", price: 320000,
      fur: [
        { doc: "норка белая отбеленная 20 (5023/5022/5037/5028)", lot: "5023, 5022, 5037, 5028", mat: "Норка", qty: 23, docUnit: 8666.66, docTotal: 243186.48 },
        { doc: "норка белая отбеленная 20 300302", lot: "300302", mat: "Норка", qty: 6, docUnit: 8666.66, docTotal: 63439.95 },
        { doc: "норка белая отбеленная 20 (5023/5022/5037/5028), вторая строка", lot: "5023, 5022, 5037, 5028", mat: "Норка", qty: 15, docUnit: 8666.66, docTotal: 158599.88 },
        { doc: "норка белая 20 (5017/5020/5016)", lot: "5017/5020/5016", mat: "Норка", qty: 72, docUnit: 8320, docTotal: 730828.8 },
      ],
      lin: [{ fabric: "Подкладочная ткань №2", doc: "№2/130", meters: 15.4, docUnit: 3848.85, docTotal: 72312.19, pick: "new" }],
    }],
  },
  {
    tz: 175, date: "2026-08-26", file: "ПРИЛОЖЕНИЕ 175 (М018-свакара 6 шт).docx", docTotal: 4388953.34,
    orders: [{
      model: "M018", color: "Коричневый", size: "42 44 44 46 46 48", qty: 6, material: "шкура каракуля SWAKARA", lining: "100% Шелк", price: 154500,
      fur: [
        { doc: "свакара белая 740505 (сага 03-26)", lot: "740505", mat: "Свакара", qty: 40, docUnit: 23320.07, docTotal: 1138019.42 },
        { doc: "свакара белая 740506 (сага 03-26)", lot: "740506", mat: "Свакара", qty: 80, docUnit: 23320.07, docTotal: 2276038.83 },
      ],
      lin: [{ fabric: "Подкладочная ткань №24", doc: "№24/130", meters: 10.2, docUnit: 3848.85, docTotal: 47895.09, pick: "new" }],
    }],
  },
  {
    tz: 176, date: "2026-08-26", file: "ПРИЛОЖЕНИЕ 176 (М038 - 2 шт).docx", docTotal: 1180331.39,
    orders: [{
      model: "М038", color: "Коричневый", size: "42 44", qty: 2, material: "Соболь выделанный тонированный; выделанная шкурка норки", lining: "100% Шелк", price: 187000,
      fur: [
        { doc: "XXL 3-2.1 РП0426.20", lot: "20", mat: "Соболь", purchase: "З-2026-0042", qty: 6, docUnit: 27826.55, docTotal: 203690.35 },
        { doc: "XXL 3-2.1 РП0426.23 (в графе «лот» опечатка «РП0426.233»)", lot: "23", mat: "Соболь", purchase: "З-2026-0042", qty: 6, docUnit: 27826.55, docTotal: 203690.35 },
        { doc: "норка коричневая 300687 (сага 03-26)", lot: "300687", mat: "Норка", qty: 30, docUnit: 10438.43, docTotal: 382046.54 },
      ],
      lin: [{ fabric: "Подкладочная ткань №37", doc: "№37/130", meters: 3.6, docUnit: 3848.85, docTotal: 16904.15, pick: "new" }],
    }],
  },
  {
    tz: 177, date: "2026-08-26", file: "ПРИЛОЖЕНИЕ 177 (М044 - 1 шт).docx", docTotal: 561878.08,
    orders: [{
      model: "М044", color: "Коричневый", size: "48", qty: 1, material: "выделанная шкурка норки коричневой", lining: "100% Шелк", price: 300000,
      fur: [{ doc: "норка коричневая 302127 (сага 03-26)", lot: "302127", mat: "Норка", qty: 24, docUnit: 8655.26, docTotal: 253426.01 }],
      lin: [{ fabric: "Подкладочная ткань №24", doc: "№24/130", meters: 1.8, docUnit: 3848.85, docTotal: 8452.07, pick: "new" }],
    }],
  },
  {
    tz: 178, date: "2026-08-26", file: "ПРИЛОЖЕНИЕ 178 (MMF01 - 1 шт. ).docx", docTotal: 156807.77, extraPerUnit: 791.78,
    orders: [{
      model: "MMF01", color: "Коричневый", size: "NS", qty: 1, material: "Соболь выделанный тонированный", lining: "100% Шелк", price: 16000,
      fur: [
        { doc: "XXL 2-1.2 РП0426.5", lot: "5", mat: "Соболь", purchase: "З-2026-0041", qty: 1, docUnit: 27826.57, docTotal: 33948.42 },
        { doc: "XXL 3-2.1 РП0426.20", lot: "20", mat: "Соболь", purchase: "З-2026-0042", qty: 1, docUnit: 27826.55, docTotal: 33948.39 },
        { doc: "XXL 3-2.2 РП0426.26", lot: "26", mat: "Соболь", purchase: "З-2026-0042", qty: 2, docUnit: 29557.04, docTotal: 72119.18 },
      ], lin: [],
      extra: "Дополнительные материалы по ТЗ: 791,78 ₽ за ед. с НДС 22% — какие именно, в приложении не указано; в расходы не заведены (вопрос владельцу).",
      note: "Подкладка в блоке «Заказчик передал» не указана — списание подкладки не заведено.",
    }],
  },
  {
    tz: 179, date: "2026-08-26", file: "ПРИЛОЖЕНИЕ 179 (MCF01 - 5 шт. ).docx", docTotal: 122347.8,
    orders: [{
      model: "MCF01", color: "Коричневый", size: "NS", qty: 5, material: "Лоскут соболя", lining: "100% Шелк", price: 24000,
      fur: [], lin: [{ fabric: "Подкладочная ткань №24", doc: "№24/130", meters: 0.5, docUnit: 3848.85, docTotal: 2347.8, pick: "new" }],
      note: "Мех (лоскут соболя) в блоке «Заказчик передал» не указан — списание меха не заведено.",
    }],
  },
  {
    tz: 180, date: "2026-08-26", file: "ПРИЛОЖЕНИЕ 180 (М045 - 5 шт.) бордо.docx", docTotal: 1847245.7,
    orders: [{
      model: "М045", color: "Бордовый", size: "42 44 44 46 46", qty: 5, material: "выделанная шкурка норки", lining: "100% Шелк", price: 180000,
      fur: [{ doc: "норка коричневая 400102 (сага 03-26)", lot: "400102", mat: "Норка", qty: 90, docUnit: 8370.42, docTotal: 919072.12 }],
      lin: [{ fabric: "Подкладочная ткань №38", doc: "№38/130", meters: 6, docUnit: 3848.85, docTotal: 28173.58, pick: "new" }],
    }],
  },
  {
    tz: 181, date: "2026-09-15", file: "ПРИЛОЖЕНИЕ 181 (М055 - 2 шт.).docx", docTotal: 803063.99,
    orders: [{
      model: "М055", color: "Т-Коричневый", size: "46 48", qty: 2, material: "выделанная шкурка норки", lining: "100% Шелк", price: 210000,
      fur: [{ doc: "норка коричневая (махагон) 204742 (AME 05-26)", lot: "204742", mat: "Норка", qty: 36, docUnit: 8230.06, docTotal: 361464.24 }],
      lin: [{ fabric: "Подкладочная ткань №24", doc: "№24/130", meters: 4.6, docUnit: 3848.85, docTotal: 21599.75, pick: "new" }],
    }],
  },
  {
    tz: 182, date: "2026-08-26", file: "ПРИЛОЖЕНИЕ 182 (МН06-МН07 - 46 шт).docx", docTotal: 577337.6,
    orders: [
      {
        model: "МН06", color: "Серый", size: "NS", qty: 20, material: "шкура норки ирис", lining: "100% шерсть", price: 7000, docOrderTotal: 233405,
        fur: [{ doc: "норка ирис самец 20 518005", lot: "518005", mat: "Норка", qty: 10, docUnit: 8834, docTotal: 93404.91, basis: "incl", note: "в графе «без НДС» стоит цена лота С НДС 20%; сумма строки — цена лота без НДС × 1,04 × 1,22" }],
        lin: [], note: "Подкладка в блоке «Заказчик передал» не указана — списание подкладки не заведено.",
      },
      {
        model: "МН06", color: "Кремовый", size: "NS", qty: 20, material: "шкура норки лаванда", lining: "51% Шелк 49% Кашемир", price: 7000, docOrderTotal: 292932.6,
        fur: [{ doc: "норка лаванда самец 20 519506", lot: "519506", mat: "Норка", qty: 10, docUnit: 14464, docTotal: 152932.61, basis: "incl", note: "в графе «без НДС» стоит цена лота С НДС 20%; сумма строки — цена лота без НДС × 1,04 × 1,22" }],
        lin: [], note: "Подкладка в блоке «Заказчик передал» не указана — списание подкладки не заведено.",
      },
      {
        model: "МН07", color: "Коричневый", size: "NS", qty: 6, material: "Лоскут соболя", lining: "100% Кашемир", price: 8500, docOrderTotal: 51000,
        fur: [], lin: [], note: "Сырьё в блоке «Заказчик передал» не указано (лоскут соболя) — списаний нет.",
      },
    ],
  },
];

// ---------------------------------------------------------------------------------------------------------------------------------------------

const r2 = (n: number) => Math.round(n * 100) / 100;
const rub = (n: number) => r2(n).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/ /g, " ");
const LAT: Record<string, string> = { М: "M", Н: "H", Е: "E", С: "C", К: "K", А: "A", О: "O", Т: "T", Р: "P", В: "B", Х: "X" };
const nm = (s: string) => s.toUpperCase().replace(/[\s\-_]/g, "").replace(/[А-Я]/g, (c) => LAT[c] ?? c);

type Journal = {
  script: string; status: "applied" | "rolled-back"; at: string;
  orders: { id: string; number: string; tz: string; model: string }[];
  usages: string[]; movements: string[];
  lots: { lotId: string; lotNumber: string | null; qty: string; remainingBefore: string; remainingAfter: string }[];
  createdModels: string[]; createdColors: string[];
};

async function main() {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const { INV, readJson, writeJson } = await import("./detail-common");
  const { consumeFromLot } = await import("../src/lib/stock");
  const { matchColorRef, capitalizeColor, PROPOSED_MARK } = await import("../src/lib/color-ref");
  const { Decimal } = await import("@prisma/client/runtime/library");
  const { lineCostWith4 } = await import("../src/lib/commission4");
  const prisma = createAuditedClient("script:apply-tz-169-182-2026-10-13");
  const JOURNAL = join(INV, "corrections-journal-tz-169-182-2026-10-13.json");

  const org = await prisma.organization.findFirst({ orderBy: { createdAt: "asc" } });
  if (!org) throw new Error("нет организации");
  const orgId = org.id;

  // ----- Откат -----
  if (ROLLBACK) {
    const j = readJson<Journal | null>(JOURNAL, null);
    if (!j || j.status !== "applied") { console.log("Журнал пуст или уже откачен — откатывать нечего."); await prisma.$disconnect(); return; }
    const ids = j.orders.map((o) => o.id);
    const blockers = {
      "разнесения оплат (PaymentAllocation)": await prisma.paymentAllocation.count({ where: { productionOrderId: { in: ids } } }),
      "ссылки оплат на ТЗ": await prisma.productionPaymentOrder.count({ where: { productionOrderId: { in: ids } } }),
      "расходы ТЗ": await prisma.productionExpense.count({ where: { productionOrderId: { in: ids } } }),
      "отгрузки": await prisma.shipmentLine.count({ where: { productionOrderId: { in: ids } } }),
      "примерки": await prisma.fitting.count({ where: { productionOrderId: { in: ids } } }),
      "движения готовой продукции": await prisma.finishedGoodsMovement.count({ where: { productionOrderId: { in: ids } } }),
      "документы": await prisma.driveDocument.count({ where: { productionOrderId: { in: ids } } }),
    };
    const blocked = Object.entries(blockers).filter(([, n]) => n > 0);
    // списания, добавленные позже вручную, откатом не затрагиваем — но и не даём удалить ТЗ с чужими записями
    const extraUsages = await prisma.productionMaterialUsage.count({ where: { productionOrderId: { in: ids }, id: { notIn: j.usages } } });
    const extraMoves = await prisma.stockMovement.count({ where: { productionOrderId: { in: ids }, id: { notIn: j.movements } } });
    console.log(`Откат: ТЗ ${j.orders.length}, списаний ${j.usages.length}, движений ${j.movements.length}, лотов ${j.lots.length}, моделей ${j.createdModels.length}, цветов ${j.createdColors.length}${APPLY ? "" : " (пробный — добавьте --apply)"}`);
    if (blocked.length || extraUsages || extraMoves) {
      console.log("ОТКАТ НЕВОЗМОЖЕН: к созданным ТЗ уже привязаны другие записи:");
      for (const [k, n] of blocked) console.log(`  - ${k}: ${n}`);
      if (extraUsages) console.log(`  - списания, добавленные после скрипта: ${extraUsages}`);
      if (extraMoves) console.log(`  - движения склада, добавленные после скрипта: ${extraMoves}`);
      console.log("Сначала снимите эти записи (например, откатите разнесение аванса), затем повторите.");
      await prisma.$disconnect(); process.exitCode = 1; return;
    }
    if (APPLY) {
      await prisma.$transaction(async (tx) => {
        await tx.stockMovement.deleteMany({ where: { id: { in: j.movements } } });
        await tx.productionMaterialUsage.deleteMany({ where: { id: { in: j.usages } } });
        for (const l of j.lots) {
          const lot = await tx.rawMaterialLot.findUniqueOrThrow({ where: { id: l.lotId } });
          const back = lot.quantityRemaining.add(new Decimal(l.qty));
          if (back.greaterThan(lot.quantityReceived)) throw new Error(`Лот ${l.lotNumber}: после возврата остаток ${back} больше полученного ${lot.quantityReceived} — откат отменён`);
          await tx.rawMaterialLot.update({ where: { id: l.lotId }, data: { quantityRemaining: back } });
        }
        await tx.productionOrderColor.deleteMany({ where: { orderId: { in: ids } } });
        await tx.productionOrder.deleteMany({ where: { id: { in: ids } } });
        for (const id of j.createdColors) if ((await tx.productionOrder.count({ where: { colorRefId: id } })) === 0) await tx.colorRef.deleteMany({ where: { id } });
        for (const id of j.createdModels) if ((await tx.productionOrder.count({ where: { productModelId: id } })) === 0) await tx.productModel.deleteMany({ where: { id } });
      }, { timeout: 120000, maxWait: 15000 });
      writeJson(JOURNAL, { ...j, status: "rolled-back", at: new Date().toISOString() });
      console.log("Откат выполнен.");
    }
    await prisma.$disconnect();
    return;
  }

  // ----- Данные из базы -----
  const problems: string[] = [];
  const warns: string[] = [];
  const client = await prisma.client.findFirst({ where: { organizationId: orgId, name: { contains: "Меркури" } } });
  if (!client) throw new Error("клиент «Меркури Мода» не найден");
  const warehouse = (await prisma.warehouse.findMany({ where: { organizationId: orgId }, orderBy: { name: "asc" } })).find((w) => w.isDefault) ?? (await prisma.warehouse.findFirst({ where: { organizationId: orgId } }));
  if (!warehouse) throw new Error("нет склада");
  const existing = await prisma.productionOrder.findMany({ where: { organizationId: orgId, workOrderNumber: { in: TZS.map((t) => String(t.tz)) } }, select: { number: true, workOrderNumber: true } });
  const prev = readJson<Journal | null>(JOURNAL, null);
  if (existing.length) problems.push(`ТЗ ${[...new Set(existing.map((e) => e.workOrderNumber))].join(", ")} уже есть в базе (${existing.map((e) => e.number).join(", ")}) — скрипт не дублирует`);
  if (prev && prev.status === "applied") problems.push("журнал уже содержит применённое внесение — сначала --rollback --apply");

  const models = await prisma.productModel.findMany({ where: { organizationId: orgId }, select: { id: true, name: true, salesCode: true, aliases: true } });
  const colors = await prisma.colorRef.findMany({ where: { organizationId: orgId }, select: { id: true, name: true, aliases: true, note: true } });
  const lots = await prisma.rawMaterialLot.findMany({
    where: { organizationId: orgId },
    include: { rawMaterial: { select: { name: true, unit: true } }, purchase: { select: { number: true, status: true } } },
  });
  const lastNum = await prisma.productionOrder.findFirst({ where: { organizationId: orgId, number: { startsWith: `П-${new Date().getFullYear()}-` } }, orderBy: { number: "desc" }, select: { number: true } });
  let seq = lastNum ? Number(lastNum.number.slice(-4)) : 0;

  type LotRow = (typeof lots)[number];
  const remPlan = new Map<string, { lot: LotRow; use: DecimalT }>();
  const findFurLot = (f: Fur, tag: string): LotRow | null => {
    const c = lots.filter((l) => l.rawMaterial.name === f.mat && l.lotNumber === f.lot && (!f.purchase || l.purchase?.number === f.purchase));
    if (c.length !== 1) { problems.push(`${tag}: лот «${f.lot}» (${f.mat}${f.purchase ? ", " + f.purchase : ""}) найден ${c.length} раз(а), ожидался 1`); return null; }
    const l = c[0];
    if (l.purchase?.status !== "RECEIVED") problems.push(`${tag}: лот ${f.lot} из закупки ${l.purchase?.number} в статусе ${l.purchase?.status} (не принят)`);
    return l;
  };
  const findLinLot = (x: Lin, tag: string): LotRow | null => {
    const c = lots.filter((l) => l.rawMaterial.name === x.fabric && (x.pick === "new" ? Number(l.vatRate) === 22 && Math.abs(Number(l.unitCost) - NEW_LINING_UNIT) < 0.005 : Number(l.vatRate) === 20));
    if (c.length !== 1) { problems.push(`${tag}: лот подкладки «${x.fabric}» (${x.pick}) найден ${c.length} раз(а), ожидался 1`); return null; }
    return c[0];
  };

  type Use = { kind: "fur" | "lin"; lot: LotRow; qty: number; docs: string[]; unit: number; cost: number; cost4: number; docTotal: number; confidence: string; source: string };
  type Plan = { tz: Tz; o: Ord; idx: number; number: string; modelId: string | null; modelName: string; newModel: boolean; colorId: string | null; colorNew: boolean; uses: Use[]; docOrderTotal: number };
  const plans: Plan[] = [];
  const newModels = new Set<string>();
  const newColors = new Set<string>();

  for (const tz of TZS) {
    const workSum = tz.orders.reduce((s, o) => s + o.price * o.qty, 0);
    let matSum = 0;
    for (const [idx, o] of tz.orders.entries()) {
      const tag = `ТЗ ${tz.tz}${tz.orders.length > 1 ? ` (${o.model} ${o.color})` : ""}`;
      // модель
      const mm = models.filter((m) => nm(m.name) === nm(o.model) || (m.salesCode && nm(m.salesCode) === nm(o.model)) || m.aliases.some((a) => nm(a) === nm(o.model)));
      let modelId: string | null = null; let newModel = false; let modelName = o.model;
      if (mm.length === 1) { modelId = mm[0].id; modelName = mm[0].name; }
      else if (mm.length > 1) problems.push(`${tag}: артикул ${o.model} неоднозначен (${mm.map((m) => m.name).join(", ")})`);
      else { newModel = true; newModels.add(o.model); }
      // цвет
      const cr = matchColorRef(o.color, colors);
      const colorNew = !cr;
      if (colorNew) newColors.add(capitalizeColor(o.color));
      // списания (по лотам; повторы одного лота в ТЗ объединяются)
      const uses: Use[] = [];
      for (const f of o.fur) {
        const lot = findFurLot(f, tag);
        const lineTot = r2(f.qty * f.docUnit * VAT_DOC);
        if (Math.abs(lineTot - f.docTotal) > 0.02 && f.basis !== "incl") problems.push(`${tag}: строка «${f.doc}»: ${f.qty} × ${f.docUnit} × 1,22 = ${rub(lineTot)} ≠ ${rub(f.docTotal)} из документа`);
        matSum += f.docTotal;
        if (!lot) continue;
        const ex = Number(lot.materialCostExclVat);
        const expect = f.basis === "incl" ? Number(lot.unitCost) : ex * 1.04;
        if (Math.abs(expect - f.docUnit) > (f.basis === "incl" ? 0.5 : 0.3)) problems.push(`${tag}: лот ${f.lot}: цена в приложении ${f.docUnit} ≠ ожидаемой по лоту ${r2(expect)} (лот ${rub(Number(lot.unitCost))} с НДС ${lot.vatRate}%)`);
        if (f.basis === "incl") { const t = r2(ex * 1.04 * VAT_DOC * f.qty); if (Math.abs(t - f.docTotal) > 5) problems.push(`${tag}: лот ${f.lot}: сумма строки ${rub(f.docTotal)} ≠ ${rub(t)} (цена лота без НДС × 1,04 × 1,22)`); else if (Math.abs(t - f.docTotal) > 0.05) warns.push(`${tag}: лот ${f.lot}: сумма строки в приложении ${rub(f.docTotal)}, по лоту ${rub(t)} (в приложении цена лота округлена до рубля: ${f.docUnit})`); }
        const unit = Number(lot.unitCost);
        const eff = Number(lot.vatRate);
        const ex1 = uses.find((u) => u.lot.id === lot.id);
        const cost = r2(unit * f.qty);
        const cost4 = r2(lineCostWith4(unit, eff, true) * f.qty);
        const conf = f.lot.startsWith("FW26") || /^\d{1,2}$/.test(f.lot) ? "высокая: № в приложении СП0526.N/РП0426.N = лот N или FW26-N, подтверждено ценой и сортом" : "высокая: № лота и цена совпали";
        if (ex1) { ex1.qty += f.qty; ex1.cost = r2(ex1.cost + cost); ex1.cost4 = r2(ex1.cost4 + cost4); ex1.docTotal = r2(ex1.docTotal + f.docTotal); ex1.docs.push(f.doc); }
        else uses.push({ kind: "fur", lot, qty: f.qty, docs: [f.doc], unit, cost, cost4, docTotal: f.docTotal, confidence: conf, source: `приложение ${tz.tz}: «${f.doc}»` });
      }
      for (const x of o.lin) {
        const lot = findLinLot(x, tag);
        const lineTot = r2(x.meters * x.docUnit * VAT_DOC);
        if (Math.abs(lineTot - x.docTotal) > 0.02) problems.push(`${tag}: подкладка ${x.doc}: ${x.meters} × ${x.docUnit} × 1,22 = ${rub(lineTot)} ≠ ${rub(x.docTotal)} из документа`);
        matSum += x.docTotal;
        if (!lot) continue;
        const expect = Number(lot.materialCostExclVat) * 1.04;
        if (Math.abs(expect - x.docUnit) > (x.pick === "new" ? 0.05 : 0.5)) problems.push(`${tag}: подкладка ${x.fabric}: цена в приложении ${x.docUnit} ≠ лот ${r2(expect)}`);
        else if (Math.abs(expect - x.docUnit) > 0.05) warns.push(`${tag}: подкладка ${x.fabric}: цена в приложении ${x.docUnit}, по прежнему пулу ${r2(expect)} (разница ${r2(expect - x.docUnit)} ₽/м из-за копеек в средней цене пула)`);
        const unit = Number(lot.unitCost);
        uses.push({ kind: "lin", lot, qty: x.meters, docs: [x.doc], unit, cost: r2(unit * x.meters), cost4: r2(lineCostWith4(unit, Number(lot.vatRate), true) * x.meters), docTotal: x.docTotal,
          confidence: x.pick === "new" ? "высокая: «№N/130» по 3 848,85 = лот подкладки 05.26 (4 515 ₽/м с НДС) × 1,04 ÷ 1,22" : "средняя: цена 1 854,66 = прежний пул ткани №41 (2 140 ₽/м с НДС 20%); так же списана подкладка №41 у ТЗ 125 (М002)",
          source: `приложение ${tz.tz}: «${x.fabric}», ${x.meters} м` });
      }
      const furSum = o.fur.reduce((s, f) => s + f.docTotal, 0) + o.lin.reduce((s, x) => s + x.docTotal, 0);
      const orderDoc = r2(o.price * o.qty + furSum + (idx === 0 && tz.extraPerUnit ? tz.extraPerUnit * o.qty : 0));
      if (o.docOrderTotal != null && Math.abs(orderDoc - o.docOrderTotal) > 0.2) problems.push(`${tag}: работа + материалы = ${rub(orderDoc)} ≠ ${rub(o.docOrderTotal)} из документа`);
      for (const u of uses) { const e = remPlan.get(u.lot.id) ?? { lot: u.lot, use: new Decimal(0) }; e.use = e.use.add(u.qty); remPlan.set(u.lot.id, e); }
      seq += 1;
      plans.push({ tz, o, idx, number: `П-${new Date().getFullYear()}-${String(seq).padStart(4, "0")}`, modelId, modelName, newModel, colorId: cr?.id ?? null, colorNew, uses, docOrderTotal: orderDoc });
    }
    const tot = r2(workSum + matSum + (tz.extraPerUnit ? tz.extraPerUnit * tz.orders[0].qty : 0));
    if (Math.abs(tot - tz.docTotal) > 0.2) problems.push(`ТЗ ${tz.tz}: работа + материалы + доп. = ${rub(tot)} ≠ итого ТЗ ${rub(tz.docTotal)} из документа`);
  }
  for (const { lot, use } of remPlan.values()) {
    if (lot.quantityRemaining.lessThan(use)) problems.push(`лот ${lot.lotNumber ?? lot.rawMaterial.name}: нужно ${use}, остаток ${lot.quantityRemaining} — остаток ушёл бы ниже 0`);
  }

  // ----- Отчёт -----
  const out: string[] = [];
  out.push(`# ТЗ 169–182 — ${APPLY ? "ПРИМЕНЕНИЕ" : "пробный прогон"} (${new Date().toISOString()})`, "");
  out.push(`Организация: ${org.name}; клиент: ${client.name}; склад: ${warehouse.name}; договор: ${CONTRACT}. Партия НЕ присваивается (в приложениях и переписке не указана).`, "");
  out.push("## ТЗ → поля", "", "| ТЗ | заказ | артикул | цвет (справочник) | размеры | шт. | цена работы | работа всего | дата ТЗ | подкладка | статус |", "|---|---|---|---|---|---:|---:|---:|---|---|---|");
  for (const p of plans) {
    const st = p.uses.length ? "IN_PROGRESS" : "PLANNED";
    out.push(`| ${p.tz.tz} | ${p.number} | ${p.o.model}${p.modelId ? ` → ${p.modelName}` : " → НОВЫЙ артикул"} | ${p.o.color} → ${p.colorNew ? "НОВЫЙ (предложенный)" : "есть"} | ${p.o.size} | ${p.o.qty} | ${rub(p.o.price)} | ${rub(p.o.price * p.o.qty)} | ${p.tz.date} | ${p.o.lining} | ${st} |`);
  }
  out.push("", "## Списания (лот → количество → цена → стоимость)", "", "| ТЗ | вид | лот | материал | партия закупки | остаток до | спис. | остаток после | цена лота с НДС | НДС лота | стоимость | с 4% | по документу (22%, с 4%) | источник / уверенность |", "|---|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|");
  const running = new Map<string, DecimalT>();
  for (const { lot } of remPlan.values()) running.set(lot.id, lot.quantityRemaining);
  const perTz = new Map<number, { cost: number; cost4: number; doc: number; fur: number; lin: number; furQ: number; linQ: number }>();
  for (const p of plans) {
    for (const u of p.uses) {
      const before = running.get(u.lot.id)!; const after = before.sub(u.qty); running.set(u.lot.id, after);
      out.push(`| ${p.tz.tz}${p.tz.orders.length > 1 ? ` ${p.o.model} ${p.o.color}` : ""} | ${u.kind === "fur" ? "мех" : "подкладка"} | ${u.lot.lotNumber ?? "(пул)"} | ${u.lot.rawMaterial.name} | ${u.lot.purchase?.number ?? "—"} | ${before} | ${u.qty} | ${after} | ${rub(u.unit)} | ${Number(u.lot.vatRate)}% | ${rub(u.cost)} | ${rub(u.cost4)} | ${rub(u.docTotal)} | ${u.source}; ${u.confidence} |`);
      const t = perTz.get(p.tz.tz) ?? { cost: 0, cost4: 0, doc: 0, fur: 0, lin: 0, furQ: 0, linQ: 0 };
      t.cost += u.cost; t.cost4 += u.cost4; t.doc += u.docTotal;
      if (u.kind === "fur") { t.fur += u.cost; t.furQ += u.qty; } else { t.lin += u.cost; t.linQ += u.qty; }
      perTz.set(p.tz.tz, t);
    }
  }
  out.push("", "## Итоговая себестоимость по ТЗ (материалы из базы по ценам лотов; работа — по приложению)", "", "| ТЗ | шт. | мех, шкур | подкладка, м | мех+подкладка без 4% (НДС лота) | с 4% (НДС лота) | по документу (22%, с 4%) | разница с документом | работа с НДС | итого по ТЗ в документе | материалы + работа (с 4%) |", "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
  let sumQ = 0, sumC = 0, sumC4 = 0, sumDoc = 0, sumWork = 0, sumTot = 0, sumFur = 0, sumLin = 0;
  for (const tz of TZS) {
    const t = perTz.get(tz.tz) ?? { cost: 0, cost4: 0, doc: 0, fur: 0, lin: 0, furQ: 0, linQ: 0 };
    const q = tz.orders.reduce((s, o) => s + o.qty, 0); const work = tz.orders.reduce((s, o) => s + o.price * o.qty, 0);
    out.push(`| ${tz.tz} | ${q} | ${t.furQ} | ${t.linQ} | ${rub(t.cost)} | ${rub(t.cost4)} | ${rub(t.doc)} | ${rub(t.cost4 - t.doc)} | ${rub(work)} | ${rub(tz.docTotal)} | ${rub(t.cost4 + work)} |`);
    sumQ += q; sumC += t.cost; sumC4 += t.cost4; sumDoc += t.doc; sumWork += work; sumTot += tz.docTotal; sumFur += t.fur; sumLin += t.lin;
  }
  out.push(`| **Итого** | ${sumQ} | | | ${rub(sumC)} | ${rub(sumC4)} | ${rub(sumDoc)} | ${rub(sumC4 - sumDoc)} | ${rub(sumWork)} | ${rub(sumTot)} | ${rub(sumC4 + sumWork)} |`);
  out.push("", `Мех (без 4%): ${rub(sumFur)}; подкладка (без 4%): ${rub(sumLin)}. Разница «с 4% по базе» и «по документу» — только от ставки НДС: у старых лотов (поставки 2025, НДС 20%) в приложениях НДС 22%; у лотов с НДС 22% совпадает до копеек.`);
  out.push("", "## Остатки лотов до/после", "", "| лот | материал | закупка | было | спишется | станет |", "|---|---|---|---:|---:|---:|");
  for (const { lot, use } of [...remPlan.values()].sort((a, b) => (a.lot.rawMaterial.name + (a.lot.lotNumber ?? "")).localeCompare(b.lot.rawMaterial.name + (b.lot.lotNumber ?? "")))) {
    out.push(`| ${lot.lotNumber ?? "(пул " + lot.rawMaterial.name + ", " + Number(lot.vatRate) + "%)"} | ${lot.rawMaterial.name} | ${lot.purchase?.number ?? "—"} | ${lot.quantityRemaining} | ${use} | ${lot.quantityRemaining.sub(use)} |`);
  }
  out.push("", `Будут созданы: ТЗ-заказов ${plans.length}, списаний ${plans.reduce((s, p) => s + p.uses.length, 0)}, новых артикулов ${newModels.size}${newModels.size ? " (" + [...newModels].join(", ") + ")" : ""}, новых цветов ${newColors.size}${newColors.size ? " (" + [...newColors].join(", ") + ")" : ""}.`);
  if (warns.length) out.push("", "## Замечания", ...warns.map((w) => `- ${w}`));
  for (const p of plans) {
    const notes = [p.o.note, p.o.extra].filter(Boolean);
    if (notes.length) out.push(`- ТЗ ${p.tz.tz}${p.tz.orders.length > 1 ? " " + p.o.model + " " + p.o.color : ""}: ${notes.join(" ")}`);
  }
  if (problems.length) out.push("", "## ПРОБЛЕМЫ — запись не выполняется", ...problems.map((x) => `- ${x}`));
  console.log(out.join("\n"));
  if (problems.length) { console.log(`\nНайдено проблем: ${problems.length}. Запись невозможна.`); await prisma.$disconnect(); process.exitCode = 1; return; }
  if (!APPLY) { console.log("\nПробный прогон: БД не менялась. Для записи — --apply."); await prisma.$disconnect(); return; }

  // ----- Применение -----
  if (!NO_BACKUP) { console.log("\nКопия базы перед применением: scripts/backup.sh …"); execSync("sh scripts/backup.sh", { stdio: "inherit" }); }
  const journal: Journal = { script: SCRIPT, status: "applied", at: new Date().toISOString(), orders: [], usages: [], movements: [], lots: [], createdModels: [], createdColors: [] };
  await prisma.$transaction(async (tx) => {
    const modelIdByName = new Map<string, string>();
    for (const name of newModels) {
      const m = await tx.productModel.create({ data: { organizationId: orgId, name }, select: { id: true } });
      modelIdByName.set(name, m.id); journal.createdModels.push(m.id);
    }
    const colorIdByName = new Map<string, string>();
    for (const name of newColors) {
      const c = await tx.colorRef.create({ data: { organizationId: orgId, name, aliases: [], note: PROPOSED_MARK }, select: { id: true } });
      colorIdByName.set(name, c.id); journal.createdColors.push(c.id);
    }
    const lotBefore = new Map<string, string>();
    for (const p of plans) {
      // номер — по факту, как в приложении (максимум + 1 внутри транзакции)
      const { nextDocumentNumber } = await import("../src/lib/numbering");
      const number = await nextDocumentNumber(tx, "productionOrder", orgId, "П");
      const o = p.o;
      const extraNote = [o.note, o.extra].filter(Boolean).join(" ");
      const order = await tx.productionOrder.create({
        data: {
          organizationId: orgId, number, productModelId: p.modelId ?? modelIdByName.get(o.model)!, rawWarehouseId: warehouse.id, finishedWarehouseId: warehouse.id,
          status: p.uses.length ? "IN_PROGRESS" : "PLANNED", plannedQuantity: o.qty, producedQuantity: 0, color: capitalizeColor(o.color),
          colorRefId: p.colorId ?? colorIdByName.get(capitalizeColor(o.color))!, size: o.size, materialDescription: o.material, lining: o.lining,
          clientId: client.id, contractNumber: CONTRACT, workOrderNumber: String(p.tz.tz), workOrderDate: new Date(`${p.tz.date}T00:00:00.000Z`), clientWorkPricePerUnit: o.price,
          notes: `ТЗ №${p.tz.tz}: создано по документу «${p.tz.file}» (${SCRIPT}).${extraNote ? " " + extraNote : ""}`,
        },
        select: { id: true, number: true },
      });
      journal.orders.push({ id: order.id, number: order.number, tz: String(p.tz.tz), model: o.model });
      for (const u of p.uses) {
        if (!lotBefore.has(u.lot.id)) lotBefore.set(u.lot.id, (await tx.rawMaterialLot.findUniqueOrThrow({ where: { id: u.lot.id } })).quantityRemaining.toString());
        const mvBefore = await tx.stockMovement.findMany({ where: { productionOrderId: order.id, lotId: u.lot.id }, select: { id: true } });
        const r = await consumeFromLot(tx, { organizationId: orgId, lotId: u.lot.id, quantity: u.qty, productionOrderId: order.id });
        const mv = await tx.stockMovement.findMany({ where: { productionOrderId: order.id, lotId: u.lot.id, id: { notIn: mvBefore.map((m) => m.id) } }, select: { id: true } });
        mv.forEach((m) => journal.movements.push(m.id));
        const us = await tx.productionMaterialUsage.create({
          data: { productionOrderId: order.id, rawMaterialId: r.rawMaterialId, lotId: u.lot.id, quantity: u.qty, unitCost: r.unitCost, totalCost: r.totalCost, commission4: true },
          select: { id: true },
        });
        journal.usages.push(us.id);
      }
    }
    for (const [lotId, before] of lotBefore) {
      const lot = await tx.rawMaterialLot.findUniqueOrThrow({ where: { id: lotId } });
      if (lot.quantityRemaining.isNegative()) throw new Error(`Лот ${lot.lotNumber}: остаток ушёл ниже 0 — откат транзакции`);
      journal.lots.push({ lotId, lotNumber: lot.lotNumber, qty: new Decimal(before).sub(lot.quantityRemaining).toString(), remainingBefore: before, remainingAfter: lot.quantityRemaining.toString() });
    }
  }, { timeout: 180000, maxWait: 15000 });
  writeJson(JOURNAL, journal);
  console.log(`\nПрименено: ТЗ-заказов ${journal.orders.length}, списаний ${journal.usages.length}, движений склада ${journal.movements.length}. Журнал: ${JOURNAL}`);
  console.log("Номера: " + journal.orders.map((o) => `${o.number} (ТЗ ${o.tz})`).join(", "));
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
