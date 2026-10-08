"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { recheckIntegrity } from "./actions";

export function RecheckButton() {
  const [pending, start] = useTransition();
  return (
    <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => start(() => recheckIntegrity())}>
      {pending ? "Проверяем…" : "Проверить сейчас"}
    </Button>
  );
}
