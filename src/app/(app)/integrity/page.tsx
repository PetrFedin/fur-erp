import { redirect } from "next/navigation";

/** «Проверка данных» теперь раздел страницы «Сверка». Старый адрес оставлен для закладок и ссылок. */
export default function IntegrityRedirect(): never {
  redirect("/reconciliation#integrity");
}
