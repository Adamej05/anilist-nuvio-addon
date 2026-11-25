import { FRIBB_URL, TTL } from "./config";
import { convertFribb, isCompactMapping, type CompactMapping, type FribbEntry } from "./mappingFormat";

/**
 * Loads the compact mapping (about 350 kB, about 2 ms to parse):
 * 1. from memory of this isolate,
 * 2. from the Cache API (24 h),
 * 3. from MAPPING_URL (the "data" branch built by the GitHub Action),
 * 4. as a fallback from the full Fribb dataset, converted here. That parse costs
 *    about 30 ms CPU, above the free plan's 10 ms, so it is only a last resort;
 *    the converted result is cached, so it happens at most once a day.
 * If everything fails, an empty mapping is used and items get anilist:ID.
 */

let memory: { data: CompactMapping; expiresAt: number } | null = null;
let inFlight: Promise<CompactMapping> | null = null;

export async function getMapping(mappingUrl: string, ctx: ExecutionContext): Promise<CompactMapping> {
  if (memory && memory.expiresAt > Date.now()) return memory.data;
  if (!inFlight) {
    inFlight = loadMapping(mappingUrl, ctx)
      .then((data) => {
        memory = { data, expiresAt: Date.now() + TTL.mapping * 1000 };
        return data;
      })
      .catch((err) => {
        console.error("mapping load failed", err);
        // Keep a stale copy if there is one; retry in 10 minutes.
        const data = memory?.data ?? {};
        memory = { data, expiresAt: Date.now() + 10 * 60 * 1000 };
        return data;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

async function loadMapping(mappingUrl: string, ctx: ExecutionContext): Promise<CompactMapping> {
  const cache = caches.default;
  const key = new Request(mappingUrl);
  const hit = await cache.match(key).catch(() => undefined);
  if (hit) {
    const data = await hit.json().catch(() => null);
    if (isCompactMapping(data)) return data;
  }

  let data: CompactMapping | null = null;
  try {
    const res = await fetch(mappingUrl);
    if (res.ok) {
      const json: unknown = await res.json();
      data = Array.isArray(json) ? convertFribb(json as FribbEntry[]) : isCompactMapping(json) ? json : null;
    }
  } catch (err) {
    console.warn("compact mapping unavailable", err);
  }
  if (!data) {
    console.warn("falling back to full Fribb dataset");
    const res = await fetch(FRIBB_URL);
    if (!res.ok) throw new Error(`Fribb HTTP ${res.status}`);
    data = convertFribb((await res.json()) as FribbEntry[]);
  }

  const response = new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${TTL.mapping}` },
  });
  ctx.waitUntil(cache.put(key, response).catch(() => undefined));
  return data;
}
