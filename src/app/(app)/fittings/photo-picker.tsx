"use client";

import { useEffect, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";

export const MAX_FILES = 10;
export const MAX_BYTES = 10 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 50 * 1024 * 1024;

/** Размер файла для сообщений: с двумя знаками в МБ (чтобы 10,004 МБ не выглядело как «10.0»). */
export function formatMb(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(2)} МБ`;
}

/** Проверка выбранных файлов на клиенте (сервер проверяет всё заново). */
export function validatePicked(files: File[]): string | null {
  if (files.length > MAX_FILES) return `Можно выбрать не больше ${MAX_FILES} фото за раз (выбрано ${files.length})`;
  for (const f of files) {
    const heic = /\.(heic|heif)$/i.test(f.name);
    if (!f.type.startsWith("image/") && !heic) return `Файл «${f.name}» не является фото`;
    if (f.size === 0) return `Файл «${f.name}» пустой (0 байт) — уберите его и выберите заново`;
    if (f.size > MAX_BYTES) return `Файл «${f.name}» больше 10 МБ (${formatMb(f.size)})`;
  }
  const total = files.reduce((a, f) => a + f.size, 0);
  if (total > MAX_TOTAL_BYTES) return `Общий размер фото больше 50 МБ (${formatMb(total)}) — уберите часть файлов`;
  return null;
}

/**
 * Выбор фото: можно добавлять по одному (камера телефона) или пачкой из
 * галереи; ниже — превью выбранного и кнопка «убрать» у каждого.
 */
export function PhotoPicker({ files, onChange }: { files: File[]; onChange: (files: File[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const urls = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={input}
        type="file"
        multiple
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const picked = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (picked.length) onChange([...files, ...picked]);
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => input.current?.click()}>
          {files.length ? "Добавить ещё фото" : "Выбрать фото или снять"}
        </Button>
        <span className="text-xs text-neutral-500">До {MAX_FILES} фото за раз, каждое до 10 МБ: JPEG, PNG, WebP, HEIC</span>
      </div>
      {files.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={urls[i]} alt={f.name} className="h-24 w-24 rounded-md border border-neutral-200 bg-neutral-50 object-cover" />
              <button
                type="button"
                aria-label={`Убрать ${f.name}`}
                onClick={() => onChange(files.filter((_, j) => j !== i))}
                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-neutral-900 text-xs text-white"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
