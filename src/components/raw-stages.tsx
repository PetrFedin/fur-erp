import { STAGE_NAME, STAGE_STATUS_CLASS, STAGE_STATUS_LABEL, ruShort, sortStages, stageDuration, summarizeStages, summaryChip, summaryLine, todayDay, type StageStatusKey } from "@/lib/raw-stage";
import { AddStage, CopyChain, StageControls, type StageEdit } from "@/app/(app)/supplier/raw/stage-controls";

export type StageRow = {
  id: string; stage: string; status: string; place: string | null; lotNumber: string | null; qty: number | null; note: string | null;
  plannedStart: Date | null; plannedEnd: Date | null; factStart: Date | null; factEnd: Date | null;
};

const ymd = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
const range = (a: Date | null, b: Date | null) => (a || b ? `${a ? ruShort(a) : "…"} — ${b ? ruShort(b) : "…"}` : "");
const toEdit = (s: StageRow): StageEdit => ({
  id: s.id, stage: s.stage, status: s.status, place: s.place ?? "", lotNumber: s.lotNumber ?? "", qty: s.qty == null ? "" : String(s.qty), note: s.note ?? "",
  plannedStart: ymd(s.plannedStart), plannedEnd: ymd(s.plannedEnd), factStart: ymd(s.factStart), factEnd: ymd(s.factEnd),
});

/** Строка «Сейчас: …» (текущий этап и когда ждать) — цветом: просрочено красным. */
export function RawNow({ stages, className }: { stages: StageRow[]; className?: string }) {
  const sum = summarizeStages(stages);
  if (!sum) return null;
  return (
    <p className={`rounded-md border px-3 py-2 text-sm ${sum.overdue ? "border-red-300 bg-red-50 text-red-900" : "border-blue-200 bg-blue-50 text-blue-900"} ${className ?? ""}`}>
      <b>Сейчас:</b> {summaryLine(sum)}
    </p>
  );
}

/** Чип этапа для списков: «Выделка · ждём к 20.10». null — этапов нет. */
export function RawChip({ stages }: { stages: Pick<StageRow, "stage" | "status" | "place" | "plannedStart" | "plannedEnd" | "factStart" | "factEnd">[] }) {
  const sum = summarizeStages(stages);
  if (!sum) return null;
  const cls = sum.overdue ? "bg-red-100 text-red-800" : sum.state === "done" ? "bg-green-100 text-green-800" : "bg-blue-100 text-blue-800";
  return <span title={summaryLine(sum)} className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs ${cls}`}>{summaryChip(sum)}</span>;
}

/**
 * Блок «Где сырьё»: текущий этап и лента этапов. editable — Веллмех (кнопки и формы), иначе только чтение (у нас).
 * author — кто внёс (подпись у нас: «внёс: Веллмех»).
 */
export function RawStagesBlock({ stages, purchaseId, lots = [], editable = false, author }: { stages: StageRow[]; purchaseId: string; lots?: string[]; editable?: boolean; author?: string }) {
  const sorted = sortStages(stages);
  const today = todayDay();
  return (
    <section className="flex flex-col gap-2 rounded-md border border-neutral-300 bg-white p-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-semibold">Где сырьё</h2>
        {author && <span className="text-xs text-neutral-500">внёс: {author}</span>}
        {editable && <span className="ml-auto flex flex-wrap items-center gap-2">{stages.length === 0 && <CopyChain purchaseId={purchaseId} />}<AddStage purchaseId={purchaseId} lots={lots} /></span>}
      </div>
      <RawNow stages={stages} />
      {sorted.length === 0 ? (
        <p className="rounded-md border border-dashed border-neutral-300 p-4 text-center text-sm text-neutral-500">
          {editable ? "Этапов пока нет. Нажмите «+ Этап» и добавьте, например, «Куплено на аукционе», затем «Выделка» с местом и датами — мы увидим, где сырьё и когда его ждать." : "Веллмех пока не отметил, где сырьё."}
        </p>
      ) : (
        <ol className="flex flex-col gap-1.5">
          {sorted.map((s) => {
            const dur = stageDuration(s, today);
            const plan = range(s.plannedStart, s.plannedEnd);
            const fact = range(s.factStart, s.factEnd);
            return (
              <li key={s.id} className="flex flex-col gap-1 rounded-md border border-neutral-200 px-3 py-2 text-sm">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <b>{STAGE_NAME[s.stage] ?? s.stage}</b>
                  {s.place && <span>{s.place}</span>}
                  {s.lotNumber && <span className="text-neutral-600">лот {s.lotNumber}</span>}
                  <span className={`rounded-full px-2 py-0.5 text-xs ${STAGE_STATUS_CLASS[s.status as StageStatusKey] ?? ""}`}>{STAGE_STATUS_LABEL[s.status as StageStatusKey] ?? s.status}</span>
                  {plan && <span className="text-neutral-600">план: {plan}</span>}
                  {fact && <span>факт: {fact}</span>}
                  {s.qty != null && <span>{s.qty} шкур</span>}
                  {dur && <span className="text-neutral-500">{dur}</span>}
                </div>
                {s.note && <p className="text-neutral-600">{s.note}</p>}
                {editable && <StageControls purchaseId={purchaseId} lots={lots} s={toEdit(s)} />}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
