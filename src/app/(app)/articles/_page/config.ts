import { defineFilters, pick, stateParam } from "@/lib/filters";
import type { PickerColumn } from "@/components/column-picker";

// Фильтры «Изделий». Уровень модели: поиск, категория, цена. Уровень ТЗ (остальные): модель остаётся в списке, если у неё есть ТЗ,
// подходящее под ВСЕ выбранные условия; её ср. взвеш. себестоимость и число ТЗ считаются только по таким ТЗ.
// «Год ТЗ» (tzyear) — дополнительный фильтр внутри общего года из шапки (cookie), общий год не заменяет.
export const ARTICLE_FILTERS = defineFilters({
  ...pick(["q", "category", "catgroup", "model", "len", "fur", "color", "size", "season", "batch"], { q: { label: "Поиск" }, fur: { label: "Вид (тип) меха" }, batch: { label: "Партия" }, size: { label: "Размер изделия" }, model: { label: "Артикул" } }),
  lining: { kind: "multi", label: "Подкладка", allowed: ["yes", "no"] },
  tzyear: { kind: "multi", label: "Год ТЗ", pattern: /^\d{4}$/ },
  tz: { kind: "multi", label: "ТЗ", maxLen: 60 },
  price: { kind: "multi", label: "Цена", allowed: ["yes", "no"] },
  active: { kind: "multi", label: "Вкл / выкл", allowed: ["on", "off"] },
  param: { kind: "multi", label: "Параметры", maxLen: 90 },
  empty: stateParam("Состав списка", { allowed: ["1"] }),
  src: stateParam("Источник", { allowed: ["supplier"] }),
  grp: stateParam("Одежда / аксессуары", { allowed: ["clothes", "acc"] }),
});

/** Колонки таблицы «Изделия»: на виду главные (артикул, фото, категория, мех, выпуск, себестоимость, цена, наценка, ТЗ), остальные — в «Колонки ▾». */
export const ARTICLE_COLUMNS: PickerColumn[] = [
  { key: "name", label: "Артикул", fixed: true },
  { key: "active", label: "Вкл / выкл", on: true },
  { key: "photos", label: "Фото", on: true },
  { key: "plu", label: "PLU" },
  { key: "shop", label: "Ссылка на магазин" },
  { key: "category", label: "Категория / группа", on: true },
  { key: "fur", label: "Тип меха", on: true },
  { key: "color", label: "Цвет" },
  { key: "sizes", label: "Размеры" },
  { key: "lining", label: "Состав подкладки" },
  { key: "qty", label: "Заведено в ТЗ", on: true },
  { key: "stock", label: "На складе, шт.", on: true },
  { key: "furQty", label: "Шкур, шт." },
  { key: "furSum", label: "Шкуры, сумма" },
  { key: "liningQty", label: "Подкладка, м" },
  { key: "liningSum", label: "Подкладка, сумма" },
  { key: "work", label: "Работа" },
  { key: "total", label: "Полная себестоимость", on: true },
  { key: "unit", label: "Себестоимость за ед.", on: true },
  { key: "vat", label: "НДС" },
  { key: "price", label: "Розничная цена", on: true },
  { key: "markup", label: "Наценка к ТЗ", on: true },
  { key: "mu110", label: "MU (110)", on: true },
  { key: "orders", label: "ТЗ", on: true },
];
