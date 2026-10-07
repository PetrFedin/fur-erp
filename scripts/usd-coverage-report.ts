// Покрытие ценой в USD по лотам меха: источники, аукционы, список «нет USD». Только чтение.
//   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/usd-coverage-report.ts > docs-inventory/usd-coverage.md
import "./stubs/server-only-shim";
import { PrismaClient } from "@prisma/client";
import { loadFurLots } from "../src/lib/fur-table-server";
import { figures, flowOf } from "../src/lib/fur-table";
import { lotUsdRef } from "../src/lib/lot-hammer";

const prisma = new PrismaClient();
const f1 = (v: number) => v.toLocaleString("ru-RU", { maximumFractionDigits: 1 });
const f2 = (v: number) => v.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

(async () => {
  const org = (await prisma.organization.findFirst())!.id;
  const lots = await loadFurLots(prisma, org, { kind: "fur", year: "all" });
  const tot = lots.reduce((s, l) => s + l.recv, 0);
  const withUsd = lots.filter((l) => l.usdPrice != null);
  const qUsd = withUsd.reduce((s, l) => s + l.recv, 0);
  const srcs = ["direct", "eur×rate", "rub÷rate", "calc", "none"] as const;
  const out: string[] = [];
  out.push("# Покрытие ценой в USD (мех)", "");
  out.push(`Лотов меха: ${lots.length}, шкур: ${f1(tot)}. Было (только строка «Цена за ед. (ам. долл.)»): 167 лотов, 9 526 шт. (52%).`);
  out.push(`Стало: ${withUsd.length} лотов, ${f1(qUsd)} шт. (${f1((qUsd / tot) * 100)}%).`, "");
  out.push("Правила (lotUsdPrice, src/lib/lot-hammer.ts): direct — строка в долларах в расчёте лота; eur×rate — цена в евро (расчёт Drive «Закупка ММ SAGA 03-26 (fin).xlsx», столбец «Закупка EURO») × «Валютный курс инвойса» (EUR→USD) из расчёта лота; rub÷rate — молоток в ₽ («НДС на шкуры» ÷ ставка НДС лота) ÷ «Курс ЦБ (фиксация)» из расчёта лота (расчёты Руспушнина/Союзпушнина считаются от цены в $); calc — цена в $ из расчёта Drive (src/data/lot-usd-sources.json), когда в лоте нет разбивки. Курс ЦБ на сегодня не используется.", "");
  out.push("## По источникам", "", "| Источник | Лотов | Шт. |", "|---|---:|---:|");
  for (const s of srcs) {
    const ls = lots.filter((l) => l.usdSource === s);
    out.push(`| ${s} | ${ls.length} | ${f1(ls.reduce((a, l) => a + l.recv, 0))} |`);
  }
  out.push("", "## По аукционам", "", "| Аукцион | Лотов | Шт. | С USD, шт. | % | direct | eur×rate | rub÷rate | calc | none, шт. |", "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
  const byA = new Map<string, typeof lots>();
  for (const l of lots) byA.set(l.auctionLabel, [...(byA.get(l.auctionLabel) ?? []), l]);
  for (const [a, ls] of [...byA].sort((x, y) => x[0].localeCompare(y[0], "ru"))) {
    const q = (s: string) => ls.filter((l) => l.usdSource === s).reduce((t, l) => t + l.recv, 0);
    const all = ls.reduce((t, l) => t + l.recv, 0);
    const u = all - q("none");
    out.push(`| ${a} | ${ls.length} | ${f1(all)} | ${f1(u)} | ${f1(all ? (u / all) * 100 : 0)} | ${f1(q("direct"))} | ${f1(q("eur×rate"))} | ${f1(q("rub÷rate"))} | ${f1(q("calc"))} | ${f1(q("none"))} |`);
  }
  out.push("", "## По видам меха", "", "| Вид | Шт. | С USD, шт. | % |", "|---|---:|---:|---:|");
  const byK = new Map<string, typeof lots>();
  for (const l of lots) byK.set(l.item, [...(byK.get(l.item) ?? []), l]);
  for (const [k, ls] of [...byK].sort((x, y) => x[0].localeCompare(y[0], "ru"))) {
    const all = ls.reduce((t, l) => t + l.recv, 0);
    const u = ls.filter((l) => l.usdPrice != null).reduce((t, l) => t + l.recv, 0);
    out.push(`| ${k} | ${f1(all)} | ${f1(u)} | ${f1(all ? (u / all) * 100 : 0)} |`);
  }
  const fig = figures(flowOf(lots), { vat: "incl", c4: "on" });
  // независимый пересчёт средневзвешенной $/шт: прямо по списку лотов
  const num = withUsd.reduce((s, l) => s + l.recv * (l.usdPrice as number), 0);
  out.push("", "## Средневзвешенная цена $/шт.", "", `Приложение (figures): ${f2(fig.usdAvg ?? 0)}; независимо Σ(шт×$)/Σшт по лотам: ${f2(num / qUsd)} (Σ$ = ${f2(num)}, Σшт = ${f1(qUsd)}).`);
  out.push("", "## Лоты без цены в USD", "", "| Закупка | Аукцион | Лот | Шт. | Причина |", "|---|---|---|---:|---|");
  for (const l of lots.filter((x) => x.usdSource === "none")) {
    const pn = l.purchaseNumber ?? "";
    const why = ["З-2026-0005", "З-2026-0006", "З-2026-0007"].includes(pn) ? "ферма (КФХ Дуденко): в расчёте лота только рубли, курса нет"
      : ["З-2026-0008", "З-2026-0009"].includes(pn) ? "«Белая норка»: цена только в рублях (счёт), расчёта с курсом нет"
      : ["З-2026-0010", "З-2026-0011", "З-2026-0012", "З-2026-0013"].includes(pn) ? "сырьё подрядчика (партии 5–9): цена только в рублях, расчёта нет"
      : ["З-2026-0001", "З-2026-0059"].includes(pn) ? "красная лиса по УПД подрядчика: цена только в рублях, расчёта нет"
      : "нет цены в валюте и курса в документах";
    out.push(`| ${l.purchaseNumber ?? "—"} | ${l.auctionLabel} | ${l.lotNumber} | ${f1(l.recv)} | ${why} |`);
  }
  out.push("", "## Использованные записи расчётов Drive (src/data/lot-usd-sources.json)", "", "| Закупка | Лот | Валюта | Цена | USD в приложении | Источник |", "|---|---|---|---:|---:|---|");
  for (const l of lots.filter((x) => x.usdSource === "eur×rate" || x.usdSource === "calc")) {
    const r = lotUsdRef(l.purchaseNumber, l.lotNumber);
    out.push(`| ${l.purchaseNumber} | ${l.lotNumber} | ${r?.currency} | ${r?.price} | ${l.usdPrice} | ${r?.source} |`);
  }
  out.push("", "## Ручная сверка пяти лотов из разных аукционов", "", "| Аукцион | Закупка / лот | Расчёт вручную | Ожидается $ | В приложении $ | Совпало |", "|---|---|---|---:|---:|---|");
  const manual: [string, string, string, string, number][] = [
    ["SAGA 03.26 (евро)", "З-2026-0037", "400440", "65 EUR (Drive, «Закупка EURO») × 1,153 (курс инвойса EUR→USD из лота) = 74,945", 74.945],
    ["РП 04.26 (₽÷курс)", "З-2026-0042", "18", "НДС на шкуры 5 579,30956 ÷ 22% ÷ курс 74,5897 = 340,00 (в расчёте Drive «Закупка» 340 $)", 340],
    ["СП 05.26 (₽÷курс)", "З-2026-0047", "39", "НДС на шкуры 5 175,84276 ÷ 22% ÷ курс 71,2926 = 330,00 (в расчёте Drive «Закупка $» 330)", 330],
    ["AME 05.26 (расчёт Drive)", "З-2026-0058", "204742", "«Закупка» 72 $ в «расчет себестоимости fin.xlsx»", 72],
    ["РП 03.25 (расчёт Drive)", "З-2026-0018", "1498-2", "«Закупка» 88 $ в «Русьпушнина для УПД.xlsx», курс 88,2568", 88],
  ];
  for (const [a, pn, ln, how, want] of manual) {
    const l = lots.find((x) => x.purchaseNumber === pn && x.lotNumber === ln);
    out.push(`| ${a} | ${pn} / ${ln} | ${how} | ${want} | ${l?.usdPrice ?? "—"} | ${l && l.usdPrice != null && Math.abs(l.usdPrice - want) < 0.001 ? "да" : "НЕТ"} |`);
  }
  console.log(out.join("\n"));
  await prisma.$disconnect();
})();
