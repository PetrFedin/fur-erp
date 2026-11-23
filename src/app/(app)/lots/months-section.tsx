"use client";

import { PinSection } from "@/components/pin-section";
import { InfoHint } from "@/components/info-hint";
import { MonthlyChart, type MonthPoint } from "../analytics/raw/monthly-chart";

/** «Динамика закупок по месяцам» внутри «Сырья» (раньше — на отдельной странице аналитики): свернуть и закрепить — справа, как у других таблиц. */
export function MonthsSection({ points, unit }: { points: MonthPoint[]; unit: string }) {
  if (points.length === 0) return null;
  return (
    <PinSection id="lots-months" title="Динамика закупок по месяцам" value={[]} onRestore={() => {}}
      headerExtra={
        <InfoHint label="Динамика закупок" wide>
          <p>Сколько принято в сырьё в каждом месяце (по дате закупки): в {unit} или в ₽ с учётом режима НДС. Данные из витрины.</p>
        </InfoHint>
      }>
      <div className="rounded-lg border border-neutral-200 bg-white p-3">
        <MonthlyChart points={points} unit={unit} />
      </div>
    </PinSection>
  );
}
