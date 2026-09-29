// Plain, server-safe VAT-mode helpers — kept out of vat-display.tsx because
// that file is "use client": every export from a client-marked file becomes
// a client-only reference, even a pure function, so AppLayout (a Server
// Component) can't call parseVatModeCookie() if it lived there.
export type VatMode = "incl" | "excl";

export function parseVatModeCookie(value: string | undefined): VatMode {
  return value === "excl" ? "excl" : "incl";
}
