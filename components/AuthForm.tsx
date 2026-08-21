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
        <label htmlFor="email" className="eyebrow text-[11px] text-[--color-ink-faint]">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className="rounded-lg border border-[--color-border] bg-[--color-base] px-3.5 py-3 text-[--color-ink] outline-none transition focus:border-[--color-cyan]"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className="eyebrow text-[11px] text-[--color-ink-faint]">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete={isSignUp ? "new-password" : "current-password"}
          required
          minLength={isSignUp ? 8 : undefined}
          className="rounded-lg border border-[--color-border] bg-[--color-base] px-3.5 py-3 text-[--color-ink] outline-none transition focus:border-[--color-cyan]"
        />
        {isSignUp && (
          <p className="text-xs text-[--color-ink-faint]">At least 8 characters.</p>
        )}
      </div>

      {state.error && (
        <p
          role="alert"
          className="rounded-lg border border-[--color-pink]/40 bg-[--color-pink]/10 px-3.5 py-2.5 text-sm text-[--color-pink]"
        >
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="mt-1 rounded-lg bg-[--color-accent] px-4 py-3 font-semibold text-[--color-base] transition hover:bg-[--color-accent-dim] active:translate-y-px disabled:opacity-60"
      >
        {pending ? "Working…" : isSignUp ? "Create account" : "Sign in"}
      </button>

      <p className="text-center text-sm text-[--color-ink-muted]">
        {isSignUp ? "Already have an account? " : "No account yet? "}
        <Link
          href={isSignUp ? "/login" : "/signup"}
          className="font-semibold text-[--color-cyan] hover:underline"
        >
          {isSignUp ? "Sign in" : "Sign up"}
        </Link>
      </p>
    </form>
  );
}
