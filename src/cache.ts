/**
 * Thin wrapper over the Cloudflare Cache API for JSON values.
 * Keys are synthetic URLs under the Worker's own origin.
 */
export async function cachedJson<T>(
  keyUrl: string,
  ttlSeconds: number,
  ctx: ExecutionContext,
  producer: () => Promise<T>,
): Promise<T> {
  const cache = caches.default;
  const key = new Request(keyUrl);
  try {
    const hit = await cache.match(key);
    if (hit) return (await hit.json()) as T;
  } catch {
    // A broken cache entry is treated as a miss.
  }
  const value = await producer();
  const response = new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${ttlSeconds}` },
  });
  ctx.waitUntil(cache.put(key, response).catch(() => undefined));
  return value;
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
