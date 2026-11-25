import { FRIBB_URL, TTL } from "./config";
import { convertFribb, isCompactMapping, type CompactMapping, type FribbEntry } from "./mappingFormat";

/**
 * Loads the compact mapping (about 350 kB):
 * 1. from memory of this function instance (24 h),
 * 2. from MAPPING_URL (the "data" branch built by the GitHub Action),
 * 3. as a fallback from the full Fribb dataset (7.5 MB), converted here.
 * If everything fails, an empty mapping is used and items get anilist:ID.
 */

let memory: { data: CompactMapping; expiresAt: number } | null = null;
let inFlight: Promise<CompactMapping> | null = null;

export async function getMapping(mappingUrl: string, fetchImpl: typeof fetch = fetch): Promise<CompactMapping> {
  if (memory && memory.expiresAt > Date.now()) return memory.data;
  if (!inFlight) {
    inFlight = loadMapping(mappingUrl, fetchImpl)
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

/** For tests. */
export function resetMappingCache(): void {
  memory = null;
  inFlight = null;
}

async function loadMapping(mappingUrl: string, fetchImpl: typeof fetch): Promise<CompactMapping> {
  try {
    const res = await fetchImpl(mappingUrl);
    if (res.ok) {
      const json: unknown = await res.json();
      if (Array.isArray(json)) return convertFribb(json as FribbEntry[]);
      if (isCompactMapping(json)) return json;
    } else {
      console.warn(`compact mapping HTTP ${res.status}`);
    }
  } catch (err) {
    console.warn("compact mapping unavailable", err);
  }
  console.warn("falling back to full Fribb dataset");
  const res = await fetchImpl(FRIBB_URL);
  if (!res.ok) throw new Error(`Fribb HTTP ${res.status}`);
  return convertFribb((await res.json()) as FribbEntry[]);
}
