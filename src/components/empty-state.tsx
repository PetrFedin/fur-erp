import Link from "next/link";

/**
 * Единое пустое состояние: короткая фраза и, если есть что сделать, одно действие. Без картинок и длинных объяснений.
 * Для пустой ячейки таблицы/плитки используйте «—» (<Dash />), а не этот блок.
 */
export function EmptyState({ children, action }: { children: React.ReactNode; action?: { href: string; label: string } }) {
  return (
    <div className="rounded-lg border border-dashed border-neutral-300 bg-white px-4 py-6 text-center text-sm text-neutral-500">
      <p>{children}</p>
      {action ? (
        <Link href={action.href} className="mt-2 inline-flex min-h-11 items-center text-blue-700 hover:underline">
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}
