/** Размер в МБ с двумя знаками, округлённый вверх (чтобы «больше 25 МБ» не выглядело как «25,00 МБ»). Одинаково на клиенте и сервере. */
export function formatMb(bytes: number): string {
  return (Math.ceil((bytes / 1024 / 1024) * 100) / 100).toFixed(2).replace(".", ",");
}
