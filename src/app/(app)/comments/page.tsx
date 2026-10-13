import { redirect } from "next/navigation";

/** Отдельной вкладки «Комментарии» больше нет: виджет комментариев остаётся на каждой странице, список — «История → Комментарии». */
export default function CommentsRedirect(): never {
  redirect("/history");
}
