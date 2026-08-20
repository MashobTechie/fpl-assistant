/**
 * In-process TTL cache for FPL payloads.
 *
 * Next's fetch cache cannot hold these: bootstrap-static is ~2.1MB and the
 * data cache rejects anything over 2MB, so `next: { revalidate }` silently
 * failed and every request re-fetched the full payload from FPL. Trimming the
 * response to the fields we actually use and memoising it here keeps us well
 * inside that limit and off FPL's servers.
 *
 * The cache is per server instance, so a serverless deployment refetches once
 * per cold start. That is a large improvement over once per request, but the
 * durable fix is snapshotting into Postgres on a schedule.
 */

interface Entry<T> {
  value: T;
  expiresAt: number;
}

const store = new Map<string, Entry<unknown>>();
/** De-duplicates concurrent misses so a cold start makes one request, not ten. */
const inFlight = new Map<string, Promise<unknown>>();

export async function cached<T>(
  key: string,
  ttlSeconds: number,
  load: () => Promise<T>,
): Promise<T> {
  const hit = store.get(key) as Entry<T> | undefined;
  if (hit && hit.expiresAt > Date.now()) return hit.value;

  const pending = inFlight.get(key) as Promise<T> | undefined;
  if (pending) return pending;

  const promise = load()
    .then((value) => {
      store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
      return value;
    })
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, promise);
  return promise;
}

/** Test/maintenance hook — drops everything so the next read refetches. */
export function clearFplCache() {
  store.clear();
  inFlight.clear();
}
