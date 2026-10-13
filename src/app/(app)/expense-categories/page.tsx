import { redirect } from "next/navigation";

// Статьи расходов переехали в «Настройки»; старый адрес остаётся рабочим.
export default function ExpenseCategoriesRedirect() {
  redirect("/settings/expense-categories");
}
