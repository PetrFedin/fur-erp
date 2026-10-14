import Link from "next/link";
import { STEPS } from "./data";
import { SchemeDiagram } from "./diagram";
import { requireSession } from "@/lib/session";

export const metadata = { title: "Схема работы" };

export default async function SchemePage() {
  await requireSession();
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Схема работы</h1>
        <Link href="/dashboard" className="rounded-md border border-neutral-300 bg-white px-3 py-1 text-xs text-neutral-700 hover:bg-neutral-50">← Главная</Link>
      </div>
      <p className="max-w-3xl text-sm text-neutral-600">
        Сверху вниз: что заводим сначала и откуда берётся следующий шаг. Нажмите на блок — поверх откроется описание: что вносят, что получаем и кнопка перехода в раздел.
      </p>

      <SchemeDiagram steps={STEPS} />
    </div>
  );
}
