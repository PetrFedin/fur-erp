/** Миниатюры фото примерки (до 3) — общий вид для ленты, карточки ТЗ и модели. */
export function FittingThumbs({ photoIds, total }: { photoIds: string[]; total: number }) {
  if (total === 0) return <span className="text-xs text-neutral-400">нет фото</span>;
  const shown = photoIds.slice(0, 3);
  return (
    <span className="inline-flex items-center gap-1">
      {shown.map((id) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={id}
          src={`/api/fittings/photo/${id}`}
          alt="Фото примерки"
          loading="lazy"
          className="h-10 w-10 rounded border border-neutral-200 bg-neutral-50 object-cover"
        />
      ))}
      {total > shown.length && <span className="text-xs text-neutral-500">+{total - shown.length}</span>}
    </span>
  );
}
