"use client";

import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { SUPPLIER_PRESETS, payloadFromPreset, presetLabel } from "@/lib/calc-presets";
import { FORMAT_LABEL, emptyPayload, newId, rowFilled, syncLetters, type CalcFormat, type CalcPayload } from "@/lib/supplier-calc";
import { deleteTemplate, listTemplates, renameTemplate, saveTemplate, type TemplateRow } from "./template-actions";

const CLASSIC = (Object.keys(FORMAT_LABEL) as CalcFormat[]).filter((k) => k !== "SHEET");

/** Свободная таблица с двумя столбцами ввода — «Пустой, соберу сам». */
function blankSheet(base: CalcPayload): CalcPayload {
  const b = base.format === "SHEET" ? base : emptyPayload("SHEET");
  return syncLetters({
    ...base, format: "SHEET", rows: b.rows.map((r) => ({ _id: r._id ?? newId(), fur: r.fur ?? "", size: r.size ?? "", lot: r.lot ?? "" })), overrides: {}, checks: undefined,
    customColumns: [
      { id: "c_qty", letter: "", title: "Количество", unit: "шт", formula: "", kind: "input" },
      { id: "c_price", letter: "", title: "Закупка (молоток)", unit: "$", formula: "", kind: "input" },
    ],
    params: [{ name: "курс", value: "" }], qtyColumn: "c_qty", priceColumn: "c_price", unitCostColumn: undefined, formatId: undefined, formatName: undefined,
  });
}

/** Формат расчёта: встроенные, 13 образцов из файлов Веллмеха, «Мои форматы» и пустая таблица. */
export function FormatPicker({ p, setP, ro, onClassic, notify }: {
  p: CalcPayload; setP: Dispatch<SetStateAction<CalcPayload>>; ro: boolean; onClassic: (f: CalcFormat) => void; notify: (text: string, bad?: boolean) => void;
}) {
  const [tpls, setTpls] = useState<TemplateRow[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [manage, setManage] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { try { setTpls(await listTemplates()); } catch { setTpls([]); } }, []);
  useEffect(() => {
    if (ro) return;
    let on = true;
    listTemplates().then((r) => { if (on) setTpls(r); }).catch(() => { if (on) setTpls([]); });
    return () => { on = false; };
  }, [ro]);

  const value = p.format !== "SHEET" ? p.format : p.formatId ? p.formatId : "blank";
  const hasData = (x: CalcPayload) => x.rows.some((r) => rowFilled(r) && Object.entries(r).some(([k, v]) => !k.startsWith("_") && !["fur", "size", "lot", "invoice", "dest"].includes(k) && String(v).trim() !== ""));
  const confirmLose = (x: CalcPayload) => !hasData(x) || confirm("Смена формата заменит столбцы. Введённые числа в строках пропадут (названия лотов останутся). Продолжить?");

  const apply = (v: string) => {
    if (v === value) return;
    if ((CLASSIC as string[]).includes(v)) { if (p.format === "SHEET" && !confirmLose(p)) return; onClassic(v as CalcFormat); return; }
    if (!confirmLose(p)) return;
    if (v === "blank") { setP((x) => blankSheet(x)); notify("Пустая таблица: добавьте столбцы кнопкой «+ Столбец»."); return; }
    if (v.startsWith("tpl:")) {
      const t = tpls?.find((x) => x.id === v.slice(4));
      if (!t) return;
      setP((x) => { const b = blankSheet(x); return syncLetters({ ...b, customColumns: t.payload.customColumns ?? [], params: t.payload.params ?? [], qtyColumn: t.payload.qtyColumn, priceColumn: t.payload.priceColumn, unitCostColumn: t.payload.unitCostColumn, checks: t.payload.checks, formatId: v, formatName: t.name }); });
      notify(`Формат «${t.name}»: столбцы и параметры подставлены.`);
      return;
    }
    const pr = SUPPLIER_PRESETS.find((x) => x.id === v) ?? null;
    if (!pr) return;
    setP((x) => {
      const rows = (x.format === "SHEET" ? x.rows : [{ fur: "", size: "", lot: "", _id: newId() }]).map((r) => ({ _id: r._id ?? newId(), fur: r.fur ?? "", size: r.size ?? "", lot: r.lot ?? "" }));
      return payloadFromPreset(pr, { ...x, format: "SHEET", rows });
    });
    notify(`Формат подставлен: ${pr.columns.length} столбцов, ${pr.params.length} параметров. Заполните параметры (курс, ставки) в блоке «Параметры».`);
  };

  const save = async () => {
    setBusy(true);
    const r = await saveTemplate(null, name, desc, JSON.stringify(p));
    setBusy(false);
    if (r.error) return notify(r.error, true);
    setSaving(false); setName(""); setDesc("");
    notify(`Формат «${name.trim()}» сохранён в «Мои форматы».`);
    void load();
  };
  const isSheet = p.format === "SHEET" && (p.customColumns?.length ?? 0) > 0;
  const curTpl = p.formatId?.startsWith("tpl:") ? tpls?.find((t) => `tpl:${t.id}` === p.formatId) : undefined;

  return (
    <div className="col-span-full flex flex-col gap-2 sm:col-span-2">
      <div>
        <Label>Формат расчёта</Label>
        <Select value={value} disabled={ro} onChange={(e) => apply(e.target.value)}>
          <optgroup label="Простые (3 шага)">
            {CLASSIC.map((k) => <option key={k} value={k}>{FORMAT_LABEL[k]}</option>)}
          </optgroup>
          <optgroup label="Образцы из файлов Веллмеха (таблица со столбцами и формулами)">
            {SUPPLIER_PRESETS.map((x) => <option key={x.id} value={x.id}>{presetLabel(x)}</option>)}
          </optgroup>
          {(tpls?.length ?? 0) > 0 && (
            <optgroup label="Мои форматы">
              {tpls!.map((t) => <option key={t.id} value={`tpl:${t.id}`}>{t.name}</option>)}
            </optgroup>
          )}
          <optgroup label="С нуля">
            <option value="blank">Пустой — соберу сам</option>
          </optgroup>
        </Select>
        <p className="mt-1 text-xs text-neutral-500">
          {p.formatName ? `Взят образец: ${p.formatName}. ` : ""}Образец подставляет столбцы, формулы и подсказки к параметрам; дальше всё можно менять. Ставки вы вводите сами.
        </p>
      </div>
      {!ro && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {isSheet && !saving && <Button type="button" size="sm" variant="outline" onClick={() => { setSaving(true); setName(curTpl?.name ?? ""); }}>Сохранить как мой формат</Button>}
          {(tpls?.length ?? 0) > 0 && <button type="button" className="text-neutral-500 underline decoration-dotted" onClick={() => setManage((v) => !v)}>{manage ? "Скрыть мои форматы" : `Мои форматы (${tpls!.length})`}</button>}
        </div>
      )}
      {saving && (
        <div className="flex flex-col gap-2 rounded-md border border-neutral-300 bg-neutral-50 p-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div><Label>Название формата</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Например: SAGA норка 2026" /></div>
            <div><Label>Описание (необязательно)</Label><Input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Для каких лотов" /></div>
          </div>
          <p className="text-xs text-neutral-500">Сохраняются столбцы, формулы, правила и параметры (с их значениями), без лотов и цен. Формат виден только вам.</p>
          <div className="flex gap-2"><Button type="button" size="sm" disabled={busy} onClick={save}>Сохранить формат</Button><Button type="button" size="sm" variant="ghost" onClick={() => setSaving(false)}>Отмена</Button></div>
        </div>
      )}
      {manage && tpls && (
        <div className="flex flex-col gap-1 rounded-md border border-neutral-200 p-2 text-sm">
          {tpls.map((t) => (
            <div key={t.id} className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{t.name}</span>
              {t.description && <span className="text-xs text-neutral-500">{t.description}</span>}
              <span className="text-xs text-neutral-400">столбцов: {t.payload.customColumns?.length ?? 0}</span>
              <button type="button" className="text-xs underline" onClick={async () => {
                const n = prompt("Новое название формата", t.name);
                if (n === null) return;
                const r = await renameTemplate(t.id, n, t.description);
                if (r.error) notify(r.error, true); else void load();
              }}>переименовать</button>
              {isSheet && <button type="button" className="text-xs underline" title="Заменить столбцы формата текущими" onClick={async () => {
                if (!confirm(`Заменить формат «${t.name}» текущими столбцами и формулами?`)) return;
                const r = await saveTemplate(t.id, t.name, t.description, JSON.stringify(p));
                if (r.error) notify(r.error, true); else { notify("Формат обновлён."); void load(); }
              }}>обновить из таблицы</button>}
              <button type="button" className="text-xs text-neutral-400 hover:text-red-600" onClick={async () => {
                if (!confirm(`Удалить формат «${t.name}»? Расчёты, сделанные по нему, останутся.`)) return;
                const r = await deleteTemplate(t.id);
                if (r.error) notify(r.error, true); else void load();
              }}>удалить</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
