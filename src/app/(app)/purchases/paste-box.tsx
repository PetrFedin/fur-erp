"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { formatQty, formatCurrency } from "@/lib/utils";
import { parsePasteRows, DEFAULT_PASTE_VAT_RATE } from "./parse-rows";
import type { Issue } from "./actions";

const EXAMPLE = "Соболь дикий выделанный\t21\t60355,15\t22\t15874\tК 2\tтёмный";

/** Подтверждение перед сохранением, если вставка создаст новые материалы (опечатка = тихий дубль). */
export function confirmNewMaterials(result: ReturnType<typeof parsePasteRows>): boolean {
  const names = [...new Set(result.rows.filter((r) => r.isNewMaterial).map((r) => r.materialName))];
  if (names.length === 0) return true;
  return window.confirm(
    `Будут созданы новые материалы (${names.length}):\n• ${names.join("\n• ")}\n\nЭтих названий нет в справочнике. Если это опечатка — отмените и исправьте. Создать и сохранить?`,
  );
}

export function IssueList({ issues }: { issues: Issue[] }) {
  if (issues.length === 0) return null;
  const errors = issues.filter((i) => i.level === "error");
  const warnings = issues.filter((i) => i.level === "warning");
  return (
    <div className="flex flex-col gap-2 text-sm">
      {errors.length > 0 && (
        <div className="rounded-md bg-red-50 px-3 py-2 text-red-700">
          <div className="font-medium">Ошибки ({errors.length}) — ничего не записано:</div>
          <ul className="mt-1 list-disc pl-5">
            {errors.map((e, i) => (
              <li key={i}>{e.text}</li>
            ))}
          </ul>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="rounded-md bg-amber-50 px-3 py-2 text-amber-800">
          <div className="font-medium">Предупреждения ({warnings.length}):</div>
          <ul className="mt-1 list-disc pl-5">
            {warnings.map((w, i) => (
              <li key={i}>{w.text}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// Textarea for rows pasted from Excel + format hint + "Проверить" preview.
// The textarea is controlled by the parent so a failed submit keeps the text.
export function PasteBox({
  name = "rows",
  value,
  onChange,
  materialNames,
  existingLotNumbers = [],
  rows = 10,
  currency = "RUB",
}: {
  existingLotNumbers?: string[];
  name?: string;
  value: string;
  onChange: (v: string) => void;
  materialNames: string[];
  rows?: number;
  currency?: string;
}) {
  const [checked, setChecked] = useState<string | null>(null);
  const result = checked !== null ? parsePasteRows(checked, materialNames, existingLotNumbers) : null;
  const issues: Issue[] = [];
  if (result) {
    for (const r of result.rows) {
      for (const e of r.errors) issues.push({ level: "error", text: `строка ${r.lineNo}: ${e}` });
      for (const w of r.warnings) issues.push({ level: "warning", text: `строка ${r.lineNo}: ${w}` });
    }
  }
  const okRows = result?.rows.filter((r) => r.errors.length === 0) ?? [];
  const total = okRows.reduce((s, r) => s + r.quantity * r.unitPrice, 0);

  return (
    <div className="flex flex-col gap-2">
      <div className="text-sm">
        <div className="font-medium">Вставьте позиции из Excel</div>
        <p className="mt-1 text-neutral-600">
          Одна позиция на строку, столбцы:{" "}
          <span className="font-mono text-xs">Материал ⇥ Кол-во ⇥ Цена без НДС ⇥ НДС% ⇥ Лот ⇥ Сорт ⇥ Цвет</span>
        </p>
        <p className="text-xs text-neutral-500">
          Лот, сорт, цвет — по желанию; пустой НДС% = {DEFAULT_PASTE_VAT_RATE}. Пример:{" "}
          <span className="font-mono">{EXAMPLE.replace(/\t/g, " ⇥ ")}</span>
        </p>
      </div>
      <Textarea
        name={name}
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={EXAMPLE}
        className="font-mono text-xs"
        spellCheck={false}
      />
      <div className="flex items-center gap-3">
        <Button type="button" variant="outline" size="sm" onClick={() => setChecked(value)} disabled={!value.trim()}>
          Проверить
        </Button>
        {result && (
          <span className="text-xs text-neutral-500">
            Строк: {result.rows.length}, ошибок: {result.errorCount}, предупреждений: {result.warningCount}
            {result.headerSkipped && " · первая строка (заголовок) пропущена"}
          </span>
        )}
      </div>
      {result && <IssueList issues={issues} />}
      {result && okRows.length > 0 && (
        <div className="max-h-96 overflow-auto rounded-md border border-neutral-200">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-neutral-50 text-left text-neutral-500">
              <tr>
                <th className="px-2 py-1">№</th>
                <th className="px-2 py-1">Материал</th>
                <th className="px-2 py-1">Лот</th>
                <th className="px-2 py-1 text-right">Кол-во</th>
                <th className="px-2 py-1 text-right">Цена без НДС</th>
                <th className="px-2 py-1 text-right">НДС</th>
                <th className="px-2 py-1 text-right">Сумма без НДС</th>
                <th className="px-2 py-1">Что будет создано</th>
              </tr>
            </thead>
            <tbody>
              {okRows.map((r) => (
                <tr key={r.lineNo} className="border-t border-neutral-100">
                  <td className="px-2 py-1 text-neutral-500">{r.lineNo}</td>
                  <td className="px-2 py-1">{r.materialName}</td>
                  <td className="px-2 py-1">
                    {r.lotNumber ?? "—"}
                    {(r.grade || r.color) && (
                      <span className="text-neutral-500"> · {[r.grade, r.color].filter(Boolean).join(" / ")}</span>
                    )}
                  </td>
                  <td className="px-2 py-1 text-right">{formatQty(String(r.quantity))}</td>
                  <td className="px-2 py-1 text-right">{formatCurrency(String(r.unitPrice), currency)}</td>
                  <td className="px-2 py-1 text-right">{r.vatRate}%</td>
                  <td className="px-2 py-1 text-right">{formatCurrency(String(r.quantity * r.unitPrice), currency)}</td>
                  <td className="px-2 py-1">
                    {r.isNewMaterial ? (
                      <span className="text-amber-700">позиция + новый материал</span>
                    ) : (
                      <span className="text-neutral-500">позиция</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-neutral-200 bg-neutral-50 font-medium">
                <td colSpan={6} className="px-2 py-1 text-right">
                  Итого без НДС
                </td>
                <td className="px-2 py-1 text-right">{formatCurrency(String(total), currency)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
