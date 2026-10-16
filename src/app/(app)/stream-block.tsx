"use client";

import { Component, Suspense, type ReactNode } from "react";
import { useRouter } from "next/navigation";

// Тяжёлый блок страницы грузится отдельно от остальной страницы: пока считается — одна строка «Загрузка…»,
// а если расчёт блока упал — остаётся сообщение и кнопка «Повторить», остальная страница работает.
class Boundary extends Component<{ label: string; onRetry: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
        <span>Блок «{this.props.label}» не загрузился.</span>
        <button
          type="button"
          className="min-h-11 cursor-pointer rounded-md border border-red-300 bg-white px-3 font-medium text-red-900 hover:bg-red-100"
          onClick={() => {
            this.setState({ failed: false });
            this.props.onRetry();
          }}
        >
          Повторить
        </button>
      </div>
    );
  }
}

export function StreamBlock({ label, children }: { label: string; children: ReactNode }) {
  const router = useRouter();
  return (
    <Boundary label={label} onRetry={() => router.refresh()}>
      <Suspense
        fallback={
          <p role="status" aria-live="polite" className="py-3 text-sm text-neutral-600">
            Загрузка: {label}…
          </p>
        }
      >
        {children}
      </Suspense>
    </Boundary>
  );
}
