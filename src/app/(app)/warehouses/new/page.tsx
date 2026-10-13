import { redirect } from "next/navigation";

// Создание теперь в окне поверх списка; старый адрес открывает его.
export default function NewRedirect() {
  redirect("/warehouses?new=1");
}
