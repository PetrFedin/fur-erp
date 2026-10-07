import { articleHint, articleTitle, type ArticleLike } from "@/lib/article-label";

/**
 * Артикул в списках и карточках: «M012 · Пальто» (код + название из справочника артикулов), подсказка — код и название в продажах.
 * compact — только код. Работает и на сервере, и в клиентских компонентах.
 */
export function ArticleName({ model, compact = false, className }: { model: ArticleLike | null | undefined; compact?: boolean; className?: string }) {
  if (!model) return <>—</>;
  const t = compact ? "" : articleTitle(model);
  return (
    <span className={className} title={articleHint(model)}>
      {model.name}
      {t && t.toLowerCase() !== model.name.toLowerCase() ? <span className="font-normal text-neutral-500"> · {t}</span> : null}
    </span>
  );
}
