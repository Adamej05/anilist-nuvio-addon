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

/** kitsu:ID first (Torrentio + AIOMetadata), then IMDb, then anilist:ID (AIOMetadata only). */
export function stremioIdFor(mapping: CompactMapping, anilistId: number): string {
  const ids = lookupIds(mapping, anilistId);
  if (ids.kitsu) return `kitsu:${ids.kitsu}`;
  if (ids.imdb) return ids.imdb;
  return `anilist:${anilistId}`;
}

export function isCompactMapping(value: unknown): value is CompactMapping {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
