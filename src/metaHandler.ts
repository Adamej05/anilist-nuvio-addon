import { fetchMediaDetail, type RequestDeps } from "./anilist";
import { cachedJson, type JsonCache } from "./cache";
import { entryIndex, getCollection } from "./catalog";
import { TTL } from "./config";
import { externalIdsForKitsu, kitsuIdForMedia } from "./kitsu";
import { anilistIdForKitsu, lookupIds, type CompactMapping } from "./mappingFormat";
import { itemType, OWN_PREFIX, stremioType, toMetaDetail, type MetaDetailResponse } from "./meta";

export interface MetaContext {
  cache: JsonCache;
  username?: string;
  getMapping: () => Promise<CompactMapping>;
  deps?: RequestDeps;
  /** For the Kitsu API fallback. */
  fetchImpl?: typeof fetch;
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
  const kitsuDeps = { cache: ctx.cache, fetchImpl: ctx.fetchImpl };
  const requestedKitsu = /^kitsu:(\d+)$/.exec(id);
  let anilistId = resolveAnilistId(id, mapping);

  // A kitsu id Fribb does not know (e.g. adult titles): ask Kitsu which anime it is.
  if (anilistId === null && requestedKitsu) {
    const ext = await externalIdsForKitsu(Number(requestedKitsu[1]), kitsuDeps);
    if (ext.anilist) anilistId = ext.anilist;
    else if (ext.mal) {
      const byMal = await cachedJson(ctx.cache, `mal:${ext.mal}`, TTL.mediaDetail, () =>
        fetchMediaDetail({ idMal: ext.mal! }, ctx.deps),
      );
      if (byMal) anilistId = byMal.id;
    }
  }
  if (anilistId === null) return { meta: null, cacheSeconds: TTL.mediaDetail };

  const media = await cachedJson(ctx.cache, `media:${anilistId}`, TTL.mediaDetail, () =>
    fetchMediaDetail(anilistId!, ctx.deps),
  );
  if (!media) return { meta: null, cacheSeconds: TTL.mediaDetail };

  // Episodes need a Kitsu id for Torrentio; Fribb first, then the Kitsu API.
  let kitsuId = lookupIds(mapping, media.id).kitsu;
  if (!kitsuId && !media.isAdult) {
    kitsuId = requestedKitsu ? Number(requestedKitsu[1]) : await kitsuIdForMedia(media.id, media.idMal, kitsuDeps);
  }

  let entry;
  if (ctx.username) {
    try {
      entry = entryIndex(await getCollection(ctx.cache, ctx.username, ctx.deps)).get(anilistId);
    } catch (err) {
      console.warn("user list unavailable for meta", err);
    }
  }

  // Adult titles are always "anime" (Yomi). Otherwise keep the type Nuvio asked for
  // when it is a real Stremio type, so streams match.
  const metaType = media.isAdult
    ? itemType(media)
    : type === "movie" || type === "series"
      ? type
      : stremioType(media.format);
  return {
    meta: toMetaDetail(media, mapping, { id, type: metaType, entry, kitsuId }),
    cacheSeconds: ctx.username ? TTL.userList : TTL.mediaDetail,
  };
}
