"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { addLiningPurchase, type LiningPurchaseState } from "../purchases/actions";

// «+ Купить ткань»: one quick form — fabric, metres, price per metre, date.
// The metres are added to that fabric's single pool (no new row appears).
export function LiningPurchaseForm({ materials }: { materials: { id: string; name: string }[] }) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<LiningPurchaseState>({});
  const [materialId, setMaterialId] = useState(materials[0]?.id ?? "__new");
  const today = new Date().toISOString().slice(0, 10);

  return (
    <details className="mb-4 rounded-md border border-neutral-200 bg-white">
      <summary className="cursor-pointer list-none px-3 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50 [&::-webkit-details-marker]:hidden">
        + Купить ткань
      </summary>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const fd = new FormData(form);
          setState({});
          startTransition(async () => {
            const res = await addLiningPurchase({}, fd);
            setState(res);
            if (res.ok) {
              form.reset();
              setMaterialId(materials[0]?.id ?? "__new");
            }
          });
        }}
        className="flex flex-col gap-3 border-t border-neutral-100 p-3"
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <Label htmlFor="lp-material">Ткань</Label>
            <Select
              id="lp-material"
              name="materialId"
              value={materialId}
              onChange={(e) => setMaterialId(e.target.value)}
            >
              {materials.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name.replace("Подкладочная ткань ", "")}
                </option>
              ))}
              <option value="__new">Новый номер…</option>
            </Select>
            {materialId === "__new" && (
              <Input name="newNumber" placeholder="№ новой ткани" className="mt-1" required />
            )}
          </div>
          <div>
            <Label htmlFor="lp-meters">Метры</Label>
            <Input id="lp-meters" name="meters" type="number" step="0.001" min="0.001" required />
          </div>
          <div>
            <Label htmlFor="lp-price">Цена за м, без НДС</Label>
            <Input id="lp-price" name="pricePerMeter" type="number" step="0.01" min="0" required />
          </div>
          <div>
            <Label htmlFor="lp-date">Дата</Label>
            <Input id="lp-date" name="date" type="date" defaultValue={today} required />
          </div>
        </div>
        <details className="text-sm">
          <summary className="cursor-pointer text-neutral-500">Дополнительно</summary>
          <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <Label htmlFor="lp-vat">НДС, %</Label>
              <Input id="lp-vat" name="vatRate" type="number" step="0.01" min="0" max="100" defaultValue={22} />
            </div>
            <div>
              <Label htmlFor="lp-invoice">Счёт / накладная</Label>
              <Input id="lp-invoice" name="invoiceNumber" />
            </div>
            <div className="col-span-2">
              <Label htmlFor="lp-notes">Примечание</Label>
              <Input id="lp-notes" name="notes" />
            </div>
          </div>
        </details>
        {state.error && <p className="text-sm text-red-600">{state.error}</p>}
        {state.ok && <p className="text-sm text-green-700">{state.ok}</p>}
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? "Добавляю…" : "Добавить"}
          </Button>
        </div>
      </form>
    </details>
  );
}
