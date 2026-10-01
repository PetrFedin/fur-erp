"use client";

import { useState, useTransition } from "react";
import { Select } from "@/components/ui/input";
import { updateUserRole } from "./actions";

const ROLE_LABELS: Record<string, string> = {
  OWNER: "Владелец",
  ADMIN: "Администратор",
  PURCHASER: "Закупщик",
  WAREHOUSE: "Кладовщик",
  TECHNOLOGIST: "Технолог",
  ACCOUNTANT: "Бухгалтер",
  VIEWER: "Наблюдатель",
};

export function RoleSelect({
  userId,
  role,
  disabled,
  allowOwner = true,
}: {
  userId: string;
  role: string;
  disabled?: boolean;
  allowOwner?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(role);

  return (
    <Select
      value={value}
      disabled={disabled || pending}
      className="h-8 w-44"
      onChange={(e) => {
        const next = e.target.value;
        setValue(next);
        startTransition(async () => {
          const res = await updateUserRole(userId, next);
          if (res?.error) {
            window.alert(res.error);
            setValue(role);
          }
        });
      }}
    >
      {Object.entries(ROLE_LABELS)
        .filter(([v]) => allowOwner || v !== "OWNER")
        .map(([value, label]) => (
        <option key={value} value={value}>
          {label}
        </option>
      ))}
    </Select>
  );
}
