import profiles from "@/lib/data/article-tz-profile.json";
import { normalizeModelCode } from "@/lib/model-code";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Prof = { names: [string, number][]; colors: [string, number][]; sizes: string[]; linings: [string, number][]; furs: string[]; tz: number[] };

const key = (code: string) => normalizeModelCode(code).toUpperCase().replace(/-/g, "");
/** Есть ли профиль из Word-ТЗ у артикула. */
export const hasTzProfile = (code: string) => !!(profiles as unknown as Record<string, Prof>)[key(code)];

/** «Профиль по ТЗ»: что написано про артикул в Word-ТЗ (приложения к договору подряда) — без цен. Данные: scripts/data/build-article-profile.py. */
export function TzProfile({ code }: { code: string }) {
  const p = (profiles as unknown as Record<string, Prof>)[key(code)];
  if (!p) return null;
  const row = (label: string, v: string) => (v ? <div className="grid grid-cols-[6.5rem_1fr] gap-2 sm:grid-cols-[8rem_1fr]"><dt className="text-neutral-600">{label}</dt><dd>{v}</dd></div> : null);
  // Названия и цвета — по убыванию частоты, без счётчиков в скобках; число ТЗ — отдельной строкой значением.
  const list = (xs: [string, number][]) => [...xs].sort((a, b) => b[1] - a[1]).map(([n]) => n).join("; ");
  return (
    <Card>
      <CardHeader><CardTitle as="h2">Профиль по ТЗ</CardTitle></CardHeader>
      <CardContent className="text-sm">
        <dl className="flex flex-col gap-1.5">
          {row("Названия", list(p.names))}
          {row("Мех", p.furs.join(", "))}
          {row("Цвета", list(p.colors))}
          {row("Размеры", p.sizes.join(", "))}
          {row("Подкладка", list(p.linings))}
          {row("ТЗ в Word", p.tz.length ? `${p.tz.length}: №${p.tz.join(", ")}` : "")}
        </dl>
      </CardContent>
    </Card>
  );
}
