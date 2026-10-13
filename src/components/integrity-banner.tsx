import Link from "next/link";
import { Suspense } from "react";
import { requireSession } from "@/lib/session";
import { getIntegrityReport, violationsForEntity, knownForEntity } from "@/lib/integrity";
import { cn } from "@/lib/utils";

const fmt = (v: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(Math.abs(v));

async function Body({ kind, id }: { kind?: string; id?: string }) {
  const session = await requireSession();
  const report = await getIntegrityReport(session.user.organizationId);
  if (!report) return null;

  // Общую плашку «Данные не сходятся» на Сводке не показываем (решение владельца: не пугать).
  // Список расхождений остаётся на странице «Контроль → Самопроверка» (/integrity).
  if (!kind || !id) return null;

  const v = violationsForEntity(report, kind, id);
  const k = knownForEntity(report, kind, id);
  if (!v.length && !k.length) return null;
  const red = v.some((x) => x.severity === "error");
  return (
    <div className="mb-3 space-y-1.5">
      {v.length > 0 && (
        <div role="alert" className={cn("rounded-lg border px-3 py-2 text-sm", red ? "border-red-200 bg-red-50 text-red-900" : "border-amber-200 bg-amber-50 text-amber-900")}>
          <div className="font-medium">Не сходится: {v.length}</div>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {v.slice(0, 5).map((x, i) => (
              <li key={i}>
                {x.v.message}
                {x.v.delta != null ? <> — на <b className="tabular-nums">{fmt(x.v.delta)} {x.v.unit}</b></> : null}{" "}
                <Link href={x.v.href} className="underline">где исправить</Link>
              </li>
            ))}
            {v.length > 5 && <li>…и ещё {v.length - 5}. <Link href="/integrity" className="underline">Проверка данных</Link></li>}
          </ul>
        </div>
      )}
      {k.map((x, i) => (
        <div key={i} className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-xs text-neutral-600">
          <span className="font-medium">Известно:</span> {x.v.reason}
        </div>
      ))}
    </div>
  );
}

/** Плашка самопроверки на карточке записи (kind/id) или на Сводке (без параметров). Не блокирует страницу: грузится в Suspense. */
export function IntegrityBanner({ kind, id }: { kind?: "purchase" | "lot" | "order" | "batch" | "payment" | "prodPayment" | "model"; id?: string }) {
  return (
    <Suspense fallback={null}>
      <Body kind={kind} id={id} />
    </Suspense>
  );
}
