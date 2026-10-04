import { TONE_DOT, type Tone } from "@/lib/doc-panel";
import { cn } from "@/lib/utils";

/**
 * Компактный индикатор «документы и оплата» для списков: цветная точка + «нет документов: 2» · «оплата 60%».
 * Красная точка — нет обязательных документов или не оплачено; жёлтая — оплата частичная или нет платёжки; зелёная — всё есть.
 */
export function DocsPayBadge({
  tone,
  missing,
  noDocs = false,
  payText,
  proofMissing = 0,
  className,
}: {
  tone: Tone;
  missing: number;
  noDocs?: boolean;
  payText: string;
  proofMissing?: number;
  className?: string;
}) {
  const docs = noDocs ? "нет документов совсем" : missing > 0 ? `нет документов: ${missing}` : "документы есть";
  const title = [docs, payText, proofMissing > 0 ? `платёжек нет: ${proofMissing}` : null].filter(Boolean).join(" · ");
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs", className)} title={title}>
      <span aria-hidden className={cn("inline-block size-2.5 shrink-0 rounded-full", TONE_DOT[tone])} />
      <span className={cn(missing > 0 || noDocs ? "font-semibold text-red-700" : "text-neutral-600")}>{docs}</span>
      <span className="text-neutral-400">·</span>
      <span className={tone === "bad" && !missing ? "font-semibold text-red-700" : "text-neutral-600"}>{payText}</span>
      {proofMissing > 0 && <span className="text-amber-700">· платёжек нет: {proofMissing}</span>}
    </span>
  );
}
