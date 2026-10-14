"use client";

import { Button } from "@/components/ui/button";

function setValue(id: string, value: string) {
  const el = document.getElementById(id) as HTMLInputElement | null;
  if (!el) return;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

// Демо-доступ: спокойная секция под формой, без отдельной карточки и цветной заливки.
export function DemoLogin({ email, password, title = "Демо-доступ", note = "Данные для входа в демонстрационную версию.", id = "demo" }: { email: string; password: string; title?: string; note?: string; id?: string }) {
  return (
    <section aria-labelledby={`${id}-title`} className="mt-8 border-t border-neutral-200 pt-6">
      <div className="flex items-center gap-2">
        <h2 id={`${id}-title`} className="text-sm font-semibold text-neutral-900">
          {title}
        </h2>
        <span className="rounded border border-neutral-300 px-1.5 py-0.5 text-xs font-medium tracking-wide text-neutral-700">
          DEMO
        </span>
      </div>
      <p className="mt-1 text-sm text-neutral-600">{note}</p>

      <dl className="mt-3 grid grid-cols-[4.5rem_1fr] gap-x-3 gap-y-1.5 text-sm">
        <dt className="text-neutral-600">Email</dt>
        <dd className="break-all font-mono text-neutral-900 select-all">{email}</dd>
        <dt className="text-neutral-600">Пароль</dt>
        <dd className="break-all font-mono text-neutral-900 select-all">{password}</dd>
      </dl>

      <Button
        type="button"
        variant="outline"
        className="mt-4 h-11 w-full border-neutral-500 text-sm focus-visible:ring-neutral-900 focus-visible:ring-offset-2"
        onClick={() => {
          setValue("email", email);
          setValue("password", password);
        }}
      >
        Подставить email и пароль
      </Button>
    </section>
  );
}
