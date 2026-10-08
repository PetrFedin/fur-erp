"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";

export function PhotoGallery({
  photos,
  canEdit,
  onDelete,
}: {
  photos: { id: string; name: string }[];
  canEdit: boolean;
  onDelete: (photoId: string) => Promise<void>;
}) {
  const [pending, startTransition] = useTransition();
  if (photos.length === 0) return <p className="text-sm text-neutral-500">Фото пока нет</p>;
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {photos.map((p) => (
        <li key={p.id} className="flex flex-col gap-1">
          <a href={`/api/fittings/photo/${p.id}`} target="_blank" rel="noopener noreferrer" title="Открыть в новой вкладке">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/fittings/photo/${p.id}`}
              alt={p.name}
              loading="lazy"
              className="aspect-[4/3] w-full rounded-md border border-neutral-200 bg-neutral-50 object-cover"
            />
          </a>
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-xs text-neutral-500" title={p.name}>
              {p.name}
            </span>
            {canEdit && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => {
                  if (!confirm(`Удалить фото «${p.name}»? Файл будет удалён без возможности восстановления.`)) return;
                  startTransition(() => onDelete(p.id));
                }}
              >
                Удалить
              </Button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
