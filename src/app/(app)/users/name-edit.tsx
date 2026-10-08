"use client";

import { EditDialog, Field } from "@/components/edit-dialog";
import { Input } from "@/components/ui/input";
import { updateUserName } from "./actions";

export function UserNameEdit({ userId, name, version }: { userId: string; name: string; version: string }) {
  return (
    <EditDialog title="Изменить имя пользователя" action={(fd) => updateUserName(userId, fd)} version={version} hint="Роль и активность меняются в таблице; e-mail и пароль здесь не меняются.">
      <Field label="Имя" wide>
        <Input name="name" defaultValue={name} required minLength={2} maxLength={100} />
      </Field>
    </EditDialog>
  );
}
