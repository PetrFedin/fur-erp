import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-kit";
import { actionClass } from "@/components/auth/styles";

export const metadata = { title: "Страница не найдена" };

export default function NotFound() {
  return (
    <AuthShell
      title="Страница не найдена"
      description="Такой страницы нет или запись была удалена. Проверьте адрес или вернитесь на главную."
      footer="Код ошибки: 404"
    >
      <div className="mt-6">
        <Link href="/" className={`w-full sm:w-auto ${actionClass()}`}>
          На главную
        </Link>
      </div>
    </AuthShell>
  );
}
