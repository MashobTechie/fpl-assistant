"use client";

import Link from "next/link";
import { useActionState } from "react";

import type { AuthState } from "@/app/auth/actions";

interface Props {
  mode: "signin" | "signup";
  action: (prev: AuthState, formData: FormData) => Promise<AuthState>;
}

export function AuthForm({ mode, action }: Props) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  const isSignUp = mode === "signup";

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="text-sm text-[--color-ink-muted]">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className="rounded-lg border border-[--color-border] bg-[--color-surface-2] px-3 py-2.5 text-[--color-ink] outline-none focus:border-[--color-accent]"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className="text-sm text-[--color-ink-muted]">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete={isSignUp ? "new-password" : "current-password"}
          required
          minLength={isSignUp ? 8 : undefined}
          className="rounded-lg border border-[--color-border] bg-[--color-surface-2] px-3 py-2.5 text-[--color-ink] outline-none focus:border-[--color-accent]"
        />
        {isSignUp && (
          <p className="text-xs text-[--color-ink-faint]">At least 8 characters.</p>
        )}
      </div>

      {state.error && (
        <p role="alert" className="text-sm text-[--color-danger]">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-[--color-accent] px-4 py-2.5 font-semibold text-[--color-base] transition hover:bg-[--color-accent-dim] disabled:opacity-60"
      >
        {pending ? "Working…" : isSignUp ? "Create account" : "Sign in"}
      </button>

      <p className="text-center text-sm text-[--color-ink-muted]">
        {isSignUp ? "Already have an account? " : "No account yet? "}
        <Link
          href={isSignUp ? "/login" : "/signup"}
          className="text-[--color-accent] hover:underline"
        >
          {isSignUp ? "Sign in" : "Sign up"}
        </Link>
      </p>
    </form>
  );
}
