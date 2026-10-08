"use client";

// Последний рубеж: ошибка в самом корневом layout. Свои <html>/<body> обязательны; стили Tailwind здесь
// не подключены, поэтому всё задано прямо в разметке. Внешний вид совпадает со служебными страницами.
const button = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: 44,
  padding: "0 20px",
  borderRadius: 6,
  fontSize: 16,
  fontWeight: 500,
  fontFamily: "inherit",
  cursor: "pointer",
  textDecoration: "none",
  boxSizing: "border-box",
} as const;

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="ru">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          background: "#fafafa",
          color: "#171717",
          fontFamily: "system-ui, -apple-system, Arial, sans-serif",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "40px 16px",
          boxSizing: "border-box",
        }}
      >
        <main style={{ width: "100%", maxWidth: 448 }}>
          <p style={{ margin: "0 0 24px", fontSize: 14, fontWeight: 600, letterSpacing: "0.18em" }}>
            MVST FUR PRODUCTION
          </p>
          <div
            style={{
              background: "#fff",
              border: "1px solid #e5e5e5",
              borderRadius: 8,
              padding: 32,
              boxShadow: "0 1px 2px rgba(0,0,0,0.06)",
            }}
          >
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600, letterSpacing: "-0.01em" }}>
              Что-то пошло не так
            </h1>
            <p style={{ margin: "4px 0 0", fontSize: 14, color: "#525252" }}>
              Не удалось открыть страницу. Попробуйте ещё раз; если ошибка повторяется — вернитесь на главную.
            </p>
            <div style={{ marginTop: 24, display: "flex", flexWrap: "wrap", gap: 12 }}>
              <button
                type="button"
                onClick={() => reset()}
                style={{ ...button, background: "#171717", color: "#fff", border: "1px solid #171717" }}
              >
                Повторить
              </button>
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a href="/" style={{ ...button, background: "#fff", color: "#171717", border: "1px solid #737373" }}>
                На главную
              </a>
            </div>
          </div>
          {error.digest ? (
            <p style={{ marginTop: 16, textAlign: "center", fontSize: 14, color: "#525252" }}>
              Если ошибка повторяется, сообщите код: {error.digest}
            </p>
          ) : null}
        </main>
      </body>
    </html>
  );
}
