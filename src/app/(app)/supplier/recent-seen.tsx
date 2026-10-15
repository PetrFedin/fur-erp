"use client";

import { useEffect } from "react";
import { RECENT_COOKIE } from "@/lib/supplier-recent-const";

/** Запоминает, что Веллмех посмотрел «Недавнее»: кука читается сервером (точка в меню и пометка «новое»). */
export function RecentSeen() {
  useEffect(() => {
    const t = window.setTimeout(() => {
      try { document.cookie = `${RECENT_COOKIE}=${Date.now()}; path=/; max-age=31536000; samesite=lax`; } catch { /* куки закрыты — просто не запомним */ }
    }, 1500);
    return () => window.clearTimeout(t);
  }, []);
  return null;
}
