// Budget PCS FW27 (SystemState budget-pcs:fw27-mvst): решения владельца 01.11.2026 из scripts/fw27-owner-plan-2026-11-01.json —
// желаемый остаток по типам меха (reserve, %), доля норки в строках «Норка+Соболь» (mixRows, %), пол норки по строкам (minkSex).
// Прежние параметры — docs-inventory/budget-pcs-params-before-2026-11-02.json.
//   node --env-file=.env node_modules/.bin/tsx scripts/apply-pcs-owner-params-2026-11-02.ts [--write]
import { readFileSync, writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

type Owner = { reserve: Record<string, number | string>; minkShare: Record<string, number | string>; minkSex: Record<string, string> };
const own = JSON.parse(readFileSync("scripts/fw27-owner-plan-2026-11-01.json", "utf8")) as Owner;
const nums = (o: Record<string, number | string>, k: number) => Object.fromEntries(Object.entries(o).filter(([key, v]) => key !== "_" && typeof v === "number").map(([key, v]) => [key, Math.round((v as number) * k * 100) / 100]));

(async () => {
  const prisma = new PrismaClient();
  const st = await prisma.systemState.findFirstOrThrow({ where: { key: "budget-pcs:fw27-mvst" } });
  const v = st.value as { params?: Record<string, unknown>; rows: { fur: string; cat: string; len: string }[] };
  const reserve = nums(own.reserve, 100), mixRows = nums(own.minkShare, 100);
  const minkSex = Object.fromEntries(Object.entries(own.minkSex).filter(([k, s]) => k !== "_" && (s === "M" || s === "F")));
  // Ключи должны совпасть со строками файла, иначе значение молча не применится.
  const mixKeys = new Set(v.rows.filter((r) => r.fur === "Норка+Соболь").map((r) => `${r.cat}|${r.len || ""}`));
  const sexKeys = new Set(v.rows.map((r) => `${r.fur}|${r.cat}|${r.len || ""}`));
  const missing = [...Object.keys(mixRows).filter((k) => !mixKeys.has(k)).map((k) => `mixRows ${k}`), ...Object.keys(minkSex).filter((k) => !sexKeys.has(k)).map((k) => `minkSex ${k}`)];
  console.log("было:", JSON.stringify(v.params));
  console.log("reserve:", reserve, "\nmixRows:", mixRows, "\nminkSex:", minkSex);
  if (missing.length) console.log("НЕТ СТРОК (пропущено, в файле нет такой строки):", missing);
  if (process.argv.includes("--write")) {
    writeFileSync("docs-inventory/budget-pcs-params-before-2026-11-02.json", JSON.stringify(v.params ?? null));
    v.params = { ...(v.params ?? {}), reserve, mixRows, minkSex };
    await prisma.systemState.update({ where: { id: st.id }, data: { value: v as never } });
    console.log("ЗАПИСАНО");
  }
  process.exit(0);
})();
