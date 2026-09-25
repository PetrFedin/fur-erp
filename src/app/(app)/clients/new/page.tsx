import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ClientForm } from "../client-form";
import { createClient } from "../actions";

export default function NewClientPage() {
  return (
    <div className="max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>Новый заказчик</CardTitle>
        </CardHeader>
        <CardContent>
          <ClientForm action={createClient} />
        </CardContent>
      </Card>
    </div>
  );
}
