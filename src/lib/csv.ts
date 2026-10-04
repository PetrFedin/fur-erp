// CSV для Excel (русская локаль): разделитель «;», десятичная запятая, BOM в начале.
export type CsvCell = string | number | null | undefined;

export function csvNum(v: number | null | undefined, digits = 2): string {
  return v == null || !Number.isFinite(v) ? "" : v.toFixed(digits).replace(".", ",");
}

function esc(c: CsvCell): string {
  const s = c == null ? "" : String(c);
  // защита от формул в Excel
  const safe = /^[=+@]/.test(s) || (/^-/.test(s) && !/^-\d/.test(s)) ? `'${s}` : s;
  return /[";\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(header: string[], rows: CsvCell[][]): string {
  return "﻿" + [header, ...rows].map((r) => r.map(esc).join(";")).join("\r\n") + "\r\n";
}

export function csvResponse(name: string, body: string): Response {
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
