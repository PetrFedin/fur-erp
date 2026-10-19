import { redirect } from "next/navigation";

// Раздела «Аналитика» как отдельной страницы нет: вкладки (Сырьё, Изделия, Цены, Маржа) живут по своим адресам. Голый /analytics раньше отдавал 404.
export default function AnalyticsIndex() {
  redirect("/analytics/raw");
}
