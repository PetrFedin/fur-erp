import profiles from "@/lib/data/article-tz-profile.json";
import { normalizeModelCode } from "@/lib/model-code";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Prof = { names: [string, number][]; colors: [string, number][]; sizes: string[]; linings: [string, number][]; furs: string[]; tz: number[] };

/** «Профиль по ТЗ»: что написано про артикул в Word-ТЗ (приложения к договору подряда) — без цен. Данные: scripts/data/build-article-profile.py. */
export function TzProfile({ code }: { code: string }) {
  const p = (profiles as unknown as Record<string, Prof>)[normalizeModelCode(code).toUpperCase().replace(/-/g, "")];
  if (!p) return null;
  const row = (label: string, v: string) => (v ? <div className="grid grid-cols-[8rem_1fr] gap-2"><dt className="text-neutral-500">{label}</dt><dd>{v}</dd></div> : null);
  const list = (xs: [string, number][]) => xs.map(([n, c]) => (c > 1 ? `${n} (×${c})` : n)).join("; ");
  return (
    <Card>
      <CardHeader><CardTitle as="h2">Профиль по ТЗ</CardTitle></CardHeader>
      <CardContent className="text-sm">
        <dl className="flex flex-col gap-1">
          {row("Названия", list(p.names))}
          {row("Мех", p.furs.join(", "))}
          {row("Цвета", list(p.colors))}
          {row("Размеры", p.sizes.join(", "))}
          {row("Подкладка", list(p.linings))}
          {row("Из ТЗ №", p.tz.join(", "))}
        </dl>
        <p className="mt-2 text-xs text-neutral-500">Сводка из Word-ТЗ на 15.10.2026; в скобках — в скольких ТЗ встречается.</p>
      </CardContent>
    </Card>
  );
}
