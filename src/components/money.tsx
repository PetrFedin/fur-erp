import { MoneyClient } from "./money-client";

type MoneyLike = number | string | { toString(): string };

/**
 * Renders a RUB amount that follows the site-wide "С НДС / Без НДС" toggle.
 * Server Components compute both `incl` and `excl` from real stored fields
 * and hand them both down here — this component only ever picks which
 * already-correct number to display, it never derives one itself.
 *
 * When a figure genuinely has no correct excl-VAT breakdown (see README),
 * pass only `incl` — the "Без НДС" mode then falls back to showing the
 * incl-VAT figure with a footnote marker rather than guessing.
 *
 * Deliberately NOT a "use client" module: callers pass Prisma Decimal
 * values, and a Decimal can't be a prop of a Client Component (React logs
 * "Only plain objects can be passed to Client Components" for every one).
 * This wrapper stringifies on the server side and hands MoneyClient plain
 * strings; used from a client tree it's just an ordinary component.
 */
export function Money({
  incl,
  excl,
  className,
}: {
  incl: MoneyLike;
  excl?: MoneyLike | null;
  className?: string;
}) {
  return <MoneyClient incl={incl.toString()} excl={excl != null ? excl.toString() : null} className={className} />;
}
