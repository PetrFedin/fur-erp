// Текст модуля для тестов, проверяющих исходный код: сам файл и его части (разрезанный модуль лежит в _<имя>/ или _actions/ рядом).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";

export function readModuleSource(file: string): string {
  const parts = [readFileSync(file, "utf8")];
  const base = basename(file).replace(/\.tsx?$/, "");
  for (const dir of [join(dirname(file), "_" + base)]) {
    if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
    for (const n of readdirSync(dir).sort()) if (/\.tsx?$/.test(n)) parts.push(readFileSync(join(dir, n), "utf8"));
  }
  return parts.join("\n");
}
