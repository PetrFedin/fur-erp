"use client";

import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-kit";
import { actionClass } from "@/components/auth/styles";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <AuthShell
      title="Что-то пошло не так"
      description="Не удалось открыть страницу. Попробуйте ещё раз; если ошибка повторяется — вернитесь на главную."
      footer={error.digest ? `Если ошибка повторяется, сообщите код: ${error.digest}` : undefined}
    >
      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <button type="button" onClick={() => reset()} className={actionClass()}>
          Повторить
        </button>
        <Link href="/" className={actionClass("outline")}>
          На главную
        </Link>
      </div>
    </AuthShell>
  );
}
