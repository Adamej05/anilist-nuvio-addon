import { fetchMediaDetail, type RequestDeps } from "./anilist";
import { cachedJson, type JsonCache } from "./cache";
import { entryIndex, getCollection } from "./catalog";
import { TTL } from "./config";
import { anilistIdForKitsu, type CompactMapping } from "./mappingFormat";
import { OWN_PREFIX, stremioType, toMetaDetail, type MetaDetailResponse } from "./meta";

export interface MetaContext {
  cache: JsonCache;
  username?: string;
  getMapping: () => Promise<CompactMapping>;
  deps?: RequestDeps;
}

/** "alsz:123" or "kitsu:456" -> AniList id; anything else (or unknown kitsu) -> null. */
export function resolveAnilistId(id: string, mapping: CompactMapping): number | null {
  const own = new RegExp(`^${OWN_PREFIX}(\\d+)$`).exec(id);
  if (own) return Number(own[1]);
  const kitsu = /^kitsu:(\d+)$/.exec(id);
  if (kitsu) return anilistIdForKitsu(mapping, Number(kitsu[1])) ?? null;
  return null;
}

export async function handleMeta(
  type: string,
  id: string,
  ctx: MetaContext,
): Promise<{ meta: MetaDetailResponse | null; cacheSeconds: number }> {
  const mapping = await ctx.getMapping();
  const anilistId = resolveAnilistId(id, mapping);
  if (anilistId === null) return { meta: null, cacheSeconds: TTL.mediaDetail };

  const media = await cachedJson(ctx.cache, `media:${anilistId}`, TTL.mediaDetail, () =>
    fetchMediaDetail(anilistId, ctx.deps),
  );
  if (!media) return { meta: null, cacheSeconds: TTL.mediaDetail };

  let entry;
  if (ctx.username) {
    try {
      entry = entryIndex(await getCollection(ctx.cache, ctx.username, ctx.deps)).get(anilistId);
    } catch (err) {
      console.warn("user list unavailable for meta", err);
    }
  }

  // Keep the type Nuvio asked for when it is a real Stremio type, so streams match.
  const metaType = type === "movie" || type === "series" ? type : stremioType(media.format);
  return {
    meta: toMetaDetail(media, mapping, { id, type: metaType, entry }),
    cacheSeconds: ctx.username ? TTL.userList : TTL.mediaDetail,
  };
}
