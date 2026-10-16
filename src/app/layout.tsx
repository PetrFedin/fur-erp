import type { Metadata } from "next";
import "@fontsource-variable/inter";
import "@fontsource-variable/manrope";
import "@fontsource-variable/geist-mono";
import { cookies } from "next/headers";
import { THEME_COOKIE, parseTheme } from "@/lib/ui-theme";
import "./globals.css";
import "./theme-customer.css";
import "./fonts.css";
import { DevAgentation } from "@/components/dev-agentation";

// Шрифты лежат в проекте (пакеты @fontsource-variable: Inter с кириллицей, Manrope для темы «Привычный стиль», Geist Mono),
// поэтому сборка и работа не зависят от сети и от fonts.gstatic.com. Имена переменных — как раньше (--font-inter, --font-theme, --font-geist-mono) в fonts.css.

export const metadata: Metadata = {
  title: { default: "THE FUR", template: "%s — THE FUR" },
  description: "Закупки, сырьё и себестоимость",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html
      lang="ru"
      data-theme={theme}
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col bg-neutral-50 text-neutral-900">
        {children}
        {process.env.NODE_ENV === "development" && <DevAgentation />}
      </body>
    </html>
  );
}
