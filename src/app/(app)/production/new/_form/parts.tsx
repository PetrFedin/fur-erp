"use client";
import type { ReactNode } from "react";
import { Label } from "@/components/ui/input";
import { InfoHint } from "@/components/info-hint";
import { MoneyClient } from "@/components/money-client";

/** Сумма с НДС / без НДС через общий переключатель «С НДС / Без НДС» шапки. */
export function M({ incl, excl }: { incl: number; excl: number }) {
  return <MoneyClient incl={String(Math.round(incl * 100) / 100)} excl={String(Math.round(excl * 100) / 100)} />;
}

export function Step({ n, title, hint, children, id }: { n: number; title: string; hint?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section id={id} aria-label={title} className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-neutral-900 text-xs font-medium text-white">{n}</span>
        <h2 className="block-title">{title}</h2>
        {hint ? <InfoHint label={title} wide>{hint}</InfoHint> : null}
      </div>
      {children}
    </section>
  );
}

export function Field({ label, children, className, hint, link, htmlFor }: { label: string; children: ReactNode; className?: string; hint?: ReactNode; link?: ReactNode; htmlFor?: string }) {
  return (
    <div className={className}>
      <div className="mb-1 flex items-center gap-1 text-xs text-neutral-500">
        <Label htmlFor={htmlFor} className="mb-0 text-xs text-neutral-500">{label}</Label>
        {hint ? <InfoHint label={label}>{hint}</InfoHint> : null}
        {link}
      </div>
      {children}
    </div>
  );
}
