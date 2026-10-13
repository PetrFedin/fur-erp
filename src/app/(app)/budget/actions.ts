"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireRole, requireSession } from "@/lib/session";
import { loadBudgetStats } from "@/lib/budget-stats";
import { DEFAULT_PARAMS, autoCalc, computeTree, grandTotal, nowPerUnit, perUnit, varPct, parseNodes, templateNodes, type BudgetNode, type BudgetParams, type BudgetStat, type NodeSrc } from "@/lib/budget-calc";

const EDIT = ["OWNER", "ADMIN", "TECHNOLOGIST"] as const;
type Res<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const n = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? Math.min(Math.max(v, -1e12), 1e12) : d);
const s = (v: unknown, max = 80) => String(v ?? "").trim().slice(0, max);

function cleanParams(p: Partial<BudgetParams> | null | undefined): BudgetParams {
  return { upFur: n(p?.upFur, DEFAULT_PARAMS.upFur), upLining: n(p?.upLining, DEFAULT_PARAMS.upLining), upWork: n(p?.upWork, DEFAULT_PARAMS.upWork), c4: n(p?.c4, DEFAULT_PARAMS.c4) };
}

/** Переопределение надбавки: число в разумных границах или null (наследуется). */
const upv = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.min(Math.max(v, -100), 1000) : null);

const SRC: NodeSrc[] = ["art", "len", "pair", "none", "manual"];

/** Проверка дерева: допустимые виды и родители (тип сырья → категория → [длина] → артикул), уникальные id, числа в границах. */
function cleanNodes(input: unknown): BudgetNode[] | null {
  if (!Array.isArray(input) || input.length > 800) return null;
  const out: BudgetNode[] = [];
  const kindById = new Map<string, string>();
  for (const raw of input as Partial<BudgetNode>[]) {
    const kind = raw.kind === "fur" || raw.kind === "cat" || raw.kind === "len" || raw.kind === "art" ? raw.kind : null;
    const id = s(raw.id, 40);
    if (!kind || !id || kindById.has(id)) continue;
    const parentId = raw.parentId ? s(raw.parentId, 40) : null;
    const parentKind = kindById.get(parentId ?? "");
    if (kind === "fur" ? parentId !== null : kind === "cat" ? parentKind !== "fur" : kind === "len" ? parentKind !== "cat" : parentKind !== "cat" && parentKind !== "len") continue;
    kindById.set(id, kind);
    const b = raw.base;
    out.push({
      id, kind, parentId, name: s(raw.name, 120), modelId: raw.modelId ? s(raw.modelId, 40) : null,
      pcs: Math.max(0, n(raw.pcs)), locked: !!raw.locked,
      hides: Math.max(0, n(raw.hides)), hidePrice: Math.max(0, n(raw.hidePrice)), meters: Math.max(0, n(raw.meters)), meterPrice: Math.max(0, n(raw.meterPrice)), work: Math.max(0, n(raw.work)),
      statFur: s(raw.statFur), statCat: s(raw.statCat),
      base: b ? { hides: n(b.hides), hidePrice: n(b.hidePrice), meters: n(b.meters), meterPrice: n(b.meterPrice), work: n(b.work) } : null,
      upFur: upv(raw.upFur), upLining: upv(raw.upLining), upWork: upv(raw.upWork),
      sample: Math.max(0, n(raw.sample)), src: SRC.includes(raw.src as NodeSrc) ? (raw.src as NodeSrc) : "none",
    });
  }
  return out;
}

/** Свежая статистика системы для кнопки «Автоматический расчёт». */
export async function refreshBudgetStats(): Promise<BudgetStat[]> {
  const session = await requireSession();
  return loadBudgetStats(session.user.organizationId);
}

/** Сохранение версии (параметры и дерево одним документом). Утверждённую версию не меняет. */
export async function saveBudget(id: string, params: BudgetParams, nodes: BudgetNode[], comment?: string): Promise<Res<{ at: string }>> {
  const session = await requireRole(...EDIT);
  const clean = cleanNodes(nodes);
  if (!clean) return { ok: false, error: "Слишком много строк или неверный формат" };
  const row = await prisma.budgetScenario.findFirst({ where: { id: s(id, 40), organizationId: session.user.organizationId }, select: { id: true, status: true } });
  if (!row) return { ok: false, error: "Бюджет не найден" };
  if (row.status === "APPROVED") return { ok: false, error: "Версия утверждена: верните её в черновик, чтобы менять" };
  const saved = await prisma.budgetScenario.update({
    where: { id: row.id },
    data: { params: cleanParams(params), lines: clean as object[], ...(comment === undefined ? {} : { comment: s(comment, 500) || null }), updatedBy: session.user.name ?? null },
  });
  return { ok: true, at: saved.updatedAt.toISOString() };
}

/** Новый бюджет: пустой, копия существующего или по Budget PCS FW27 (строки с готовым автоматическим расчётом). */
export async function createBudget(input: { name: string; season: string; template: "empty" | "copy" | "fw27"; copyFromId?: string }): Promise<Res<{ id: string }>> {
  const session = await requireRole(...EDIT);
  const orgId = session.user.organizationId;
  const name = s(input?.name, 80);
  const season = s(input?.season, 20) || "FW27";
  if (!name) return { ok: false, error: "Введите название бюджета" };
  let params = DEFAULT_PARAMS;
  let nodes: BudgetNode[] = [];
  let parentId: string | null = null;
  let comment: string | null = null;
  if (input.template === "copy") {
    const src = await prisma.budgetScenario.findFirst({ where: { id: s(input.copyFromId, 40), organizationId: orgId } });
    if (!src) return { ok: false, error: "Бюджет для копирования не найден" };
    params = cleanParams(src.params as Partial<BudgetParams>);
    nodes = parseNodes(src.lines);
    parentId = src.id;
    comment = src.comment;
  } else if (input.template === "fw27") {
    nodes = autoCalc(templateNodes(), await loadBudgetStats(orgId), params);
  }
  const row = await prisma.budgetScenario.create({
    data: { organizationId: orgId, season, name, status: "DRAFT", comment, parentId, params, lines: (cleanNodes(nodes) ?? []) as object[], createdBy: session.user.name ?? null, updatedBy: session.user.name ?? null },
  });
  revalidatePath("/budget");
  return { ok: true, id: row.id };
}

export async function duplicateBudget(id: string): Promise<Res<{ id: string }>> {
  const session = await requireRole(...EDIT);
  const src = await prisma.budgetScenario.findFirst({ where: { id: s(id, 40), organizationId: session.user.organizationId } });
  if (!src) return { ok: false, error: "Бюджет не найден" };
  const row = await prisma.budgetScenario.create({
    data: {
      organizationId: src.organizationId, season: src.season, name: `${src.name} (копия)`.slice(0, 80), status: "DRAFT", comment: src.comment, parentId: src.id,
      params: src.params as object, lines: (cleanNodes(parseNodes(src.lines)) ?? []) as object[], createdBy: session.user.name ?? null, updatedBy: session.user.name ?? null,
    },
  });
  revalidatePath("/budget");
  return { ok: true, id: row.id };
}

export async function renameBudget(id: string, name: string, season: string): Promise<Res> {
  const session = await requireRole(...EDIT);
  const nm = s(name, 80);
  if (!nm) return { ok: false, error: "Введите название" };
  const r = await prisma.budgetScenario.updateMany({ where: { id: s(id, 40), organizationId: session.user.organizationId }, data: { name: nm, season: s(season, 20) || "FW27", updatedBy: session.user.name ?? null } });
  revalidatePath("/budget");
  revalidatePath(`/budget/${s(id, 40)}`);
  return r.count ? { ok: true } : { ok: false, error: "Бюджет не найден" };
}

export async function setBudgetStatus(id: string, status: "DRAFT" | "APPROVED"): Promise<Res> {
  const session = await requireRole(...EDIT);
  if (status !== "DRAFT" && status !== "APPROVED") return { ok: false, error: "Неверный статус" };
  const r = await prisma.budgetScenario.updateMany({ where: { id: s(id, 40), organizationId: session.user.organizationId }, data: { status, updatedBy: session.user.name ?? null } });
  return r.count ? { ok: true } : { ok: false, error: "Бюджет не найден" };
}

export async function deleteBudget(id: string): Promise<Res> {
  const session = await requireRole(...EDIT);
  const r = await prisma.budgetScenario.deleteMany({ where: { id: s(id, 40), organizationId: session.user.organizationId } });
  revalidatePath("/budget");
  return r.count ? { ok: true } : { ok: false, error: "Бюджет не найден" };
}

// ---------------------------------------------------------------------------------------------------------------------
// Загрузка из файла (.xlsx / .csv) и выгрузка сводки в Excel. exceljs подключается только здесь, на сервере.

export type ImportRow = { fur: string; cat: string; pcs: number; hides: number | null; hidePrice: number | null; meters: number | null; meterPrice: number | null; work: number | null; statFur: string; statCat: string };

const norm = (v: unknown) => String(v ?? "").toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();

/** Значение ячейки как число: число, результат формулы, «1 234,5» из текста; иначе null. */
function cellNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "object") {
    const o = v as { result?: unknown; text?: unknown };
    return o.result !== undefined ? cellNum(o.result) : o.text !== undefined ? cellNum(o.text) : null;
  }
  const t = String(v).replace(/\s|\u00a0/g, "").replace(",", ".").replace(/%$/, "");
  if (!t || !/^-?\d*\.?\d+$/.test(t)) return null;
  return Number(t);
}
function cellStr(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "object") { const o = v as { result?: unknown; text?: unknown }; return cellStr(o.result ?? o.text ?? ""); }
  return String(v).trim();
}

function splitCsv(text: string): string[][] {
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  const d = (first.match(/;/g)?.length ?? 0) >= (first.match(/,/g)?.length ?? 0) && first.includes(";") ? ";" : first.includes("\t") ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; continue; }
    if (c === '"') q = true;
    else if (c === d) { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cur); rows.push(row); row = []; cur = ""; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

/** Таблица значений → строки бюджета. Заголовки ищутся в первых 12 строках; секции «тип меха» — строки без данных. */
function rowsFromGrid(grid: unknown[][]): { rows: ImportRow[]; warnings: string[] } {
  const warnings: string[] = [];
  let h = -1;
  for (let i = 0; i < Math.min(grid.length, 12); i++) {
    const t = grid[i].map(norm);
    if (t.some((x) => x.startsWith("бюджет")) && t.some((x) => x.includes("категор") || x.includes("тип меха"))) { h = i; break; }
  }
  if (h < 0) return { rows: [], warnings: ["Не нашёл строку заголовков: нужны колонки «Тип меха / категория» (или «Тип меха» и «Категория») и «Бюджет, шт.»"] };
  const head = grid[h].map(norm);
  const find = (f: (x: string) => boolean) => head.findIndex(f);
  const cFur = find((x) => x === "тип меха" || x === "тип сырья" || x === "мех");
  const cCat = find((x) => x === "категория");
  const cBoth = find((x) => x.includes("тип меха") && x.includes("категор"));
  const cPcs = find((x) => x.startsWith("бюджет"));
  const cHides = find((x) => x.includes("шкур") && x.includes("на изделие"));
  const cHidePrice = find((x) => x.includes("цена шкуры"));
  const cMeters = find((x) => x.includes("подклад") && x.includes("на изделие") && !x.includes("цена"));
  const cMeterPrice = find((x) => x.includes("цена подкладки"));
  const cWork = find((x) => x.includes("работа на изделие"));
  const cStatFur = find((x) => x.includes("статистика") && x.includes("мех"));
  const cStatCat = find((x) => x.includes("статистика") && x.includes("категор"));
  const label = cBoth >= 0 ? cBoth : cCat >= 0 ? cCat : 0;
  const rows: ImportRow[] = [];
  let fur = "";
  for (let i = h + 1; i < grid.length; i++) {
    const g = grid[i];
    const name = cellStr(g[label]);
    if (!name) continue;
    const nl = norm(name);
    if (nl === "тотал" || nl === "итого" || nl === "всего" || nl.startsWith("изделий ")) continue;
    const pcs = cellNum(g[cPcs]);
    if (cFur >= 0 && cCat >= 0) {
      fur = cellStr(g[cFur]) || fur;
      if (!fur) { warnings.push(`Строка ${i + 1}: не указан тип меха`); continue; }
    } else if (pcs == null && cellNum(g[cHides]) == null && cellNum(g[cHidePrice]) == null) { fur = name; continue; }
    if (!fur) { warnings.push(`Строка ${i + 1} «${name}»: до неё не было строки с типом меха`); continue; }
    const v = (c: number) => (c >= 0 ? cellNum(g[c]) : null);
    rows.push({
      fur: fur.slice(0, 120), cat: name.slice(0, 120), pcs: Math.max(0, pcs ?? 0), hides: v(cHides), hidePrice: v(cHidePrice), meters: v(cMeters), meterPrice: v(cMeterPrice), work: v(cWork),
      statFur: cStatFur >= 0 ? cellStr(g[cStatFur]).slice(0, 80) : "", statCat: cStatCat >= 0 ? cellStr(g[cStatCat]).slice(0, 80) : "",
    });
  }
  if (rows.length > 500) { warnings.push("Слишком много строк: взяты первые 500"); rows.length = 500; }
  return { rows, warnings };
}

/** Разбор загруженного файла для предпросмотра. Ничего не сохраняет. */
export async function parseBudgetFile(fd: FormData): Promise<Res<{ rows: ImportRow[]; warnings: string[]; sheet: string }>> {
  await requireRole(...EDIT);
  const file = fd.get("file");
  if (!(file instanceof File)) return { ok: false, error: "Файл не получен" };
  if (file.size > 5_000_000) return { ok: false, error: "Файл больше 5 МБ" };
  const name = file.name.toLowerCase();
  try {
    let grid: unknown[][];
    let sheet = "";
    if (name.endsWith(".csv") || name.endsWith(".txt")) {
      grid = splitCsv((await file.text()).replace(/^\uFEFF/, ""));
    } else if (name.endsWith(".xlsx")) {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await file.arrayBuffer());
      const ws = wb.worksheets.find((w) => /прикидка/i.test(w.name)) ?? wb.worksheets[0];
      if (!ws) return { ok: false, error: "В файле нет листов" };
      sheet = ws.name;
      grid = [];
      ws.eachRow({ includeEmpty: true }, (row, i) => { grid[i - 1] = (row.values as unknown[]).slice(1); });
      for (let i = 0; i < grid.length; i++) grid[i] = grid[i] ?? [];
    } else return { ok: false, error: "Нужен файл .xlsx или .csv" };
    const { rows, warnings } = rowsFromGrid(grid);
    if (!rows.length) return { ok: false, error: warnings[0] ?? "В файле не нашлось строк бюджета" };
    return { ok: true, rows, warnings, sheet };
  } catch {
    return { ok: false, error: "Не удалось прочитать файл. Проверьте формат (.xlsx или .csv)." };
  }
}

/** Выгрузка сводки версии в Excel: итог, типы сырья, категории, артикулы. Возвращает файл в base64. */
export async function exportBudgetXlsx(id: string): Promise<Res<{ name: string; base64: string }>> {
  const session = await requireSession();
  const row = await prisma.budgetScenario.findFirst({ where: { id: s(id, 40), organizationId: session.user.organizationId } });
  if (!row) return { ok: false, error: "Бюджет не найден" };
  const params = cleanParams(row.params as Partial<BudgetParams>);
  const nodes = parseNodes(row.lines);
  const calc = computeTree(nodes, params);
  const total = grandTotal(nodes, params);
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Сводка", { views: [{ state: "frozen", ySplit: 3, xSplit: 1 }] });
  ws.addRow([`Бюджет расходов по меху: ${row.name} (${row.season})`]).font = { bold: true, size: 14 };
  ws.addRow([`${row.status === "APPROVED" ? "Утверждён" : "Черновик"} · цены с НДС · надбавка на мех и подкладку ${params.c4}%`]).font = { color: { argb: "FF666666" } };
  const head = ws.addRow(["Тип сырья / категория / артикул", "Изделий", "Шкур", "Мех, ₽", "Подкладка, ₽", "Работа, ₽", "4%, ₽", "Итого, ₽", "Доля, %", "На 1 изделие, ₽", "Сейчас на 1 изд., ₽", "Var, %"]);
  head.font = { bold: true };
  head.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFEFEF" } }; c.alignment = { wrapText: true, vertical: "middle" }; });
  const put = (label: string, a: typeof total, bold: boolean, indent: number) => {
    const r = ws.addRow([label, a.pcs, a.hides, a.mex, a.lining, a.work, a.c4, a.total, total.total > 0 ? a.total / total.total : null, perUnit(a), nowPerUnit(a), varPct(a) == null ? null : (varPct(a) as number) / 100]);
    r.getCell(1).alignment = { indent };
    if (bold) r.font = { bold: true };
    for (const c of [2, 3]) r.getCell(c).numFmt = "#,##0";
    for (const c of [4, 5, 6, 7, 8, 10, 11]) r.getCell(c).numFmt = "#,##0";
    r.getCell(9).numFmt = "0.0%";
    r.getCell(12).numFmt = "+0.0%;-0.0%;0.0%";
    return r;
  };
  const tr = put("ВСЕГО", total, true, 0);
  tr.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDDDDDD" } }; });
  const kids = new Map<string | null, typeof nodes>();
  for (const nd of nodes) kids.set(nd.parentId, [...(kids.get(nd.parentId) ?? []), nd]);
  const walk = (pid: string | null, depth: number) => {
    for (const nd of kids.get(pid) ?? []) {
      const a = calc.get(nd.id);
      if (a) {
        const r = put(nd.name, a, nd.kind !== "art" && nd.kind !== "len", depth);
        if (nd.kind === "fur") r.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F3F3" } }; });
      }
      walk(nd.id, depth + 1);
    }
  };
  walk(null, 0);
  ws.getColumn(1).width = 38;
  for (let c = 2; c <= 12; c++) ws.getColumn(c).width = 16;
  ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  return { ok: true, name: `Бюджет ${row.name}.xlsx`.replace(/[\\/:*?"<>|]/g, "_"), base64: buf.toString("base64") };
}
