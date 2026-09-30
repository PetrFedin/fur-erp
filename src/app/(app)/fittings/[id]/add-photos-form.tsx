"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { PhotoPicker, validatePicked } from "../photo-picker";

export function AddPhotosForm({ fittingId }: { fittingId: string }) {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function upload() {
    setError(null);
    if (files.length === 0) return setError("Выберите хотя бы одно фото");
    const pickErr = validatePicked(files);
    if (pickErr) return setError(pickErr);
    const fd = new FormData();
    for (const f of files) fd.append("photos", f);
    setPending(true);
    try {
      const res = await fetch(`/api/fittings/${fittingId}/photos`, { method: "POST", body: fd });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? `Не удалось загрузить (ошибка ${res.status})`);
      } else {
        setFiles([]);
        router.refresh();
      }
    } catch {
      setError("Нет связи с сервером — фото не загружены");
    }
    setPending(false);
  }

  return (
    <div className="flex flex-col gap-2 border-t border-neutral-200 pt-3">
      <p className="text-sm font-medium">Добавить фото</p>
      <PhotoPicker files={files} onChange={setFiles} />
      {error && <p className="text-sm text-red-600">{error}</p>}
      {files.length > 0 && (
        <div>
          <Button type="button" size="sm" onClick={upload} disabled={pending}>
            {pending ? "Загружаем…" : `Загрузить (${files.length})`}
          </Button>
        </div>
      )}
    </div>
  );
}
