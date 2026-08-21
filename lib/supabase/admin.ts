import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * A Supabase client that bypasses row-level security.
 *
 * MUST NOT reach the browser. The service role key is not a stronger anon key
 * — it ignores every RLS policy in the schema, so anyone holding it can read
 * and write every user's rows. What actually keeps it out of the browser is the
 * missing NEXT_PUBLIC_ prefix: Next inlines only prefixed variables, so this one
 * is simply absent from the client bundle. The window check below turns any
 * mistaken client-side call into a loud error rather than a silent undefined.
 *
 * Used by the snapshot job, which writes tables that RLS closes to the app's
 * ordinary anon-key client. Everything a signed-in user does should continue
 * to go through lib/supabase/server.ts so their policies still apply.
 *
 * Guarded at runtime rather than with `server-only`: this module is reachable
 * from lib/fpl/client.ts, which the CLI scripts also import, and `server-only`
 * throws under plain node as well as in the browser — it would break the
 * tooling to guard against a leak the missing NEXT_PUBLIC_ prefix already
 * prevents.
 */
export function createAdminClient() {
  if (typeof window !== "undefined") {
    throw new Error(
      "createAdminClient is server-only: it bypasses row-level security.",
    );
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_URL are required for admin access.",
    );
  }

  return createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
