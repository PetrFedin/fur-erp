// Мгновенная оболочка на время загрузки страницы: меню и шапка видны сразу, а тяжёлый расчёт дорисовывается потоком.
export default function Loading() {
  return (
    <p role="status" aria-live="polite" className="p-4 text-sm text-neutral-600">
      Загрузка…
    </p>
  );
}
