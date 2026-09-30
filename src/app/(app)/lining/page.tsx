import { redirect } from "next/navigation";

// Подкладка переехала на вкладку раздела «Сырьё»; старый адрес остаётся рабочим.
export default function LiningPage() {
  redirect("/lots?tab=lining");
}
