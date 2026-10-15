// Обезличивание исходников ДЛЯ ДЕМО-СБОРКИ (стенд для внешних тестировщиков). Реальные реквизиты, фамилии, названия компаний,
// тексты из переписки, Word-шаблоны ТЗ и примеры расчётов заменяются вымышленными. Меняет файлы в указанной папке (по умолчанию
// текущая): запускайте только в рабочей копии демо-сборки (Dockerfile при DEMO_BUILD=true; вручную: в отдельном worktree).
// Этот файл содержит реальные строки (это таблица подмен) и в образ не попадает: в runner копируется только .next/standalone.
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import JSZip from "jszip";

/** Точные подмены (применяются по порядку, длинные раньше коротких). */
export const STRING_MAP = [
  // идентификаторы и банковские реквизиты
  ["9729114877", "7701000000"], // ИНН поставщика -> тот же, что у «Веллмех-демо» в демо-базе (make-demo-db.ts)
  ["5032277847", "7702000002"],
  ["772901001", "770101001"],
  ["997350001", "770201001"],
  ["40702810638000184298", "40702810000000000001"],
  ["40702810000010002483", "40702810000000000002"],
  ["30101810400000000225", "30101810000000000000"],
  ["044525225", "044525000"],
  ["ПАО Сбербанк г. Москва", "Демо-Банк"],
  ["банк «Сервис Резерв»", "банк «Демо-Банк»"],
  ["«Сервис Резерв»", "«Демо-Банк»"],
  ["Сервис Резерв", "Демо-Банк"],
  // договоры
  ["№ 1605 от 16 мая 2025 г.", "№ 7001 от 1 января 2025 г."],
  ["№ 1605 от 16.05.2025 г.", "№ 7001 от 01.01.2025 г."],
  ["№ 1605 от 16.05.2025", "№ 7001 от 01.01.2025"],
  ["№1605", "№7001"],
  ["16 мая 2025", "1 января 2025"],
  ["16.05.2025", "01.01.2025"],
  ["1605", "7001"],
  // фамилии, должности
  ["Вельмакина И. Е.", "Петров П. П."],
  ["Вельмакина И.Е.", "Петров П.П."],
  ["Вельмакиной", "Петрова"],
  ["Вельмакина", "Петров"],
  ["Павлов А. М.", "Иванов И. И."],
  ["Павлов А.М.", "Иванов И.И."],
  ["Коношенко", "представителя заказчика"],
  ["Василий", "Иван"],
  ["26.02.2025", "01.01.2025"],
  ["2502", "7002"],
  ["Василий Константинопольский", "Демо"],
  ["Коптево Приемный склад Оптика", "Демо Приёмный склад"],
  // внешние ссылки на реальные файлы
  ["https://docs.google.com/spreadsheets/d/1l3sj71hz5gWEdTWiNgReifzovmfJBDhb/edit", "#"],
  ["Анализ остатков сырья.xlsx", "Контрольный файл (демо)"],
  ["Если разом выгрузить выписку р/с за 30.03.2026 — 20.07.2026, она закроет шесть оплат на 102 227 020,54 ₽ (отмечены ниже), а выписка за сентябрь 2025 — июль 2026 — большую часть остальных.", "Если разом выгрузить выписку р/с за нужный период, она закроет несколько оплат сразу (отмечены ниже)."],
];

/** Подмены по шаблону. */
export const REGEX_MAP = [
  [/ООО\s*[«"“]\s*МЕРКУРИ\s+МОДА\s*[»"”]/gi, "ООО «Демо-Заказчик»"],
  [/Меркури\s+Мода/gi, "Демо-Заказчик"],
  [/МЕРКУРИ/g, "ДЕМО-ЗАКАЗЧИК"],
  [/Меркури/g, "Демо-Заказчик"],
  [/ООО\s*[«"“]\s*Велл?\s?Мех\s*[»"”]/gi, "ООО «Демо-Подрядчик»"],
  [/ВЕЛЛМЕХ\s+ООО/g, "ДЕМО-ПОДРЯДЧИК ООО"],
  [/ВЕЛЛМЕХ/g, "ДЕМО-ПОДРЯДЧИК"],
  [/ВеллМех/g, "Демо-Подрядчик"],
  [/Барвих[а-я]*/g, "Демо"],
  [/Солнцев[а-я]*/g, "Демо"],
  [/[A-Za-z0-9._%+-]+@gmail\.com/gi, "user@demo.invalid"],
];

/** Вырезаемые блоки: [файл, начало (строка), конец (строка), чем заменить]. Содержимое — реальные задачи и суммы долга. */
const CUTS = [
  ["src/lib/supplier-debt.ts", "export const INVOICES_FOR_DRAFTS: DraftInvoice[] = [", "];", "export const INVOICES_FOR_DRAFTS: DraftInvoice[] = [];\n"],
  ["src/lib/task-docs-catalog.ts", "const nums = (a: number, b: number)", "];", "export const DOC_TASKS: DocTask[] = [];\n"],
  ["src/lib/task-docs-catalog.ts", "export const DECISIONS: Decision[] = [", "];", "export const DECISIONS: Decision[] = [];\n"],
];

/** Точечные правила по файлам: жёстко прописанные «известные случаи» с реальными суммами, номерами документов и выводами. */
const GENERIC_NOTE = "Известный случай (демо): подробности скрыты.";
export const FILE_RULES = {
  "src/app/(app)/verify/duplicates.ts": [[/text: "[^"\n]*"/g, 'text: "одна поставка на две закупки (проверено)"']],
  "src/lib/overpay-notes.ts": [[/text: "[^"\n]*"/g, 'text: "Переплата аукциона зачтена в другом аукционе (демо)."']],
  "src/lib/integrity/known.ts": [[/(reason|decision):\s*"(?:[^"\\\n]|\\.)*"/g, `$1: "${GENERIC_NOTE}"`]],
  "src/app/(app)/dashboard/dynamics-tables.tsx": [[/const LINING_NOTE = "[^"\n]*";/, 'const LINING_NOTE = "Расхождение со счётом (демо).";']],
  "src/app/(app)/documents/analysis-section.tsx": [[/conclusion:\s*"(?:[^"\\\n]|\\.)*"/g, 'conclusion: "Вывод по группе (демо)."']],
  "src/app/(app)/payments/page.tsx": [[/ и З-2026-0059 \(красная лиса, счёт №209\)/, ""]],
  "src/lib/contractor-hides.ts": [[/ \* {2}• п\/п[^\n]*\n/g, ""], [/amount: 25040/, "amount: 2504"]],
};

const WELLMEKH_REQ_DEMO = `export const WELLMEKH_REQ: VendorReq = {
  inn: "7701000000",
  seller: { name: "ООО «Демо-Подрядчик»", inn: "7701000000", kpp: "770101001", address: "г. Город, ул. Демо, 1", phone: "+70000000000" },
  buyer: { name: "ООО «Демо-Заказчик»", inn: "7702000002", kpp: "770201001", address: "г. Город, ул. Демо, 2" },
  bank: { name: "Демо-Банк", bik: "044525000", corrAccount: "30101810000000000000", account: "40702810000000000001" },
  signer: "Петров П. П.",
  contract: { title: "Договор купли продажи", number: "7002", date: "01.01.2025" },
};`;

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const unesc = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

export function sanitizeText(s) {
  for (const [a, b] of STRING_MAP) s = s.split(a).join(b);
  for (const [re, b] of REGEX_MAP) s = s.replace(re, b);
  return s;
}

const scramble = (m) => m.replace(/\d/g, (d) => String((Number(d) * 7 + 3) % 10));

/** Текст абзаца Word-шаблона ТЗ: образец содержит настоящие позиции, лоты, цены, даты и подписантов. */
export function sanitizeTemplateText(t) {
  let s = sanitizeText(t);
  s = s.replace(/\d{2}\.\d{2}\.\d{4}/g, "01.01.2026");
  s = s.replace(/№ ?(182|171|116|178)\b/g, "№ 1");
  s = s.replace(/(?<![\p{L}\d])(?:МН|MMF|РП)\d[\d.]*|(?<![\p{L}\d])М0\d+(?![\p{L}\d])/gu, "М01");
  s = s.replace(/\d[\d ]*,\d\d/g, scramble); // цены
  s = s.replace(/\d{4,}/g, scramble); // лоты, суммы, длинные номера
  return s;
}

async function sanitizeDocx(b64) {
  const zip = await JSZip.loadAsync(Buffer.from(b64, "base64"));
  for (const f of Object.keys(zip.files)) {
    if (!/^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(f)) continue;
    let xml = await zip.file(f).async("string");
    xml = xml.replace(/<w:p[ >][\s\S]*?<\/w:p>/g, (p) => {
      const ts = [...p.matchAll(/<w:t(?: [^>]*)?>([\s\S]*?)<\/w:t>/g)];
      if (!ts.length) return p;
      const orig = unesc(ts.map((m) => m[1]).join(""));
      const next = sanitizeTemplateText(orig);
      if (next === orig) return p;
      let i = 0;
      return p.replace(/<w:t(?: [^>]*)?>[\s\S]*?<\/w:t>/g, () => (i++ === 0 ? `<w:t xml:space="preserve">${esc(next)}</w:t>` : `<w:t></w:t>`));
    });
    zip.file(f, xml);
  }
  const core = zip.file("docProps/core.xml");
  if (core) {
    let c = await core.async("string");
    c = c.replace(/<dc:creator>[\s\S]*?<\/dc:creator>/, "<dc:creator>Демо</dc:creator>").replace(/<cp:lastModifiedBy>[\s\S]*?<\/cp:lastModifiedBy>/, "<cp:lastModifiedBy>Демо</cp:lastModifiedBy>");
    zip.file("docProps/core.xml", c);
  }
  const app = zip.file("docProps/app.xml");
  if (app) zip.file("docProps/app.xml", (await app.async("string")).replace(/<(Company|Manager)>[\s\S]*?<\/\1>/g, ""));
  return (await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" })).toString("base64");
}

async function sanitizeTemplateData(path) {
  let src = readFileSync(path, "utf8");
  const re = /const (\w+_B64) =\s*((?:\s*(?:\+\s*)?"[A-Za-z0-9+/=]*"\s*)+);/g;
  const parts = [...src.matchAll(re)];
  for (const m of parts) {
    const b64 = [...m[2].matchAll(/"([^"]*)"/g)].map((x) => x[1]).join("");
    const out = await sanitizeDocx(b64);
    const chunks = out.match(/.{1,120}/g) ?? [];
    src = src.replace(m[0], `const ${m[1]} =\n  ${chunks.map((c) => `"${c}"`).join("\n  + ")};`);
  }
  writeFileSync(path, src);
  return parts.length;
}

function sanitizePresets(path) {
  const d = JSON.parse(readFileSync(path, "utf8"));
  for (const p of d) {
    if (p.exampleFile) p.exampleFile = "Пример расчёта (демо)";
    p.check = [];
    for (const prm of p.params ?? []) prm.hint = prm.default ? String(prm.default) : "";
  }
  writeFileSync(path, JSON.stringify(d, null, 2) + "\n");
}

function cutBlock(src, startMark, endMark, replacement) {
  const lines = src.split("\n");
  const a = lines.findIndex((l) => l.startsWith(startMark));
  if (a < 0) return src;
  let b = a;
  while (b < lines.length && lines[b] !== endMark) b++;
  return [...lines.slice(0, a), ...replacement.replace(/\n$/, "").split("\n"), ...lines.slice(b + 1)].join("\n");
}

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|json|mjs)$/.test(n)) out.push(p);
  }
  return out;
}

export async function sanitizeSources(root = ".", log = console.log) {
  const abs = (p) => join(root, p);
  // 1. крупные блоки реальных данных
  for (const file of new Set(CUTS.map((c) => c[0]))) {
    let text = readFileSync(abs(file), "utf8");
    for (const [f, a, b, r] of CUTS) if (f === file) text = cutBlock(text, a, b, r);
    writeFileSync(abs(file), text);
  }
  // 2. реквизиты сторон: целиком вымышленные
  const rq = abs("src/lib/vendor-requisites.ts");
  writeFileSync(rq, readFileSync(rq, "utf8").replace(/export const WELLMEKH_REQ: VendorReq = \{[\s\S]*?\n\};/, WELLMEKH_REQ_DEMO));
  // 3. Word-шаблоны и пресеты расчётов
  log(`Word-шаблонов обезличено: ${await sanitizeTemplateData(abs("src/lib/tz-template-data.ts"))}`);
  sanitizePresets(abs("src/lib/calc-presets.json"));
  // 4. остальной текст: подмены по таблице
  let changed = 0;
  for (const f of walk(abs("src"))) {
    if (f.endsWith("src/lib/demo-mode.ts") || f.includes("tz-template-data.ts")) continue;
    const a = readFileSync(f, "utf8");
    let b = sanitizeText(a);
    for (const [re, to] of FILE_RULES[relative(root, f)] ?? []) b = b.replace(re, to);
    if (a !== b) { writeFileSync(f, b); changed++; }
  }
  log(`файлов с подменой текста: ${changed}`);
}
