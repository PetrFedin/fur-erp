"use client";

import { useTransition } from "react";
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
}: {
  userId: string;
  role: string;
  disabled?: boolean;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <Select
      defaultValue={role}
      disabled={disabled || pending}
      className="h-8 w-44"
      onChange={(e) => {
        const value = e.target.value;
        startTransition(() => {
          updateUserRole(userId, value);
        });
      }}
    >
      {Object.entries(ROLE_LABELS).map(([value, label]) => (
        <option key={value} value={value}>
          {label}
        </option>
      ))}
    </Select>
  );
}
