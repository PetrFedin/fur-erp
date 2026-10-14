import { redirect } from "next/navigation";

// Старая форма «Новая отгрузка» заменена окном «+ Отгрузка» на списке.
export default function NewShipmentRedirect() {
  redirect("/shipments");
}
