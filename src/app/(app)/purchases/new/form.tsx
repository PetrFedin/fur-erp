"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import type { FormState, Issue } from "../actions";
import { parsePasteRows, issueLines } from "../parse-rows";
import { PasteBox, IssueList, confirmNewMaterials } from "../paste-box";
import { CbrRateButton } from "../cbr-rate-button";
import { AuctionSelect, type AuctionSelectOption } from "@/components/auction-select";

type Option = { id: string; name: string; isDefault?: boolean };

// One form: header + pasted lines -> the purchase is created together with its
// lines. State is held in React (not in the DOM) and the action is called from
// a transition, so a failed submit never resets or loses any field.
export function PurchaseCreateForm({
  action,
  suppliers,
  warehouses,
  materialNames,
  existingLotNumbers,
  auctions,
  canCreateAuction = false,
}: {
  auctions: AuctionSelectOption[];
  canCreateAuction?: boolean;
  existingLotNumbers: string[];
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  suppliers: Option[];
  warehouses: Option[];
  materialNames: string[];
}) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<FormState>({});
  const [clientIssues, setClientIssues] = useState<Issue[]>([]);
  const [currency, setCurrency] = useState("RUB");
  const [rows, setRows] = useState("");
  const today = new Date().toISOString().slice(0, 10);

  const issues = clientIssues.length > 0 ? clientIssues : (state.issues ?? []);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        setState({});
        if (rows.trim()) {
          const result = parsePasteRows(rows, materialNames, existingLotNumbers);
          if (result.errorCount > 0) {
            setClientIssues(issueLines(result));
            setState({ error: `Закупка не создана: ошибок в позициях — ${result.errorCount}. Исправьте строки ниже.` });
            return;
          }
          setClientIssues(issueLines(result));
          if (!confirmNewMaterials(result)) return;
        } else {
          setClientIssues([]);
        }
        startTransition(async () => {
          const res = await action({}, fd);
          if (res) setState(res);
        });
      }}
      className="flex flex-col gap-4"
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <Label htmlFor="orderDate">Дата</Label>
          <Input id="orderDate" name="orderDate" type="date" defaultValue={today} required />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="auctionSession">Аукцион / сессия</Label>
          <AuctionSelect id="auctionSession" refs={auctions} canCreate={canCreateAuction} />
        </div>
        <div>
          <Label htmlFor="invoiceNumber">Счёт №</Label>
          <Input id="invoiceNumber" name="invoiceNumber" placeholder="2004" />
        </div>
        <div>
          <Label htmlFor="currency">Валюта</Label>
          <Select id="currency" name="currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            <option value="RUB">RUB — рубль</option>
            <option value="USD">USD — доллар</option>
            <option value="EUR">EUR — евро</option>
          </Select>
        </div>
        {currency !== "RUB" && (
          <div>
            <Label htmlFor="exchangeRate">Курс {currency} → RUB</Label>
            <Input
              id="exchangeRate"
              name="exchangeRate"
              type="number"
              step="0.0001"
              min="0"
              required
              placeholder="например, 79.75"
            />
            <div className="mt-1">
              <CbrRateButton currency={currency} dateInputId="orderDate" />
            </div>
          </div>
        )}
        {suppliers.length > 1 ? (
          <div className="sm:col-span-2">
            <Label htmlFor="supplierId">Поставщик</Label>
            <Select id="supplierId" name="supplierId" required defaultValue="">
              <option value="" disabled>
                Выберите поставщика
              </option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </div>
        ) : (
          suppliers[0] && <input type="hidden" name="supplierId" value={suppliers[0].id} />
        )}
        {warehouses.length > 1 ? (
          <div className="sm:col-span-2">
            <Label htmlFor="warehouseId">Склад поступления</Label>
            <Select
              id="warehouseId"
              name="warehouseId"
              required
              defaultValue={warehouses.find((w) => w.isDefault)?.id ?? ""}
            >
              <option value="" disabled>
                Выберите склад
              </option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
          </div>
        ) : (
          warehouses[0] && <input type="hidden" name="warehouseId" value={warehouses[0].id} />
        )}
      </div>

      <details className="rounded-md border border-neutral-200 px-3 py-2">
        <summary className="cursor-pointer text-sm text-neutral-600">Дополнительно</summary>
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label htmlFor="transferDocument">УПД / документ передачи</Label>
            <Input id="transferDocument" name="transferDocument" placeholder="№ 143 от 22.09.2025 г." />
          </div>
          <div>
            <Label htmlFor="expectedDate">Ожидаемая дата</Label>
            <Input id="expectedDate" name="expectedDate" type="date" />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="notes">Заметки</Label>
            <Textarea id="notes" name="notes" rows={2} />
          </div>
        </div>
      </details>

      <PasteBox value={rows} onChange={setRows} materialNames={materialNames} existingLotNumbers={existingLotNumbers} currency={currency} />

      {state.error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      <IssueList issues={issues} />
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Создаём..." : "Создать закупку"}
        </Button>
      </div>
    </form>
  );
}
