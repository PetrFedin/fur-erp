"use client";

import { EditDialog, Field } from "@/components/edit-dialog";
import { Input } from "@/components/ui/input";
import { ColorSelect, type ColorSelectOption } from "@/components/color-select";
import { updateLotMeta } from "@/app/(app)/purchases/actions";

/**
 * «Изменить лот» — безопасные поля лота после приёмки: № лота, сорт/описание, размер, цвет, примечание.
 * Количество, цена и остатки здесь не меняются (их правит строка закупки, пока лот не списан в ТЗ).
 */
export function LotEditButton({
  lotId,
  version,
  defaults,
  colorOptions,
  canAddColor,
}: {
  lotId: string;
  version: string;
  defaults: { lotNumber: string; grade: string; sizeGrade: string; color: string; colorRefId: string | null; notes: string };
  colorOptions: ColorSelectOption[];
  canAddColor: boolean;
}) {
  return (
    <EditDialog
      title="Изменить лот"
      variant="outline"
      action={(fd) => updateLotMeta(lotId, fd)}
      version={version}
      hint="Количество, цена и остаток лота здесь не меняются — только описание. Подтверждение закупки сбросится, итоги и фильтры обновятся."
    >
      <Field label="Номер лота">
        <Input name="lotNumber" defaultValue={defaults.lotNumber} maxLength={100} />
      </Field>
      <Field label="Размер (пусто — определить из сорта)">
        <Input name="sizeGrade" defaultValue={defaults.sizeGrade} maxLength={40} placeholder="XXL, XL, 40…" />
      </Field>
      <Field label="Сорт / описание" wide>
        <Input name="grade" defaultValue={defaults.grade} maxLength={500} />
      </Field>
      <Field label="Цвет (из справочника)" wide>
        <ColorSelect refs={colorOptions} defaultValue={defaults.color} defaultRefId={defaults.colorRefId} canCreate={canAddColor} />
      </Field>
      <Field label="Примечание" wide>
        <Input name="notes" defaultValue={defaults.notes} maxLength={2000} />
      </Field>
    </EditDialog>
  );
}
