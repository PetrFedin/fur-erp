"use client";

import { startTransition, useEffect, useState, type FormEvent } from "react";

/**
 * React 19 стирает поля формы после `<form action={formAction}>` даже тогда, когда сервер вернул ошибку, —
 * человек терял всё введённое. Этот хук отправляет форму через onSubmit (то же самое действие useActionState),
 * поля остаются как есть. `resetOnSuccess` — для форм «добавить»: очистить поля только после успешного ответа.
 * Использование: const keep = useKeepingForm(formAction, state, pending, true);  <form ref={keep.setForm} onSubmit={keep.onSubmit}>
 */
export function useKeepingForm(
  formAction: (formData: FormData) => void,
  state: { error?: string } | null | undefined,
  pending: boolean,
  resetOnSuccess = false,
) {
  const [node, setNode] = useState<HTMLFormElement | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [prevPending, setPrevPending] = useState(pending);
  const [resetTick, setResetTick] = useState(0);
  // Состояние подстраиваем прямо при рендере (без эффекта): ответ пришёл — запрос закончился.
  if (pending !== prevPending) {
    setPrevPending(pending);
    if (!pending && submitted) {
      setSubmitted(false);
      if (resetOnSuccess && !state?.error) setResetTick((t) => t + 1);
    }
  }
  useEffect(() => {
    if (resetTick > 0) node?.reset();
  }, [resetTick, node]);

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
    const fd = new FormData(e.currentTarget, submitter);
    setSubmitted(true);
    startTransition(() => formAction(fd));
  };
  return { setForm: setNode, onSubmit };
}
