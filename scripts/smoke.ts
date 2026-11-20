/**
 * End-to-end smoke test against a local Supabase and a running dev server.
 *
 * The Supabase-backed half of this app — auth, persistence, the analysis cache,
 * saved drafts — was written against the documented APIs and for a long time
 * had never run, because the build environment had no Supabase project. This is
 * the script that runs it: it creates a throwaway user, signs in the way the
 * app does, and drives the real HTTP routes with a real session cookie.
 *
 * It deliberately never calls /api/analysis. That route bills an Anthropic
 * request, and a smoke test that costs money per run is a smoke test nobody
 * runs. Everything here is free: projections, the optimal XI, drafts.
 *
 *   npx supabase start
 *   npm run dev
 *   npm run smoke
 *
 * Exits non-zero on the first failed check, so it is usable in a pre-push hook.
 */

import { readFileSync } from "node:fs";

import { createServerClient } from "@supabase/ssr";
import { createClient as createAdminClient } from "@supabase/supabase-js";

// Loaded by hand: this runs under tsx, not under Next, so none of Next's env
// handling applies.
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const match = /^([A-Z_]+)=(.*)$/.exec(line.trim());
  if (match) process.env[match[1]] ??= match[2].replace(/^"|"$/g, "");
}

const BASE = process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:3000";
const EMAIL = "smoke@test.local";
const PASSWORD = "smoke-test-password-123";

const url = required("NEXT_PUBLIC_SUPABASE_URL");
const anonKey = required("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const serviceKey = required("SUPABASE_SERVICE_ROLE_KEY");

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is not set in .env.local — nothing to test against.`);
    process.exit(2);
  }
  return value;
}

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  console.log(`${ok ? "  ok  " : " FAIL "} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

/**
 * A session in the shape the app reads it.
 *
 * Signing in through @supabase/ssr with a cookie jar, rather than hand-building
 * a cookie, is the point: the cookie name and encoding are the library's
 * business and have changed between versions. Whatever it writes here is
 * exactly what the browser would send.
 */
async function signIn(): Promise<string> {
  const admin = createAdminClient(url, serviceKey, {
    auth: { persistSession: false },
  });

  const { data: list } = await admin.auth.admin.listUsers();
  const existing = list?.users.find((u) => u.email === EMAIL);
  if (existing) await admin.auth.admin.deleteUser(existing.id);

  const { error: createError } = await admin.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
  });
  if (createError) throw createError;

  const jar = new Map<string, string>();
  const client = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (toSet) => toSet.forEach(({ name, value }) => jar.set(name, value)),
    },
  });

  const { error } = await client.auth.signInWithPassword({
    email: EMAIL,
    password: PASSWORD,
  });
  if (error) throw error;

  return [...jar].map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join("; ");
}

async function cleanUp() {
  const admin = createAdminClient(url, serviceKey, {
    auth: { persistSession: false },
  });
  const { data: list } = await admin.auth.admin.listUsers();
  const user = list?.users.find((u) => u.email === EMAIL);
  // The cascade takes the squads, analyses and drafts with it, which is the
  // delete-user behaviour worth knowing still works.
  if (user) await admin.auth.admin.deleteUser(user.id);
}

async function main() {
  const reachable = await fetch(`${BASE}/login`).then(
    (r) => r.ok,
    () => false,
  );
  if (!reachable) {
    console.error(`No dev server at ${BASE}. Run \`npm run dev\` first.`);
    process.exit(2);
  }

  const cookie = await signIn();
  const headers = { cookie, "Content-Type": "application/json" };

  const call = async (path: string, init?: RequestInit) => {
    const res = await fetch(`${BASE}${path}`, { headers, ...init });
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  };

  console.log(`\nAgainst ${BASE}\n`);

  // ---- the guard ---------------------------------------------------------
  const anonymous = await fetch(`${BASE}/api/drafts`).then((r) => r.status);
  check("drafts refuse an unauthenticated caller", anonymous === 401, `got ${anonymous}`);

  // ---- projections, which everything else hangs from ---------------------
  // A manual fifteen, so the test does not depend on anyone's FPL team being
  // importable or on a deadline having passed.
  const squad = await pickLegalSquad();
  const projected = await call("/api/projections", {
    method: "POST",
    body: JSON.stringify({ playerIds: squad, horizon: 3 }),
  });
  check(
    "a manual squad projects",
    projected.status === 200 && projected.body?.optimal?.startingXI?.length === 11,
    projected.status === 200
      ? `XI of ${projected.body?.optimal?.startingXI?.length}, ${projected.body?.optimal?.expectedPoints?.toFixed?.(1)} xPts`
      : JSON.stringify(projected.body),
  );
  const gameweek: number = projected.body?.gameweek ?? 1;

  // ---- the squad is persisted, which the cache key depends on ------------
  const reProjected = await call("/api/projections", {
    method: "POST",
    body: JSON.stringify({ playerIds: squad, horizon: 3 }),
  });
  check("projecting twice is idempotent", reProjected.status === 200);

  // ---- saved drafts ------------------------------------------------------
  const transfers = [{ out: squad[0], in: 0 }];
  const bad = await call("/api/drafts", {
    method: "POST",
    body: JSON.stringify({ gameweek, name: "", transfers }),
  });
  check("an unnamed draft is refused", bad.status === 400, `got ${bad.status}`);

  const saved = await call("/api/drafts", {
    method: "POST",
    body: JSON.stringify({
      gameweek,
      name: "Smoke draft",
      transfers: [{ out: squad[0], in: squad[1] }],
      chip: "wildcard",
      entryId: 1234567,
    }),
  });
  check(
    "a draft saves",
    saved.status === 200 && saved.body?.draft?.name === "Smoke draft",
    saved.status === 200 ? `chip ${saved.body?.draft?.chip}` : JSON.stringify(saved.body),
  );

  const resaved = await call("/api/drafts", {
    method: "POST",
    body: JSON.stringify({
      gameweek,
      name: "Smoke draft",
      transfers: [{ out: squad[2], in: squad[3] }],
    }),
  });
  check(
    "re-saving one name edits rather than duplicates",
    resaved.status === 200 && resaved.body?.draft?.id === saved.body?.draft?.id,
    `chip cleared: ${resaved.body?.draft?.chip === null}`,
  );

  const listed = await call(`/api/drafts?gameweek=${gameweek}`);
  check(
    "the draft lists back for its gameweek",
    listed.status === 200 && listed.body?.drafts?.length === 1,
    `${listed.body?.drafts?.length} row(s)`,
  );

  const otherWeek = await call(`/api/drafts?gameweek=${gameweek === 38 ? 1 : gameweek + 1}`);
  check(
    "and not for another gameweek",
    otherWeek.status === 200 && otherWeek.body?.drafts?.length === 0,
  );

  const id = saved.body?.draft?.id;
  const deleted = await call(`/api/drafts?id=${id}`, { method: "DELETE" });
  const afterDelete = await call(`/api/drafts?gameweek=${gameweek}`);
  check(
    "a draft deletes",
    deleted.status === 200 && afterDelete.body?.drafts?.length === 0,
  );

  // ---- drafts on a manual squad ------------------------------------------
  // Priced against what is left of the £100m rather than an FPL bank, and
  // reported with the hit withheld: there is no history to read a
  // free-transfer count from, and guessing one invents the most consequential
  // number on the screen.
  const swapIn = await affordableSwap(squad);
  const manualDraft = await call("/api/projections", {
    method: "POST",
    body: JSON.stringify({
      playerIds: squad,
      transfers: [{ out: squad[14], in: swapIn }],
    }),
  });
  check(
    "a manual squad can be drafted",
    manualDraft.status === 200 && manualDraft.body?.draft?.moves?.length === 1,
    manualDraft.status === 200
      ? `net ${manualDraft.body?.draft?.comparison?.netHorizon}`
      : String(manualDraft.body?.error).slice(0, 90),
  );
  check(
    "and its hit is withheld rather than guessed",
    manualDraft.body?.draft?.hitUnknown === true &&
      manualDraft.body?.draft?.hitCost === 0,
  );

  // A chip answers the question the manual case cannot: the limit is
  // suspended, so there is no hit to know about either way.
  const manualWildcard = await call("/api/projections", {
    method: "POST",
    body: JSON.stringify({
      playerIds: squad,
      transfers: [{ out: squad[14], in: swapIn }],
      chip: "wildcard",
    }),
  });
  check(
    "a chip settles the hit even on a manual squad",
    manualWildcard.body?.draft?.hitUnknown === false &&
      manualWildcard.body?.draft?.hitCost === 0 &&
      manualWildcard.body?.draft?.chip === "wildcard",
  );

  // The composition rules are shared with every other kind of squad, so this
  // is really a check that a manual draft is put through them at all.
  const fourth = await fourthFromAClub(squad);
  const illegal = await call("/api/projections", {
    method: "POST",
    body: JSON.stringify({ playerIds: squad, transfers: [fourth] }),
  });
  check(
    "a manual draft breaking the three-per-club rule is refused",
    illegal.status === 400,
    String(illegal.body?.error ?? illegal.status).slice(0, 70),
  );

  const crossPosition = await call("/api/projections", {
    method: "POST",
    body: JSON.stringify({
      playerIds: squad,
      transfers: [{ out: squad[0], in: swapIn }],
    }),
  });
  check(
    "and so is one that swaps across positions",
    crossPosition.status === 400,
    String(crossPosition.body?.error ?? crossPosition.status).slice(0, 60),
  );

  console.log(
    `\n${failures === 0 ? "All checks passed." : `${failures} check(s) failed.`}\n`,
  );
}

/** Cheap FPL data, fetched once and reused by the squad helpers. */
let bootstrapCache: {
  elements: { id: number; element_type: number; now_cost: number; team: number; status: string }[];
} | null = null;

async function bootstrap() {
  if (!bootstrapCache) {
    const res = await fetch("https://fantasy.premierleague.com/api/bootstrap-static/");
    bootstrapCache = await res.json();
  }
  return bootstrapCache!;
}

/** A forward the budget can absorb, so the legality check is what is tested. */
async function affordableSwap(squad: number[]): Promise<number> {
  const { elements } = await bootstrap();
  const out = elements.find((e) => e.id === squad[14])!;
  const candidate = elements
    .filter(
      (e) =>
        e.element_type === out.element_type &&
        e.status === "a" &&
        !squad.includes(e.id) &&
        e.now_cost <= out.now_cost + 5,
    )
    .sort((a, b) => b.now_cost - a.now_cost)[0];
  if (!candidate) throw new Error("no affordable swap available");
  return candidate.id;
}

/**
 * A swap that would put a fourth player from one club in the squad.
 *
 * Finds a club the squad already has three of, and someone to sell from
 * elsewhere in the same position — so the only thing wrong with the move is
 * the club limit.
 */
async function fourthFromAClub(squad: number[]): Promise<{ out: number; in: number }> {
  const { elements } = await bootstrap();
  const held = elements.filter((e) => squad.includes(e.id));
  const counts = new Map<number, number>();
  for (const e of held) counts.set(e.team, (counts.get(e.team) ?? 0) + 1);

  for (const [team, count] of counts) {
    if (count < 3) continue;
    for (const incoming of elements) {
      if (incoming.team !== team || squad.includes(incoming.id)) continue;
      const sellable = held.find(
        (e) => e.element_type === incoming.element_type && e.team !== team,
      );
      if (sellable) return { out: sellable.id, in: incoming.id };
    }
  }
  throw new Error("no club in the squad has three players to exceed");
}

/**
 * A legal fifteen from live FPL data: right shape, at most three per club,
 * inside the budget. Built the same way as the dry run, for the same reason —
 * a squad that cannot be fielded tests the error path and nothing else.
 */
async function pickLegalSquad(): Promise<number[]> {
  const { elements } = await bootstrap();
  const quota: Record<number, number> = { 1: 2, 2: 5, 3: 5, 4: 3 };
  const held: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  const perClub = new Map<number, number>();
  const squad: number[] = [];
  let spend = 0;

  for (const el of [...elements]
    .filter((e) => e.status === "a")
    .sort((a, b) => a.now_cost - b.now_cost)) {
    if (held[el.element_type] >= quota[el.element_type]) continue;
    if ((perClub.get(el.team) ?? 0) >= 3) continue;
    squad.push(el.id);
    held[el.element_type]++;
    perClub.set(el.team, (perClub.get(el.team) ?? 0) + 1);
    spend += el.now_cost;
    if (squad.length === 15) break;
  }
  if (squad.length !== 15) throw new Error("could not assemble a legal fifteen");
  if (spend > 1000) throw new Error(`cheapest legal fifteen costs ${spend / 10}m`);
  return squad;
}

main()
  // Always tidy up: a leftover user makes the next run's sign-in ambiguous.
  .finally(cleanUp)
  .then(() => process.exit(failures === 0 ? 0 : 1))
  .catch((err) => {
    console.error(err);
    process.exit(2);
  });
