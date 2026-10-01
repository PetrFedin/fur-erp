"use client";

// Последний рубеж: ошибка в самом корневом layout. Свои <html>/<body> обязательны.
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="ru">
      <body style={{ fontFamily: "system-ui, sans-serif", textAlign: "center", padding: "6rem 1rem" }}>
        <h1 style={{ fontSize: "1.25rem" }}>Что-то пошло не так</h1>
        <p style={{ color: "#737373" }}>Не удалось открыть страницу.</p>
        <button type="button" onClick={() => reset()} style={{ marginRight: 8 }}>
          Повторить
        </button>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/">На главную</a>
      </body>
    </html>
  );
}
