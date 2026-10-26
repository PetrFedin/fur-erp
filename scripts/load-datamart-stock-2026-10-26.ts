/**
 * Остатки из datamart → SystemState (ключ datamart-stock): снимки по датам (inventory_on_dates.csv) и текущий остаток по складам (stock_now.csv + locations_all.csv).
 *   node --env-file=.env node_modules/.bin/tsx scripts/load-datamart-stock-2026-10-26.ts [--dir=~/Downloads] [--apply]
 * Без --apply — только расчёт. Откат: удалить ключ datamart-stock из SystemState.
 */
import { homedir } from "os";
import { join } from "path";
import { readFileSync } from "fs";

const DIR = process.argv.find((a) => a.startsWith("--dir="))?.slice(6) ?? join(homedir(), "Downloads");
const APPLY = process.argv.includes("--apply");
type Row = Record<string, string>;
function readCsv(file: string): Row[] {
  const lines = readFileSync(join(DIR, file), "utf8").replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.length);
  const split = (l: string) => { const o: string[] = []; let cur = "", q = false; for (let i = 0; i < l.length; i++) { const c = l[i]; if (q) { if (c === '"' && l[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; } else if (c === '"') q = true; else if (c === ";") { o.push(cur); cur = ""; } else cur += c; } o.push(cur); return o; };
  const head = split(lines[0]);
  return lines.slice(1).map((l) => { const c = split(l); return Object.fromEntries(head.map((h, i) => [h, c[i] ?? ""])); });
}
const n = (s: string) => (s === "" ? 0 : Number(s));
const ACC = /^(MSC|MH|МН|MGL)/i;
const iso = (d: string) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  const inv = readCsv("inventory_on_dates.csv"), now = readCsv("stock_now.csv"), locs = readCsv("locations_all.csv");
  const names = new Map(locs.map((l) => [l.LocationKey, l.LocationName]));
  const snaps = new Map<string, { total: number; rtw: number; acc: number }>();
  for (const r of inv) { const d = iso(r.DateID), s = snaps.get(d) ?? { total: 0, rtw: 0, acc: 0 }; const q = n(r.Qty); s.total += q; if (ACC.test(r.Article)) s.acc += q; else s.rtw += q; snaps.set(d, s); }
  const places = new Map<string, number>(); let avail = 0, reserved = 0, physical = 0, rtw = 0, acc = 0; let nowDate = "";
  for (const r of now) {
    avail += n(r.AvailPhysical); reserved += n(r.Reserved); physical += n(r.PhisicalInvent);
    if (ACC.test(r.Article)) acc += n(r.PhisicalInvent); else rtw += n(r.PhisicalInvent);
    const nm = names.get(r.LocationKey) ?? `склад ${r.LocationKey}`; places.set(nm, (places.get(nm) ?? 0) + n(r.AvailPhysical));
    const m = /(\d\d)\/(\d\d)\/(\d{4})/.exec(r.load_dt); if (m) nowDate = `${m[3]}-${m[1]}-${m[2]}`;
  }
  const value = {
    source: "витрина datamart: dwh.vFact_Inventory_Datamart и dwh.vFact_AnalyseStockOnHand", loadedAt: new Date().toISOString().slice(0, 10), orders: ["147621", "155627", "157488", "157525", "158123"],
    snapshots: [...snaps.entries()].sort().map(([date, s]) => ({ date, ...s })),
    now: { date: nowDate, physical, avail, reserved, rtw, acc, places: [...places.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([name, v]) => ({ name, avail: v })) },
  };
  console.log(JSON.stringify(value, null, 1).slice(0, 1500));
  if (APPLY) {
    const org = (await prisma.organization.findFirst({ select: { id: true } }))!.id;
    await prisma.systemState.upsert({ where: { organizationId_key: { organizationId: org, key: "datamart-stock" } }, update: { value }, create: { organizationId: org, key: "datamart-stock", value } });
    console.log("Записано в SystemState: datamart-stock");
  } else console.log("Пробный прогон: добавьте --apply.");
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
