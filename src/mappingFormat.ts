/**
 * Compact AniList -> Kitsu/IMDb mapping, built from Fribb/anime-lists.
 * Shared by the Worker and by scripts/build-mapping.ts, so keep this file
 * free of TypeScript-only runtime syntax (enums etc.): Node runs it directly.
 *
 * Format: { "<anilistId>": kitsuId } or { "<anilistId>": [kitsuId | 0, "tt..."] }
 */
export type CompactMapping = Record<string, number | [number, string]>;

export interface FribbEntry {
  anilist_id?: number;
  kitsu_id?: number;
  imdb_id?: string | string[];
}

export interface ResolvedIds {
  kitsu?: number;
  imdb?: string;
}

export function convertFribb(list: FribbEntry[]): CompactMapping {
  const out: CompactMapping = {};
  for (const e of list) {
    if (!e || typeof e.anilist_id !== "number") continue;
    const kitsu = typeof e.kitsu_id === "number" && e.kitsu_id > 0 ? e.kitsu_id : 0;
    const imdbRaw = Array.isArray(e.imdb_id) ? e.imdb_id[0] : e.imdb_id;
    const imdb = typeof imdbRaw === "string" && /^tt\d+$/.test(imdbRaw) ? imdbRaw : "";
    if (!kitsu && !imdb) continue;
    const key = String(e.anilist_id);
    // The first entry wins when two AniDB entries point at the same AniList id.
    if (key in out) continue;
    out[key] = imdb ? [kitsu, imdb] : kitsu;
  }
  return out;
}

export function lookupIds(mapping: CompactMapping, anilistId: number): ResolvedIds {
  const v = mapping[String(anilistId)];
  if (v === undefined) return {};
  if (typeof v === "number") return { kitsu: v };
  return { kitsu: v[0] || undefined, imdb: v[1] || undefined };
}

export function isCompactMapping(value: unknown): value is CompactMapping {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const reverseCache = new WeakMap<CompactMapping, Map<number, number>>();

/** Kitsu id -> AniList id (built once per mapping object). */
export function anilistIdForKitsu(mapping: CompactMapping, kitsuId: number): number | undefined {
  let reverse = reverseCache.get(mapping);
  if (!reverse) {
    reverse = new Map();
    for (const [anilist, v] of Object.entries(mapping)) {
      const kitsu = typeof v === "number" ? v : v[0];
      if (kitsu && !reverse.has(kitsu)) reverse.set(kitsu, Number(anilist));
    }
    reverseCache.set(mapping, reverse);
  }
  return reverse.get(kitsuId);
}
