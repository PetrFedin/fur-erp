import { Breadcrumbs } from "@/components/breadcrumbs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ClientForm } from "../client-form";
import { createClient } from "../actions";

export default function NewClientPage() {
  return (
    <div className="flex flex-col gap-3">
      <Breadcrumbs items={[{ label: "Настройки", href: "/settings" }, { label: "Заказчики", href: "/clients" }, { label: "Новый заказчик" }]} />
      <Card>
        <CardHeader>
          <CardTitle as="h1" className="text-xl">Новый заказчик</CardTitle>
        </CardHeader>
        <CardContent>
          <ClientForm action={createClient} />
        </CardContent>
      </Card>
    </div>
  );
}
