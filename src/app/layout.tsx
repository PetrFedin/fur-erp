import type { Metadata } from "next";
import { Inter, Geist_Mono, Manrope } from "next/font/google";
import { cookies } from "next/headers";
import { THEME_COOKIE, parseTheme } from "@/lib/ui-theme";
import "./globals.css";
import "./theme-customer.css";
import { DevAgentation } from "@/components/dev-agentation";

// Основной шрифт — Inter с кириллицей (Geist без кириллицы, русский текст уходил на запасной шрифт).
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin", "cyrillic"],
  display: "swap",
});

// Шрифт темы «Привычный стиль» (округлый гротеск, ближе всего к оформлению заказчика); применяется только внутри темы.
const manrope = Manrope({ variable: "--font-theme", subsets: ["latin", "cyrillic"], display: "swap" });

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "MVST FUR PRODUCTION", template: "%s — MVST FUR PRODUCTION" },
  description: "Закупки, склад и себестоимость",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html
      lang="ru"
      data-theme={theme}
      className={`${inter.variable} ${geistMono.variable} ${manrope.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-neutral-50 text-neutral-900">
        {children}
        {process.env.NODE_ENV === "development" && <DevAgentation />}
      </body>
    </html>
  );
}
