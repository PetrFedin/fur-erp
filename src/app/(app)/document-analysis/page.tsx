import { redirect } from "next/navigation";

/** «Анализ документов» влит в страницу «Документы» (раздел «Расхождения / документы для поиска»). Старый адрес оставлен для закладок и ссылок. */
export default function DocumentAnalysisRedirect(): never {
  redirect("/documents#analysis");
}
