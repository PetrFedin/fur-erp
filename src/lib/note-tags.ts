/**
 * Служебные теги в заметках вида [fix:P07] (метки загрузки данных) в интерфейсе не показываем:
 * они остаются в базе и в форме редактирования, но в тексте для чтения вырезаются.
 */
const TAG_RE = /\s*\[fix:[^\]]*\]/gi;

export function stripServiceTags(s: string): string {
  return s.replace(TAG_RE, "").replace(/\s{2,}/g, " ").replace(/^[\s,;·]+|[\s,;·]+$/g, "").trim();
}

/** Заметка для показа: без служебных тегов; пусто → null. */
export function cleanNote(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = stripServiceTags(s);
  return t || null;
}
