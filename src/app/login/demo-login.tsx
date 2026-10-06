"use client";

import { useState } from "react";

function setValue(id: string, value: string) {
  const el = document.getElementById(id) as HTMLInputElement | null;
  if (!el) return;
  // React-контролируемые поля: через нативный setter + событие input
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

export function DemoLogin({ email, password }: { email: string; password: string }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="mx-auto -mt-[30vh] mb-10 w-full max-w-md px-4 text-sm">
      <div className="rounded-lg border border-dashed border-neutral-300 bg-neutral-50 p-3 text-neutral-700">
        <div className="mb-1 font-medium">Демо-доступ для тестирования</div>
        <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
          <span className="text-neutral-500">Логин</span>
          <span className="font-mono select-all">{email}</span>
          <span className="text-neutral-500">Пароль</span>
          <span className="font-mono select-all">{shown ? password : "••••••••••"}</span>
        </div>
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            className="rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-xs font-medium hover:bg-neutral-100"
            onClick={() => {
              setValue("email", email);
              setValue("password", password);
            }}
          >
            Подставить в форму
          </button>
          <button
            type="button"
            className="rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-xs hover:bg-neutral-100"
            onClick={() => setShown((v) => !v)}
          >
            {shown ? "Скрыть пароль" : "Показать пароль"}
          </button>
        </div>
      </div>
    </div>
  );
}
