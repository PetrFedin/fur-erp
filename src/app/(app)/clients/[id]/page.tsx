import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ClientForm } from "../client-form";
import { updateClient } from "../actions";

export default async function EditClientPage({ params }: PageProps<"/clients/[id]">) {
  const { id } = await params;
  const session = await requireSession();
  const client = await prisma.client.findFirst({
    where: { id, organizationId: session.user.organizationId },
  });
  if (!client) notFound();

  return (
    <div className="max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>Редактировать заказчика</CardTitle>
        </CardHeader>
        <CardContent>
          <ClientForm action={updateClient.bind(null, id)} client={client} />
        </CardContent>
      </Card>
    </div>
  );
}
