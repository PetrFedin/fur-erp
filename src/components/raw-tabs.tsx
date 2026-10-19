import Link from "next/link";
import type { ReactNode } from "react";
import { TABS_NAV, tabCls } from "@/components/section-tabs";

/**
 * Вкладки раздела «Сырьё»: Закупки · Мех · Подкладка · Сводка по годам.
 * Это ссылки между страницами, а не переключатель панелей: активная помечена aria-current, фокус общий тёмный.
 */
export function RawTab({ href, active, children, muted }: { href: string; active: boolean; children: ReactNode; /** Второстепенная вкладка в конце ряда («Сводка по годам»): мельче и справа. */ muted?: boolean }) {
  return (
    <Link href={href} aria-current={active ? "page" : undefined} className={tabCls(active, muted)}>
      {children}
    </Link>
  );
}

/** Ряд вкладок для страницы «Закупки» (на страницах сырья ряд собирается в lots/page.tsx — там вкладки переносят фильтры). */
export function PurchasesTabs() {
  return (
    <div role="navigation" aria-label="Разделы сырья" className={TABS_NAV}>
      <RawTab href="/purchases" active>
        Закупки
      </RawTab>
      <RawTab href="/lots" active={false}>
        Мех
      </RawTab>
      <RawTab href="/lots?tab=lining" active={false}>
        Подкладка
      </RawTab>
      <RawTab href="/lots?tab=summary" active={false} muted>
        Сводка по годам
      </RawTab>
    </div>
  );
}
