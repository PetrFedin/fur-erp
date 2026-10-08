import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ClientForm } from "../client-form";
import { createClient } from "../actions";

export default function NewClientPage() {
  return (
    <div className="flex flex-col gap-3">
      <div className="text-sm"><Link href="/clients" className="text-neutral-500 hover:underline">← Заказчики</Link></div>
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
