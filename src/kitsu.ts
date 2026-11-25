import { cachedJson, type JsonCache } from "./cache";
import { TTL, USER_AGENT } from "./config";

/**
 * Fallback for anime the Fribb dataset does not map (adult titles are left
 * out of it completely, very new titles may be missing for a few days):
 * ask the Kitsu API directly. Results, also "not found", are cached for 24 h.
 */

const KITSU_API = "https://kitsu.app/api/edge";

export interface KitsuDeps {
  cache: JsonCache;
  fetchImpl?: typeof fetch;
}

interface MappingsResponse {
  data?: Array<{
    attributes?: { externalSite?: string; externalId?: string };
    relationships?: { item?: { data?: { type?: string; id?: string } | null } };
  }>;
}

async function kitsuGet(path: string, fetchImpl: typeof fetch): Promise<MappingsResponse> {
  const res = await fetchImpl(`${KITSU_API}${path}`, {
    headers: { Accept: "application/vnd.api+json", "User-Agent": USER_AGENT },
  });
  if (res.status === 404) return { data: [] };
  if (!res.ok) throw new Error(`Kitsu HTTP ${res.status}`);
  return (await res.json()) as MappingsResponse;
}

/** Kitsu id for an AniList anime, by its AniList id or MAL id. undefined = unknown. */
export async function kitsuIdForMedia(
  anilistId: number,
  idMal: number | null | undefined,
  deps: KitsuDeps,
): Promise<number | undefined> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  try {
    // 0 stands for "Kitsu does not know it" so that the answer is cached too.
    const id = await cachedJson(deps.cache, `kitsuid:${anilistId}`, TTL.mapping, async () => {
      const lookups: Array<[string, number | null | undefined]> = [
        ["anilist/anime", anilistId],
        ["myanimelist/anime", idMal],
      ];
      for (const [site, externalId] of lookups) {
        if (!externalId) continue;
        const query = `filter%5BexternalSite%5D=${encodeURIComponent(site)}&filter%5BexternalId%5D=${externalId}&include=item`;
        const body = await kitsuGet(`/mappings?${query}`, fetchImpl);
        const item = body.data?.[0]?.relationships?.item?.data;
        if (item?.type === "anime" && item.id) return Number(item.id);
      }
      return 0;
    });
    return id || undefined;
  } catch (err) {
    console.warn("Kitsu lookup failed", anilistId, err);
    return undefined;
  }
}

/** AniList / MAL id for a Kitsu id (for kitsu: ids the Fribb mapping does not know). */
export async function externalIdsForKitsu(
  kitsuId: number,
  deps: KitsuDeps,
): Promise<{ anilist?: number; mal?: number }> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  try {
    return await cachedJson(deps.cache, `kitsurev:${kitsuId}`, TTL.mapping, async () => {
      const body = await kitsuGet(`/anime/${kitsuId}/mappings?page%5Blimit%5D=20`, fetchImpl);
      const out: { anilist?: number; mal?: number } = {};
      for (const m of body.data ?? []) {
        const id = Number(m.attributes?.externalId);
        if (!Number.isInteger(id) || id <= 0) continue;
        if (m.attributes?.externalSite === "anilist/anime" && !out.anilist) out.anilist = id;
        if (m.attributes?.externalSite === "myanimelist/anime" && !out.mal) out.mal = id;
      }
      return out;
    });
  } catch (err) {
    console.warn("Kitsu reverse lookup failed", kitsuId, err);
    return {};
  }
}
