import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { ACCESS, hasRole } from "@/lib/access";
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

  const canEdit = hasRole(session.user.role, ACCESS.clients);

  return (
    <div className="flex max-w-2xl flex-col gap-3">
      <div className="text-sm"><Link href="/clients" className="text-neutral-500 hover:underline">← Заказчики</Link></div>
      <Card>
        <CardHeader>
          <CardTitle>Редактировать заказчика</CardTitle>
        </CardHeader>
        <CardContent>
          {!canEdit && <p className="mb-3 text-sm text-neutral-500">Только просмотр: редактировать заказчиков могут владелец, администратор и технолог.</p>}
          <fieldset disabled={!canEdit} className="min-w-0 border-0 p-0">
            <ClientForm action={updateClient.bind(null, id)} client={client} />
          </fieldset>
        </CardContent>
      </Card>
    </div>
  );
}
