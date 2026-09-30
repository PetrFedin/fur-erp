"use client";

/** Link-styled button that opens a <details id=targetId> elsewhere on the page and scrolls to it. */
export function OpenDetailsLink({ targetId, children }: { targetId: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      className="underline underline-offset-2 hover:text-neutral-700"
      onClick={() => {
        const el = document.getElementById(targetId);
        if (el instanceof HTMLDetailsElement) el.open = true;
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
      }}
    >
      {children}
    </button>
  );
}
