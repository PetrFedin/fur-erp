import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { VerifyControl, type VerifyView } from "@/components/verify-control";
import { InfoHint } from "@/components/info-hint";
import { canVerify } from "@/lib/verify-access";
import { loadVerifyModel, loadVerifyRow, type Blocker, type VerifyKind, type VerifyRow } from "@/lib/verification";
import { shortAuctionName } from "@/lib/auction-names";

const HINT: Record<VerifyKind, string> = {
  payment: "Платёж подтверждён, если есть документ-основание (файл платёжки либо п/п с номером или письмо «оплачено» с датой), он привязан к закупке или аукциону и сумма с датой заданы.",
  prodPayment: "Оплата подтверждена, если есть документ-основание (файл платёжки либо п/п или письмо «оплачено» с датой) и она привязана к ТЗ или партии.",
  purchase: "Закупка подтверждена, если все обязательные документы приложены, сумма в базе равна УПД/счёту (±1 ₽), лоты и количество сошлись, оплата завершена и у каждой оплаты есть платёжка. Подтвердить можно и вопреки замечаниям — только с примечанием.",
  order: "ТЗ подтверждено, если приложение ТЗ загружено, дата настоящая (не шаблонная), заданы партия, заказчик, количество, цена работы и состав материалов, а количество и работа совпали с приложением. Правка суммы, даты или документа снимает подтверждение.",
  batch: "Партия подтверждена, если подтверждены все её ТЗ, есть расчёт и счёт, а оплата за работу сопоставлена (оплачено, у каждой оплаты есть платёжка или п/п).",
};

/** Блок «Подтверждено ✓ / Ждёт ручной проверки» для карточки (закупка, ТЗ, партия). */
export async function VerifyBlock({ kind, id, title = "Подтверждение" }: { kind: VerifyKind; id: string; title?: string }) {
  const session = await requireSession();
  const row = await loadVerifyRow(prisma, session.user.organizationId, kind, id, { userId: session.user.id as string, canUpload: true, canMark: true });
  if (!row) return null;
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-neutral-200 bg-white p-3 sm:p-4" data-verify-block={`${kind}:${id}`}>
      <h3 className="flex items-center gap-2 text-base font-semibold">
        {title}
        <InfoHint wide label="Что значит «подтверждено»">
          <p>{HINT[kind]}</p>
          <p className="mt-2">Любая правка суммы, документа или даты после подтверждения сбрасывает его — проверьте и подтвердите снова. Очередь всех строк — «Ждёт проверки».</p>
        </InfoHint>
      </h3>
      <VerifyControl v={row} canEdit={canVerify(session.user.role, kind)} />
    </section>
  );
}

const view = (r: VerifyRow): VerifyView => r;

/** Подтверждение аукциона: по каждому названию — «подтверждено N из M закупок» и кнопка «подтвердить все». */
export async function AuctionVerify({ organizationId, names }: { organizationId: string; names: string[] }) {
  const session = await requireSession();
  const model = await loadVerifyModel(prisma, organizationId, { userId: session.user.id as string, kinds: ["purchase"], canUpload: true, canMark: true });
  const canEdit = canVerify(session.user.role, "purchase");
  const blocks = names
    .map((name) => ({ name, rows: model.rows.filter((r) => r.group === name) }))
    .filter((b) => b.rows.length > 0);
  if (blocks.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {blocks.map(({ name, rows }) => {
        const waiting = rows.filter((r) => !r.verified);
        const seen = new Set<string>();
        const blockers: Blocker[] = [];
        for (const r of waiting) for (const b of r.blockers) if (!seen.has(b.text)) {
            seen.add(b.text);
            blockers.push(b);
          }
        const allDone = waiting.length === 0;
        const first = rows[0];
        const v: VerifyView = {
          ...view(first),
          verified: allDone,
          auto: allDone && rows.every((r) => r.auto),
          stampText: allDone ? (rows.every((r) => r.auto) ? "авто по документам" : first.stampText) : null,
          note: null,
          ready: waiting.every((r) => r.ready),
          blockers,
        };
        return (
          <section key={name} className="flex flex-col gap-2 rounded-lg border border-neutral-200 bg-white p-3 sm:p-4" data-verify-block={`auction:${name}`}>
            <h3 className="flex flex-wrap items-center gap-2 text-base font-semibold">
              Подтверждение · {shortAuctionName(name, 60)}
              <span className="text-sm font-normal text-neutral-500">закупок подтверждено: {rows.length - waiting.length} из {rows.length}</span>
              <InfoHint wide label="Что значит «подтверждено»">
                <p>{HINT.purchase}</p>
                <p className="mt-2">Кнопка действует на все закупки аукциона сразу; закупки с замечаниями подтверждаются только с примечанием.</p>
              </InfoHint>
            </h3>
            <VerifyControl v={v} canEdit={canEdit} purchaseIds={rows.map((r) => r.id)} />
          </section>
        );
      })}
    </div>
  );
}

/** Подтверждение оплат для панели «Документы и оплата»: по id оплаты — статус и блокеры. */
export async function loadPaymentVerify(kind: "payment" | "prodPayment"): Promise<{ verify: Record<string, VerifyView>; canVerify: boolean }> {
  const session = await requireSession();
  const model = await loadVerifyModel(prisma, session.user.organizationId, { userId: session.user.id as string, kinds: [kind] });
  const verify: Record<string, VerifyView> = {};
  for (const r of model.rows) verify[r.id] = view(r);
  return { verify, canVerify: canVerify(session.user.role, kind) };
}
