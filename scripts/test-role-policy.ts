// Права ролей в одном месте (этап 7): списки ролей живут только в src/lib/access.ts (ACCESS, GROUP_TOPICS).
//   node node_modules/.bin/tsx scripts/test-role-policy.ts            — проверка
//   node node_modules/.bin/tsx scripts/test-role-policy.ts --update   — обновить эталон после осознанного изменения прав
// Проверяет: 1) в src нет литералов-списков ролей вне access.ts; 2) нет requireRole("A", "B", …) с перечислением;
// 3) каждый раздел ACCESS где-то используется; 4) таблица прав совпадает с эталоном scripts/fixtures/role-policy.json —
// любое изменение прав видно в коммите отдельной строкой эталона.
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, relative } from "node:path";
import { ACCESS, GROUP_TOPICS } from "../src/lib/access";

const ROOT = join(__dirname, "..");
const SRC = join(ROOT, "src");
const ACCESS_FILE = join(SRC, "lib", "access.ts");
const SNAP = join(ROOT, "scripts", "fixtures", "role-policy.json");
let fails = 0, checks = 0;
const ok = (what: string, cond: boolean, extra = "") => { checks++; if (!cond) { fails++; console.log(`FAIL ${what}${extra ? " " + extra : ""}`); } };

const files: string[] = [];
const walk = (d: string) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(n)) files.push(p); } };
walk(SRC);

const ROLE = "OWNER|ADMIN|PURCHASER|TECHNOLOGIST|ACCOUNTANT|WAREHOUSE|VIEWER|SUPPLIER";
const listLiteral = new RegExp(`\\[\\s*"(${ROLE})"\\s*,`);
const reqMany = new RegExp(`requireRole\\(\\s*"(${ROLE})"\\s*,`);
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1"); // комментарии не считаются

const lists: string[] = [], reqs: string[] = [];
let allSrc = "";
for (const f of files) {
  const text = strip(readFileSync(f, "utf8"));
  if (f !== ACCESS_FILE) allSrc += text + "\n";
  text.split("\n").forEach((line, i) => {
    const at = `${relative(ROOT, f)}:${i + 1}`;
    if (f !== ACCESS_FILE && listLiteral.test(line)) lists.push(at);
    if (reqMany.test(line)) reqs.push(at);
  });
}
ok("списки ролей только в src/lib/access.ts", lists.length === 0, lists.join(", "));
ok("requireRole без перечисления ролей (раздел ACCESS или одна роль)", reqs.length === 0, reqs.join(", "));

const unused = Object.keys(ACCESS).filter((k) => !new RegExp(`ACCESS\\.${k}\\b|ACCESS\\[["']${k}["']\\]`).test(allSrc));
ok("каждый раздел ACCESS используется", unused.length === 0, unused.join(", "));

const policy = {
  ACCESS: Object.fromEntries(Object.entries(ACCESS).map(([k, v]) => [k, [...v]])),
  GROUP_TOPICS: Object.fromEntries(Object.entries(GROUP_TOPICS).map(([k, v]) => [k, { roles: [...v.roles], supplier: v.supplier }])),
};
const json = JSON.stringify(policy, null, 2) + "\n";
if (process.argv.includes("--update") || !existsSync(SNAP)) {
  mkdirSync(join(ROOT, "scripts", "fixtures"), { recursive: true });
  writeFileSync(SNAP, json);
  console.log(`эталон прав записан: ${relative(ROOT, SNAP)}`);
} else {
  const want = readFileSync(SNAP, "utf8");
  const diff: string[] = [];
  const w = JSON.parse(want) as typeof policy;
  for (const sect of ["ACCESS", "GROUP_TOPICS"] as const) {
    const a = policy[sect] as Record<string, unknown>, b = w[sect] as Record<string, unknown>;
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) diff.push(`${sect}.${k}: было ${JSON.stringify(b[k])}, стало ${JSON.stringify(a[k])}`);
  }
  ok("права совпадают с эталоном scripts/fixtures/role-policy.json (осознанное изменение — запуск с --update)", diff.length === 0, "\n  " + diff.join("\n  "));
}

console.log(fails ? `\nПровалов: ${fails} из ${checks}` : `\nВсё в порядке (${checks} проверок, разделов ACCESS ${Object.keys(ACCESS).length}, тем чата ${Object.keys(GROUP_TOPICS).length}, файлов ${files.length})`);
process.exit(fails ? 1 : 0);
