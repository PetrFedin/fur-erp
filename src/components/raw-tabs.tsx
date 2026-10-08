import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Вкладки раздела «Сырьё»: Закупки · Мех · Подкладка · Сводка по годам.
 * Это ссылки между страницами, а не переключатель панелей: активная помечена aria-current, фокус общий тёмный.
 */
export function RawTab({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={
        "inline-flex items-center rounded-md px-3 py-1.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900 max-md:min-h-10 " +
        (active ? "bg-neutral-900 text-white" : "text-neutral-700 hover:bg-neutral-100")
      }
    >
      {children}
    </Link>
  );
}

/** Ряд вкладок для страницы «Закупки» (на страницах сырья ряд собирается в lots/page.tsx — там вкладки переносят фильтры). */
export function PurchasesTabs() {
  return (
    <div role="navigation" aria-label="Разделы сырья" className="flex flex-wrap gap-1 border-b border-neutral-200 pb-2">
      <RawTab href="/purchases" active>
        Закупки
      </RawTab>
      <RawTab href="/lots" active={false}>
        Мех
      </RawTab>
      <RawTab href="/lots?tab=lining" active={false}>
        Подкладка
      </RawTab>
      <RawTab href="/lots?tab=summary" active={false}>
        Сводка по годам
      </RawTab>
    </div>
  );
}
