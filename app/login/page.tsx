import { AuthForm } from "@/components/AuthForm";
import { signIn } from "@/app/auth/actions";

export default function Page() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-12">
      <div className="mb-8">
        <p className="text-sm font-semibold tracking-widest text-[--color-accent]">
          FPL ASSISTANT
        </p>
        <h1 className="mt-2 text-2xl font-bold">Sign in</h1>
        <p className="mt-1 text-sm text-[--color-ink-muted]">Pick up where you left off.</p>
      </div>
      <div className="rounded-2xl border border-[--color-border] bg-[--color-surface] p-6">
        <AuthForm mode="signin" action={signIn} />
      </div>
    </main>
  );
}
