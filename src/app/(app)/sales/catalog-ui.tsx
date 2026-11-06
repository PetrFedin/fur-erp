import type { ReactNode } from "react";

const XIcon = () => <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>;
/** Крестик закрытия окна: всегда справа вверху, цель касания 44 px. */
export function CloseX({ onClick, dark = false }: { onClick: () => void; dark?: boolean }) {
  return <button type="button" onClick={onClick} aria-label="Закрыть" title="Закрыть" className={"pointer-events-auto inline-flex size-11 shrink-0 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 " + (dark ? "bg-white/15 text-white focus-visible:outline-white" : "border border-neutral-300 bg-white text-neutral-800 focus-visible:outline-neutral-900")}><XIcon /></button>;
}


export const CHIP = "inline-flex min-h-11 shrink-0 items-center rounded-full border px-4 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900";
export const chip = (on: boolean) => CHIP + (on ? " border-neutral-900 bg-neutral-900 text-white" : " border-neutral-300 bg-white text-neutral-800 hover:bg-neutral-50");
export type { ReactNode };
