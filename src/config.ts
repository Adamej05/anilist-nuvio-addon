/**
 * Central settings. Everything you might want to tweak lives here.
 * The defaults below can be overridden per deployment with environment
 * variables (Vercel: Project -> Settings -> Environment Variables):
 *   ANILIST_USER, ENABLE_SPLIT_FILTERS, MAPPING_URL.
 */

/** AniList user for the list catalogs. "-" in ANILIST_USER turns the lists off. */
export const DEFAULT_ANILIST_USER = "Achnatos";

/** Custom AniList lists drawn with the "two people" badge (lower case). Other custom lists get a bookmark. */
export const DUO_LIST_NAMES = ["duo"];

/** Custom lists that get a bookmark badge (lower case). Empty: only Duo gets an icon. */
export const BOOKMARK_LIST_NAMES: string[] = [];

/** Test catalog with two separate filters (rok + sezona). */
export const DEFAULT_ENABLE_SPLIT_FILTERS = false;

/** Compact mapping published by .github/workflows/mapping.yml to the "data" branch. */
export const DEFAULT_MAPPING_URL =
  "https://raw.githubusercontent.com/Adamej05/anilist-nuvio-addon/data/mapping.json";

/** AniList media formats included in the season catalogs. */
export const FORMATS = ["TV", "TV_SHORT", "MOVIE", "ONA", "OVA", "SPECIAL"] as const;
export type MediaFormat = (typeof FORMATS)[number];

/** How many of the newest years get "season + year" options in the filter. */
export const SEASON_YEARS_COUNT = 10;

/** Oldest year offered in the filter. */
export const MIN_YEAR = 1960;

/** Items per catalog page. AniList allows at most 50 per page. */
export const PAGE_SIZE = 50;

/** Cache lifetimes in seconds. */
export const TTL = {
  seasonal: 6 * 60 * 60,
  userList: 15 * 60,
  mapping: 24 * 60 * 60,
  manifest: 60 * 60,
  /** Anime detail from AniList (episodes, schedule). */
  mediaDetail: 6 * 60 * 60,
  /** Posters with badges never change for the same URL. */
  poster: 30 * 24 * 60 * 60,
} as const;

/** Which title to show: English when AniList has one, otherwise romaji. */
export const TITLE_LANGUAGE: "english" | "romaji" = "english";

/** Behaviour on HTTP 429 from AniList. */
export const RETRY = {
  maxRetries: 2,
  /** Never wait longer than this per retry (Nuvio would time out). */
  maxWaitSeconds: 15,
  /** Wait used when AniList sends no Retry-After header. */
  defaultWaitSeconds: 5,
} as const;

export const ANILIST_URL = "https://graphql.anilist.co";

/** Workers send no User-Agent by default; AniList asks API clients to identify themselves. */
export const USER_AGENT = "anilist-nuvio-addon/1.0 (+https://github.com/Adamej05/anilist-nuvio-addon)";

/** Full Fribb dataset, used only as a fallback when the compact mapping is unavailable. */
export const FRIBB_URL = "https://raw.githubusercontent.com/Fribb/anime-lists/master/anime-list-full.json";

export const ADDON_VERSION = "1.2.0";
export const ADDON_ID = "community.anilist-seasons";
export const ADDON_NAME = "AniList Sezóny";
