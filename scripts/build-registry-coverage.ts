/**
 * Собирает компактный src/data/registry-coverage.json из docs-inventory/coverage-matrix.json
 * (результат сверки единого реестра xlsx с базой). Работает ТОЛЬКО с файлами, к базе не обращается.
 *
 * Запуск:  npx tsx scripts/build-registry-coverage.ts
 * Сводка «Покрытие реестра базой» (таблица ниже) переносится вручную из docs-inventory/registry-reconciliation.md.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

type Src = { file: string; sheet: string; rows?: number[] };
type Reg = { found: boolean; note?: string; sources?: Src[]; sheet?: string; workOrdersInRegistry?: number; workOrdersTotal?: number };

const REGISTRY_DATE = "2026-08-21"; // дата единого реестра (в названии файла «21-08»)

const COVERAGE = [
  { key: "lots", label: "Лоты", what: "лотов реестра («остатки») найдено в БД", have: "186 из 186", percent: 100 },
  { key: "balances", label: "Остатки на дату реестра", what: "остаток лота совпал; 18 объяснены расходом по ТЗ 152+", have: "168 из 186", percent: 90.3 },
  { key: "purchases", label: "Закупки", what: "строк реестров и отчётов найдено в БД (381)", have: "377 из 381", percent: 98.9 },
  { key: "tzNumbers", label: "ТЗ: номера", what: "ТЗ реестра 1–151 найдены", have: "151 из 151", percent: 100 },
  { key: "tzQty", label: "ТЗ: количество изделий", what: "совпало", have: "150 из 151", percent: 99.3 },
  { key: "tzWork", label: "ТЗ: сумма работы", what: "совпала (±1 ₽)", have: "145 из 151", percent: 96.0 },
  { key: "tzFur", label: "ТЗ: расход сырья (меха)", what: "совпал по лотам", have: "151 из 151", percent: 100 },
  { key: "tzLining", label: "ТЗ: подкладка", what: "совпала по метрам", have: "132 из 151", percent: 87.4 },
  { key: "payments", label: "Оплаты", what: "платёжных документов реестра найдено в БД (точно 88,9 %)", have: "18 из 18", percent: 100 },
];
const BACK = [
  { key: "backPurchases", label: "Закупки из базы подтверждены реестром", what: "по стоимости 98,8 %", have: "56 из 60", percent: 93.3 },
  { key: "backTz", label: "ТЗ из базы найдены в реестре", what: "162 из 168 с Drive-версией реестра (96,4 %)", have: "151 из 168", percent: 89.9 },
  { key: "backPayments", label: "Платежи из базы найдены в реестре", what: "остальные — после даты реестра (26 + 11 записей)", have: "18 из 37", percent: 48.6 },
];

const ranges = (rows?: number[] | null) => {
  const a = [...(rows ?? [])].sort((x, y) => x - y);
  const out: string[] = [];
  for (let i = 0; i < a.length; ) {
    let j = i;
    while (j + 1 < a.length && a[j + 1] === a[j] + 1) j++;
    out.push(j > i ? `${a[i]}–${a[j]}` : String(a[i]));
    i = j + 1;
  }
  return out.join(", ");
};

const entry = (r: Reg, tz?: string) => {
  const s = r.sources?.[0];
  const e: { found: boolean; sheet: string; rows: string; note: string; tz?: string } = {
    found: r.found,
    sheet: s?.sheet ?? r.sheet ?? "",
    rows: ranges(s?.rows),
    note: r.note ?? "",
  };
  if (s && /drive/i.test(s.file)) e.note = "Drive-версия реестра";
  if (tz) e.tz = tz;
  if (r.workOrdersTotal !== undefined) e.note = `ТЗ в реестре: ${r.workOrdersInRegistry} из ${r.workOrdersTotal}`;
  return e;
};

const src = JSON.parse(readFileSync(resolve("docs-inventory/coverage-matrix.json"), "utf8"));
const map = (o: Record<string, { registry: Reg }>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, entry(v.registry)]));

const out = {
  checkedAt: src.meta.generatedAt,
  registryDate: REGISTRY_DATE,
  coverage: COVERAGE,
  backCoverage: BACK,
  purchases: map(src.purchases),
  batches: map(src.batches),
  // ТЗ: ключ — номер заказа в базе (П-2026-NNNN); tz — номер ТЗ в реестре (одно ТЗ реестра может быть несколькими заказами)
  workOrders: Object.fromEntries(
    Object.entries(src.workOrders as Record<string, { orderNumbers: string[]; registry: Reg }>).flatMap(([tz, v]) =>
      v.orderNumbers.map((n) => [n, entry(v.registry, tz)])
    )
  ),
  registryOnly: src.registryOnly.map((r: { kind: string; title: string; qty?: number; amount?: number; registry: { sheet: string; rows?: number[] }; missing?: string[] }) => ({
    kind: r.kind,
    title: r.title,
    qty: r.qty ?? null,
    amount: r.amount ?? null,
    sheet: r.registry.sheet,
    rows: ranges(r.registry.rows),
    note: (r.missing ?? []).join("; "),
  })),
};
writeFileSync(resolve("src/data/registry-coverage.json"), JSON.stringify(out, null, 1) + "\n");
console.log("ok", Object.keys(out.purchases).length, Object.keys(out.workOrders).length);
