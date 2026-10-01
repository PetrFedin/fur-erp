"use client";

import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-24 text-center">
      <h1 className="text-xl font-semibold">Что-то пошло не так</h1>
      <p className="max-w-md text-sm text-neutral-500">
        Не удалось открыть страницу. Попробуйте ещё раз; если ошибка повторяется — вернитесь на главную.
      </p>
      <div className="flex gap-2">
        <button type="button" onClick={() => reset()} className={buttonVariants({ variant: "outline" })}>
          Повторить
        </button>
        <Link href="/" className={buttonVariants()}>
          На главную
        </Link>
      </div>
    </div>
  );
}
