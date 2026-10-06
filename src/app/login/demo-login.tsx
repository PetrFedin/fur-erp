"use client";

function setValue(id: string, value: string) {
  const el = document.getElementById(id) as HTMLInputElement | null;
  if (!el) return;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

export function DemoLogin({ email, password }: { email: string; password: string }) {
  return (
    <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50/70 p-4 text-sm text-neutral-800">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="font-semibold text-neutral-900">Демо-доступ</div>
          <div className="mt-0.5 text-xs text-neutral-600">Используйте эти данные для входа в демонстрационную версию.</div>
        </div>
        <span className="shrink-0 rounded-full bg-amber-100 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-amber-800">DEMO</span>
      </div>

      <div className="grid grid-cols-[74px_1fr] gap-x-3 gap-y-2 rounded-lg bg-white/80 px-3 py-2.5">
        <span className="text-neutral-500">Логин</span>
        <span className="break-all font-mono font-medium select-all">{email}</span>
        <span className="text-neutral-500">Пароль</span>
        <span className="break-all font-mono font-medium select-all">{password}</span>
      </div>

      <button
        type="button"
        className="mt-3 w-full rounded-md border border-amber-300 bg-white px-3 py-2 text-xs font-semibold text-neutral-800 transition hover:bg-amber-100"
        onClick={() => {
          setValue("email", email);
          setValue("password", password);
        }}
      >
        Подставить логин и пароль
      </button>
    </div>
  );
}
