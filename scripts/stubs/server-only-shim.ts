// «server-only» в Next — служебный пакет; в обычном Node его нет: подставляем пустышку.
// Подключать ПЕРВОЙ строкой импорта в скриптах, которые тянут src/lib/*.ts с `import "server-only"`.
import Module from "module";
import { join } from "path";

const M = Module as unknown as { _resolveFilename: (...a: unknown[]) => string };
const origResolve = M._resolveFilename;
M._resolveFilename = function (this: unknown, req: unknown, ...rest: unknown[]) {
  if (req === "server-only") return join(__dirname, "empty.js");
  return origResolve.call(this, req, ...rest);
};
