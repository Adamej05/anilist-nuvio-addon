import { ANILIST_URL, RETRY, USER_AGENT } from "./config";

export interface AniListMedia {
  id: number;
  idMal: number | null;
  title: { romaji: string | null; english: string | null; native: string | null };
  format: string | null;
  status: string | null;
  description: string | null;
  season: string | null;
  seasonYear: number | null;
  startDate: { year: number | null; month: number | null; day: number | null } | null;
  episodes: number | null;
  duration: number | null;
  genres: string[] | null;
  averageScore: number | null;
  isAdult: boolean | null;
  coverImage: { extraLarge: string | null; large: string | null } | null;
  bannerImage: string | null;
}

export interface MediaPage {
  hasNextPage: boolean;
  media: AniListMedia[];
}

const MEDIA_FIELDS = `
  id idMal format status season seasonYear episodes duration genres averageScore isAdult bannerImage
  title { romaji english native }
  description(asHtml: false)
  startDate { year month day }
  coverImage { extraLarge large }
`;

export const BROWSE_QUERY = `
query (
  $page: Int, $perPage: Int, $sort: [MediaSort], $format_in: [MediaFormat],
  $season: MediaSeason, $seasonYear: Int,
  $startDate_greater: FuzzyDateInt, $startDate_lesser: FuzzyDateInt,
  $averageScore_greater: Int
) {
  Page(page: $page, perPage: $perPage) {
    pageInfo { hasNextPage }
    media(
      type: ANIME, isAdult: false, sort: $sort, format_in: $format_in,
      season: $season, seasonYear: $seasonYear,
      startDate_greater: $startDate_greater, startDate_lesser: $startDate_lesser,
      averageScore_greater: $averageScore_greater
    ) { ${MEDIA_FIELDS} }
  }
}`;

export const COLLECTION_QUERY = `
query ($userName: String, $chunk: Int, $perChunk: Int) {
  MediaListCollection(
    userName: $userName, type: ANIME, chunk: $chunk, perChunk: $perChunk,
    forceSingleCompletedList: true, sort: [UPDATED_TIME_DESC]
  ) {
    hasNextChunk
    user { mediaListOptions { animeList { customLists } } }
    lists {
      isCustomList
      entries {
        status updatedAt
        customLists(asArray: true)
        media { ${MEDIA_FIELDS} }
      }
    }
  }
}`;

export const MEDIA_DETAIL_QUERY = `
query ($id: Int) {
  Media(id: $id, type: ANIME) {
    ${MEDIA_FIELDS}
    endDate { year month day }
    nextAiringEpisode { episode airingAt }
    aired: airingSchedule(perPage: 25, notYetAired: false) { nodes { episode airingAt } }
    upcoming: airingSchedule(perPage: 25, notYetAired: true) { nodes { episode airingAt } }
    streamingEpisodes { title thumbnail }
    trailer { id site }
    studios(isMain: true) { nodes { name } }
  }
}`;

export class AniListError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "AniListError";
  }
}

export interface RequestDeps {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  nowMs?: () => number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Seconds to wait after a 429: Retry-After, else X-RateLimit-Reset, else a default; capped. */
export function retryDelaySeconds(headers: Headers, nowMs: number): number {
  const retryAfter = Number(headers.get("retry-after"));
  let wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : NaN;
  if (Number.isNaN(wait)) {
    const reset = Number(headers.get("x-ratelimit-reset"));
    if (Number.isFinite(reset) && reset > 0) wait = Math.ceil(reset - nowMs / 1000);
  }
  if (!Number.isFinite(wait) || wait <= 0) wait = RETRY.defaultWaitSeconds;
  return Math.min(wait, RETRY.maxWaitSeconds);
}

/** One GraphQL call; on 429 waits and retries (and once on a 5xx). */
export async function anilistRequest<T>(
  query: string,
  variables: Record<string, unknown>,
  deps: RequestDeps = {},
): Promise<T> {
  const doFetch = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? defaultSleep;
  const now = deps.nowMs ?? Date.now;

  for (let attempt = 0; ; attempt++) {
    const res = await doFetch(ANILIST_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": USER_AGENT,
      },
      body: JSON.stringify({ query, variables }),
    });

    if (res.status === 429 && attempt < RETRY.maxRetries) {
      await sleep(retryDelaySeconds(res.headers, now()) * 1000);
      continue;
    }
    if (res.status >= 500 && attempt < 1) {
      await sleep(1000);
      continue;
    }

    let body: { data?: T; errors?: Array<{ message: string; status?: number }> };
    try {
      body = (await res.json()) as typeof body;
    } catch {
      throw new AniListError(`AniList HTTP ${res.status} with invalid JSON`, res.status);
    }
    if (!res.ok || body.errors?.length) {
      const err = body.errors?.[0];
      throw new AniListError(err?.message ?? `AniList HTTP ${res.status}`, err?.status ?? res.status);
    }
    if (!body.data) throw new AniListError("AniList returned no data", res.status);
    return body.data;
  }
}

interface BrowseResponse {
  Page: { pageInfo: { hasNextPage: boolean }; media: Array<AniListMedia | null> };
}

export type ListStatus = "CURRENT" | "PLANNING" | "COMPLETED" | "DROPPED" | "PAUSED" | "REPEATING";

export interface ListEntry {
  status: ListStatus;
  /** Unix seconds. */
  updatedAt: number;
  /** Names of the custom lists the entry is in. */
  customLists: string[];
  media: AniListMedia;
}

export interface UserCollection {
  /** All custom list names of the user, also the empty ones. */
  customListNames: string[];
  /** One entry per anime, newest update first. */
  entries: ListEntry[];
}

interface CollectionResponse {
  MediaListCollection: {
    hasNextChunk: boolean;
    user: { mediaListOptions: { animeList: { customLists: string[] | null } | null } | null } | null;
    lists: Array<{
      isCustomList: boolean;
      entries: Array<{
        status: ListStatus;
        updatedAt: number;
        customLists: Array<{ name: string; enabled: boolean }> | null;
        media: AniListMedia | null;
      } | null> | null;
    } | null> | null;
  } | null;
}

/** Safety stop: 10 chunks of 500 = 5000 anime. */
const MAX_CHUNKS = 10;

/**
 * The whole anime list of a user (all statuses and custom lists) in as few
 * requests as possible. Unknown or private user = empty collection.
 */
export async function fetchUserCollection(userName: string, deps?: RequestDeps): Promise<UserCollection> {
  const byId = new Map<number, ListEntry>();
  let customListNames: string[] = [];
  try {
    for (let chunk = 1; chunk <= MAX_CHUNKS; chunk++) {
      const data = await anilistRequest<CollectionResponse>(
        COLLECTION_QUERY,
        { userName, chunk, perChunk: 500 },
        deps,
      );
      const col = data.MediaListCollection;
      if (!col) break;
      if (chunk === 1) customListNames = col.user?.mediaListOptions?.animeList?.customLists ?? [];
      for (const list of col.lists ?? []) {
        for (const e of list?.entries ?? []) {
          if (!e?.media || byId.has(e.media.id)) continue;
          byId.set(e.media.id, {
            status: e.status,
            updatedAt: e.updatedAt ?? 0,
            customLists: (e.customLists ?? []).filter((c) => c.enabled).map((c) => c.name),
            media: e.media,
          });
        }
      }
      if (!col.hasNextChunk) break;
    }
  } catch (e) {
    if (e instanceof AniListError && e.status === 404) return { customListNames: [], entries: [] };
    throw e;
  }
  const entries = [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt || b.media.id - a.media.id);
  return { customListNames, entries };
}

export interface MediaDetail extends AniListMedia {
  endDate: { year: number | null; month: number | null; day: number | null } | null;
  nextAiringEpisode: { episode: number; airingAt: number } | null;
  aired: { nodes: Array<{ episode: number; airingAt: number } | null> | null } | null;
  upcoming: { nodes: Array<{ episode: number; airingAt: number } | null> | null } | null;
  streamingEpisodes: Array<{ title: string | null; thumbnail: string | null } | null> | null;
  trailer: { id: string | null; site: string | null } | null;
  studios: { nodes: Array<{ name: string } | null> | null } | null;
}

export async function fetchMediaDetail(id: number, deps?: RequestDeps): Promise<MediaDetail | null> {
  try {
    const data = await anilistRequest<{ Media: MediaDetail | null }>(MEDIA_DETAIL_QUERY, { id }, deps);
    return data.Media;
  } catch (e) {
    if (e instanceof AniListError && e.status === 404) return null;
    throw e;
  }
}

export async function fetchBrowsePage(
  variables: Record<string, unknown>,
  page: number,
  perPage: number,
  deps?: RequestDeps,
): Promise<MediaPage> {
  const data = await anilistRequest<BrowseResponse>(BROWSE_QUERY, { ...variables, page, perPage }, deps);
  return {
    hasNextPage: data.Page.pageInfo.hasNextPage,
    media: data.Page.media.filter((m): m is AniListMedia => m !== null),
  };
}
