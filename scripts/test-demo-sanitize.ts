// Демо-сборка не должна содержать реальных реквизитов, фамилий и названий компаний (стенд для внешних тестировщиков).
// Проверяет: (1) копия исходников после scripts/demo-static-data.mjs чиста от запрещённых строк; (2) функции генерации
// (счёт Excel, Word ТЗ четырёх образцов, расчёт Excel, реквизиты, каталог задач, пресеты, известные случаи) в обезличенной копии
// выдают вымышленный текст, а формулы Excel остаются теми же, что в боевой копии; (3) собранная демо-сборка (.next), если указана.
//   npx tsx scripts/test-demo-sanitize.ts [путь к собранной демо-сборке, например /tmp/wt-demo]
// Боевой режим не затрагивается: проверка идёт на временной копии.
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Запрещённые подстроки (реальные реквизиты, люди, компании, адреса). Список независим от каких-либо выгрузок. */
const FORBIDDEN = [
  "9729114877", "5032277847", "772901001", "997350001", "40702810638000184298", "40702810000010002483", "044525225", "30101810400000000225",
  "Сбербанк", "Сервис Резерв", "Меркури", "МЕРКУРИ", "Mercury Moda", "ВеллМех", "ВЕЛЛМЕХ", "ООО «Веллмех", "ООО \"Веллмех",
  "Барвих", "Barviha", "Солнцев", "Одинцов", "Вельмакин", "Павлов", "Коношенко", "Козлов", "Желнин", "Киржнер", "Федин", "Константинопольский",
  "Василий", "gmail", "petr", "1605 от", "№ 1605", "№1605", "№2502", "№ 2502", "2502 от", "+74956181807", "1l3sj71hz5gWEdTWiNgReifzovmfJBDhb",
  "102 227 020", "115_723_078", "60_831_100", "Анализ остатков сырья",
];

const root = process.cwd();
let bad = 0;
const ok = (name: string, cond: boolean, extra = "") => { if (!cond) bad++; console.log(`${cond ? "OK  " : "FAIL"} ${name}${extra ? ": " + extra : ""}`); };
const hits = (text: string) => FORBIDDEN.filter((w) => text.includes(w));

function walk(dir: string, out: string[] = [], re = /\.(ts|tsx|json|mjs|js|html|css|txt|map)$/): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) { if (n !== "node_modules") walk(p, out, re); } else if (re.test(n)) out.push(p);
  }
  return out;
}
function scanTree(dir: string, label: string) {
  const bySub = new Map<string, Set<string>>();
  for (const f of walk(dir)) {
    const h = hits(readFileSync(f, "utf8"));
    for (const w of h) { if (!bySub.has(w)) bySub.set(w, new Set()); bySub.get(w)!.add(f.slice(dir.length)); }
  }
  ok(`${label}: запрещённых подстрок нет`, bySub.size === 0);
  for (const [w, fs] of bySub) console.log(`   «${w}»: ${[...fs].slice(0, 4).join(", ")}${fs.size > 4 ? ` … (+${fs.size - 4})` : ""}`);
}
function gen(cwd: string): { texts: Record<string, string>; formulas: string[] } {
  const out = execFileSync("npx", ["tsx", "scripts/demo-sanitize-gen.ts"], { cwd, encoding: "utf8", maxBuffer: 1 << 28, env: { ...process.env, DEMO_BUILD: "true" } });
  return JSON.parse(out.slice(out.indexOf("@@JSON@@") + 8));
}

// 1. обезличенная копия исходников
const tmp = mkdtempSync(join(tmpdir(), "demo-sanitize-"));
try {
  for (const d of ["src", "scripts"]) cpSync(join(root, d), join(tmp, d), { recursive: true });
  for (const f of ["tsconfig.json", "package.json"]) cpSync(join(root, f), join(tmp, f));
  symlinkSync(join(root, "node_modules"), join(tmp, "node_modules"));
  execFileSync("node", ["scripts/demo-static-data.mjs", tmp], { cwd: root, stdio: "pipe" });
  scanTree(join(tmp, "src"), "исходники src/ после обезличивания");

  // 2. функции генерации: боевая копия -> реальные значения есть (проверка, что тест вообще что-то ловит), демо -> нет
  const real = gen(root);
  const demo = gen(tmp);
  ok("боевая копия содержит реальные реквизиты (проверка теста)", hits(Object.values(real.texts).join("\n")).length > 5);
  for (const [k, v] of Object.entries(demo.texts)) ok(`демо: ${k}`, hits(v).length === 0, hits(v).join(", "));
  ok("демо: реквизиты вымышленные", /Демо-Подрядчик/.test(demo.texts.requisites) && /Демо-Заказчик/.test(demo.texts.requisites));
  ok("демо: Word ТЗ с подписантами-заглушками", /Иванов И\. И\./.test(demo.texts["tz-docx-work"]) && /Демо-Заказчик/.test(demo.texts["tz-docx-work"]));
  ok("демо: каталог задач по долгу пуст", /"DOC_TASKS":\[\]/.test(demo.texts.catalog) && /"DECISIONS":\[\]/.test(demo.texts.catalog));
  ok("формулы Excel не изменились (счёт, расчёты)", demo.formulas.length > 20 && JSON.stringify(demo.formulas) === JSON.stringify(real.formulas), `${demo.formulas.length} формул`);
  const rp = readFileSync(join(tmp, "src/app/(app)/reconciliation/page.tsx"), "utf8");
  ok("страница сверки: без реальных названий", hits(rp).length === 0);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

// 2б. боевой режим не затронут: реальные реквизиты остаются в рабочей копии
ok("боевые исходники не тронуты", readFileSync(join(root, "src/lib/vendor-requisites.ts"), "utf8").includes("9729114877"));

// 3. собранная демо-сборка
const build = process.argv[2];
if (build && existsSync(join(build, ".next"))) {
  for (const sub of [".next/standalone", ".next/server"]) if (existsSync(join(build, sub))) scanTree(join(build, sub), `сборка ${build}/${sub}`);
} else console.log("(собранная демо-сборка не указана: пропуск; запуск: npx tsx scripts/test-demo-sanitize.ts /путь/к/сборке)");

console.log(bad ? `ПРОВАЛОВ: ${bad}` : "демо-обезличивание: проверки пройдены");
process.exit(bad ? 1 : 0);
