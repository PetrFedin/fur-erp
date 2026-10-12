"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { addPurchaseItemsBulk, type BulkFormState } from "../actions";
import { PasteBox, IssueList, confirmNewMaterials } from "../paste-box";
import { parsePasteRows, issueLines } from "../parse-rows";
import { vatRateForDate } from "@/lib/vat-by-date";

// Paste rows from Excel into an existing draft. Same parser/format as the
// "Новая закупка" form. All-or-nothing; the text stays if anything is wrong.
export function BulkItemForm({
  purchaseId,
  materialNames,
  existingLotNumbers,
  currency,
  purchaseDate,
}: {
  existingLotNumbers: string[];
  purchaseId: string;
  materialNames: string[];
  currency: string;
  /** Дата закупки (YYYY-MM-DD): по ней подставляется ставка для пустого НДС%. */
  purchaseDate: string;
}) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<BulkFormState>({});
  const [rows, setRows] = useState("");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const result = parsePasteRows(rows, materialNames, existingLotNumbers, vatRateForDate(purchaseDate));
        if (result.errorCount > 0) {
          setState({
            error: `Ничего не добавлено: ошибок в позициях — ${result.errorCount}.`,
            issues: issueLines(result),
          });
          return;
        }
        if (!confirmNewMaterials(result)) {
          setState({ issues: issueLines(result) });
          return;
        }
        const fd = new FormData();
        fd.set("rows", rows);
        startTransition(async () => {
          const res = await addPurchaseItemsBulk(purchaseId, {}, fd);
          setState(res);
          if (res.created) setRows("");
        });
      }}
      className="flex flex-col gap-3"
    >
      <PasteBox value={rows} onChange={setRows} materialNames={materialNames} existingLotNumbers={existingLotNumbers} rows={8} currency={currency} />
      <div className="flex items-center gap-3">
        <Button type="submit" variant="outline" size="sm" disabled={pending || !rows.trim()}>
          {pending ? "Добавляем..." : "Добавить в закупку"}
        </Button>
        {state.created !== undefined && (
          <span className="text-sm text-emerald-700">Добавлено позиций: {state.created}</span>
        )}
      </div>
      {state.error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      <IssueList issues={state.issues ?? []} />
    </form>
  );
}
