import { AuthForm } from "@/components/AuthForm";
import { signUp } from "@/app/auth/actions";

export default function Page() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-12">
      <div className="mb-8">
        <div className="flex items-center gap-2.5">
          <span aria-hidden className="pl-rule h-4 w-1 rounded-full" />
          <p className="eyebrow text-[11px] text-[--color-accent]">FPL Assistant</p>
        </div>
        <h1 className="mt-3 font-[family-name:--font-display] text-4xl font-bold uppercase leading-none tracking-tight">Create your account</h1>
        <p className="mt-2.5 text-sm text-[--color-ink-muted]">Free while in beta.</p>
      </div>
      <div className="relative overflow-hidden rounded-2xl border border-[--color-border] bg-[--color-surface] p-6 shadow-[0_18px_40px_-24px_rgba(0,0,0,0.8)]">
        <AuthForm mode="signup" action={signUp} />
      </div>
    </main>
  );
}
