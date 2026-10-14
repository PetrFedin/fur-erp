import Link from "next/link";
import { requireSession } from "@/lib/session";

export const metadata = { title: "Схема работы" };

type Branch = { title: string; text: string; href: string };
type Step = {
  title: string;
  /** Раздел меню, куда ведёт кнопка. */
  href: string;
  open: string;
  /** Что вносят руками. */
  enter: string[];
  /** Что получаем в итоге (и куда это идёт дальше). */
  get: string[];
  /** Откуда берутся данные — предыдущие шаги. */
  from?: string;
  branches: Branch[];
};

const STEPS: Step[] = [
  {
    title: "Аукционы, поставщики и сырьё",
    href: "/purchases",
    open: "Сырьё → Закупки",
    enter: ["Аукцион (SAGA, FH, СП, РП…) и поставщика", "Закупку: счёт, инвойс, УПД, цены по лотам, мех и подкладку", "Кнопка «Принять на склад»"],
    get: ["Лоты на складе: номер, вид меха, цвет, размер, цена, остаток", "«Куплено» и «Остаток» сырья на Главной", "Долг по закупке — в Оплаты"],
    branches: [
      { title: "Справочники", text: "Виды меха, цвета, категории, признаки — выбираются при заведении лота.", href: "/settings" },
      { title: "Аукционы", text: "Справочник аукционов и сессий: к ним привязываются закупки.", href: "/settings/auctions" },
      { title: "Мех и подкладка", text: "Остатки по лотам, паспорт лота, документы к лоту.", href: "/lots" },
    ],
  },
  {
    title: "Справочник артикулов",
    href: "/settings/articles-ref",
    open: "Настройки → Артикулы",
    enter: ["Артикул, название, категория, длина (короткий / обычный / длинный)", "Написания артикула из ТЗ и системы продаж"],
    get: ["Единый список изделий: из него выбирают артикул в ТЗ, бюджете и отгрузках", "Группы «Одежда» и «Аксессуары» для итогов"],
    from: "Справочники из шага 1",
    branches: [
      { title: "Бюджет", text: "План закупок по артикулам и длине; факт подтягивается из ТЗ.", href: "/budget" },
      { title: "Изделия", text: "Артикулы с ценами, наценкой и остатками готовой продукции.", href: "/articles" },
    ],
  },
  {
    title: "ТЗ (техническое задание на пошив)",
    href: "/production",
    open: "ТЗ",
    enter: ["Артикул — из справочника, либо новый", "Цвет, размер, количество изделий", "Мех и подкладку — списание из лотов склада", "Расходы ТЗ и цену работы"],
    get: ["Себестоимость ТЗ: мех, подкладка, надбавка 4%, расходы", "Остаток сырья уменьшается, «Использовано» растёт", "Работа по ТЗ — основа оплаты производству"],
    from: "Лоты (шаг 1) и справочник артикулов (шаг 2)",
    branches: [
      { title: "Примерки", text: "Что смотрели на примерке по ТЗ.", href: "/fittings" },
      { title: "План", text: "Что и когда запускать в производство.", href: "/plan" },
      { title: "Партии пошива", text: "ТЗ сгруппированы в партии поставки.", href: "/production" },
    ],
  },
  {
    title: "Оплаты",
    href: "/payments",
    open: "Оплаты",
    enter: ["Оплаты поставщикам за аукционы и закупки", "Оплаты производству (Веллмех) по ТЗ и счетам", "Платёжное поручение, дата, сумма, на что"],
    get: ["«Оплачено» и «Задолженность» по сырью и по ТЗ", "Список «К оплате»", "Подтверждение платежей документами"],
    from: "Закупки (шаг 1) и ТЗ (шаг 3)",
    branches: [
      { title: "Подтвердить", text: "Платежи и строки, где сумма или документ ждут подтверждения.", href: "/verify" },
      { title: "Документы", text: "УПД, счета, платёжные поручения и письма по закупкам и ТЗ.", href: "/documents" },
    ],
  },
  {
    title: "Изделия и готовая продукция",
    href: "/articles",
    open: "Изделия",
    enter: ["Выпуск по ТЗ: сколько произведено", "Цена продажи (розница) и наценка"],
    get: ["Склад готовой продукции и её себестоимость", "Наценка и цена по артикулу"],
    from: "ТЗ (шаг 3)",
    branches: [
      { title: "Склад ГП", text: "Остатки готовых изделий и движения.", href: "/finished-stock" },
      { title: "Ремонт", text: "Ремонтные работы и использованное сырьё.", href: "/repair" },
    ],
  },
  {
    title: "Отгрузки",
    href: "/shipments",
    open: "Отгрузки",
    enter: ["Новая отгрузка: поставщик, партия, дата примерки", "Примерка: артикулы из ТЗ (или свои), «Принято / На доработку»", "Этапы: сторона (Веллмех / ЦУМ), кто, дата и время, заголовок, документы", "Приёмка в Коптево: «Принято / Не принято» по строкам"],
    get: ["Хронология этапов по дням и сроки между ними", "Итог поставки: сколько отгрузили, приняли, вернули", "Список «готов к отгрузке» из принятого на примерке"],
    from: "Артикулы и ТЗ (шаги 2–3)",
    branches: [
      { title: "Примерка", text: "Список артикулов на просмотр: принято идёт в отгрузку, остальное на доработку.", href: "/shipments" },
      { title: "Приёмка в Коптево", text: "Согласованный список, добавление артикулов, отметки по строкам и «Закрыть приёмку».", href: "/shipments" },
    ],
  },
  {
    title: "Итоги и контроль",
    href: "/dashboard",
    open: "Главная",
    enter: ["Ничего не вносится — всё считается из шагов выше"],
    get: ["Главная: сырьё, производство, оплаты, динамика по годам", "Календарь: события и сроки", "Контроль: задачи, сверка, расхождения, история"],
    from: "Все шаги выше",
    branches: [
      { title: "Календарь", text: "Что запланировано и что уже было.", href: "/calendar" },
      { title: "Контроль", text: "Задачи, документы, сверка и история изменений.", href: "/attention" },
      { title: "Сверка", text: "Проверка: данные сходятся с документами и с Excel.", href: "/reconciliation" },
    ],
  },
];

export default async function SchemePage() {
  await requireSession();
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Схема работы</h1>
        <Link href="/dashboard" className="rounded-md border border-neutral-300 bg-white px-3 py-1 text-xs text-neutral-700 hover:bg-neutral-50">← Главная</Link>
      </div>
      <p className="max-w-3xl text-sm text-neutral-600">
        Как данные идут по системе: сверху вниз. Что заводим сначала, откуда берётся следующий шаг, что вносят руками и что получаем. Кнопка в каждом блоке открывает раздел.
      </p>

      <ol className="relative flex flex-col gap-0" data-scheme>
        {STEPS.map((s, i) => (
          <li key={s.title} className="relative pl-12 sm:pl-14" data-step={i + 1}>
            {/* ствол дерева */}
            <span aria-hidden className={"absolute left-[1.1rem] top-0 w-px bg-neutral-300 sm:left-[1.4rem] " + (i === STEPS.length - 1 ? "h-8" : "h-full")} />
            <span aria-hidden className="absolute left-0 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-neutral-900 text-sm font-semibold text-white sm:left-[0.3rem]">{i + 1}</span>

            <div className="mb-1 mt-3 rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-neutral-900">{s.title}</h2>
                  {s.from && <p className="mt-0.5 text-xs text-neutral-500">Берёт данные: {s.from}</p>}
                </div>
                <Link href={s.href} className="inline-flex h-9 shrink-0 items-center rounded-md bg-neutral-900 px-3 text-sm font-medium text-white hover:bg-neutral-700 max-md:min-h-10">{s.open} →</Link>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="rounded-md bg-amber-50/60 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-800">Вносят</p>
                  <ul className="mt-1 flex flex-col gap-1 text-sm text-neutral-800">{s.enter.map((x) => <li key={x} className="flex gap-1.5"><span aria-hidden className="text-amber-700">›</span>{x}</li>)}</ul>
                </div>
                <div className="rounded-md bg-emerald-50/60 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-800">Получаем</p>
                  <ul className="mt-1 flex flex-col gap-1 text-sm text-neutral-800">{s.get.map((x) => <li key={x} className="flex gap-1.5"><span aria-hidden className="text-emerald-700">›</span>{x}</li>)}</ul>
                </div>
              </div>

              {/* ветви */}
              <div className="mt-3 border-t border-dashed border-neutral-200 pt-3">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Ветви</p>
                <ul className="relative ml-2 flex flex-col gap-2 border-l border-neutral-300 pl-4 sm:ml-3">
                  {s.branches.map((b) => (
                    <li key={b.title} className="relative flex flex-wrap items-center justify-between gap-2 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2">
                      <span aria-hidden className="absolute -left-4 top-1/2 h-px w-4 bg-neutral-300" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-neutral-900">{b.title}</p>
                        <p className="text-xs text-neutral-600">{b.text}</p>
                      </div>
                      <Link href={b.href} className="inline-flex h-8 shrink-0 items-center rounded-md border border-neutral-300 bg-white px-2.5 text-xs text-neutral-700 hover:bg-neutral-100 max-md:min-h-10">Открыть →</Link>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            {i < STEPS.length - 1 && <div aria-hidden className="h-3" />}
          </li>
        ))}
      </ol>
    </div>
  );
}
