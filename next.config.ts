import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

// CSP: Next.js вставляет inline-скрипты гидратации и Tailwind/React — inline-стили, поэтому 'unsafe-inline'
// (без nonce, иначе страницы нельзя кэшировать и сборка усложняется). Всё остальное — только свой домен:
// чужие скрипты, фреймы, формы и <object> закрыты, подмена <base> невозможна, встраивание нашего сайта в чужой запрещено.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProd ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'self' blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
  { key: "Content-Security-Policy", value: csp },
  // HSTS только в боевом режиме (на http://localhost он бесполезен и мешает). Браузер запоминает «только HTTPS» на год.
  ...(isProd ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }] : []),
];

// Файлы документов показываются в окне предпросмотра (iframe) нашего же сайта — для них frame-ancestors 'self'.
const docFrameHeaders = securityHeaders.map((h) =>
  h.key === "X-Frame-Options"
    ? { ...h, value: "SAMEORIGIN" }
    : h.key === "Content-Security-Policy"
      ? { ...h, value: "frame-ancestors 'self'" }
      : h,
);

const nextConfig: NextConfig = {
  output: "standalone",
  // Второй dev-сервер (проверка на тестовой копии базы): NEXT_DIST_DIR=.next-test next dev -p 3204.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Демо-сборка (DEMO_BUILD=true) заменяет вшитые JSON пустыми заготовками (scripts/demo-static-data.mjs): типы пустых списков не сходятся.
  // Обычная сборка проверяет типы как всегда.
  typescript: { ignoreBuildErrors: process.env.DEMO_BUILD === "true" },
  poweredByHeader: false, // не раскрываем «X-Powered-By: Next.js»
  // Загрузка документов закупки (до 25 МБ на файл + служебные байты multipart).
  experimental: {
    serverActions: { bodySizeLimit: "26mb" },
  },
  turbopack: {
    root: process.cwd(),
  },
  // Старые адреса переезжают мгновенно, на уровне сервера: без загрузки страницы и без экрана «Загрузка…». Параметры запроса сохраняются.
  async redirects() {
    return [
      { source: "/lining", destination: "/lots?tab=lining", permanent: false },
      { source: "/integrity", destination: "/reconciliation#integrity", permanent: false },
    ];
  },
  async headers() {
    return [
      { source: "/((?!api/drive-docs/|api/purchase-docs/).*)", headers: securityHeaders },
      // Всё, что зависит от входа, не кэшируется ни браузером, ни промежуточными прокси (статика /_next/static — как раньше).
      { source: "/((?!_next/static|_next/image|favicon.ico).*)", headers: [{ key: "Cache-Control", value: "private, no-store, max-age=0" }] },
      { source: "/api/drive-docs/:path*", headers: docFrameHeaders },
      { source: "/api/purchase-docs/:path*", headers: docFrameHeaders },
    ];
  },
};

export default nextConfig;
