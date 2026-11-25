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

export const USER_LIST_QUERY = `
query ($userName: String, $status_in: [MediaListStatus], $page: Int, $perPage: Int) {
  Page(page: $page, perPage: $perPage) {
    pageInfo { hasNextPage }
    mediaList(userName: $userName, type: ANIME, status_in: $status_in, sort: [UPDATED_TIME_DESC]) {
      media { ${MEDIA_FIELDS} }
    }
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

interface UserListResponse {
  Page: { pageInfo: { hasNextPage: boolean }; mediaList: Array<{ media: AniListMedia | null } | null> };
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

export async function fetchUserListPage(
  userName: string,
  statuses: string[],
  page: number,
  perPage: number,
  deps?: RequestDeps,
): Promise<MediaPage> {
  try {
    const data = await anilistRequest<UserListResponse>(
      USER_LIST_QUERY,
      { userName, status_in: statuses, page, perPage },
      deps,
    );
    return {
      hasNextPage: data.Page.pageInfo.hasNextPage,
      media: data.Page.mediaList.map((e) => e?.media ?? null).filter((m): m is AniListMedia => m !== null),
    };
  } catch (e) {
    // Unknown or private user: an empty list instead of an error.
    if (e instanceof AniListError && e.status === 404) return { hasNextPage: false, media: [] };
    throw e;
  }
}
