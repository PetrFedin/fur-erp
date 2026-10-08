"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { actionClass } from "@/components/auth/styles";

// Ошибка внутри приложения: боковое меню и верхняя панель остаются на месте, меняется только содержимое.
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Фокус на заголовок: скринридер сразу читает, что случилось, а клавиатура начинает с кнопок.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-24 text-center">
      <h1 ref={headingRef} tabIndex={-1} className="text-xl font-semibold text-neutral-900 outline-none">
        Что-то пошло не так
      </h1>
      <p className="max-w-md text-sm text-neutral-600">
        Не удалось открыть страницу. Попробуйте ещё раз; если ошибка повторяется — вернитесь на главную.
      </p>
      <div className="flex flex-col gap-3 sm:flex-row">
        <button type="button" onClick={() => reset()} className={actionClass()}>
          Повторить
        </button>
        <Link href="/" className={actionClass("outline")}>
          На главную
        </Link>
      </div>
      {error.digest ? (
        <p className="text-sm text-neutral-600">Если ошибка повторяется, сообщите код: {error.digest}</p>
      ) : null}
    </div>
  );
}
