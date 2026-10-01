import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  // Только запрет встраивания: полноценный CSP сломал бы inline-скрипты Next.
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
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
  poweredByHeader: false,
  // Загрузка документов закупки (до 25 МБ на файл + служебные байты multipart).
  experimental: {
    serverActions: { bodySizeLimit: "26mb" },
  },
  turbopack: {
    root: process.cwd(),
  },
  async headers() {
    return [
      { source: "/((?!api/drive-docs/|api/purchase-docs/).*)", headers: securityHeaders },
      { source: "/api/drive-docs/:path*", headers: docFrameHeaders },
      { source: "/api/purchase-docs/:path*", headers: docFrameHeaders },
    ];
  },
};

export default nextConfig;
