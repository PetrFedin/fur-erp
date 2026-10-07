"use client";

export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="rounded-md border border-neutral-300 bg-white px-3 py-1 text-xs text-neutral-700 hover:bg-neutral-50 print:hidden">
      Печать (A4)
    </button>
  );
}
