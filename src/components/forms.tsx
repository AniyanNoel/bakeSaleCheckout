"use client";

import { createContext, startTransition, useActionState, useContext, useEffect, useRef, type ReactNode } from "react";
import type { ActionState } from "@/lib/action";
import { buttonClass, cx } from "./ui";

/** True while the surrounding ActionForm is saving. */
const PendingContext = createContext(false);

type FormAction = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/**
 * A form wired to a server action. Shows the result message, disables the
 * submit button while saving (so a double click can't submit twice), and can
 * clear itself after a successful save.
 */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess = false,
  confirm,
  showSuccess = true,
}: {
  action: FormAction;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  /** Ask "are you sure?" before submitting. */
  confirm?: string;
  showSuccess?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form
      ref={ref}
      className={className}
      // Submitting by hand (rather than <form action>) stops React from clearing
      // what was typed when the server says something needs fixing.
      onSubmit={(e) => {
        e.preventDefault();
        if (pending) return;
        if (confirm && !window.confirm(confirm)) return;
        const fd = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
        startTransition(() => formAction(fd));
      }}
    >
      <PendingContext value={pending}>{children}</PendingContext>
      <FormMessage state={state} showSuccess={showSuccess} />
    </form>
  );
}

export function FormMessage({ state, showSuccess = true }: { state: ActionState; showSuccess?: boolean }) {
  if (!state) return null;
  if (state.error)
    return (
      <p role="alert" className="mt-2 text-sm font-medium text-red-700">
        {state.error}
      </p>
    );
  if (state.ok && showSuccess)
    return (
      <p role="status" className="mt-2 text-sm text-green-700">
        {state.ok}
      </p>
    );
  return null;
}

export function SubmitButton({
  children,
  variant = "primary",
  pendingText = "Saving…",
  className,
  name,
  value,
}: {
  children: ReactNode;
  variant?: keyof typeof buttonClass;
  pendingText?: string;
  className?: string;
  name?: string;
  value?: string;
}) {
  const pending = useContext(PendingContext);
  return (
    <button type="submit" name={name} value={value} disabled={pending} className={cx(buttonClass[variant], className)}>
      {pending ? pendingText : children}
    </button>
  );
}

export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className={buttonClass.secondary}>
      Print
    </button>
  );
}
