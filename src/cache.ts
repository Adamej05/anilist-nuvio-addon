/**
 * Small JSON cache. On Vercel the function instance is reused between
 * requests (Fluid compute), so an in-memory cache survives for a while;
 * the CDN in front caches whole responses on top of that (see app.ts).
 */
export interface JsonCache {
  get<T>(key: string): T | undefined;
  set(key: string, value: unknown, ttlSeconds: number): void;
}

export class MemoryCache implements JsonCache {
  private readonly entries = new Map<string, { value: unknown; expiresAt: number }>();

  constructor(
    private readonly maxEntries = 500,
    private readonly now: () => number = Date.now,
  ) {}

  get<T>(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    // Re-insert so the Map order works as a least-recently-used list.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value as T;
  }

  set(key: string, value: unknown, ttlSeconds: number): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + ttlSeconds * 1000 });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  get size(): number {
    return this.entries.size;
  }
}

const inFlight = new Map<string, Promise<unknown>>();

/** Returns the cached value or runs the producer once (concurrent callers share it). */
export async function cachedJson<T>(
  cache: JsonCache,
  key: string,
  ttlSeconds: number,
  producer: () => Promise<T>,
): Promise<T> {
  const hit = cache.get<T>(key);
  if (hit !== undefined) return hit;
  const pending = inFlight.get(key) as Promise<T> | undefined;
  if (pending) return pending;
  const promise = producer()
    .then((value) => {
      cache.set(key, value, ttlSeconds);
      return value;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
