"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useVatDisplay } from "@/lib/vat-display";

/**
 * Сводка считается на сервере; переключатель НДС в шапке меняет только cookie и клиентское состояние.
 * Когда режим шапки расходится с тем, по которому страница отрисована, просим сервер перерисовать её.
 */
export function VatSync({ serverMode }: { serverMode: "incl" | "excl" }) {
  const { mode } = useVatDisplay();
  const router = useRouter();
  useEffect(() => {
    if (mode !== serverMode) router.refresh();
  }, [mode, serverMode, router]);
  return null;
}
