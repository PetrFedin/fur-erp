import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export const metadata = { title: "Страница не найдена" };

export default function NotFound() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-24 text-center">
      <p className="text-5xl font-semibold text-neutral-300">404</p>
      <h1 className="text-xl font-semibold">Страница не найдена</h1>
      <p className="max-w-md text-sm text-neutral-500">
        Такой страницы нет или запись была удалена. Проверьте адрес или вернитесь на главную.
      </p>
      <Link href="/" className={buttonVariants()}>
        На главную
      </Link>
    </div>
  );
}
